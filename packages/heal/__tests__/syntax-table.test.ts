// A fixed table of snippets, one or more per grammar rule of the recognizer
// (markup, math, code, patterns, rules, errors), each checked against Typst's
// parser on every prefix: same verdict, same first error, same token modes.
// Deterministic, so it keeps its strength when property runs are scaled down.

import { describe, expect, it } from "vitest";
import { heal } from "../src";
import { modeAt } from "../src/lint";
import { effectiveRequirements, recognize } from "../src/recognizer";
import { prefixes } from "./support/generators";
import { knownBug } from "./support/known-bugs";
import { syntaxErrors, tokenModes } from "./support/oracle";

const KEYWORDS = [
  "none",
  "auto",
  "true",
  "false",
  "not",
  "and",
  "or",
  "let",
  "set",
  "show",
  "context",
  "if",
  "else",
  "for",
  "in",
  "while",
  "break",
  "continue",
  "return",
  "import",
  "include",
  "as",
];

const MARKUP = [
  "= Heading <h>\n== Sub",
  "== *Strong heading* with $x$",
  "- item\n  - nested\n- next",
  "+ one\n+ two\n  + nested",
  "1. first\n2. second",
  "/ Term: description\n/ Other: more",
  "*strong _emph_ inside*",
  "_emph *strong* inside_",
  "a*b*c word-internal",
  "\"quoted\" and 'single' it's",
  "a -- b --- c ... d ~ e -? f",
  "line \\\nbreak and \\# escape \\u{1F600}",
  "label <a:b.c> and @ref @ref[supplement] @a.b.",
  "https://typst.app/docs?x=1#y and (https://a.b/(c))",
  "`raw` and ``empty`` and ```lang\ncode\n```",
  "````\n```\nnested fence\n```\n````",
  "// line comment\n/* block /* nested */ */ text",
  "#[content block] and [brackets [nested]]",
  "text ] stray",
  "#box[a]#box[b]",
  "#![shebang-like]",
  "  - indented list\n    continued\n  - next",
  "= Heading\ncontinued?",
  "a\n\n\nb",
];

const MATH = [
  "$x^2_i + y_(i j)^(k+1)$",
  "$a/b + (a+b)/(c d) + 1/2/3$",
  "$f(x) = x'' + g'(x)$",
  "$sqrt(x) + root(3, x) + √x + ∛y + ∜z$",
  "$a & = b \\\\ & = c$",
  "$ x \\ y $",
  '$"text" + #x + #f(1) + x.y.z + alpha.alt$',
  '$mat(1, 2; 3, 4) + vec(a, b, delim: "[")$',
  "$f(a, ..b, c: d, e: f)$",
  '$cases(x &"if" y, z &"else")$',
  "$[a, b) + {c} + |d| + ||e|| + ⌈f⌉$",
  "$a -> b => c <== d != e <= f >= g ... h :: i := j$",
  "$a!$ and $n!+1$ and $!=$",
  "$x_1_2^3$",
  "$#let x = 1; x$",
  "$1.5 + 2,3 + x;y$",
  "$a #h(1em) b$",
  "$ lr(( a/b )) $",
  "$\\$ + \\# + \\u{41}$",
  "$x^$",
  "$_x$",
  "$f(,)$",
  "$f(a:)$",
];

const CODE = [
  "#let x = 1",
  "#let f(x, y: 2, ..z) = x + y",
  "#let (a, b) = (1, 2)",
  "#let (a, .., b) = (1, 2, 3)",
  "#let (a: x, b, ..rest) = d",
  "#let ((a, b), c) = ((1, 2), 3)",
  "#let _ = 1",
  "#let f() = none",
  "#let f(_) = 1",
  "#let f((a, b)) = a",
  "#let x",
  "#set text(size: 12pt, fill: red)",
  "#set text(red) if x > 1",
  "#show heading: set text(blue)",
  "#show heading.where(level: 1): it => [*#it.body*]",
  '#show "x": [y]',
  "#show: rest => rest",
  '#import "m.typ": a, b as c',
  '#import "m.typ": (a, b,)',
  '#import "m.typ" as m',
  '#import "m.typ": *',
  '#import "m.typ": a.b',
  '#include "x.typ"',
  "#{ let x = 1; x += 2; x -= 1; x *= 3; x /= 4; x }",
  "#{ x = 1\n y = 2 }",
  "#(1 + 2 * 3 - 4 / 5)",
  "#(a == b and c != d or e < f and g <= h or i > j and k >= l)",
  "#(x in y and x not in z)",
  "#(not true and -1 < +2)",
  "#(a.b.c(d)(e)[f][g])",
  "#(x => x + 1)",
  "#((x, y) => x * y)",
  "#((..args) => args)",
  "#((a: 1, ..rest) => a)",
  "#(() => none)",
  "#((x) => x)",
  "#((x))",
  "#(1,)",
  "#()",
  "#(:)",
  '#(a: 1, "b": 2, c: 3)',
  "#(..a, ..b)",
  "#(a: 1, ..b)",
  "#(1, a: 2)",
  "#if a { 1 } else if b { 2 } else { 3 }",
  "#if a [x] else [y]",
  "#if a [x]\nelse [y]",
  "#{\n  if a { 1 }\n  else { 2 }\n}",
  "#{\n  x\n    .at(0)\n    .len()\n}",
  "#for x in y { x }",
  "#for (k, v) in d [#k: #v]",
  "#for (a, .., b) in z {}",
  "#while x < 3 { x += 1; break; continue }",
  "#let f() = { return 1 }",
  "#let f() = { return }",
  "#context counter(page).get()",
  "#f[a][b]",
  "#f(1)[a]",
  "#x.y",
  "#x.y()",
  "#x.y.z text",
  "#x. text",
  "#f(x) text",
  "#f (x)",
  "#1pt + 2",
  "#0x1F + 0b101 + 0o17 + 1e10 + 1.5e-3 + 50% + 2fr + 3em + 4deg",
  '#"str \\" \\\\ \\u{41}"',
  "#<lbl>",
  "#`raw`",
  "#$x$",
  "#[x]",
  "#{}",
  "#none#auto#true",
  "#x;rest",
  "#{ let x = 1 };rest",
  "#(\n  1,\n  2,\n)",
  "#f(\n  a,\n  b: c,\n)",
  "#{ /* c */ x // c\n }",
  "#let f(x) = if x { 1 } else { 2 }",
  "#(if x { 1 } else { 2 })",
  "#let x = context y",
];

