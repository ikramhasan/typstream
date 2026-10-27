// Documents for property tests, assembled from COMPLETE constructs (the
// remend approach): every truncation comes from the streaming cut, never from
// the generator. Atoms cover markup, math, code, raw, comments and the
// statements teachers' documents use.

import fc from "fast-check";

export const INLINE_ATOMS = [
  "plain words",
  "*strong text*",
  "_emph text_",
  "*bold _nested emph_ text*",
  "`inline code`",
  "``",
  "$x^2 + y_1$",
  "$frac(a, b)$",
  "$sqrt(x) / 2$",
  "$sqrt(1/n sum (x_i - {y})^2)$",
  "$a_(i j)^2$",
  "$[0, 1)$",
  "$f(x) = x'$",
  "$alpha + beta.alt$",
  '$"text" in A$',
  "@ref-a",
  "#emph[inner]",
  "#text(fill: red)[colored]",
  "#box[a [nested] b]",
  '#link("https://typst.app")[Typst]',
  "https://example.com/path_(x)",
  "\\#escaped",
  "\\u{1F600}",
  "#(1 + 2 * 3)",
  "#calc.max(1, 2)",
  '#"str with \\" quote".len()',
  "snake_case_word",
  "a*b and 2*3",
  "smart \"quotes\" and 'single'",
  "--- dash ...",
  "#[content block]",
  "#{ 1 + 2 }",
  "#(a: 1, b: (2, 3))",
  "~nbsp",
  "😀 émoji ünïcode",
  "文字 *中文*",
  "line\\ break",
  "#sym.arrow.r",
  "#h(1em)",
  "#strong[*nested* strong]",
  "#[a]#[b]",
];

export const BLOCK_ATOMS = [
  "= Heading",
  "== Sub heading <sec-a>",
  "- item one\n- item two",
  "+ first\n+ second\n  + nested",
  "/ Term: description",
  "$ sum_(k=1)^n k = (n(n+1))/2 $",
  '```python\nprint("hi")\n```',
  "````md\n```inner```\n````",
  "#let f(x) = x + 1",
  "#let (a, b) = (1, 2)",
  "#set text(size: 11pt)",
  '#set heading(numbering: "1.")',
  "#show heading: it => [*#it.body*]",
  "#show link: underline",
  "#figure(\n  table(columns: 2, [a], [b]),\n  caption: [Cap],\n) <fig-a>",
  "#if true [yes] else [no]",
  "#for i in range(3) [#i ]",
  "#while false {}",
  "#{\n  let x = 1\n  x + 2\n}",
  "#context counter(page).get()",
  "/* block /* nested */ comment */",
  "// line comment",
  '#import "lib.typ": f',
  "#table(\n  columns: 3,\n  [a], [b], [c],\n)",
  "#grid(columns: (1fr, 2fr))[x][y]",
  "#par(justify: true)[Long text with *strong*]",
  "- list with *strong*\n  continued line",
  "#align(center)[#box(width: 50%)[Centered]]",
  "$ mat(1, 2; 3, 4) $",
  "$ x &= 1 \\\n  &= 2 $",
  "#footnote[a note]",
  "#let g(a, b: 2, ..rest) = {\n  a + b\n}",
  '#let d = (x: 1, "y": 2)',
  "#{\n  if 1 < 2 { [less] } else { [more] }\n}",
  "Text with a label ref @fig-a and math $x$.",
];

export const MAX_ATOM_LENGTH = Math.max(...[...INLINE_ATOMS, ...BLOCK_ATOMS].map((a) => a.length));

const paragraph = fc
  .array(fc.constantFrom(...INLINE_ATOMS), { minLength: 1, maxLength: 6 })
  .map((atoms) => atoms.join(" "));

const block = fc.oneof({ weight: 3, arbitrary: paragraph }, { weight: 2, arbitrary: fc.constantFrom(...BLOCK_ATOMS) });

/** A complete, valid document. */
export const documentArb = fc.array(block, { minLength: 1, maxLength: 8 }).chain((blocks) =>
  fc
    .array(fc.constantFrom("\n\n", "\n\n", "\n\n\n", "\n\n// c\n\n"), {
      minLength: blocks.length,
      maxLength: blocks.length,
    })
    .map((seps) => blocks.map((b, i) => b + (i < blocks.length - 1 ? seps[i] : "\n")).join("")),
);

