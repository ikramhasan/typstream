// Images a document names but has no file for (PLAN §6.4 "Images"). Typst
// reads images only from the document's virtual file system, and a model can
// only write a path: `#image("diagram.png")`, or a URL, which Typst takes for
// a path too. The client finds the complete paths in the input, asks the app's
// `resolveImage` for their bytes and writes them into the document's files,
// which recompiles it. Until then, and for paths the app can't resolve, the
// worker's `missing-image` fixer shows a placeholder. The client resolves,
// not the worker: it works the same over any transport (a WebSocket server
// fetches nothing a client names), and the resolver is the app's code, which
// can use its own uploads, a proxy or credentials.

import type { Diagnostic } from "@typstream/core";
import { fileKey, imageSources, stringValue } from "./image-paths";

/**
 * Gives the bytes of an image a document names but has no file for: a URL
 * (`#image("https://…")`; `fetchImages` from `@typstream/engine/images`
 * downloads those) or a name the app knows
 * (`"diagram.png"`). Return `null` to leave it missing; it shows as a
 * placeholder. A throw shows as a placeholder too, and its message is in the
 * image's diagnostic. Called at most once per path and document, once the
 * path's string is complete; `signal` aborts when the document is disposed.
 * @public
 */
export type ImageResolver = (
  path: string,
  options: { signal: AbortSignal },
) => Promise<Uint8Array | null | undefined> | Uint8Array | null | undefined;

/** The image paths complete in `text` that a file could be written for, each once. */
export const imagePaths = (text: string): string[] => [...new Set(imageSources(text).map((s) => s.path))];

type Entry =
  | { status: "loading" }
  | { status: "loaded" }
  | { status: "missing" }
  | { status: "failed"; reason: string };

/** What a document's images need from it. */
export interface ImageHost {
  /** Whether the document's own files (or its plugins') have a file at this key (`fileKey`). */
  has(key: string): boolean;
  /** An image arrived: write it into the document's files. */
  loaded(key: string, bytes: Uint8Array): void;
  /** An image failed: its diagnostics say something else now. */
  changed(): void;
}

/** One document's images: what it asked the resolver for, and what came of it. */
export class DocumentImages {
  private readonly entries = new Map<string, Entry>();
  private readonly abort = new AbortController();

  constructor(
    private readonly resolve: ImageResolver,
    private readonly host: ImageHost,
  ) {}

  /** Asks for the images `text` names that the document has no file for and hasn't asked for. */
  scan(text: string): void {
    for (const { path, key } of imageSources(text)) {
      if (!this.entries.has(key) && !this.host.has(key)) this.request(path, key);
    }
  }

  private async request(path: string, key: string): Promise<void> {
    this.entries.set(key, { status: "loading" });
    const { signal } = this.abort;
    let entry: Entry;
    let bytes: Uint8Array | null | undefined;
    try {
      bytes = await this.resolve(path, { signal });
      entry = bytes ? { status: "loaded" } : { status: "missing" };
    } catch (e) {
      entry = { status: "failed", reason: e instanceof Error ? e.message : String(e) };
    }
    if (signal.aborted) return;
    this.entries.set(key, entry);
    if (bytes) this.host.loaded(key, bytes);
    else this.host.changed();
  }

  /**
   * An image's "file not found" said better (PLAN §5.5): still loading (an
   * `info`: it's coming), or why the resolver failed. `input` is the text the
   * diagnostics' spans are in.
   */
  describe(diagnostics: Diagnostic[], input: string): Diagnostic[] {
    if (this.entries.size === 0) return diagnostics;
    return diagnostics.map((d) => {
      if (!d.span || !/^file not found/.test(d.message)) return d;
      const literal = input.slice(d.span.from, d.span.to);
      const path = literal.startsWith('"') ? stringValue(literal) : null;
      const key = path === null ? null : fileKey(path);
      const entry = key === null ? undefined : this.entries.get(key);
      if (entry?.status === "loading") return { ...d, severity: "info", message: `image ${literal} is loading` };
      if (entry?.status === "failed") return { ...d, message: `image ${literal} failed to load (${entry.reason})` };
      return d;
    });
  }

  dispose(): void {
    this.abort.abort();
  }
}
