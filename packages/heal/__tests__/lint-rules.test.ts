// Lint rules in detail: the exact findings (span, message, changes), the edges
// of each pattern, and the `[from, to)` range a call may look at. lint.test.ts
// covers the rules end to end through `heal`.

import { describe, expect, it } from "vitest";
import { heal } from "../src";
import { fixChanges, type LintFinding, lint, modeAt } from "../src/lint";
import { recognize } from "../src/recognizer";

const lintAll = (text: string, rules = {}) => lint(text, recognize(text), 0, text.length, { rules });
const final = (input: string) => heal(input, { final: true });

describe("findings", () => {
  it("each rule reports its span, message and changes", () => {
    const text = "## Sub\nSome **bold** [Typst](http://typst.app) me@x.com, # 5 and ] or *open\n\nnext /* rest";
    const at = (s: string, from = 0) => text.indexOf(s, from);
    expect(lintAll(text)).toEqual<LintFinding[]>([
      {
        rule: "markdown-heading",
        severity: "fix",
        start: 0,
        end: 2,
        message: "Markdown heading; Typst uses `=`",
        changes: [{ from: 0, to: 2, insert: "==" }],
      },
      {
        rule: "markdown-bold",
        severity: "fix",
        start: at("**"),
        end: at("**", at("**") + 1) + 2,
        message: "Markdown `**`; Typst uses single `*`",
        changes: [
          { from: at("**"), to: at("**") + 2, insert: "*" },
          { from: at("** ["), to: at("** [") + 2, insert: "*" },
        ],
      },
      {
        rule: "markdown-link",
        severity: "fix",
        start: at("[Typst]"),
        end: at(") me") + 1,
        message: "Markdown link; Typst uses `#link`",
        changes: [{ from: at("[Typst]"), to: at(") me") + 1, insert: '#link("http://typst.app")[Typst]' }],
      },
      {
        rule: "email-at",
        severity: "fix",
        start: at("@x"),
        // A reference takes the label characters after `@`, dots included.
        end: at(".com") + 4,
        message: "`@` inside a word is read as a reference; escaped it (`\\@`)",
        changes: [{ from: at("@x"), to: at("@x"), insert: "\\" }],
      },
      {
        rule: "bare-hash",
        severity: "fix",
        start: at("# 5"),
        end: at("# 5") + 1,
        message: "a `#` followed by a space starts no expression; escaped it (`\\#`)",
        changes: [{ from: at("# 5"), to: at("# 5"), insert: "\\" }],
      },
      {
        rule: "stray-closer",
        severity: "fix",
        start: at("] or"),
        end: at("] or") + 1,
        message: "unmatched `]`; escaped it (`\\]`)",
        changes: [{ from: at("] or"), to: at("] or"), insert: "\\" }],
      },
      {
        rule: "unclosed-delim",
        severity: "fix",
        start: at("*open"),
        end: at("*open") + 1,
        message: "`*` is never closed in its paragraph; escaped it",
        changes: [{ from: at("*open"), to: at("*open"), insert: "\\" }],
      },
      {
        rule: "unclosed-block-comment",
        severity: "warn",
        start: at("/*"),
        end: text.length,
        message: "unclosed `/*` hides the rest of the document",
        changes: [],
      },
    ]);
  });

  it("markdown-link: the whole link is replaced", () => {
    // Pinned separately: the finding's end is exclusive, the change covers the same span.
    const [f] = lintAll("[a](https://x.y)");
    expect(f).toMatchObject({ start: 0, end: 16, changes: [{ from: 0, to: 16 }] });
  });

  it("currency-dollar escapes both dollars when it fixes", () => {
    expect(lintAll("It costs $5 and $10", { "currency-dollar": "fix" })).toEqual([
      {
        rule: "currency-dollar",
        severity: "fix",
        start: 9,
        end: 17,
        message: "looks like prices, not math: `$` should be escaped (`\\$`)",
        changes: [
          { from: 9, to: 9, insert: "\\" },
          { from: 16, to: 16, insert: "\\" },
        ],
      },
    ]);
  });

  it("findings are sorted by position, whatever order the rules found them in", () => {
    // Event rules (stray closer) run after the regex rules (heading), but come first here.
    const starts = lintAll("] x\n# Heading").map((f) => f.start);
    expect(starts).toEqual([0, 4]);
  });
});