/** Splits text into chunks the way token streams do (1–24 chars, occasionally splitting surrogate pairs). */
export const chunksArb = (text: string) =>
  fc.array(fc.integer({ min: 1, max: 24 }), { minLength: 1, maxLength: text.length + 1 }).map((sizes) => {
    const chunks: string[] = [];
    let pos = 0;
    let i = 0;
    while (pos < text.length) {
      const size = sizes[i++ % sizes.length] as number;
      chunks.push(text.slice(pos, pos + size));
      pos += size;
    }
    return chunks;
  });

/** Every cut position of a text, plus the full text. */
export const prefixes = (text: string, step = 1): string[] => {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += step) out.push(text.slice(0, i));
  out.push(text);
  return out;
};

/** Length of the longest prefix of `input` that is a subsequence of `output`. */
export const preservedPrefixLength = (input: string, output: string): number => {
  let matched = 0;
  for (let i = 0; i < output.length && matched < input.length; i++) {
    if (output[i] === input[matched]) matched++;
  }
  return matched;
};

/** Typst-heavy character soup for differential parser tests. */
export const soupArb = fc
  .array(
    fc.constantFrom(
      ..."*_#$[](){}<>@`\\\"'=-+/:;,.^&!|~ \n\nabcxyz0123",
      "let ",
      "set ",
      "show ",
      "if ",
      "else ",
      "for ",
      "in ",
      "=>",
      "..",
      "//",
      "/*",
      "*/",
      "```",
      "https://a.b",
      "#f(",
      "$ ",
      "é",
      "文",
      "😀",
      "\t",
      "u{41}",
      "12pt",
      "1.5",
      "import ",
      "include ",
      " as ",
      "not ",
      "context ",
      "return ",
      "break",
      "while ",
      "(a: 1)",
      "(..x)",
      "x.y",
      "+=",
      "-=",
      "!=",
      "<=",
      ">=",
      "==",
      "0x1F",
      "0b2",
      "1e5",
      "1e",
      "50%",
      "2fr",
      "3em",
      "none",
      "auto",
      "true",
      "_ ",
      "#let (a, ..b) = ",
      "#let f(a, b: 1, ..c) = ",
      "(x) => ",
      "√",
      "&",
      "'",
      "!",
      "[|",
      "|]",
      "frac(",
      "a.b(",
      "<lbl>",
      "@r[s]",
      "- ",
      "+ ",
      "/ T: ",
      "1. ",
      "\\u{",
      "~",
      "---",
      "...",
      '#import "m": a as b, c',
      "#for (k, v) in d ",
      "#(1, 2) == ",
      "#{ x = 1 }",
      "$a_1^2'$",
      "#x.at(",
    ),
    { maxLength: 40 },
  )
  .map((parts) => parts.join(""));

// --- Code ------------------------------------------------------------------------
// Typst code built from complete expressions: every operator, closures, patterns,
// rules and control flow, with the newline rules that apply inside code (a line
// break ends a statement, `else` and `.` on the next line continue one).

const IDENT = fc.constantFrom("x", "y", "foo", "my-var", "_tmp", "é");
const LITERAL = fc.constantFrom(
  "1",
  "0",
  "1.5",
  "1e3",
  ".5",
  "0x1F",
  "0b101",
  "0o17",
  "2pt",
  "50%",
  "1fr",
  "3em",
  '"s"',
  '"a\\"b"',
  '"\\u{41}"',
  "none",
  "auto",
  "true",
  "false",
  "<lbl>",
  "`raw`",
  "[text *b*]",
  "[]",
  "$x^2$",
  "$ a/b $",
  "()",
  "(:)",
);
const BINARY = ["+", "-", "*", "/", "==", "!=", "<", "<=", ">", ">=", "and", "or", "in", "not in"];
const ASSIGN = ["=", "+=", "-=", "*=", "/="];

