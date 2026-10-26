// validate() and render(): one-shot compiles of a finished document (PLAN §5.7).

import { type CompileTarget, type Diagnostic, hasErrors, normalizeDiagnostics } from "@typstream/core";
import { type HealOptions, heal, type LintFinding } from "@typstream/heal";
import { compileOnce, type DocumentOptions } from "./engine";

/** @public */
export interface ValidateOptions extends DocumentOptions {
  /**
   * Which output to compile for. Default `paged`, what gets printed; `html`
   * also catches problems specific to HTML export.
   */
  target?: CompileTarget;
  /**
   * Report `@typstream/heal`'s lint findings as warnings (default true). They
   * catch Markdown habits that compile but render wrongly (`**bold**`,
   * `$5 and $10`). Pass heal's `lint` settings to configure single rules.
   */
  lint?: boolean | HealOptions["lint"];
}

/** @public */
export interface ValidateResult {
  /** No errors. Warnings (including lint findings) don't count. */
  ok: boolean;
  /** Sorted and deduplicated; positions are UTF-16 offsets into the source. */
  diagnostics: Diagnostic[];
  /** Pages of the paged document, when it compiled. */
  pageCount?: number;
  /** Wall-clock milliseconds. */
  ms: number;
}

const quote = (s: string): string => (s.includes("`") ? `\`\` ${s} \`\`` : `\`${s}\``);

/** The finding's fix as one instruction over its whole range (`**a**` → `*a*`, not two `**` → `*`). */
const suggestion = (source: string, finding: LintFinding): string[] => {
  const changes = [...finding.changes].sort((a, b) => a.from - b.from);
  const first = changes[0];
  if (!first) return [];
  const from = Math.min(finding.start, first.from);
  const to = Math.max(finding.end, ...changes.map((c) => c.to));
  let fixed = "";
  let at = from;
  for (const c of changes) {
    fixed += source.slice(at, c.from) + c.insert;
    at = c.to;
  }
  fixed += source.slice(at, to);
  const old = source.slice(from, to);
  if (old && fixed) return [`replace ${quote(old)} with ${quote(fixed)}`];
  return [old ? `remove ${quote(old)}` : `insert ${quote(fixed)}`];
};

/**
 * Heal's messages describe what it did to a stream ("…; escaped it (`\@`)").
 * Nothing was changed here, and the hint already says what to change.
 */
const reportMessage = (message: string): string => message.replace(/; escaped it.*$/, "");

/** heal's lint findings on the finished document, as diagnostics. */
export const lintDiagnostics = (source: string, lint: ValidateOptions["lint"]): Diagnostic[] => {
  if (lint === false) return [];
  const { findings } = heal(source, {
    final: true,
    unwrapFences: "never",
    ...(typeof lint === "object" ? { lint } : {}),
  });
  return findings.map((f) => ({
    severity: "warning",
    span: { from: f.start, to: f.end },
    message: reportMessage(f.message),
    hints: suggestion(source, f),
    trace: [],
    source: "heal",
    code: f.rule,
  }));
};

/**
 * Checks a finished document before it is saved: compiles it (without
 * exporting) and adds lint findings. Never throws for a broken document; a
 * compile that exceeds the watchdog budget or crashes the engine is reported
 * as an error diagnostic (`code: "timeout"` / `"engine-crashed"`).
 *
 * @example
 * ```ts
 * const { ok, diagnostics } = await validate(source);
 * if (!ok) prompt = formatDiagnosticsForLLM(source, diagnostics);
 * ```
 * @public
 */
export const validate = async (source: string, options: ValidateOptions = {}): Promise<ValidateResult> => {
  const t0 = performance.now();
  const compiled = await compileOnce(source, options.target === "html" ? "html" : "check", options);
  const diagnostics = normalizeDiagnostics([...compiled.diagnostics, ...lintDiagnostics(source, options.lint)]);
  return {
    ok: !hasErrors(diagnostics),
    diagnostics,
    ...(compiled.result?.pageCount !== undefined ? { pageCount: compiled.result.pageCount } : {}),
    ms: performance.now() - t0,
  };
};

/** @public */
export type RenderFormat = "pdf" | "html" | "svg";

/** What {@link render} produces per format: PDF bytes, an HTML document, one SVG per page. @public */
export interface RenderData {
  pdf: Uint8Array;
  html: string;
  svg: string[];
}

/** @public */
export type RenderResult<F extends RenderFormat = RenderFormat> =
  | { ok: true; diagnostics: Diagnostic[]; data: RenderData[F]; pageCount?: number; ms: number }
  | { ok: false; diagnostics: Diagnostic[]; ms: number };

/**
 * Compiles and exports a document. Diagnostics are Typst's only (no lint);
 * `ok: false` means it didn't compile and there's no data.
 * @public
 */
export const render = async <F extends RenderFormat>(
  source: string,
  format: F,
  options: DocumentOptions = {},
): Promise<RenderResult<F>> => {
  const t0 = performance.now();
  const compiled = await compileOnce(source, format, options);
  const diagnostics = normalizeDiagnostics(compiled.diagnostics);
  const r = compiled.result;
  const ms = performance.now() - t0;
  if (!compiled.ok || !r) return { ok: false, diagnostics, ms };
  const data = (
    format === "pdf" ? r.pdf : format === "html" ? r.html : (r.pages ?? []).map((p) => p.svg)
  ) as RenderData[F];
  return { ok: true, diagnostics, data, ...(r.pageCount !== undefined ? { pageCount: r.pageCount } : {}), ms };
};