const ERRORS = [
  "#f(a: 1, a: 2)",
  "#(a: 1, a: 2)",
  "#let f(x, x) = 1",
  "#let (a, a) = (1, 2)",
  "#let (..a, ..b) = c",
  "#f(1: 2)",
  "#let f(1) = 2",
  "#(a: 1, 2)",
  "#(1, a: 2, 3)",
  "#{ let }",
  "#let = 1",
  '#import "m": a,, b',
  '#import "m": 1',
  "#x.1",
  "#(1 +)",
  "#{ 1 2 }",
  "#(1 2)",
  "#f(a b)",
  "#for in x {}",
  "#for x y {}",
  "#while {}",
  "#if {}",
  "#set",
  "#show",
  "#(..)",
  "#(.. x)",
  "#((a) b => 1)",
  "#{ x = }",
  "#{ ) }",
  "#{ ] }",
  "#( } )",
  '#"abc',
  "#0xZZ + 1e",
  "#\\u{zz}",
  "#let (a: 1) = x",
  "#let (a.b) = x",
  "#let f(..) = x",
  "#(not)",
  "#(x not y)",
  "#(x not)",
  "a */ b",
  "$a ) b$",
  "$ f(a: ) $",
  "#box[",
  "*a",
  "_a",
  "`a",
  "$a",
  "#(",
  "#{",
  "#[",
  '#"a',
];

const KEYWORD_SNIPPETS = KEYWORDS.flatMap((k) => [
  `#let (${k}, b) = 1`,
  `#import "m": ${k}`,
  `#let f(${k}) = 1`,
  `#for ${k} in x {}`,
  `#(${k}: 1)`,
  `#f(${k}: 1)`,
  `#x.${k}`,
  `$x.${k}$`,
  `#let ${k} = 1`,
  `#${k}`,
  `#{ ${k} }`,
]);

const clean = (text: string): boolean => {
  const r = recognize(text);
  return (
    r.errors.length === 0 && effectiveRequirements(r.requirements).every((q) => q.type === "cut" && q.soft === true)
  );
};

/** `healable`: the complete snippet parses, so every healed prefix must too. */
const checkPrefix = (p: string, healable: boolean): string | null => {
  const theirs = syntaxErrors(p);
  if (clean(p) !== (theirs.length === 0)) return `verdict (oracle clean=${theirs.length === 0})`;
  if (theirs.length === 0) {
    const { modes } = recognize(p);
    const want = tokenModes(p);
    const got = want.map(({ start }) => ({ mode: modeAt(modes, start), start }));
    if (JSON.stringify(got) !== JSON.stringify(want)) return `modes ${JSON.stringify(got)} vs ${JSON.stringify(want)}`;
  }
  if (!healable) return null;
  const out = heal(p).source;
  const outErrors = syntaxErrors(out);
  if (outErrors.length > 0 && !knownBug(p, outErrors))
    return `healed to ${JSON.stringify(out)}: ${JSON.stringify(outErrors)}`;
  return null;
};

describe("syntax table ≡ typst-syntax on every prefix", () => {
  it.each([
    ["markup", MARKUP],
    ["math", MATH],
    ["code", CODE],
    ["errors", ERRORS],
    ["keywords", KEYWORD_SNIPPETS],
  ] as const)("%s", (_, snippets) => {
    const failures: string[] = [];
    for (const s of snippets) {
      const doc = `${s}\n\nafter`;
      const healable = syntaxErrors(doc).length === 0;
      for (const p of prefixes(doc)) {
        const why = checkPrefix(p, healable);
        if (why) failures.push(`${JSON.stringify(p)}: ${why}`);
      }
    }
    expect(failures.slice(0, 10).join("\n")).toBe("");
  });

  it("a keyword or identifier at the very end of code may still grow: a soft cut", () => {
    for (const k of [...KEYWORDS, "x", "_"]) {
      const reqs = recognize(`#{ a; ${k}`).requirements;
      expect(reqs, k).toContainEqual({ type: "cut", at: 6, reason: "partial-word", soft: true });
    }
    expect(recognize("#{ a; 1").requirements).not.toContainEqual(expect.objectContaining({ reason: "partial-word" }));
  });
});
