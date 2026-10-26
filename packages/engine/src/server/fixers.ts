// Layer 3: diagnostic-driven fixers in the worker (PLAN §5.5, §8.2). When a
// compile fails, each error is offered to the fixers in priority order; the
// first that returns edits fixes it. The edits are applied and the text is
// compiled again, at most twice per revision. Only a round that ends without
// errors counts: otherwise the client gets the first compile's diagnostics,
// as if no fixer had run, and keeps its last good render (§5.6).
//
// The built-in fixers come from the compile oracle's measurements (#13): nearly
// every error of a healed stream prefix is either a reference to a label that
// hasn't arrived (a citation before `#bibliography`) or sits in the text still
// being typed. Two generic fixers handle those, rather than one per message.

import {
  type CompileMode,
  type Diagnostic,
  type DiagnosticFixer,
  diffEdit,
  type FixContext,
  isError,
  mapDiagnostic,
  type Patch,
  SourceMap,
  type TextEdit,
} from "@typstream/core";
import { DEFAULT_LINT, heal, type LintRuleId } from "@typstream/heal";
import { typstString } from "./runtime";

const LABEL = /^label `<(.+)>` does not exist in the document$/;

/**
 * A reference to a label that doesn't exist becomes a placeholder showing its
 * key, `#typstream.pending-ref("key");`: a citation before its `#bibliography`
 * (usually a document's last line), a label still to come, a name still being
 * typed (`@fig-` of `@fig-cell`). The trailing `;` ends the embedded
 * expression, so the text after it can't continue it. Final compiles show the
 * placeholder too and report the error.
 * @public
 */
