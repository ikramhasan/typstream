// The default adapter: @typstream/engine-wasm, our wasm build of Typst 0.15.1
// (PLAN §6.1). One wasm `Engine` per document, so each keeps its own files and
// changed-page hashes; all of them share the wasm instance, and with it the
// fonts and Typst's memoization cache.
//
// Fonts (PLAN §6.4, #11): the base fonts are loaded at `init`. Lazy fonts are
// registered from their metadata only; a compile that selects one reports it
// missing (it falls back or draws tofu), the adapter fetches it, and the
// result's `pending` tells the server to recompile once it has arrived.

import type { ExportFormat, FontSource } from "@typstream/core";
import initWasm, { Engine, type InitInput } from "@typstream/engine-wasm";
import type { AdapterCompileResult, AdapterDocument, EngineAdapter } from "./adapter";

/**
 * The Typst version engine-wasm compiles with.
 * @public
 */
export const TYPST_VERSION = "0.15.1";

/**
 * A font: a URL to fetch, or the bytes of a font file (TTF, OTF or TTC).
 * @public
 */
export type FontInput = string | URL | Uint8Array;

/**
 * A font downloaded only when a document uses it. `info` is engine-wasm's
 * metadata for the file (`Engine.font_info`), as in `scriptFonts` from
 * `@typstream/engine-wasm/fonts`.
 * @public
 */
export interface LazyFontInput {
  /** Where to fetch the font file from. */
  url: string | URL;
  /** `Engine.font_info` of that file. */
  info: string;
}

/**
 * How to load engine-wasm.
 * @public
 */
export interface EngineWasmOptions {
  /**
   * The compiler: a URL (fetched and compiled while it streams in), a fetch
   * `Response`, the bytes, or a compiled `WebAssembly.Module`. Default:
   * `engine_bg.wasm` next to engine-wasm's JS, which bundlers emit as an asset.
   */
  wasm?: InitInput | Promise<InitInput>;
  /** Fonts every document gets, in addition to those sent with `initialize`. */
  fonts?: readonly FontInput[];
  /**
   * Fonts registered at start and downloaded the first time a document uses
   * one, e.g. `scriptFonts` from `@typstream/engine-wasm/fonts`. URL fonts
   * with `info` sent with `initialize` join them.
   */
  lazyFonts?: readonly LazyFontInput[];
  /**
   * The Cache Storage cache fonts fetched by URL are kept in, so they are
   * downloaded once rather than once per session; `false` fetches every time.
   * Default `"typstream-fonts"`. Ignored where Cache Storage is unavailable.
   */
  fontCache?: string | false;
}

/** How long a font that failed to download is left alone before a compile asks for it again. */
const RETRY_FAILED_FONT_MS = 30_000;

