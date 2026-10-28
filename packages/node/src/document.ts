// What a document is to the engine: `/main.typ` (for pages and PDFs the layout
// profile, then an optional preamble, then the text), files under `/`, and
// `sys.inputs`. Diagnostics come back to the text's
// coordinates with `fromMain` from `@typstream/engine/server`, which the
// protocol server uses too.

import type { FileContent } from "@typstream/core";
import { LAYOUT_PROFILE } from "@typstream/engine/server";
import type { FileEntry } from "./pool";

/**
 * The engine path of a document file: `img/a.png` (relative to the document
 * root, as the protocol says; a leading `/` is accepted) becomes `/img/a.png`.
 * A package's file (`@typstream/edu:0.1.0/lib.typ`, a local package) keeps its
 * spec prefix, which engine-wasm roots at the package. Throws on paths that
 * escape the root or collide with the document itself.
 */
export const toVirtualPath = (path: string): string => {
  const segments = path.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.length === 0 || segments.some((s) => s === "..")) throw new Error(`invalid file path: ${path}`);
  if (/^@[^/]+\/[^/:]+:\d+\.\d+\.\d+\/./.test(path)) return segments.join("/");
  const virtual = `/${segments.join("/")}`;
  if (virtual === "/main.typ") throw new Error(`file path is reserved for the document: ${path}`);
  return virtual;
};

let nextVersion = 1;
const byteVersions = new WeakMap<Uint8Array, number>();
const textVersions = new Map<string, number>();

/**
 * A version for file content, so pool workers keep files across calls: the
 * same `Uint8Array` object, or an equal string, gets the same version.
 */
export const fileEntry = (data: FileContent): FileEntry => {
  if (typeof data === "string") {
    let version = textVersions.get(data);
    if (version === undefined) {
      if (textVersions.size >= 1000) textVersions.clear();
      version = nextVersion++;
      textVersions.set(data, version);
    }
    return { version, data };
  }
  let version = byteVersions.get(data);
  if (version === undefined) {
    version = nextVersion++;
    byteVersions.set(data, version);
  }
  return { version, data };
};

/** Engine files for a document's `files`, keyed by virtual path. */
export const fileEntries = (files: Record<string, FileContent> | undefined): Map<string, FileEntry> => {
  const out = new Map<string, FileEntry>();
  for (const [path, data] of Object.entries(files ?? {})) out.set(toVirtualPath(path), fileEntry(data));
  return out;
};

/** `/main.typ` and where the document text starts in it. */
export interface Assembled {
  main: string;
  /** Where the document text starts in `main`. */
  offset: number;
  /** Where the preamble starts in `main`, after the layout profile. */
  preambleAt: number;
}

/**
 * `/main.typ` for a document, as `@typstream/engine`'s protocol server writes it:
 * for `paged` output (pages, a PDF, a check of them) the layout profile (#129)
 * first, then the preamble, so their set and show rules apply to the text, then
 * a newline so the text starts on a line of its own.
 */
export const assemble = (text: string, preamble: string | undefined, paged: boolean): Assembled => {
  const profile = paged ? LAYOUT_PROFILE : "";
  const prefix = profile + (preamble ? `${preamble}\n` : "");
  return { main: prefix + text, offset: prefix.length, preambleAt: profile.length };
};
