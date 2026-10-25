// Diagnostics shared by heal, the engine worker, fixers and the UI. Adapters
// normalize whatever their compiler reports into this shape (PLAN §6.1), so
// nothing downstream parses adapter-specific strings.

import type { Range } from "./index";

/**
 * How serious a diagnostic is. Typst itself only reports `error` and `warning`;
 * `info` is for reports from typstream (e.g. a fixer replaced a missing image).
 * @public
 */
export type DiagnosticSeverity = "error" | "warning" | "info";

/**
 * One step of the call chain that led to a diagnostic, outermost last, as Typst
 * reports it ("error occurred in this call of function `table`").
 * @public
 */
export interface TraceItem {
  message: string;
  /** Where the step happened in the document text (UTF-16), or `null` if outside it. */
  span: Range | null;
}

/**
 * A problem with a document, from the compiler, the healer or a fixer.
 *
 * All positions are UTF-16 offsets into the text the client sent for the
 * document (`document/open` + `document/edit`). Engines convert from Typst's
 * UTF-8 byte spans at the wasm boundary and undo their own worker-side patches
 * (Layer 3 fixers, injected anchors) before reporting. The client maps them on
 * to the raw stream through heal's source map ({@link mapDiagnostic}).
 * @public
 */
export interface Diagnostic {
  severity: DiagnosticSeverity;
  /**
   * Where the problem is in the document text. When it originated in another
   * file (preamble, package), this is the closest call site in the document
   * (from the trace) and {@link Diagnostic.file} holds the original location.
   * `null` when Typst attached no position the document contains (e.g. a
   * missing font).
   */
  span: Range | null;
  message: string;
  /** Suggestions, one per entry (Typst's `hint:` lines, never folded into `message`). */
  hints: string[];
  /** Call chain, innermost first. Empty when there is none. */
  trace: TraceItem[];
  /** Original location when the problem is in a file other than the document. */
  file?: { path: string; span: Range | null };
  /** Who reported it: `"typst"`, `"heal"`, a fixer name, … */
  source?: string;
  /** Machine-readable kind when the source has one, e.g. a lint rule id. Typst has none. */
  code?: string;
}

/** @public */
export const isError = (d: Diagnostic): boolean => d.severity === "error";

/** @public */
export const hasErrors = (ds: readonly Diagnostic[]): boolean => ds.some(isError);

/**
 * Maps a position, as {@link SourceMap.toOriginal}, heal's `map.toInput` and
 * {@link mapPosition} (curried over an edit) all do. `assoc` says which side to
 * stick to when the position is at a change: 1 after it, -1 before it.
 * @public
 */
export type PositionMapper = (pos: number, assoc: 1 | -1) => number;

const mapRange = (r: Range, map: PositionMapper): Range => {
  // The start sticks right and the end left, so text inserted exactly at a
  // boundary doesn't widen the range; never let it invert.
  const from = map(r.from, 1);
  const to = map(r.to, -1);
  return to < from ? { from, to: from } : { from, to };
};

/**
 * Maps a diagnostic's document positions (`span` and trace spans; not `file`,
 * which is in another file). Use it to carry diagnostics from healed source to
 * the raw stream, or across edits to a later revision.
 *
 * @example
 * mapDiagnostic(d, (pos, assoc) => healed.map.toInput(pos, assoc));
 * mapDiagnostic(d, (pos, assoc) => mapPosition(pos, edit, assoc));
 * @public
 */
export const mapDiagnostic = (d: Diagnostic, map: PositionMapper): Diagnostic => ({
  ...d,
  span: d.span && mapRange(d.span, map),
  trace: d.trace.map((t) => ({ ...t, span: t.span && mapRange(t.span, map) })),
});

const severityRank: Record<DiagnosticSeverity, number> = { error: 0, warning: 1, info: 2 };

/**
 * Orders by position (diagnostics without a span last), then severity, then
 * message. A total order, so sorted lists compare equal across runs.
 * @public
 */
export const compareDiagnostics = (a: Diagnostic, b: Diagnostic): number => {
  if (a.span !== b.span) {
    if (a.span === null) return 1;
    if (b.span === null) return -1;
    if (a.span.from !== b.span.from) return a.span.from - b.span.from;
    if (a.span.to !== b.span.to) return a.span.to - b.span.to;
  }
  if (a.severity !== b.severity) return severityRank[a.severity] - severityRank[b.severity];
  return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
};

const diagnosticKey = (d: Diagnostic): string =>
  JSON.stringify([d.severity, d.span?.from, d.span?.to, d.message, d.hints, d.file?.path]);

/**
 * Sorts with {@link compareDiagnostics} and drops repeats (same severity, span,
 * message, hints and file). Typst reports the same error once per evaluation
 * of a repeated call; users only need it once.
 * @public
 */
export const normalizeDiagnostics = (ds: readonly Diagnostic[]): Diagnostic[] => {
  const seen = new Set<string>();
  const out: Diagnostic[] = [];
  for (const d of [...ds].sort(compareDiagnostics)) {
    const key = diagnosticKey(d);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
};

/**
 * Zero-based line and UTF-16 column of `offset` in `text`. Lines end at `\n`
 * (heal's normalizer has already turned `\r\n` into `\n`).
 * @public
 */
export const lineColumn = (text: string, offset: number): { line: number; column: number } => {
  let line = 0;
  let start = 0;
  for (let i = text.indexOf("\n"); i !== -1 && i < offset; i = text.indexOf("\n", i + 1)) {
    line++;
    start = i + 1;
  }
  return { line, column: offset - start };
};

/**
 * One-line-per-entry plain-text rendering, e.g. for logs and test failures:
 * `error 3:5: unclosed delimiter` followed by indented `hint:` lines. Pass the
 * document text to get one-based line:column instead of offsets.
 * @public
 */
export const formatDiagnostic = (d: Diagnostic, text?: string): string => {
  let where = "";
  if (d.span) {
    if (text === undefined) where = ` ${d.span.from}..${d.span.to}`;
    else {
      const { line, column } = lineColumn(text, d.span.from);
      where = ` ${line + 1}:${column + 1}`;
    }
  }
  const file = d.file ? ` (in ${d.file.path})` : "";
  return [`${d.severity}${where}: ${d.message}${file}`, ...d.hints.map((h) => `  hint: ${h}`)].join("\n");
};
