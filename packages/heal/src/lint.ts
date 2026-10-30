// Layer 1: fixes for mistakes that are permanent, not streaming artifacts:
// Markdown habits and stray delimiters LLMs produce. Rules only look at settled
// text (or the whole document in final mode) and only at markup positions.

import { isAlphanumeric } from "./chars";
import type { LintEvent, ModeSpan, Recognition } from "./recognizer";

/** Id of a built-in lint rule: the keys of {@link DEFAULT_LINT} and `HealOptions.lint`. */
export type LintRuleId =
  | "markdown-heading"
  | "markdown-bold"
  | "markdown-link"
  | "email-at"
  | "bare-hash"
  | "stray-closer"
  | "unclosed-delim"
  | "unclosed-block-comment"
  | "currency-dollar"
  | "math-lone-script"
  | "layout-profile";

/** `fix` applies the change, `warn` only reports it. */
export type LintSeverity = "fix" | "warn" | "off";

/** Each built-in lint rule's default severity; `HealOptions.lint` overrides it per rule. */
export const DEFAULT_LINT: Readonly<Record<LintRuleId, LintSeverity>> = {
  "markdown-heading": "fix",
  "markdown-bold": "fix",
  "markdown-link": "fix",
  "email-at": "fix",
  "bare-hash": "fix",
  "stray-closer": "fix",
  "unclosed-delim": "fix",
  "unclosed-block-comment": "warn",
  "currency-dollar": "warn",
  "math-lone-script": "fix",
  "layout-profile": "fix",
};

/**
 * An edit a finding applies: replace `[from, to)` with `insert`. Offsets are into the normalized text the rule
 * ran on, which is the input unless normalization removed something before them (a leading fence or BOM).
 */
export interface TextChange {
  /** Start of the replaced text (UTF-16 offset). */
  from: number;
  /** End of the replaced text, exclusive; equal to `from` for an insertion. */
  to: number;
  /** Text put in its place (empty for a deletion). */
  insert: string;
}

/** A mistake a lint rule (or a `settled` heal handler) found in settled text. */
export interface LintFinding {
  /** The lint rule's id, or the handler's `name` for a handler's edit. */
  rule: LintRuleId | string;
  /** `fix`: its changes are applied to the healed source; `warn`: only reported. Rules set to `off` report nothing. */
  severity: "fix" | "warn";
  /** Start of the flagged text (UTF-16 offset; input offsets in `HealResult.findings`). */
  start: number;
  /** End of the flagged text, exclusive (same offsets as `start`). */
  end: number;
  /** Human-readable explanation of the problem; a handler's finding repeats its name. */
  message: string;
  /** Changes this finding applies when its severity is `fix`. */
  changes: TextChange[];
}