/** The parts of the Cache Storage API used here (the package compiles without DOM types). */
interface FontCacheStorage {
  open(name: string): Promise<{
    match(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | undefined>;
    put(key: string, response: unknown): Promise<void>;
    delete(key: string): Promise<boolean>;
  }>;
}

type FontCache = Awaited<ReturnType<FontCacheStorage["open"]>>;

const openCache = async (name: string | false): Promise<FontCache | null> => {
  const storage = (globalThis as { caches?: FontCacheStorage }).caches;
  if (!name || !storage) return null;
  // Cache Storage throws in some contexts (opaque origins, private modes): fetch instead.
  return storage.open(name).catch(() => null);
};

/**
 * Fetches a font, through the cache when there is one. `fresh` skips the cached
 * copy (it turned out stale) and replaces it.
 */
const fetchFont = async (url: string | URL, cache: FontCache | null, fresh = false): Promise<Uint8Array> => {
  const key = String(url);
  if (cache && !fresh) {
    const hit = await cache.match(key).catch(() => undefined);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`font ${key}: HTTP ${response.status}`);
  if (cache) await cache.put(key, response.clone()).catch(() => {});
  return new Uint8Array(await response.arrayBuffer());
};

const fontInput = (font: FontSource): FontInput => (font.kind === "url" ? font.url : font.data);

/**
 * The engine-wasm {@link EngineAdapter}. Targets HTML and paged (changed-page
 * SVG); exports HTML, and PDF when the wasm has it (engine-wasm's own build
 * does, #18; a custom `wasm` built without the `pdf` feature doesn't).
 * @public
 */
export const engineWasm = (options: EngineWasmOptions = {}): EngineAdapter => {
  let exports: ExportFormat[] = ["html"];
  let cache: FontCache | null = null;
  /** Lazy font id → its URL. */
  const lazyUrls = new Map<number, string | URL>();
  /** Lazy fonts being fetched, or that failed recently (retried after a while). */
  const loading = new Map<number, Promise<void> | "failed">();

  const loadLazy = async (id: number, url: string | URL): Promise<void> => {
    const bytes = await fetchFont(url, cache);
    try {
      Engine.load_font(id, bytes);
    } catch (e) {
      // A cached copy of another version of the file: fetch it again.
      if (!cache) throw e;
      Engine.load_font(id, await fetchFont(url, cache, true));
    }
  };

  /** Starts fetching the fonts a compile missed; resolves when they are all loaded. */
  const fetchMissing = (missing: readonly number[]): Promise<void> | undefined => {
    const waits: Promise<void>[] = [];
    for (const id of missing) {
      let state = loading.get(id);
      const url = lazyUrls.get(id);
      if (state === "failed" || url === undefined) continue;
      if (!state) {
        state = loadLazy(id, url).then(
          () => void loading.delete(id),
          (e: unknown) => {
            loading.set(id, "failed");
            setTimeout(() => loading.delete(id), RETRY_FAILED_FONT_MS);
            throw e;
          },
        );
        loading.set(id, state);
      }
      waits.push(state);
    }
    return waits.length > 0 ? Promise.all(waits).then(() => {}) : undefined;
  };

  /** Adds `pending` when the compile missed lazy fonts. */
  const withPending = <T extends AdapterCompileResult>(result: T, missing: readonly number[]): T => {
    const pending = fetchMissing(missing);
    return pending ? { ...result, pending } : result;
  };

  return {
    info: { name: "engine-wasm", typstVersion: TYPST_VERSION },
    targets: ["html", "paged"],
    // Known once the wasm is loaded; the server reads it after `init`.
    get exports() {
      return exports;
    },

    async init(init) {
      const sources = init.fonts ?? [];
      const lazy = [
        ...(options.lazyFonts ?? []),
        ...sources.flatMap((f) => (f.kind === "url" && f.info !== undefined ? [{ url: f.url, info: f.info }] : [])),
      ];
      const eager = [
        ...(options.fonts ?? []),
        ...sources.filter((f) => !(f.kind === "url" && f.info !== undefined)).map(fontInput),
      ];
      cache = await openCache(options.fontCache ?? "typstream-fonts");
      const [, loaded] = await Promise.all([
        // The glue streams a URL or Response through `instantiateStreaming`.
        initWasm(options.wasm === undefined ? undefined : { module_or_path: options.wasm }),
        Promise.all(eager.map((font) => (font instanceof Uint8Array ? font : fetchFont(font, cache)))),
      ]);
      // Fonts belong to the wasm instance: every document's engine sees them.
      for (const font of loaded) Engine.add_font(font);
      for (const font of lazy) lazyUrls.set(Engine.register_font(font.info), font.url);
      if (Engine.features().includes("pdf")) exports = ["html", "pdf"];
    },

    open(): AdapterDocument {
      const engine = new Engine();
      return {
        setFiles(files) {
          for (const [path, content] of Object.entries(files)) {
            if (content === null) engine.remove_file(path);
            else if (typeof content === "string") engine.set_source(path, content);
            else engine.set_file(path, content);
          }
        },
        setInputs: (inputs) => engine.set_inputs(inputs),
        compileHtml() {
          const r = engine.compile_html();
          // `ms` covers compile, export and eviction; HTML export has no separate timing.
          const result = { html: r.ok ? (r.html ?? "") : null, diagnostics: r.diagnostics, compileMs: r.ms };
          return withPending(result, r.missingFonts);
        },
        compilePaged({ fullPages }) {
          if (fullPages) engine.reset_pages();
          const r = engine.compile_svg_changed();
          const result = {
            output: r.ok ? { pageCount: r.pageCount ?? 0, changed: r.changed ?? [] } : null,
            diagnostics: r.diagnostics,
            compileMs: r.compileMs,
            exportMs: r.exportMs,
          };
          return withPending(result, r.missingFonts);
        },
        check({ target }) {
          if (target === "html") {
            const r = engine.compile_html();
            return { diagnostics: r.diagnostics, compileMs: r.ms };
          }
          const r = engine.check_paged();
          return { diagnostics: r.diagnostics, compileMs: r.ms };
        },
        exportPdf() {
          const r = engine.compile_pdf();
          const result = { pdf: r.ok ? (r.pdf ?? null) : null, diagnostics: r.diagnostics, compileMs: r.ms };
          return withPending(result, r.missingFonts);
        },
        close: () => engine.free(),
      };
    },

    memoryBytes: () => Engine.memory_bytes(),
  };
};
