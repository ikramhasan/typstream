// What a document is to the engine: `/main.typ` (an optional preamble, then the
// text), files under `/`, and `sys.inputs`; and how diagnostics come back to
// the text's own coordinates.

import type { Diagnostic, FileContent, Range } from "@typstream/core";
import type { FileEntry } from "./pool";

/** Diagnostics inside the preamble report this path in `Diagnostic.file`. */
export const PREAMBLE_PATH = "/preamble.typ";

const RESERVED = new Set(["/main.typ", PREAMBLE_PATH]);

/**
 * The engine path of a document file: `img/a.png` (relative to the document
 * root, as the protocol says; a leading `/` is accepted) becomes `/img/a.png`.
 * Throws on paths that escape the root or collide with the document itself.
 */
export const toVirtualPath = (path: string): string => {
  const segments = path.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.length === 0 || segments.some((s) => s === "..")) throw new Error(`invalid file path: ${path}`);
  const virtual = `/${segments.join("/")}`;
  if (RESERVED.has(virtual)) throw new Error(`file path is reserved for the document: ${path}`);
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

export interface Assembled {
  main: string;
  /** Where the document text starts in `main`. */
  offset: number;
}

/**
 * `/main.typ` for a document. The preamble goes first, so its set and show
 * rules apply to the text, then a newline so the text starts on a line of its own.
 */
export const assemble = (text: string, preamble?: string): Assembled =>
  preamble ? { main: `${preamble}\n${text}`, offset: preamble.length + 1 } : { main: text, offset: 0 };

/**
 * Moves diagnostics from `main` back to the document text. A position inside
 * the preamble isn't in the text: the diagnostic's `file` then points into the
 * preamble and `span` falls back to the nearest call site in the text, from
 * the trace (as engine-wasm does for other files).
 */
export const toDocument = (diagnostics: readonly Diagnostic[], { offset }: Assembled): Diagnostic[] => {
  if (offset === 0) return [...diagnostics];
  const shift = (r: Range | null): Range | null =>
    r && r.from >= offset ? { from: r.from - offset, to: r.to - offset } : null;
  return diagnostics.map((d) => {
    const trace = d.trace.map((t) => ({ ...t, span: shift(t.span) }));
    const span = shift(d.span);
    if (span || !d.span) return { ...d, span, trace };
    const callSite = trace.find((t) => t.span)?.span ?? null;
    return { ...d, span: callSite, trace, file: d.file ?? { path: PREAMBLE_PATH, span: d.span } };
  });
};