describe("pattern edges", () => {
  const rules = (text: string) => lintAll(text).map((f) => f.rule);

  it("markdown-heading takes any run of spaces after up to six hashes", () => {
    expect(final("##  Two spaces").source).toBe("==  Two spaces");
    expect(final("  ### Indented").source).toBe("  === Indented");
    expect(final("#\tTab").source).toBe("=\tTab");
  });

  it("markdown-link takes http and https URLs only", () => {
    expect(final("[a](http://x.y)").source).toBe('#link("http://x.y")[a]');
    expect(rules("[a](ftp://x.y)")).not.toContain("markdown-link");
  });

  it("currency-dollar: a number, then space, then a word, at the start of the equation", () => {
    const warns = (text: string) => rules(text).includes("currency-dollar");
    expect(warns("$5 and $")).toBe(true);
    expect(warns("$1,000.50 or $")).toBe(true);
    expect(warns("$5  and $")).toBe(true);
    expect(warns("$x 5 dollars$")).toBe(false);
    expect(warns("$5 a$")).toBe(false);
    expect(warns("$5and$")).toBe(false);
    // Display math (spaces inside both dollars) is math, whatever it holds.
    expect(warns("$ 5 and $")).toBe(false);
    expect(warns("$5 and $ ")).toBe(true);
    expect(warns("$5 for students and $")).toBe(true);
    // Math that starts with a number and a word (operators), as models write it (#24).
    expect(warns("$0.4 times 0.3 =$")).toBe(false);
    expect(warns("$6.02 times 10^23$ particles")).toBe(false);
    expect(warns("$0 leq t leq (3 + sqrt(10))/2$")).toBe(false);
    expect(warns("$2 times 0.100 = 0.200$ mol")).toBe(false);
    expect(warns("$30 degree$ to the horizontal")).toBe(false);
    expect(warns("[$2 cos(x)$], [$x$]")).toBe(false);
  });

  it("math-lone-script: a script with no base at the start of an equation (#24)", () => {
    const fixes = (text: string) => rules(text).includes("math-lone-script");
    expect(final("$9.8$ m/s$^2$").source).toBe('$9.8$ m/s$""^2$');
    expect(final("mol L$^(-1)$ and $ _2 $").source).toBe('mol L$""^(-1)$ and $ ""_2 $');
    expect(fixes("$x^2$")).toBe(false);
    expect(fixes("$a_1 + b^2$")).toBe(false);
    expect(fixes('$""^2$')).toBe(false);
    // In code, `^` and `_` aren't scripts.
    expect(fixes('#let x = "$^2$"')).toBe(false);
  });

  it("markdown-bold needs markup at both delimiters", () => {
    expect(rules("**a** b")).toContain("markdown-bold");
    expect(rules('#"**a**"')).not.toContain("markdown-bold");
    // The opening is markup, the closing is inside a string.
    expect(rules('**a #"b**"')).not.toContain("markdown-bold");
  });
});