/** Mode of the token covering `pos`. */
export const modeAt = (modes: readonly ModeSpan[], pos: number): ModeSpan["mode"] => {
  let lo = 0;
  let hi = modes.length - 1;
  let found: ModeSpan["mode"] = "markup";
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const m = modes[mid] as ModeSpan;
    if (m.at <= pos) {
      found = m.mode;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
};

const MD_HEADING = /^([ \t]*)(#{1,6})[ \t]+\S/gm;
const MD_BOLD = /(\*\*|__)(?=\S)([^*_\n]+?)(?<=\S)\1/g;
const MD_LINK = /\[([^[\]\n]+)\]\((https?:\/\/[^\s()"\\]+)\)/g;
// A price is a number, then prose up to the next price: `$5 and $10` parses as the equation
// `5 and `, which ends in a space because its closing `$` starts the next price. Math starting
// with a number and a word goes on with numbers and operators (`$0.4 times 0.3 =$`, models write
// it all the time, #24) or ends at the word (`$30 degree$`, `$2 cos(x)$`).
const CURRENCY = /^\d[\d.,]*\s+\p{L}{2,}[\p{L}\s,.;:!?'"()-]*\s$/u;

// The engine's layout profile (#129) sets these with show-set rules, which win over set rules. An element's own
// arguments and a later show-set rule on the same element win over the profile, so they come out of documents:
// a `par(…)` call and a show-set rule on the element it sets. Set rules on `par` too: Typst sets text with no
// blocks around it (a tight list's items, a cell's, a box's) without a `par` element, which the profile's show
// rule never reaches, so a document's `set par(leading: …)` would space those lines.
// Rounded corners, too: Word draws a frame's corners square, so a box with rounded ones around text is a picture in
// a DOCX export, its text not editable there (#118), where a square one is a table cell. It comes out of calls that
// hold content (a box without any, a checkbox, is a picture either way) and out of set rules, which would round
// every frame, edu's callouts too. Only a small fixed radius, a text box's (2–10 pt in models' documents): a ratio or a
// large one draws a shape (`rect(radius: 40%)`, a cell's outline), which is a picture whatever its corners.
const PROFILE_KEYS: Readonly<Record<string, RegExp>> = {
  par: /^(justify|leading|linebreaks)$/,
  text: /^(hyphenate|top-edge|bottom-edge)$/,
  "table.cell": /^breakable$/,
  block: /^radius$/,
  rect: /^radius$/,
  box: /^radius$/,
};
const FRAMES = new Set(["block", "rect", "box"]);
/** A text box's corner radius: lengths up to 12 pt (1em, 4 mm), alone or in a dictionary; no ratio, no expression. */
const small = (v: string): boolean =>
  /\d(pt|em|mm)/.test(v) &&
  !/%|[^\s\w.:(),-]/.test(v) &&
  [...v.matchAll(/([\d.]+)(pt|em|mm)/g)].every(([, n, u]) => Number(n) <= (u === "pt" ? 12 : u === "em" ? 1 : 4));
const PROFILE_CALL =
  /(?<![\w.-])(par|block|rect|box)\(|\bshow\s+(par|text|table)(?:\.where\([^()\n]*\))?\s*:\s*set\s+(par|text|table\.cell)\(/g;

interface Ctx {
  text: string;
  modes: readonly ModeSpan[];
  from: number;
  to: number;
  out: LintFinding[];
  severity(rule: LintRuleId): LintSeverity;
}

const add = (ctx: Ctx, rule: LintRuleId, start: number, end: number, message: string, changes: TextChange[]): void => {
  const severity = ctx.severity(rule);
  if (severity === "off") return;
  ctx.out.push({ rule, severity, start, end, message, changes });
};

const inRange = (ctx: Ctx, pos: number): boolean => pos >= ctx.from && pos < ctx.to;
const markupAt = (ctx: Ctx, pos: number): boolean => modeAt(ctx.modes, pos) === "markup";

const regexRule = (ctx: Ctx, re: RegExp, f: (m: RegExpExecArray) => void, start = ctx.from): void => {
  re.lastIndex = start;
  for (let m = re.exec(ctx.text); m !== null && m.index < ctx.to; m = re.exec(ctx.text)) {
    if (m.index + m[0].length <= ctx.to) f(m);
  }
};

const eventRule = (ctx: Ctx, e: LintEvent, headings: ReadonlySet<number>): void => {
  switch (e.type) {
    case "ref": {
      const before = ctx.text[e.start - 1];
      if (inRange(ctx, e.start) && isAlphanumeric(before)) {
        add(ctx, "email-at", e.start, e.end, "`@` inside a word is read as a reference; escaped it (`\\@`)", [
          { from: e.start, to: e.start, insert: "\\" },
        ]);
      }
      return;
    }
    case "bare-hash":
      if (inRange(ctx, e.at) && !headings.has(e.at)) {
        add(ctx, "bare-hash", e.at, e.at + 1, "a `#` followed by a space starts no expression; escaped it (`\\#`)", [
          { from: e.at, to: e.at, insert: "\\" },
        ]);
      }
      return;
    case "stray-closer":
      if (inRange(ctx, e.at)) {
        add(ctx, "stray-closer", e.at, e.at + 1, "unmatched `]`; escaped it (`\\]`)", [
          { from: e.at, to: e.at, insert: "\\" },
        ]);
      }
      return;
    case "unclosed-delim":
      if (inRange(ctx, e.at)) {
        add(ctx, "unclosed-delim", e.at, e.at + 1, `\`${e.delim}\` is never closed in its paragraph; escaped it`, [
          { from: e.at, to: e.at, insert: "\\" },
        ]);
      }
      return;
    case "unclosed-comment":
      if (inRange(ctx, e.at)) {
        add(ctx, "unclosed-block-comment", e.at, ctx.text.length, "unclosed `/*` hides the rest of the document", []);
      }
      return;
    case "equation": {
      if (!inRange(ctx, e.start) || ctx.text[e.end - 1] !== "$") return;
      const body = ctx.text.slice(e.start + 1, e.end - 1);
      // Units and formulas written as prose with a math exponent: `m/s$^2$`, `H$_2$O`. A script
      // needs a base in its own equation ("unexpected hat"); an empty string is one, and renders
      // what was meant. The most common error in model output (#24), and prompting doesn't stop it.
      const script = /^\s*[\^_]/.exec(body);
      if (script) {
        const at = e.start + script[0].length;
        add(ctx, "math-lone-script", at, at + 1, "a `^` or `_` needs a base in its equation; gave it an empty one", [
          { from: at, to: at, insert: '""' },
        ]);
      }
      const display = /^\s/.test(body) && /\s$/.test(body);
      if (!display && CURRENCY.test(body)) {
        add(ctx, "currency-dollar", e.start, e.end, "looks like prices, not math: `$` should be escaped (`\\$`)", [
          { from: e.start, to: e.start, insert: "\\" },
          { from: e.end - 1, to: e.end - 1, insert: "\\" },
        ]);
      }
      return;
    }
  }
};

/**
 * The top-level arguments of the call whose `(` is at `open`, as `[start, end)` ranges without the commas, and its
 * `)`; `null` if it isn't closed before `to`. Parentheses and braces count in code, brackets in markup too (which
 * balances them); strings, raw text and comments are skipped.
 */
const callArgs = (ctx: Ctx, open: number): { args: [number, number][]; close: number } | null => {
  const args: [number, number][] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = start; i < ctx.to; i++) {
    const mode = modeAt(ctx.modes, i);
    const c = ctx.text[i] as string;
    if (mode === "raw" || mode === "comment" || (mode !== "code" && c !== "[" && c !== "]")) continue;
    if (ctx.text[i - 1] === "\\") continue;
    if (mode === "code" && c === '"') {
      for (i++; i < ctx.to && ctx.text[i] !== '"'; i++) if (ctx.text[i] === "\\") i++;
    } else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) {
      if (depth--) continue;
      if (c !== ")") return null;
      args.push([start, i]);
      return { args, close: i };
    } else if (c === "," && !depth) {
      args.push([start, i]);
      start = i + 1;
    }
  }
  return null;
};

/** Whether `pos` is code outside a string literal (strings are code-mode tokens): quotes from its span's start. */
const codeAt = (ctx: Ctx, pos: number): boolean => {
  if (modeAt(ctx.modes, pos) !== "code") return false;
  let i = 0;
  for (const span of ctx.modes) if (span.at <= pos) i = span.at;
  let inString = false;
  for (; i < pos; i++) {
    if (ctx.text[i] === '"') inString = !inString;
    else if (inString && ctx.text[i] === "\\") i++;
  }
  return !inString;
};

/** Takes the arguments the layout profile sets out of the call whose `(` is at `open`. */
const profileRule = (ctx: Ctx, element: string, at: number, open: number): void => {
  const call = callArgs(ctx, open);
  const keys = PROFILE_KEYS[element];
  if (!call || !keys) return;
  // Each argument from its first character, its name, and whether it goes.
  const args = call.args.map(([from, to]) => {
    const m = /^(\s*)(?:([\w-]+)\s*:)?/.exec(ctx.text.slice(from, to)) as RegExpExecArray;
    const value = ctx.text.slice(from + m[0].length, to);
    const gone = keys.test(m[2] ?? "") && (!FRAMES.has(element) || small(value));
    return { from: from + (m[1] as string).length, to, name: m[2], gone };
  });
  // A frame's call keeps its corners unless it holds content: a content block after it or as an argument. (Not any
  // positional argument: CeTZ's `rect((0, 0), (4, 3), radius: 0.2)` takes coordinates.)
  const set = /\bset\s+$/.test(ctx.text.slice(Math.max(0, at - 12), at));
  if (
    FRAMES.has(element) &&
    !set &&
    ctx.text[call.close + 1] !== "[" &&
    !args.some((a) => a.name === undefined && ctx.text[a.from] === "[")
  )
    return;
  const changes: TextChange[] = [];
  args.forEach((arg, i) => {
    if (!arg.gone) return;
    // Up to the next argument; the last one with the comma before it, unless the argument before goes too.
    const next = args[i + 1];
    const prev = args[i - 1];
    changes.push({ from: !next && prev && !prev.gone ? prev.to : arg.from, to: next ? next.from : arg.to, insert: "" });
  });
  const names = args.filter((a) => a.gone).map((a) => `\`${a.name}\``);
  if (names.length)
    add(
      ctx,
      "layout-profile",
      at,
      call.close + 1,
      FRAMES.has(element)
        ? "rounded corners (`radius`) would make a picture of the box in a DOCX export, its text not editable; removed"
        : `${names.join(", ")} would override the layout profile; removed`,
      changes,
    );
};

export interface LintOptions {
  rules?: Partial<Record<LintRuleId, LintSeverity | boolean>>;
}

/** Runs the lint rules over `[from, to)` of a recognized text. */
export const lint = (
  text: string,
  rec: Pick<Recognition, "events" | "modes">,
  from: number,
  to: number,
  opts: LintOptions = {},
): LintFinding[] => {
  const out: LintFinding[] = [];
  const ctx: Ctx = {
    text,
    modes: rec.modes,
    from,
    to,
    out,
    severity: (rule) => {
      const v = opts.rules?.[rule];
      if (v === true) return "fix";
      if (v === false) return "off";
      return v ?? DEFAULT_LINT[rule];
    },
  };

  // A heading belongs to the range holding its `#`. Root checkpoints, where incremental
  // and streamed linting resume, sit at a line's first token, after its indentation:
  // search from the line start, or `^` can't match there and bare-hash escapes the `#`.
  const headings = new Set<number>();
  const lineStart = text.lastIndexOf("\n", from - 1) + 1;
  regexRule(
    ctx,
    MD_HEADING,
    (m) => {
      const hash = m.index + (m[1] as string).length;
      const hashes = m[2] as string;
      if (hash < from || !markupAt(ctx, hash)) return;
      headings.add(hash);
      add(ctx, "markdown-heading", hash, hash + hashes.length, "Markdown heading; Typst uses `=`", [
        { from: hash, to: hash + hashes.length, insert: "=".repeat(hashes.length) },
      ]);
    },
    lineStart,
  );
  regexRule(ctx, MD_BOLD, (m) => {
    const end = m.index + m[0].length;
    if (!markupAt(ctx, m.index) || !markupAt(ctx, end - 1)) return;
    const delim = (m[1] as string)[0] as string;
    add(ctx, "markdown-bold", m.index, end, `Markdown \`${m[1]}\`; Typst uses single \`${delim}\``, [
      { from: m.index, to: m.index + 2, insert: delim },
      { from: end - 2, to: end, insert: delim },
    ]);
  });
  regexRule(ctx, MD_LINK, (m) => {
    if (!markupAt(ctx, m.index)) return;
    const end = m.index + m[0].length;
    add(ctx, "markdown-link", m.index, end, "Markdown link; Typst uses `#link`", [
      { from: m.index, to: end, insert: `#link("${m[2]}")[${m[1]}]` },
    ]);
  });
  for (const e of rec.events) eventRule(ctx, e, headings);
  regexRule(ctx, PROFILE_CALL, (m) => {
    // A show-set rule counts on the element it sets (`show table: set table.cell(…)`), and any that sets `par`.
    const element = m[1] ?? (m[3] === "par" || m[3] === (m[2] === "table" ? "table.cell" : m[2]) ? m[3] : null);
    if (element && codeAt(ctx, m.index)) profileRule(ctx, element, m.index, m.index + m[0].length - 1);
  });

  return out.sort((a, b) => a.start - b.start);
};

/** Non-overlapping changes of the `fix` findings, ascending. */
export const fixChanges = (findings: readonly LintFinding[]): TextChange[] => {
  const changes = findings
    .filter((f) => f.severity === "fix")
    .flatMap((f) => f.changes)
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const out: TextChange[] = [];
  let last = -1;
  for (const c of changes) {
    if (c.from < last) continue;
    out.push(c);
    last = c.to;
  }
  return out;
};