export const pendingRef: DiagnosticFixer = {
  name: "pending-ref",
  priority: 10,
  match: LABEL,
  fix(d, { text }) {
    const key = LABEL.exec(d.message)?.[1];
    if (!d.span || key === undefined) return null;
    const { from, to } = d.span;
    const ref = text.slice(from, to);
    const call = `typstream.pending-ref(${typstString(key)})`;
    // `@key`, maybe with a `[supplement]`, in markup.
    if (ref.startsWith(`@${key}`)) return [{ from, to, insert: `#${call};` }];
    // `ref(<key>)` in code (`#ref(<key>)`, in a block, an argument).
    if (/^ref\(\s*</.test(ref) && ref.includes(`<${key}>`)) return [{ from, to, insert: call }];
    // Anywhere else (a function that builds its own references), the reference isn't in the text as written.
    return null;
  },
};

// Lint already ran on the client's text; re-healing a prefix of it only closes what the cut left open.
const NO_LINT = Object.fromEntries(Object.keys(DEFAULT_LINT).map((id) => [id, false])) as Record<LintRuleId, false>;

/**
 * Where an error can be cut: at its own span if that is in the unsettled tail,
 * else at the innermost call site there in its trace (a settled function
 * called with a half-typed argument fails in its own body).
 */
const cutPoint = (d: Diagnostic, settled: number): number | undefined => {
  if (d.span && d.span.from >= settled) return d.span.from;
  return d.trace.find((t) => t.span && t.span.from >= settled)?.span?.from;
};

const IDENT = /[\p{XID_Continue}-]/u;
const SPACE = /\s/;

/**
 * Where the callee of the call whose arguments open at `open` starts: `rgb` of
 * `rgb(`, `curve.line` of `curve.line(`. A method called on a value ending in a
 * closer (`zip(xs).map(`, across lines too) keeps the value and loses only
 * `.map`. Without a name (`f(x)(`), the arguments alone.
 */
const calleeStart = (text: string, open: number): number => {
  let end = open;
  for (;;) {
    let start = end;
    while (start > 0 && IDENT.test(text[start - 1] as string)) start--;
    if (start === end) return end;
    let dot = start;
    while (dot > 0 && SPACE.test(text[dot - 1] as string)) dot--;
    if (text[dot - 1] !== ".") return start;
    let receiver = dot - 1;
    while (receiver > 0 && SPACE.test(text[receiver - 1] as string)) receiver--;
    if (!IDENT.test(text[receiver - 1] ?? "")) return receiver;
    // A name path (`curve.line`, `calc.round`): the whole path is the callee.
    end = receiver;
  }
};

/** Frames that are empty after a cut fail as values (`rgb()`, `()` as a point): cut them too. */
const VALUE_FRAMES = new Set(["args", "parens", "params"]);

/**
 * Streaming only, the catch-all: an error in the text still being typed cuts
 * the text at the error (or at its call site there) and heals the rest of it
 * again, so the document shows what came before. This covers what only the
 * compiler can tell: a call closed before its required arguments arrived
 * (`#text(` → `text()`), a value still being typed (`#v(1`, `rgb("#e`), closure
 * parameters before their `=>`. A cut that leaves an argument list or a group
 * empty moves before it (and before the call's name), since `rgb()` would fail
 * the next round. The next tokens usually bring the cut text back in the next
 * revision.
 * @public
 */
export const tailCut: DiagnosticFixer = {
  name: "tail-cut",
  priority: 100,
  modes: ["streaming"],
  fix(d, { text, settled }) {
    let cut = cutPoint(d, settled);
    if (cut === undefined) return null;
    let healed = heal(text.slice(0, cut), { lint: NO_LINT, unwrapFences: "never" });
    for (;;) {
      const [inner] = healed.openFrames;
      if (!inner || !VALUE_FRAMES.has(inner.frame) || text.slice(inner.open + 1, cut).trim() !== "") break;
      const before = inner.frame === "args" ? calleeStart(text, inner.open) : inner.open;
      if (before < settled) break;
      cut = before;
      healed = heal(text.slice(0, cut), { lint: NO_LINT, unwrapFences: "never" });
    }
    const edit = diffEdit(text, healed.source);
    // Healing a prefix leaves its own settled text alone, but that can start before the client's.
    return edit && edit.from >= settled ? [edit] : null;
  },
};

/**
 * The built-in fixers: {@link pendingRef}, then {@link tailCut}.
 * @public
 */
export const DEFAULT_FIXERS: readonly DiagnosticFixer[] = [pendingRef, tailCut];

/** Most rounds of fixes after the first compile (PLAN §5.5). */
export const MAX_FIX_ROUNDS = 2;

/**
 * A fix round starts only while the compile has taken less than this (ms), so
 * fixes can't run the client's watchdog out (3 s streaming, 10 s final, by default).
 */
export const FIX_BUDGET_MS: Readonly<Record<CompileMode, number>> = { streaming: 1000, final: 3000 };

/** Fixers in the order they are tried: by priority, then as given. */
export const orderFixers = (fixers: readonly DiagnosticFixer[]): DiagnosticFixer[] =>
  fixers
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (a.f.priority ?? 50) - (b.f.priority ?? 50) || a.i - b.i)
    .map(({ f }) => f);

/** A fixer module's default export, checked. */
export const fixersOf = (exported: unknown, url: string): DiagnosticFixer[] => {
  const list = Array.isArray(exported) ? exported : [exported];
  for (const f of list) {
    const fixer = f as Partial<DiagnosticFixer> | null;
    if (!fixer || typeof fixer.name !== "string" || typeof fixer.fix !== "function") {
      throw new Error(`${url}: the default export must be a diagnostic fixer ({ name, fix }) or an array of them`);
    }
  }
  return list as DiagnosticFixer[];
};

const matches = (fixer: DiagnosticFixer, d: Diagnostic): boolean => {
  const { match } = fixer;
  if (match === undefined) return true;
  if (typeof match === "function") return match(d);
  match.lastIndex = 0;
  return match.test(d.message);
};

/** Edits that are in the text and in order; anything else is a fixer bug and counts as no fix. */
const valid = (edits: TextEdit[], length: number): boolean =>
  edits.length > 0 &&
  edits.every(
    (e, i) => e.from >= 0 && e.from <= e.to && e.to <= length && (i === 0 || e.from >= (edits[i - 1] as TextEdit).to),
  );

interface Fix {
  fixer: DiagnosticFixer;
  error: Diagnostic;
  edits: TextEdit[];
}

const fixError = async (fixers: readonly DiagnosticFixer[], d: Diagnostic, ctx: FixContext): Promise<Fix | null> => {
  for (const fixer of fixers) {
    if ((fixer.modes && !fixer.modes.includes(ctx.mode)) || !matches(fixer, d)) continue;
    let edits: TextEdit[] | null;
    try {
      edits = await fixer.fix(d, ctx);
    } catch {
      // A broken plugin fixer shouldn't break compiles; the next fixer gets a turn.
      continue;
    }
    if (edits && valid(edits, ctx.text.length)) return { fixer, error: d, edits };
  }
  return null;
};

