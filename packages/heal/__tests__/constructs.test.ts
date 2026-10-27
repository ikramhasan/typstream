// Table-driven expectations: one row per construct a stream can be cut inside
// (PLAN.md §3 and §5.4). Each output is also checked against Typst's parser.

import { describe, expect, it } from "vitest";
import { heal } from "../src";
import { syntaxErrors } from "./support/oracle";

type Row = [input: string, healed: string, frames?: string];

const close: Row[] = [
  ["Hello *bold", "Hello *bold*", "strong"],
  ["Hello _emph", "Hello _emph_", "emph"],
  ["*bold _both", "*bold _both_*", "emph,strong"],
  ["#box[Hello", "#box[Hello]", "content"],
  ["#box[a [b", "#box[a [b]]", "text-bracket,content"],
  ["#box[*a [b", "#box[*a [b*]", "strong,content"],
  ["a [b *c", "a [b *c*", "strong"],
  ["#table(columns: 2, [a], [b", "#table(columns: 2, [a], [b])", "content,args"],
  ["#{ let x = 1", "#{ let x = 1}", "code-block"],
  ['#let s = "abc', '#let s = "abc"', "string"],
  ['#let s = "ab\\\\', '#let s = "ab\\\\"', "string"],
  ['#"abc".len(', '#"abc".len()', "args"],
  ["#(1, 2", "#(1, 2)", "parens"],
  ["$x^2", "$x^2$", "math"],
  ["$ x + ", "$ x + $", "math"],
  ["$frac(a, b", "$frac(a, b)$", "math-args,math"],
  ["$frac(a, ", "$frac(a, )$", "math-args,math"],
  // A group in a call's arguments needs its own closer, or it takes the call's (#65).
  ["$sqrt(1/n sum (x_i", "$sqrt(1/n sum (x_i))$", "math-delimited,math-args,math"],
  ["$sqrt(((x", "$sqrt(((x)))$", "math-delimited,math-delimited,math-args,math"],
  ["$sqrt({x", "$sqrt({x})$", "math-delimited,math-args,math"],
  ["$sqrt(x_(i", "$sqrt(x_(i))$", "math-delimited,math-args,math"],
  ["$(sqrt(x", "$(sqrt(x)$", "math-args,math"],
  ["$sqrt(#box[$(x", "$sqrt(#box[$(x$])$", "math,content,math-args,math"],
  ["#f([$sqrt(1/n sum (x_i", "#f([$sqrt(1/n sum (x_i))$])", "math-delimited,math-args,math,content,args"],
  ["$ f(x", "$ f(x $", "math"],
  // A display equation stays display: `$ a + b$` would be inline (#19's flicker suite).
  ["x\n$ a + b", "x\n$ a + b $", "math"],
  ["$ frac(a, b", "$ frac(a, b) $", "math-args,math"],
  ["$\n  x &= 1", "$\n  x &= 1 $", "math"],
  ["$ x &= 1 \\\n", "$ x &= 1 \\\n$", "math"],
  ["```py\nprint(1)", "```py\nprint(1)```", "raw"],
  ["```py\nx\n``", "```py\nx\n```", "raw"],
  ["`code", "`code`", "raw"],
  ["x `a", "x `a`", "raw"],
  ["/ Term", "/ Term:", "term"],
];

const cut: Row[] = [
  ["#let x = ", ""],
  ["#let f(x) =", ""],
  ["#let f(x) = x +", "#let f(x) = x "],
  ["#let (a, b", ""],
  ["#tabl", ""],
  ["#calc.ma", ""],
  ["#x.y", ""],
  ["#table(col", "#table()", "args"],
  ["#f(..ar", "#f()", "args"],
  ["#(1 +", "#(1 )", "parens"],
  ["#let d = (a: 1, b:", "#let d = (a: 1, )", "parens"],
  ['#let d = (a: 1, "b"', "#let d = (a: 1, )", "parens"],
  ["$x^", "$x$", "math"],
  ["$alph", "$$", "math"],
  ["$arrow.r", "$$", "math"],
  ["```", ""],
  ["Hi <lab", "Hi "],
  ["= Title <sec", "= Title "],
  ["a \\u{1F6", "a "],
  ["text #", "text "],
  ["text # ", "text "],
  ["#if x [a] else", "#if x [a] "],
  ["#for i in range(3) { [#i", "#for i in range(3) { []}", "content,code-block"],
  ["#context ", ""],
  ["#context counter(page).ge", ""],
  ["https://example.com/a(b", ""],
];

const rules: Row[] = [
  // Incomplete global rules are dropped whole, never applied half-written.
  ["#set text(size: 12", ""],
  ["#show heading: it =>", ""],
  ["#show heading: it => [*#it.bo", ""],
  ['#import "@preview/cet', ""],
  ["#set text(size: 12pt)", "#set text(size: 12pt)"],
];

const unchanged = [
  "``",
  "/* unclosed",
  "See @fig1",
  "See @",
  "= ",
  "a \\",
  "#text(red)[x].",
  "- item\n- ",
  "+ one\n+ ",
  "/ Term: ",
  "#x.",
  "https://ex",
  "$x^2$",
];

const check = ([input, healed, frames]: Row) => {
  const r = heal(input);
  expect(r.source).toBe(healed);
  expect(syntaxErrors(r.source)).toEqual([]);
  expect(r.openFrames.map((f) => f.frame).join(",")).toBe(frames ?? "");
};

describe("closing open constructs", () => {
  it.each(close)("%j → %j", (...row) => check(row));
});

describe("cutting incomplete constructs", () => {
  it.each(cut)("%j → %j", (...row) => check(row));
});

describe("incomplete set/show/import rules", () => {
  it.each(rules)("%j → %j", (...row) => check(row));
  it("can keep closable rules when asked", () => {
    expect(heal("#set text(size: 12pt", { dropIncompleteRules: false }).source).toBe("#set text(size: 12pt)");
  });
});

describe("already valid tails", () => {
  it.each(unchanged)("%j stays", (input) => check([input, input]));
});

describe("open frames point at their opening delimiter", () => {
  it("reports input offsets", () => {
    expect(heal("Intro\n\n#box[*bold").openFrames).toEqual([
      { frame: "strong", open: 12 },
      { frame: "content", open: 11 },
    ]);
  });
});

describe("source maps", () => {
  it("maps healed positions back to the input", () => {
    const r = heal("```typst\nHello *bold");
    expect(r.source).toBe("Hello *bold*");
    expect(r.map.toInput(0)).toBe(9);
    expect(r.map.toSource(9)).toBe(0);
    expect(r.map.toInput(r.source.length)).toBe(20);
  });
});
