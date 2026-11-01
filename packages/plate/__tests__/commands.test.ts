// The commands' edits of the Typst, compiled by Typst itself (engine-wasm): typed text shows as typed, Enter and
// Backspace make and join blocks, marks and block types come out as the elements they are.

import { describe, expect, it } from "vitest";
import {
  applyEdits,
  blockOf,
  insertBreak,
  insertText,
  join,
  markOf,
  sequential,
  setBlock,
  typed,
  unwrapMark,
  wrapMark,
} from "../src/commands";
import { compile, textOf } from "./support/typst";

/** `source` with `edits` applied, compiled. */
const after = (source: string, edits: ReturnType<typeof insertText> | null) => {
  expect(edits).not.toBeNull();
  const text = applyEdits(source, edits ?? []);
  return { text, ...compile(text) };
};

describe("typed text", () => {
  const SAMPLES = [
    "a*b*c",
    "#let x = 1",
    "costs $5 or $6",
    "snake_case _here_",
    "<label> and @ref",
    "[brackets]",
    "a ~ b",
    "back\\slash",
    "`code`",
    "// not a comment",
    "a /* nor this */ b",
    "http//x",
  ];

  it("shows as typed, in a paragraph", () => {
    for (const sample of SAMPLES) {
      const source = "Text: \n";
      const r = after(source, insertText(source, 6, sample));
      expect(r.errors, sample).toEqual([]);
      expect(textOf(r.body), sample).toContain(`Text: ${sample}`);
    }
  });

  it("shows as typed at the start of a line, where markers start blocks", () => {
    for (const sample of ["= not a heading", "- not a list", "+ not an enum", "1. not one", "/ not: a term"]) {
      const source = "First.\n\n";
      const r = after(source, insertText(source, source.length, sample));
      expect(r.errors, sample).toEqual([]);
      expect(r.body, sample).not.toMatch(/<h\d|<ul|<ol|<dl/);
      expect(textOf(r.body), sample).toContain(sample);
    }
  });

  it("makes lines after the first paragraphs of their own (a paste)", () => {
    expect(typed("", 0, "one\ntwo\r\n\r\nthree")).toBe("one\n\ntwo\n\nthree");
    const r = after("", insertText("", 0, "one\ntwo"));
    expect(r.body.match(/<p>/g)?.length).toBe(2);
  });
});

describe("Enter and Backspace", () => {
  it("splits a paragraph, dropping the spaces before the break", () => {
    const source = "Hello world.";
    const r = after(source, insertBreak(source, 6));
    expect(r.text).toBe("Hello\n\nworld.");
    expect(r.body.match(/<p>/g)?.length).toBe(2);
  });

  it("adds an item to a list, a numbered one to an enum, and ends a list at an empty item", () => {
    expect(after("- one\n- two", insertBreak("- one\n- two", 5)).text).toBe("- one\n- \n- two");
    expect(after("1. one", insertBreak("1. one", 6)).text).toBe("1. one\n+ ");
    expect(after("  - x", insertBreak("  - x", 5)).text).toBe("  - x\n  - ");
    expect(after("- one\n- ", insertBreak("- one\n- ", 8)).text).toBe("- one\n");
  });

  it("breaks a line with Shift+Enter", () => {
    const r = after("ab", insertBreak("ab", 1, true));
    expect(r.body).toContain("<br>");
  });

  it("joins paragraphs, items and headings, past the delimiters around them", () => {
    expect(after("a\n\nb", join("a\n\nb", 1, 3)).text).toBe("ab");
    expect(after("*a*\n\n_b_", join("*a*\n\n_b_", 2, 6)).text).toBe("*a*_b_");
    expect(after("- a\n- b", join("- a\n- b", 3, 6)).text).toBe("- ab");
    expect(after("= A\n\n= B", join("= A\n\n= B", 3, 7)).text).toBe("= AB");
    expect(after("#strong[a]\n\n#emph[b]", join("#strong[a]\n\n#emph[b]", 9, 18)).text).toBe("#strong[a]#emph[b]");
  });

  it("doesn't join across code", () => {
    expect(join("#box(width: 1cm)[a]\n\nb", 18, 21)).not.toBeNull();
    expect(join('#f("a",\n  "b")', 4, 11)).toBeNull();
    expect(join("a\n#let x = 1\nb", 1, 13)).toBeNull();
  });
});

describe("marks", () => {
  it("wraps text in delimiters at word boundaries, else in a call", () => {
    const r = after("Add the fractions now.", wrapMark("Add the fractions now.", 8, 17, "bold"));
    expect(r.text).toBe("Add the *fractions* now.");
    expect(r.body).toContain("<strong>fractions</strong>");
    const inWord = after("fractions", wrapMark("fractions", 0, 4, "italic"));
    expect(inWord.text).toBe("#emph[frac]tions");
    expect(inWord.body).toContain("<em>frac</em>tions");
    expect(after("a b", wrapMark("a b", 0, 3, "underline")).text).toBe("#underline[a b]");
    expect(after("a b", wrapMark("a b", 0, 3, "strike")).body).toContain("<s>a b</s>");
  });

  it("leaves the spaces at a selection's ends out", () => {
    expect(applyEdits("a b c", wrapMark("a b c", 1, 4, "bold") ?? [])).toBe("a *b* c");
    expect(wrapMark("a  b", 1, 3, "bold")).toBeNull();
  });

  it("takes a mark off, whichever way it was written, and knows which it is", () => {
    for (const [source, mark] of [
      ["*bold*", "bold"],
      ["_it_", "italic"],
      ["#strong[x]", "bold"],
      ["#emph[x]", "italic"],
      ["#underline[x]", "underline"],
      ["#strike[x]", "strike"],
    ] as const) {
      expect(markOf(source, 0, source.length), source).toBe(mark);
      const r = after(source, unwrapMark(source, 0, source.length));
      expect(r.body, source).not.toMatch(/<strong|<em|<s>|underline/);
    }
  });
});

describe("blocks", () => {
  it("sets the marker at the start of a block's line", () => {
    const source = "Intro\n\nText here";
    const at = source.indexOf("Text");
    expect(after(source, setBlock(source, at, "h1")).body).toContain("<h2>Text here</h2>");
    expect(after(source, setBlock(source, at, "h3")).text).toBe("Intro\n\n=== Text here");
    expect(after(source, setBlock(source, at, "bullet")).body).toContain("<ul>");
    expect(after(source, setBlock(source, at, "numbered")).body).toContain("<ol>");
    const heading = "== Title";
    expect(applyEdits(heading, setBlock(heading, 3, "paragraph") ?? [])).toBe("Title");
    expect(blockOf(heading, 3)).toBe("h2");
    expect(blockOf("- a", 2)).toBe("bullet");
    expect(blockOf("3. a", 3)).toBe("numbered");
    expect(blockOf("*a*", 1)).toBe("paragraph");
  });

  it("sets it before the delimiters a block's text starts with, and not inside a call on a line of code", () => {
    expect(applyEdits("*Bold* start", setBlock("*Bold* start", 1, "h1") ?? [])).toBe("= *Bold* start");
    expect(setBlock("#question(points: 2)[What", 21, "h1")).toBeNull();
  });
});

describe("applying", () => {
  it("applies edits in the text's coordinates, last first for a document", () => {
    const edits = [
      { from: 0, to: 0, insert: "*" },
      { from: 3, to: 3, insert: "*" },
    ];
    expect(applyEdits("abc d", edits)).toBe("*abc* d");
    expect(sequential(edits).map((e) => e.from)).toEqual([3, 0]);
  });
});
