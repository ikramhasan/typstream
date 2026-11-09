// Top-level blocks (blocks.ts): where the engine's source anchors go (anchorPoints) and where a
// block starts (blockStarts). Which lines are headings, list, enum or term items, or labels is
// checked against Typst's own lexer.

import { describe, expect, it } from "vitest";
import { anchorPoints, blockStarts, recognize } from "../src";
import { lexTokens } from "./support/oracle";

const points = (text: string) => anchorPoints(text, recognize(text).checkpoints);
/** The lines that get an anchor, as text. */
const anchoredLines = (text: string) => points(text).map((p) => text.slice(p, text.indexOf("\n", p) >>> 0));

describe("anchorPoints", () => {
  it("anchors block starts: the start, after blank lines, and headings", () => {
    const text = "Intro\nstill intro\n\nSecond\n= Heading\nBody\n\n\n#figure[x]\n";
    expect(anchoredLines(text)).toEqual(["Intro", "Second", "= Heading", "#figure[x]"]);
  });

  it("anchors the first item of a list, not later items of the same list", () => {
    expect(anchoredLines("- a\n\n- b\n\n+ c\n\n2. d\n\n/ t: e\n\n/ u: f\n")).toEqual(["- a", "+ c", "/ t: e"]);
    expect(anchoredLines("Para\n\n12. a\n\n13. b\n")).toEqual(["Para", "12. a"]);
  });

  it("anchors a list after a different kind of block", () => {
    expect(anchoredLines("Para\n\n- a\n\nText\n\n- b\n")).toEqual(["Para", "- a", "Text", "- b"]);
    expect(anchoredLines("- a\n\n+ b\n\n/ c: d\n\n- e\n")).toEqual(["- a", "+ b", "/ c: d", "- e"]);
  });

  it("skips lines starting with a label, which would attach to the anchor", () => {
    expect(anchoredLines("= A\n\n<sec-a>\n\nText\n")).toEqual(["= A", "Text"]);
    expect(points("<top>\n\nText")).toEqual([7]);
    // Any line starting with `<`: a stream cut leaves a label's start (`<sec`), which heals to a label.
    expect(anchoredLines("x\n\n<sec\n\n< 3 apples\n")).toEqual(["x"]);
  });

  it("puts the anchor before the line's indentation and skips markers that aren't markers", () => {
    expect(points("x\n\n  - a\n")).toEqual([0, 3]);
    expect(anchoredLines("x\n\n-5 degrees\n\n=no heading\n")).toEqual(["x", "-5 degrees", "=no heading"]);
  });

  it("puts the anchor at the start of a one-character line", () => {
    expect(points("Intro\n\nB\nC")).toEqual([0, 7]);
  });

  it("takes any whitespace between lines, but needs a blank line", () => {
    expect(points("A\nB")).toEqual([0]);
    expect(points("A\n  B")).toEqual([0]);
    expect(points("A\n \t \nB")).toEqual([0, 6]);
    expect(points("A\r\n\r\nB")).toEqual([0, 5]);
    expect(points("A\n\n\n\nB")).toEqual([0, 5]);
    expect(points("  \n\nA")).toEqual([4]);
  });

  it("ignores lines inside content blocks and text brackets", () => {
    expect(anchoredLines("#[\n\nInner\n]\n\nOuter [\n\nbracket]\n")).toEqual(["#[", "Outer ["]);
  });

  it("returns no points without top-level lines", () => {
    expect(anchorPoints("", [])).toEqual([]);
  });

  // A line's kind as Typst lexes its start: a second item of a list right after the first gets no
  // anchor, a heading gets one without a blank line before it, a label never does.
  const kind = (line: string) => {
    const first = lexTokens(line, "markup")[0]?.kind;
    return (
      { HeadingMarker: "heading", ListMarker: "list", EnumMarker: "enum", TermMarker: "term", Label: "label" }[
        first ?? ""
      ] ?? "other"
    );
  };
  const LINES = [
    "- a",
    "-a",
    "-",
    "-\ta",
    "-// comment",
    "-/* comment */",
    "+ a",
    "+",
    "+a",
    "1. a",
    "1.a",
    "1.",
    "12. a",
    `${"9".repeat(19)}. a`,
    `${"1".repeat(20)}. a`,
    "18446744073709551616. a",
    `${"0".repeat(24)}1. a`,
    "1) a",
    "/ term: a",
    "/",
    "/term",
    "= A",
    "== A",
    "==",
    "=A",
    "<label>",
    "Text",
  ];

  it.each(LINES)("treats %j as Typst's lexer does", (line) => {
    const k = kind(line);
    const item = k === "list" || k === "enum" || k === "term";
    // At the end of the text, too: `-` alone is a list marker there.
    expect(points(`${line}\n\n${line}`), "after itself").toEqual([
      ...(k === "label" ? [] : [0]),
      ...(item || k === "label" ? [] : [line.length + 2]),
    ]);
    expect(points(`x\n${line}`), "after a line").toEqual(k === "heading" ? [0, 2] : [0]);
  });
});

describe("blockStarts", () => {
  it("starts with 0, then the anchor points after it", () => {
    expect(blockStarts("A\n\nB\n= C")).toEqual([0, 3, 5]);
    expect(blockStarts("<top>\n\nText")).toEqual([0, 7]);
    expect(blockStarts("")).toEqual([0]);
  });

  it("takes the text's checkpoints when given", () => {
    const text = "A\n\n#question[\n\nB\n]\n\nC";
    expect(blockStarts(text, recognize(text).checkpoints)).toEqual(blockStarts(text));
    expect(blockStarts(text)).toEqual([0, 3, 20]);
  });
});