const { expr: codeExprArb } = fc.letrec<{ expr: string; args: string; block: string; stmt: string }>((tie) => ({
  expr: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    { weight: 4, arbitrary: IDENT },
    { weight: 4, arbitrary: LITERAL },
    fc.tuple(fc.constantFrom("-", "+", "not "), tie("expr")).map(([op, e]) => `${op}${e}`),
    fc.tuple(tie("expr"), fc.constantFrom(...BINARY), tie("expr")).map(([a, op, b]) => `${a} ${op} ${b}`),
    tie("expr").map((e) => `(${e})`),
    fc.tuple(tie("expr"), tie("expr")).map(([a, b]) => `(${a}, ${b})`),
    tie("expr").map((e) => `(${e},)`),
    fc.tuple(IDENT, tie("expr")).map(([k, v]) => `(${k}: ${v}, "k": 1)`),
    fc.tuple(IDENT, IDENT).map(([a, b]) => `${a}.${b}`),
    fc.tuple(IDENT, tie("args")).map(([f, a]) => `${f}(${a})`),
    fc.tuple(IDENT, IDENT, tie("args")).map(([o, m, a]) => `${o}.${m}(${a})`),
    fc.tuple(IDENT, tie("args")).map(([f, a]) => `${f}(${a})[body]`),
    IDENT.map((f) => `${f}[only content]`),
    tie("expr").map((e) => `x => ${e}`),
    fc
      .tuple(fc.constantFrom("(x, y)", "(..args)", "(a: 1, ..rest)", "()", "((a, b), c)", "(_)"), tie("expr"))
      .map(([p, e]) => `${p} => ${e}`),
    fc.tuple(tie("expr"), tie("block")).map(([c, b]) => `if ${c} ${b}`),
    fc.tuple(tie("expr"), tie("block"), tie("block")).map(([c, a, b]) => `if ${c} ${a} else ${b}`),
    fc.tuple(tie("expr"), tie("block")).map(([c, a]) => `if ${c} ${a} else if ${c} [b] else [c]`),
    fc
      .tuple(fc.constantFrom("x", "(k, v)", "(a, .., b)", "_"), tie("expr"), tie("block"))
      .map(([p, e, b]) => `for ${p} in ${e} ${b}`),
    fc.tuple(tie("expr"), tie("block")).map(([c, b]) => `while ${c} ${b}`),
    tie("expr").map((e) => `context ${e}`),
    tie("block"),
  ),
  args: fc.oneof(
    fc.constant(""),
    tie("expr"),
    fc.tuple(tie("expr"), IDENT, tie("expr")).map(([a, k, v]) => `${a}, ${k}: ${v}`),
    tie("expr").map((e) => `..${e}`),
    fc.tuple(tie("expr"), tie("expr")).map(([a, b]) => `${a},\n  ${b},`),
  ),
  block: fc.oneof(
    { depthSize: "small" },
    fc
      .array(tie("stmt"), { minLength: 0, maxLength: 3 })
      .chain((stmts) => fc.constantFrom("; ", "\n").map((sep) => `{ ${stmts.join(sep)} }`)),
    fc.constantFrom("[a]", "[*b* _c_]", "[- item]"),
  ),
  stmt: fc.oneof(
    { weight: 3, arbitrary: tie("expr") },
    fc
      .tuple(fc.constantFrom("x", "_", "(a, b)", "(a, ..b)", "(a: x, ..r)", "f(x, y: 1, ..z)"), tie("expr"))
      .map(([p, e]) => `let ${p} = ${e}`),
    IDENT.map((x) => `let ${x}`),
    fc.tuple(IDENT, fc.constantFrom(...ASSIGN), tie("expr")).map(([x, op, e]) => `${x} ${op} ${e}`),
    fc.tuple(IDENT, tie("args")).map(([f, a]) => `set ${f}(${a})`),
    fc.tuple(IDENT, tie("expr")).map(([f, c]) => `set ${f}(red) if ${c}`),
    fc.constantFrom(
      "show heading: set text(blue)",
      'show "x": it => [y]',
      "show: it => it",
      "show heading.where(level: 1): it => it.body",
      'import "m.typ": a, b as c',
      'import "m.typ" as m',
      'import "m.typ": *',
      'import "m.typ": (a, b)',
      'include "x.typ"',
      "break",
      "continue",
      "return",
      "return x",
      "if x { 1 }\nelse { 2 }",
      "x\n  .at(0)",
      "(1 +\n 2)",
      "// comment\nx",
      "/* block */ x",
    ),
  ),
}));

export { codeExprArb };

/** Markup paragraphs with embedded code: `#(…)`, `#{…}`, and calls or rules straight after `#`. */
export const codeDocumentArb = fc
  .array(
    fc.oneof(
      codeExprArb.map((e) => `#(${e})`),
      codeExprArb.map((e) => `#{\n  ${e}\n}`),
      codeExprArb.map((e) => `Text with $#${e}$ in math.`),
      fc
        .constantFrom("x", "foo(1)", "x.y", "f(a)[b]", "if true [a] else [b]", "for i in (1, 2) [#i]")
        .map((e) => `Some #${e} text.`),
      fc.constantFrom(
        "#let f(x) = x + 1",
        "#set text(size: 12pt)",
        "#show heading: it => [*#it.body*]",
        '#import "@preview/pkg:1.0.0": a',
        "#if x [a]\nelse [b]",
        "= Heading <h>\n- #x\n+ #(1 + 2)\n/ Term: #y",
      ),
      paragraph,
    ),
    { minLength: 1, maxLength: 5 },
  )
  .map((blocks) => `${blocks.join("\n\n")}\n`);