describe("range", () => {
  // Every rule only reports findings that start inside `[from, to)` and,
  // for patterns, end inside it too.
  const text = "a ] b # c x@y $5 and $ *d\n\nend";
  const rec = recognize(text);
  const findingsIn = (from: number, to: number) => lint(text, rec, from, to).map((f) => [f.rule, f.start]);

  it("finds everything in the full range", () => {
    expect(findingsIn(0, text.length)).toEqual([
      ["stray-closer", 2],
      ["bare-hash", 6],
      ["email-at", 11],
      ["currency-dollar", 14],
      ["unclosed-delim", 23],
    ]);
  });

  it("skips findings that start before `from` or at or after `to`", () => {
    expect(findingsIn(3, text.length)).toEqual([
      ["bare-hash", 6],
      ["email-at", 11],
      ["currency-dollar", 14],
      ["unclosed-delim", 23],
    ]);
    expect(findingsIn(0, 6)).toEqual([["stray-closer", 2]]);
    expect(findingsIn(0, 7)).toEqual([
      ["stray-closer", 2],
      ["bare-hash", 6],
    ]);
    expect(findingsIn(23, 24)).toEqual([["unclosed-delim", 23]]);
    expect(findingsIn(24, text.length)).toEqual([]);
    expect(findingsIn(12, 14)).toEqual([]);
    expect(findingsIn(11, 12)).toEqual([["email-at", 11]]);
  });

  it("pattern rules need the whole match inside the range", () => {
    const md = "x **bold** y";
    const r = recognize(md);
    expect(lint(md, r, 0, md.length).map((f) => f.rule)).toEqual(["markdown-bold"]);
    expect(lint(md, r, 0, 10)).toHaveLength(1);
    expect(lint(md, r, 0, 9)).toEqual([]);
    expect(lint(md, r, 3, md.length)).toEqual([]);
    expect(lint(md, r, 2, 3)).toEqual([]);
  });

  it("an equation is judged by where it starts", () => {
    const eq = "x $5 and $";
    const r = recognize(eq);
    const rule = (from: number, to: number) => lint(eq, r, from, to).map((f) => f.rule);
    expect(rule(2, 3)).toEqual(["currency-dollar"]);
    expect(rule(3, eq.length)).toEqual([]);
  });

  it("an unclosed comment is reported from its start", () => {
    const c = "a /* b";
    const r = recognize(c);
    expect(lint(c, r, 2, 3).map((f) => f.rule)).toEqual(["unclosed-block-comment"]);
    expect(lint(c, r, 3, c.length)).toEqual([]);
    expect(lint(c, r, 0, 2)).toEqual([]);
  });
});

describe("severity", () => {
  it("true and false switch a rule to fix and off", () => {
    const t = "Costs $5 and $10\n\n# H";
    expect(final(t).findings.map((f) => [f.rule, f.severity])).toEqual([
      ["currency-dollar", "warn"],
      ["markdown-heading", "fix"],
    ]);
    const r = heal(t, { final: true, lint: { "currency-dollar": true, "markdown-heading": false } });
    expect(r.findings.map((f) => [f.rule, f.severity])).toEqual([["currency-dollar", "fix"]]);
    expect(r.source).toBe("Costs \\$5 and \\$10\n\n# H");
  });

  it("off rules report nothing", () => {
    expect(heal("a ] b", { final: true, lint: { "stray-closer": "off" } }).findings).toEqual([]);
  });
});

describe("modeAt", () => {
  const spans = [
    { at: 0, mode: "markup" },
    { at: 3, mode: "code" },
    { at: 5, mode: "math" },
  ] as const;
  it("returns the mode of the last span starting at or before a position", () => {
    expect([0, 2, 3, 4, 5, 9].map((p) => modeAt(spans, p))).toEqual([
      "markup",
      "markup",
      "code",
      "code",
      "math",
      "math",
    ]);
  });
  it("is markup before the first span and without spans", () => {
    expect(modeAt([{ at: 2, mode: "code" }], 1)).toBe("markup");
    expect(modeAt([], 4)).toBe("markup");
  });
});

describe("fixChanges", () => {
  const f = (severity: "fix" | "warn", ...changes: { from: number; to: number; insert: string }[]): LintFinding => ({
    rule: "r",
    severity,
    start: 0,
    end: 0,
    message: "",
    changes,
  });

  it("keeps fix changes only, sorted by position then end", () => {
    expect(
      fixChanges([
        f("fix", { from: 5, to: 6, insert: "b" }),
        f("warn", { from: 1, to: 1, insert: "w" }),
        f("fix", { from: 2, to: 3, insert: "a" }, { from: 2, to: 2, insert: "z" }),
      ]),
    ).toEqual([
      { from: 2, to: 2, insert: "z" },
      { from: 2, to: 3, insert: "a" },
      { from: 5, to: 6, insert: "b" },
    ]);
  });

  it("drops changes that overlap an earlier one", () => {
    expect(
      fixChanges([
        f("fix", { from: 0, to: 4, insert: "a" }),
        f("fix", { from: 3, to: 5, insert: "b" }),
        f("fix", { from: 4, to: 4, insert: "c" }),
      ]),
    ).toEqual([
      { from: 0, to: 4, insert: "a" },
      { from: 4, to: 4, insert: "c" },
    ]);
  });
});
