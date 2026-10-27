// The LLM repair loop (PLAN §5.7): diagnostics as a compact prompt, and a
// helper that validates, asks the model for a fix and repeats.

import { type Diagnostic, isError, lineColumn, normalizeDiagnostics } from "@typstream/core";
import { normalize } from "@typstream/heal";
import { type ValidateOptions, type ValidateResult, validate } from "./validate";

/** How {@link formatDiagnosticsForLLM} writes its prompt. @public */
export interface FormatOptions {
  /** Most diagnostics to include, errors first. Default 10. */
  maxDiagnostics?: number;
  /** Source lines shown before and after each problem line. Default 1. */
  contextLines?: number;
  /** Include warnings (and lint findings). Default true. */
  includeWarnings?: boolean;
  /** Text after the diagnostics. Default asks for the complete corrected document; `""` for none. */
  instructions?: string;
}

const DEFAULT_INSTRUCTIONS =
  "Fix every error, and the warnings where they point at a real mistake. Reply with the complete corrected Typst document only.";

/** Longest excerpt line; longer ones are cut around the problem. */
const MAX_LINE = 160;

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** One source line, clipped to MAX_LINE around `[col, col + width)`; returns the text and the new column. */
const clip = (line: string, col: number, width: number): { text: string; col: number } => {
  if (line.length <= MAX_LINE) return { text: line, col };
  const start = Math.max(0, Math.min(col - 40, line.length - MAX_LINE));
  const end = Math.min(line.length, Math.max(start + MAX_LINE, col + Math.min(width, MAX_LINE - 40)));
  const head = start > 0 ? "…" : "";
  return { text: `${head}${line.slice(start, end)}${end < line.length ? "…" : ""}`, col: col - start + head.length };
};

/** A rustc / Typst CLI style excerpt: numbered lines, `^^^` under the span, `= hint:` lines. */
const excerpt = (lines: readonly string[], text: string, d: Diagnostic, context: number): string[] => {
  const out: string[] = [];
  const span = d.span;
  if (span) {
    const start = lineColumn(text, span.from);
    const end = lineColumn(text, Math.max(span.from, span.to - 1));
    out.push(
      ` --> line ${start.line + 1}, column ${start.column + 1}${d.file ? ` (called from here; the problem is in ${d.file.path})` : ""}`,
    );
    const first = Math.max(0, start.line - context);
    const last = Math.min(lines.length - 1, start.line + context);
    const gutter = String(last + 1).length;
    const pad = " ".repeat(gutter);
    out.push(`${pad} |`);
    for (let i = first; i <= last; i++) {
      const line = lines[i] ?? "";
      if (i !== start.line) {
        out.push(`${String(i + 1).padStart(gutter)} | ${clip(line, 0, 0).text}`);
        continue;
      }
      // Underline to the end of the span on its first line; say so when it goes on.
      const width = Math.max(1, (end.line === start.line ? end.column + 1 : line.length) - start.column);
      const shown = clip(line, start.column, width);
      out.push(`${String(i + 1).padStart(gutter)} | ${shown.text}`);
      const multi = end.line > start.line ? ` (continues to line ${end.line + 1})` : "";
      out.push(`${pad} | ${" ".repeat(shown.col)}${"^".repeat(Math.min(width, MAX_LINE))}${multi}`);
    }
    for (const t of d.trace) {
      if (t.span) out.push(`${pad} = note: ${t.message} (line ${lineColumn(text, t.span.from).line + 1})`);
    }
    for (const h of d.hints) out.push(`${pad} = hint: ${h}`);
  } else {
    if (d.file) out.push(` --> ${d.file.path}`);
    for (const h of d.hints) out.push(`  = hint: ${h}`);
  }
  return out;
};

/**
 * Formats diagnostics as a compact repair prompt for an LLM: a summary line,
 * then each problem the way the Typst CLI prints it (message, location, the
 * source line with the span underlined, hints), then instructions. Errors come
 * first; repeats are dropped; output is capped by `maxDiagnostics` and long
 * lines are clipped, so the prompt stays small for large documents.
 *
 * @example
 * ```ts
 * const { ok, diagnostics } = await validate(source);
 * if (!ok) messages.push({ role: "user", content: `${formatDiagnosticsForLLM(source, diagnostics)}\n\n${source}` });
 * ```
 * @public
 */