/**
 * Applies edits in one pass, ascending, skipping any that overlap one already
 * taken (a cut covers what follows it). The map leads from the result back to `text`.
 */
export const applyEdits = (
  text: string,
  edits: readonly TextEdit[],
  reason: string,
): { text: string; map: SourceMap } => {
  const sorted = [...edits].sort((a, b) => a.from - b.from || b.to - a.to);
  const parts: string[] = [];
  const patches: Patch[] = [];
  let last = 0;
  let shift = 0;
  for (const e of sorted) {
    if (e.from < last) continue;
    parts.push(text.slice(last, e.from), e.insert);
    patches.push({
      original: { from: e.from, to: e.to },
      result: { from: e.from + shift, to: e.from + shift + e.insert.length },
      reason,
    });
    shift += e.insert.length - (e.to - e.from);
    last = e.to;
  }
  parts.push(text.slice(last));
  return { text: parts.join(""), map: new SourceMap(patches) };
};

/** What the fix loop needs from the server. */
export interface FixRun {
  /** The client's text, its settled offset and the compile's mode. */
  text: string;
  settled: number;
  mode: CompileMode;
  /** In the order to try them ({@link orderFixers}). */
  fixers: readonly DiagnosticFixer[];
  /** Diagnostics of the first compile, in `text` coordinates. */
  diagnostics: Diagnostic[];
  /**
   * Compiles a fixed text and returns its diagnostics in that text's
   * coordinates. `toOriginal` maps its positions to the client's text.
   */
  compile(text: string, toOriginal: (pos: number, assoc?: 1 | -1) => number): Promise<Diagnostic[]>;
  /** No round starts after this `performance.now()`. */
  deadline: number;
  /** Default {@link MAX_FIX_ROUNDS}. */
  rounds?: number;
}

export interface FixOutcome {
  /** The last compile has no errors. */
  ok: boolean;
  /** Fix rounds compiled. */
  rounds: number;
  /** What to report, in the client's text coordinates (see `DiagnosticsNotification`). */
  diagnostics: Diagnostic[];
}

/** Fixes and recompiles until the text compiles, no fix applies, or rounds or time run out. */
export const runFixers = async (run: FixRun): Promise<FixOutcome> => {
  const { mode, fixers } = run;
  const maxRounds = run.rounds ?? MAX_FIX_ROUNDS;
  let { text, settled, diagnostics } = run;
  // Each round's text back to the previous one's, newest last.
  const maps: SourceMap[] = [];
  const toOriginal = (pos: number, assoc: 1 | -1 = 1) => maps.reduceRight((p, map) => map.toOriginal(p, assoc), pos);
  const fixed: Diagnostic[] = [];
  let rounds = 0;
  while (rounds < maxRounds && diagnostics.some(isError) && performance.now() < run.deadline) {
    const errors = diagnostics.filter(isError);
    const ctx: FixContext = { text, settled, mode, round: rounds, errors };
    const fixes: Fix[] = [];
    for (const error of errors) {
      const fix = await fixError(fixers, error, ctx);
      // An error nothing fixes fails the recompile too.
      if (!fix) return { ok: false, rounds, diagnostics: run.diagnostics };
      fixes.push(fix);
    }
    for (const { fixer, error } of fixes) {
      const d = mapDiagnostic(error, toOriginal);
      fixed.push(mode === "final" ? d : { ...d, severity: "info", source: fixer.name });
    }
    const next = applyEdits(
      text,
      fixes.flatMap((f) => f.edits),
      "fix",
    );
    text = next.text;
    settled = next.map.toResult(settled);
    maps.push(next.map);
    diagnostics = await run.compile(text, toOriginal);
    rounds++;
  }
  if (diagnostics.some(isError)) return { ok: false, rounds, diagnostics: run.diagnostics };
  return { ok: true, rounds, diagnostics: [...diagnostics.map((d) => mapDiagnostic(d, toOriginal)), ...fixed] };
};
