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
