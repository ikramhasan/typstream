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
  type AppliedFix,
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
import { DEFAULT_LINT, heal, type LintRuleId, type ModeSpan, recognize } from "@typstream/heal";
import { imageSources } from "../image-paths";
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

const MISSING_PACKAGE =
  /^package (@\S+) (?:is not allowed|is still loading|failed to load)|^package not found \(searched for (@[^)]+)\)$/;
const NAME = String.raw`[\p{XID_Start}_][\p{XID_Continue}-]*`;
const ITEM = String.raw`${NAME}(?:\.${NAME})*(?:\s+as\s+${NAME})?`;
/** What follows an import's spec: `as name`, then `: *`, `: a, b as c` (maybe in parentheses), or nothing. */
const IMPORT_TAIL = new RegExp(
  String.raw`^(?:\s+as\s+(${NAME}))?(?:\s*:\s*(\*|\([^()]*\)|${ITEM}(?:\s*,\s*${ITEM})*))?`,
  "u",
);

/**
 * The names an import of `spec` binds, from what follows the spec
 * ({@link IMPORT_TAIL}): its alias, its items (an item's own alias, or the last
 * part of `a.b`), or, for a bare import, the package's name. `null` for a
 * wildcard, whose names only Typst knows.
 */
const importedNames = (spec: string, alias: string | undefined, items: string | undefined): string[] | null => {
  if (items === "*") return null;
  const names = alias ? [alias] : [];
  if (items) {
    for (const item of items.replace(/^\(|\)$/g, "").split(",")) {
      const parts = item.trim().split(/\s+as\s+/u);
      const bound = (parts[1] ?? parts[0]?.split(".").pop())?.trim();
      if (bound) names.push(bound);
    }
  } else if (!alias) names.push(spec.slice(spec.indexOf("/") + 1, spec.lastIndexOf(":")));
  return names;
};

/**
 * An import of a package the document can't have (not allowed, still loading,
 * failed to load; PLAN §5.5) binds what it would have imported to
 * placeholders that show the package's spec where they're called:
 * `#import "@preview/x:1.0.0": a, b as c` becomes
 * `#let (a, c) = (typstream.missing-package("@preview/x:1.0.0"),) * 2`, and a
 * bare or `as m` import binds the module's name the same way. A wildcard
 * import, or a module whose fields are used (`m.draw`), can't be stood in
 * for: the error stays. Final compiles show the placeholders too and report
 * the error.
 * @public
 */
export const packageStub: DiagnosticFixer = {
  name: "package-stub",
  priority: 20,
  match: MISSING_PACKAGE,
  fix(d, { text }) {
    const m = MISSING_PACKAGE.exec(d.message);
    const spec = m?.[1] ?? m?.[2];
    if (!d.span || spec === undefined || text.slice(d.span.from, d.span.to) !== typstString(spec)) return null;
    const keyword = /import\s+$/.exec(text.slice(Math.max(0, d.span.from - 64), d.span.from));
    if (!keyword) return null;
    const from = d.span.from - keyword[0].length;
    const tail = IMPORT_TAIL.exec(text.slice(d.span.to)) as RegExpExecArray;
    const [, alias, items] = tail;
    const names = importedNames(spec, alias, items);
    if (!names) return null;
    const stub = `typstream.missing-package(${typstString(spec)})`;
    const insert =
      names.length === 1 ? `let ${names[0]} = ${stub}` : `let (${names.join(", ")}) = (${stub},) * ${names.length}`;
    return [{ from, to: d.span.to + tail[0].length, insert }];
  },
};

