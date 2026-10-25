// Layer 1: fixes for mistakes that are permanent, not streaming artifacts:
// Markdown habits and stray delimiters LLMs produce. Rules only look at settled
// text (or the whole document in final mode) and only at markup positions.

import { isAlphanumeric } from "./chars";
import type { LintEvent, ModeSpan, Recognition } from "./recognizer";

export type LintRuleId =
  | "markdown-heading"
  | "markdown-bold"
  | "markdown-link"
  | "email-at"
  | "bare-hash"
  | "stray-closer"
  | "unclosed-delim"
  | "unclosed-block-comment"
  | "currency-dollar";

/** `fix` applies the change, `warn` only reports it. */
export type LintSeverity = "fix" | "warn" | "off";

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
};

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

export interface LintFinding {
  rule: LintRuleId | string;
  severity: "fix" | "warn";
  start: number;
  end: number;
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
const CURRENCY = /^\d[\d.,]*\s+\p{L}{2,}/u;

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

const regexRule = (ctx: Ctx, re: RegExp, f: (m: RegExpExecArray) => void): void => {
  re.lastIndex = ctx.from;
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
      if (!inRange(ctx, e.start)) return;
      const body = ctx.text.slice(e.start + 1, e.end - 1);
      const display = /^\s/.test(body) && /\s$/.test(body);
      if (!display && ctx.text[e.end - 1] === "$" && CURRENCY.test(body)) {
        add(ctx, "currency-dollar", e.start, e.end, "looks like prices, not math: `$` should be escaped (`\\$`)", [
          { from: e.start, to: e.start, insert: "\\" },
          { from: e.end - 1, to: e.end - 1, insert: "\\" },
        ]);
      }
      return;
    }
  }
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

  const headings = new Set<number>();
  regexRule(ctx, MD_HEADING, (m) => {
    const hash = m.index + (m[1] as string).length;
    const hashes = m[2] as string;
    if (!markupAt(ctx, hash)) return;
    headings.add(hash);
    add(ctx, "markdown-heading", hash, hash + hashes.length, "Markdown heading; Typst uses `=`", [
      { from: hash, to: hash + hashes.length, insert: "=".repeat(hashes.length) },
    ]);
  });
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