export const formatDiagnosticsForLLM = (
  source: string,
  diagnostics: readonly Diagnostic[],
  options: FormatOptions = {},
): string => {
  const {
    maxDiagnostics = 10,
    contextLines = 1,
    includeWarnings = true,
    instructions = DEFAULT_INSTRUCTIONS,
  } = options;
  const all = normalizeDiagnostics(diagnostics).filter((d) => includeWarnings || isError(d));
  // Errors first, each group in source order.
  const sorted = [...all.filter(isError), ...all.filter((d) => !isError(d))];
  const errors = sorted.filter(isError).length;
  const warnings = sorted.length - errors;
  if (sorted.length === 0) return "The Typst document compiles without problems.";

  const counts = [errors && plural(errors, "error"), warnings && plural(warnings, "warning")].filter(Boolean);
  const parts = [`The Typst document has ${counts.join(" and ")}.`];
  const lines = source.split("\n");
  const shown = sorted.slice(0, Math.max(0, maxDiagnostics));
  for (const d of shown) {
    const label = d.code && d.source !== "typst" ? `${d.severity}[${d.code}]` : d.severity;
    parts.push([`${label}: ${d.message}`, ...excerpt(lines, source, d, contextLines)].join("\n"));
  }
  if (sorted.length > shown.length) parts.push(`(${plural(sorted.length - shown.length, "more problem")} not shown)`);
  if (instructions) parts.push(instructions);
  return parts.join("\n\n");
};

/** What {@link fixLoop} asks the model to repair. @public */
export interface FixRequest {
  /** The document as it stands. */
  source: string;
  /** Its diagnostics from {@link validate}: Typst's and lint findings, sorted and deduplicated. */
  diagnostics: Diagnostic[];
  /** {@link formatDiagnosticsForLLM} of the two above. */
  prompt: string;
  /** 1 for the first repair. */
  round: number;
}

/** One validated version of the document. @public */
export interface FixAttempt {
  /** The text validated: the original source, or a model's reply with its code fence removed. */
  source: string;
  /** What {@link validate} reported for `source`, lint findings included. */
  diagnostics: Diagnostic[];
  /** No errors; with `strict`, no warnings either. The loop stops at the first such attempt. */
  ok: boolean;
}

/**
 * What {@link fixLoop} repairs and how. The {@link ValidateOptions} apply to
 * every round's validation.
 * @public
 */
export interface FixLoopOptions extends ValidateOptions {
  /** The document to validate and, if it has errors, repair. */
  source: string;
  /** Asks the model for a corrected document. A Markdown code fence (`typst` or `typ`) around the reply is removed. */
  generate(request: FixRequest): string | Promise<string>;
  /** Most repair rounds (calls to `generate`). Default 3. */
  maxRounds?: number;
  /** Also repair documents that only have warnings, until none are left. Default false: errors only. */
  strict?: boolean;
  /** How each round's `prompt` is written; passed to {@link formatDiagnosticsForLLM}. */
  format?: FormatOptions;
}

/** What {@link fixLoop} ends with: the best attempt, and every attempt it made. @public */
export interface FixLoopResult {
  /** The best attempt is acceptable (no errors; with `strict`, no warnings either). */
  ok: boolean;
  /** The best attempt: fewest errors, then fewest warnings, then the latest. */
  source: string;
  /** The best attempt's diagnostics, lint findings included. */
  diagnostics: Diagnostic[];
  /** Every attempt, starting with the original source. */
  attempts: FixAttempt[];
}

const score = (r: { diagnostics: Diagnostic[] }): [number, number] => {
  const errors = r.diagnostics.filter(isError).length;
  return [errors, r.diagnostics.length - errors];
};

/**
 * Validates `source`; while it has errors, asks `generate` for a corrected
 * document and validates that, for at most `maxRounds` rounds. Returns the best
 * attempt, so a reply that makes things worse never replaces a better one.
 *
 * @example
 * ```ts
 * const result = await fixLoop({
 *   source,
 *   generate: async ({ source, prompt }) => (await llm(`${prompt}\n\n${source}`)).text,
 * });
 * if (result.ok) save(result.source);
 * ```
 * @public
 */
export const fixLoop = async (options: FixLoopOptions): Promise<FixLoopResult> => {
  const { source, generate, maxRounds = 3, strict = false, format, ...validateOptions } = options;
  const acceptable = (r: ValidateResult): boolean => r.ok && (!strict || r.diagnostics.length === 0);
  const check = async (text: string): Promise<FixAttempt> => {
    const result = await validate(text, validateOptions);
    return { source: text, diagnostics: result.diagnostics, ok: acceptable(result) };
  };
  let attempt = await check(source);
  const attempts = [attempt];
  let best = attempt;
  for (let round = 1; !attempt.ok && round <= maxRounds; round++) {
    const prompt = formatDiagnosticsForLLM(attempt.source, attempt.diagnostics, format);
    const reply = await generate({ source: attempt.source, diagnostics: attempt.diagnostics, prompt, round });
    attempt = await check(normalize(reply).text);
    attempts.push(attempt);
    const [e, w] = score(attempt);
    const [be, bw] = score(best);
    if (e < be || (e === be && w <= bw)) best = attempt;
  }
  return { ok: best.ok, source: best.source, diagnostics: best.diagnostics, attempts };
};
