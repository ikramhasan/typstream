// Font catalogues (PLAN §6.4): libraries of fonts loaded by family name, such
// as @typstream/google-fonts. Typst warns "unknown font family: x" when a
// document names a family its font book lacks (typst-library's
// `check_font_list`) and carries on with the next family or a fallback. After
// each compile the server looks those families up in the document's
// catalogues, has the adapter load their files, and recompiles once they have
// arrived, through the `pending` lazy fonts use. Fonts are the worker's: a
// family loads once, every document has it from then on, and the client hears
// of it (`fonts/loaded`) so the HTML target can show it too.

import type {
  Diagnostic,
  FontCatalogue,
  FontCatalogueFamily,
  FontCatalogueFile,
  FontCatalogueIndex,
  LoadedFontFamily,
} from "@typstream/core";
import type { EngineAdapter } from "./adapter";

/**
 * How the server loads families from font catalogues.
 * @beta
 */
export interface FontCatalogueOptions {
  /** Catalogues every document loads from, whatever the client sends. Default none. */
  catalogues?: readonly FontCatalogue[];
  /**
   * Also use the catalogues the client lists (`initialize`'s and
   * `document/open`'s). Default true: in a browser worker the client is the
   * page. A server facing untrusted clients sets false, or any client could
   * make it fetch any URL.
   */
  trustClient?: boolean;
  /** Fetches an index. Default `fetch`. Font files are the adapter's to fetch. */
  fetch?: (url: string) => Promise<Response>;
}

/** A font catalogue's `maxBytes` when it sets none: 5 MB. @beta */
export const DEFAULT_FONT_FAMILY_BYTES = 5_000_000;

/** A family whose files add up to no more than this loads whole; a larger one only its regular and bold. */
const WHOLE_FAMILY_BYTES = 1_000_000;

/** How long an index or a family that failed to download is left alone, ms. */
const RETRY_MS = 30_000;

/** Typst's warning (typst-library's text/mod.rs, `check_font_list`); the family is lowercased. */
const UNKNOWN_FAMILY = /^unknown font family: (.+)$/;

/** The families a compile's warnings say no font has, each once. */
export const unknownFamilies = (diagnostics: readonly Diagnostic[]): string[] => {
  const families = new Set<string>();
  for (const d of diagnostics) {
    const family = d.severity === "warning" ? UNKNOWN_FAMILY.exec(d.message)?.[1] : undefined;
    if (family) families.add(family);
  }
  return [...families];
};

const nearest = (files: readonly FontCatalogueFile[], weight: number): FontCatalogueFile | undefined => {
  let best: FontCatalogueFile | undefined;
  for (const file of files) {
    const w = file.weight as number;
    if (!best || Math.abs(w - weight) < Math.abs((best.weight as number) - weight)) best = file;
  }
  return best;
};

/**
 * The files of a family to load: all of them when they're small together;
 * otherwise, for each style, its variable font, or the static files nearest to
 * regular (400) and bold (700). Typst gives other weights the nearest one
 * loaded. Static families run to 18 files (Lato's are 0.6 MB each), and a
 * document rarely uses more than two weights.
 */
export const pickFiles = (family: FontCatalogueFamily): FontCatalogueFile[] => {
  const total = family.files.reduce((sum, f) => sum + (f.bytes ?? 0), 0);
  if (total <= WHOLE_FAMILY_BYTES) return family.files;
  const picked = new Set<FontCatalogueFile>();
  for (const style of new Set(family.files.map((f) => f.style))) {
    const files = family.files.filter((f) => f.style === style);
    const variable = files.find((f) => Array.isArray(f.weight));
    if (variable) {
      picked.add(variable);
      continue;
    }
    for (const weight of [400, 700]) {
      const file = nearest(files, weight);
      if (file) picked.add(file);
    }
  }
  return family.files.filter((f) => picked.has(f));
};

/** Why a family isn't loaded: no catalogue has it, or it's over its catalogue's limit. Not retried. */
class Unavailable extends Error {}

const megabytes = (bytes: number): string => `${(bytes / 1e6).toFixed(1)} MB`;

interface Found {
  family: FontCatalogueFamily;
  catalogue: FontCatalogue;
  /** The index's `base`, absolute. */
  base: string;
}

/**
 * Resolves when any of `waits` resolves and the rest have settled; rejects
 * like the first if none does. `undefined` when there is nothing to wait for.
 */
export const anyArrives = (waits: readonly Promise<void>[]): Promise<void> | undefined =>
  waits.length === 0
    ? undefined
    : Promise.allSettled(waits).then((results) => {
        if (results.some((r) => r.status === "fulfilled")) return;
        throw (results[0] as PromiseRejectedResult).reason;
      });

/** The families documents name, loaded from their catalogues. One per server. */
export class FontCatalogues {
  /** `initialize`'s catalogues, when the client is trusted. */
  private client: readonly FontCatalogue[] = [];
  /** Indexes by URL: fetched, on their way, or the time a failed one may be fetched again. */
  private readonly indexes = new Map<string, FontCatalogueIndex | Promise<void> | number>();
  /** Families by name: loaded, loading, or the time a failed one may be loaded again. */
  private readonly families = new Map<string, "loaded" | Promise<void> | number>();
  /** Families no catalogue of a document has (or too large), keyed with the catalogues' indexes. */
  private readonly unavailable = new Set<string>();