const IMAGE_ERROR = /^file not found \(searched at |^failed to decode image|^unknown image format$/;
/** What precedes an image's source: the call's opening and maybe the argument's name. */
const IMAGE_OPEN = /\bimage\(\s*(?:source\s*:\s*)?$/;
const STRING = String.raw`"(?:[^"\\\n]|\\.)*"`;
/** The source an image call starts with: a string, a name (path), or a `read` the first round wrote. */
const IMAGE_SOURCE = new RegExp(
  String.raw`^image\(\s*(?:source\s*:\s*)?(?:(${STRING})|read\((${STRING}), encoding: none\)|(${NAME}(?:\.${NAME})*)(?![\p{XID_Continue}\-.(]))`,
  "u",
);

/**
 * An image the document can't read shows as a placeholder of the same size
 * rules (PLAN §5.5): its source becomes `typstream.missing-image(source)`, an
 * SVG showing the file's name, so the call's width, fit and alt text and a
 * figure's caption still apply. Models write paths the document has no file
 * for (`#image("diagram.png")`, a URL), and an app's `resolveImage` may still
 * be fetching one. A file whose bytes aren't the format its extension names
 * (a `.png` URL that sends a JPEG) is read as bytes first, so Typst goes by
 * its content; one that still isn't an image gets the placeholder. Final
 * compiles show the placeholder too and report the error.
 * @public
 */
export const missingImage: DiagnosticFixer = {
  name: "missing-image",
  priority: 15,
  match: IMAGE_ERROR,
  fix(d, { text }) {
    if (!d.span) return null;
    const { from, to } = d.span;
    // Not found: the span is the source argument (a path, or the name holding it).
    if (d.message.startsWith("file not found")) {
      if (!IMAGE_OPEN.test(text.slice(Math.max(0, from - 64), from))) return null;
      return [{ from, to, insert: `typstream.missing-image(${text.slice(from, to)})` }];
    }
    // Not an image (or not the format its extension says): the span is the whole call.
    const m = IMAGE_SOURCE.exec(text.slice(from, to));
    if (!m) return null;
    const [whole, path, read, name] = m;
    const value = (path ?? read ?? name) as string;
    const start = from + whole.length - (read ? `read(${read}, encoding: none)`.length : value.length);
    const insert =
      path && d.message.startsWith("failed to decode")
        ? `read(${path}, encoding: none)`
        : `typstream.missing-image(${value})`;
    return [{ from: start, to: from + whole.length, insert }];
  },
};

/** The mode at `pos`, from the recognizer's mode changes (ascending). */
const modeAt = (modes: readonly ModeSpan[], pos: number): ModeSpan["mode"] => {
  let mode: ModeSpan["mode"] = "markup";
  for (let lo = 0, hi = modes.length - 1; lo <= hi; ) {
    const mid = (lo + hi) >> 1;
    const m = modes[mid] as ModeSpan;
    if (m.at <= pos) {
      mode = m.mode;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return mode;
};

/**
 * {@link missingImage} for every image at once, before the first compile:
 * Typst stops at the first image it can't read, so a document with several
 * would take a fix round each, and two rounds are all a revision gets. Each
 * image whose source is a string with no file at its path (`has` takes
 * `fileKey`s) becomes a placeholder, with the error Typst reports for it.
 * Strings in raw text or comments aren't images.
 */
export const placeholderImages = (
  text: string,
  has: (key: string) => boolean,
): { edits: TextEdit[]; errors: Diagnostic[] } | null => {
  const missing = imageSources(text).filter((s) => !has(s.key));
  if (missing.length === 0) return null;
  const { modes } = recognize(text);
  const edits: TextEdit[] = [];
  const errors: Diagnostic[] = [];
  for (const { from, to, key } of missing) {
    if (modeAt(modes, from) !== "code") continue;
    edits.push({ from, to, insert: `typstream.missing-image(${text.slice(from, to)})` });
    errors.push({
      severity: "error",
      span: { from, to },
      message: `file not found (searched at ${key})`,
      hints: [],
      trace: [],
      source: "typst",
    });
  }
  return edits.length ? { edits, errors } : null;
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

/** What healing appends after the text being typed (closers), and whitespace. */
const APPENDED = /[\s)\]}$"*_`]/;

/**
 * Where an error with no position in the document can be cut: a package or a
 * library evaluates the document's content in its own code (CeTZ resolving a
 * half-typed coordinate inside a canvas, #72), so neither the error nor its
 * trace is in the text. The text being typed is to blame: the innermost
 * construct open where it ends, as heal sees it once the closers healing
 * appended are off. A value or a content block loses its opener and what
 * follows (`(6` of `line((0, 0), (6`, `"` of `unit("`); an argument list, the
 * whole call. A round that still fails cuts the next construct out, so two
 * rounds go from the value being typed to the call holding it. Nothing open
 * there (markup), nothing to cut: the last good render and Layer 4 take it.
 */
const unlocatedCut = (text: string, settled: number): number | undefined => {
  let end = text.length;
  while (end > 0 && APPENDED.test(text[end - 1] as string)) end--;
  const [inner] = heal(text.slice(0, end), { lint: NO_LINT, unwrapFences: "never" }).openFrames;
  if (!inner) return undefined;
  const cut = inner.frame === "args" ? calleeStart(text, inner.open) : inner.open;
  return cut >= settled ? cut : undefined;
};

const unlocated = (d: Diagnostic): boolean => d.span === null && d.trace.every((t) => t.span === null);

const UNKNOWN = /^unknown variable: (\S+)$/;
/** A top-level package import: `#import "@namespace/name:version"` at the start of a line. */
const PACKAGE_IMPORT = /^#import\s+"(@[^"\\\n]+)"/gm;

/**
 * A name used before the package import that binds it: a model writes
 * a helper on CeTZ, then `#import "@preview/cetz:0.5.3"` below it, or uses
 * `#unit(…)` in a template's arguments above the imports. A function only sees
 * what exists where it is defined, so the name is unknown wherever it's called.
 * The import moves to the document's start. Its names then exist from there:
 * a `#let` of the same name in between still wins (it comes later), but a
 * built-in or preamble name of the same name would be shadowed. So it moves
 * only an import that binds the failing name outright (bare, `as`, items), at
 * the top level, after the error; a wildcard (`: *`) could bind anything. While
 * streaming, only an import that has settled. Final compiles report the error:
 * the source still doesn't compile as written.
 * @public
 */
export const hoistImport: DiagnosticFixer = {
  name: "hoist-import",
  priority: 25,
  match: UNKNOWN,
  fix(d, { text, settled, mode }) {
    const name = UNKNOWN.exec(d.message)?.[1];
    if (!d.span || name === undefined) return null;
    let modes: readonly ModeSpan[] | undefined;
    for (const m of text.matchAll(PACKAGE_IMPORT)) {
      const from = m.index;
      if (from <= d.span.from) continue;
      const tail = IMPORT_TAIL.exec(text.slice(from + m[0].length)) as RegExpExecArray;
      if (!importedNames(m[1] as string, tail[1], tail[2])?.includes(name)) continue;
      const end = from + m[0].length + tail[0].length;
      if (mode === "streaming" && end > settled) return null;
      // Not in raw text or a comment, nor inside a block or a call: its scope would change.
      modes ??= recognize(text).modes;
      if (modeAt(modes, from) !== "markup") continue;
      if (heal(text.slice(0, from), { lint: NO_LINT, unwrapFences: "never" }).openFrames.length > 0) continue;
      const to = text.startsWith("\r\n", end) ? end + 2 : text[end] === "\n" ? end + 1 : end;
      return [
        { from: 0, to: 0, insert: `${text.slice(from, end)}\n` },
        { from, to, insert: "" },
      ];
    }
    return null;
  },
};

/**
 * Streaming only, the catch-all: an error in the text still being typed cuts
 * the text at the error (or at its call site there) and heals the rest of it
 * again, so the document shows what came before. This covers what only the
 * compiler can tell: a call closed before its required arguments arrived
 * (`#text(` → `text()`), a value still being typed (`#v(1`, `rgb("#e`), closure
 * parameters before their `=>`. A cut that leaves an argument list or a group
 * empty moves before it (and before the call's name), since `rgb()` would fail
 * the next round. An error with no position in the document (a package's
 * panic) cuts the construct open at the end of the text. The next tokens
 * usually bring the cut text back in the next revision.
 * @public
 */
export const tailCut: DiagnosticFixer = {
  name: "tail-cut",
  priority: 100,
  modes: ["streaming"],
  fix(d, { text, settled }) {
    let cut = cutPoint(d, settled) ?? (unlocated(d) ? unlocatedCut(text, settled) : undefined);
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
 * The built-in fixers: {@link pendingRef}, {@link missingImage}, {@link packageStub}, {@link hoistImport}, then
 * {@link tailCut}.
 * @public
 */
export const DEFAULT_FIXERS: readonly DiagnosticFixer[] = [pendingRef, missingImage, packageStub, hoistImport, tailCut];

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
  /** When `ok`: the errors fixed, in the order fixed. */
  fixes: AppliedFix[];
  /** The text the last round compiled (the client's when no round ran), and its positions in the client's text. */
  text: string;
  toOriginal(pos: number, assoc?: 1 | -1): number;
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
  const applied: AppliedFix[] = [];
  let rounds = 0;
  while (rounds < maxRounds && diagnostics.some(isError) && performance.now() < run.deadline) {
    const errors = diagnostics.filter(isError);
    const ctx: FixContext = { text, settled, mode, round: rounds, errors };
    const fixes: Fix[] = [];
    for (const error of errors) {
      const fix = await fixError(fixers, error, ctx);
      // An error nothing fixes fails the recompile too.
      if (!fix) return { ok: false, rounds, diagnostics: run.diagnostics, fixes: [], text, toOriginal };
      fixes.push(fix);
    }
    for (const { fixer, error } of fixes) {
      const d = mapDiagnostic(error, toOriginal);
      fixed.push(mode === "final" ? d : { ...d, severity: "info", source: fixer.name });
      applied.push({ fixer: fixer.name, message: error.message });
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
  if (diagnostics.some(isError))
    return { ok: false, rounds, diagnostics: run.diagnostics, fixes: [], text, toOriginal };
  return {
    ok: true,
    rounds,
    diagnostics: [...diagnostics.map((d) => mapDiagnostic(d, toOriginal)), ...fixed],
    fixes: applied,
    text,
    toOriginal,
  };
};