  constructor(
    private readonly adapter: EngineAdapter,
    private readonly loaded: (family: LoadedFontFamily) => void,
    private readonly log: (message: string) => void,
    private readonly options: FontCatalogueOptions = {},
  ) {}

  /** The adapter can load fonts as documents need them. */
  get enabled(): boolean {
    return this.adapter.addFonts !== undefined;
  }

  /** `initialize`'s catalogues. */
  setClient(catalogues: readonly FontCatalogue[] | undefined): void {
    this.client = this.trusted(catalogues);
  }

  /** A document's catalogues: the server's, `initialize`'s, then its own; each index once, first place kept. */
  forDocument(own: readonly FontCatalogue[] | undefined): FontCatalogue[] {
    const byIndex = new Map<string, FontCatalogue>();
    for (const c of [...(this.options.catalogues ?? []), ...this.client, ...this.trusted(own)]) {
      if (typeof c?.index === "string" && !byIndex.has(c.index)) byIndex.set(c.index, c);
    }
    return [...byIndex.values()];
  }

  /**
   * Starts loading the families a compile's `diagnostics` say no font has,
   * from `catalogues`. The promise resolves once one has arrived and every
   * other has settled (the document then compiles again), and rejects when
   * none can arrive; `undefined` when nothing is on its way.
   */
  missing(diagnostics: readonly Diagnostic[], catalogues: readonly FontCatalogue[]): Promise<void> | undefined {
    if (!this.enabled || catalogues.length === 0) return undefined;
    const waits: Promise<void>[] = [];
    const key = catalogues.map((c) => c.index).join("\n");
    for (const name of unknownFamilies(diagnostics)) {
      const state = this.families.get(name);
      if (state === "loaded" || (typeof state === "number" && Date.now() < state)) continue;
      if (state instanceof Promise) {
        waits.push(state);
        continue;
      }
      if (this.unavailable.has(`${name}\n${key}`)) continue;
      const load = this.load(name, catalogues);
      this.families.set(name, load);
      load.then(
        () => this.families.set(name, "loaded"),
        (e: unknown) => {
          if (!(e instanceof Unavailable)) {
            this.families.set(name, Date.now() + RETRY_MS);
            return;
          }
          this.families.delete(name);
          this.unavailable.add(`${name}\n${key}`);
        },
      );
      waits.push(load);
    }
    return anyArrives(waits);
  }

  private async load(name: string, catalogues: readonly FontCatalogue[]): Promise<void> {
    const found = await this.find(name, catalogues);
    if (!found) throw new Unavailable(`no font catalogue has the family "${name}"`);
    const files = pickFiles(found.family);
    const bytes = files.reduce((sum, f) => sum + (f.bytes ?? 0), 0);
    const max = found.catalogue.maxBytes ?? DEFAULT_FONT_FAMILY_BYTES;
    if (bytes > max) {
      throw new Unavailable(
        `font family "${found.family.name}" is ${megabytes(bytes)}, more than its catalogue allows (${megabytes(max)})`,
      );
    }
    const urls = files.map((f) => new URL(f.path, found.base).href);
    await this.adapter.addFonts?.(urls);
    this.loaded({ family: name, name: found.family.name, files: files.map((f, i) => ({ ...f, url: urls[i] ?? "" })) });
  }

  /**
   * The first of `catalogues` that has the family, once their indexes are in;
   * `null` when none has it. Throws (to be tried again) when an index that
   * might have it didn't load.
   */
  private async find(name: string, catalogues: readonly FontCatalogue[]): Promise<Found | null> {
    let missed: string | null = null;
    for (const catalogue of catalogues) {
      let index = this.indexes.get(catalogue.index);
      if (index === undefined || (typeof index === "number" && Date.now() >= index)) {
        index = this.fetchIndex(catalogue.index);
        this.indexes.set(catalogue.index, index);
      }
      if (index instanceof Promise) {
        await index;
        index = this.indexes.get(catalogue.index);
      }
      if (typeof index !== "object" || index instanceof Promise) {
        missed ??= catalogue.index;
        continue;
      }
      const family = Object.hasOwn(index.families, name) ? index.families[name] : undefined;
      if (family) return { family, catalogue, base: new URL(index.base, catalogue.index).href };
    }
    if (missed) throw new Error(`font catalogue ${missed} isn't available`);
    return null;
  }

  /** Fetches an index into `indexes`; a failure is logged and leaves the time to try again. Never rejects. */
  private async fetchIndex(url: string): Promise<void> {
    try {
      const response = await (this.options.fetch ?? fetch)(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const index = (await response.json()) as FontCatalogueIndex;
      if (index?.version !== 1 || typeof index.base !== "string" || typeof index.families !== "object") {
        throw new Error("not a version 1 font catalogue index");
      }
      this.indexes.set(url, index);
    } catch (e) {
      this.indexes.set(url, Date.now() + RETRY_MS);
      this.log(`font catalogue ${url}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private trusted(catalogues: readonly FontCatalogue[] | undefined): readonly FontCatalogue[] {
    return this.options.trustClient === false ? [] : (catalogues ?? []);
  }
}
