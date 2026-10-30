// The editing commands on Typst sources, checked with Typst's own parser: what typing, Backspace,
// Delete, Enter and Shift+Enter do to the source, and that the result still parses.
import { parse } from "@typstream/syntax";
import { beforeAll, describe, expect, it } from "vitest";
import { deleteChar, EditorState, escapeMarkup, insertLineBreak, insertText, moveChar, splitBlock, unitsOf } from "../src/index";
import { load, run } from "./support";

beforeAll(load);

/** What Typst shows of markup: its text leaves with escapes resolved (enough for escaping tests). */
const shown = (source: string): string => {
  const out: string[] = [];
  const walk = (n: ReturnType<typeof parse>) => {
    if (n.children.length === 0) {
      const t = source.slice(n.from, n.to);
      if (n.kind === "Text" || n.kind === "Space") out.push(t);
      else if (n.kind === "Escape") out.push(t.slice(1));
      else if (n.kind !== "Parbreak") out.push(`<${n.kind}>`);
      return;
    }
    for (const c of n.children) walk(c);
  };
  walk(parse(source));
  return out.join("");
};

describe("typing", () => {
  it("inserts text at the caret", () => {
    expect(run("Hello ‸world", insertText("big "))).toBe("Hello big ‸world");
  });

  it("types into strong text when the caret is inside it", () => {
    expect(run("A *bo‸ld* word", insertText("o"))).toBe("A *boo‸ld* word");
  });

  it("escapes what Typst would read as markup", () => {
    for (const typed of ["*", "_", "#", "$", "@", "<b>", "`", "[x]", "\\", "~", "a -- b", "...", "//", "https://x.org", "1. no"]) {
      const out = run(`Text ‸`, insertText(typed)) as string;
      const source = out.replace("‸", "");
      expect(shown(source), typed).toBe(`Text ${typed}`);
    }
  });

  it("escapes list and heading markers at the start of a line", () => {
    for (const typed of ["- x", "+ x", "= x", "/ x", "12. x"]) {
      const source = (run("A\n\n‸", insertText(typed)) as string).replace("‸", "");
      expect(shown(source), typed).toBe(`A${typed}`);
      expect(parse(source).children.map((c) => c.kind)).not.toContain("ListItem");
    }
  });

  it("doesn't make a shorthand with the text around", () => {
    const source = (run("a -‸b", insertText("-")) as string).replace("‸", "");
    expect(shown(source)).toBe("a --b");
    const dots = (run("a ..‸", insertText(".")) as string).replace("‸", "");
    expect(shown(dots)).toBe("a ...");
  });

  it("keeps strong text strong when a letter is typed against its delimiter", () => {
    expect(run("a ‸*bold* x", insertText("b"))).toBe("a b‸#strong[bold] x");
    expect(run("x *bold*‸ c", insertText("d"))).toBe("x #strong[bold]d‸ c");
  });

  it("types a non-breaking space where Typst would fold the space", () => {
    expect(run("a ‸b", insertText(" "))).toBe("a ~‸b");
  });

  it("replaces a selection", () => {
    expect(run("Hello «world»!", insertText("you"))).toBe("Hello you‸!");
  });

  it("can't type into code or math", () => {
    expect(run("#table(colu‸mns: 2)", insertText("x"))).toBeNull();
    expect(run("$x^‸2$", insertText("y"))).toBeNull();
  });

  it("types into a content block of a call", () => {
    expect(run("#question(points: 2)[What is ‸?]", insertText("2+2"))).toBe("#question(points: 2)[What is 2+2‸?]");
  });

  it("types raw text as it is", () => {
    expect(run("Use `co‸de` here", insertText("*"))).toBe("Use `co*‸de` here");
  });
});

describe("Backspace and Delete", () => {
  it("delete a character", () => {
    expect(run("Hello‸ world", deleteChar(-1))).toBe("Hell‸ world");
    expect(run("Hello‸ world", deleteChar(1))).toBe("Hello‸world");
  });

  it("delete a grapheme, not half of one", () => {
    expect(run("a👍🏽‸b", deleteChar(-1))).toBe("a‸b");
  });

  it("step over delimiters and delete the character behind them", () => {
    expect(run("a *bold*‸ x", deleteChar(-1))).toBe("a *bol‸* x");
    expect(run("a ‸*bold* x", deleteChar(1))).toBe("a ‸*old* x");
  });

  it("delete strong text whose last character goes", () => {
    expect(run("a *b*‸ x", deleteChar(-1))).toBe("a ‸ x");
  });

  it("join two paragraphs", () => {
    expect(run("First.\n\n‸Second.", deleteChar(-1))).toBe("First.‸Second.");
    expect(run("First.‸\n\nSecond.", deleteChar(1))).toBe("First.‸Second.");
  });

  it("make a heading or list item a paragraph at its start", () => {
    expect(run("Intro.\n\n= ‸Title\n\nText.", deleteChar(-1))).toBe("Intro.\n\n‸Title\n\nText.");
    expect(run("- one\n- ‸two", deleteChar(-1))).toBe("- one\n‸two");
  });

  it("select an equation, then delete it", () => {
    expect(run("Area $pi r^2$‸ here", deleteChar(-1))).toBe("Area [[$pi r^2$]] here");
  });

  it("don't delete a component's code from inside it", () => {
    expect(run("Before.\n\n#question(points: 2)[‸Body]", deleteChar(-1))).toBeNull();
  });

  it("delete a selection across paragraphs, keeping strong text valid", () => {
    expect(run("Al«pha *be»ta* x\n\nGamma", deleteChar(-1))).toBe("Al‸#strong[ta] x\n\nGamma");
    expect(run("One «two\n\nthree» four", deleteChar(-1))).toBe("One ‸ four");
  });

  it("delete a selection from a paragraph into a heading: the heading's marker goes", () => {
    expect(run("Par«a\n\n= Hea»ding", deleteChar(-1))).toBe("Par‸ding");
  });

  it("empty table cells but keep the table", () => {
    expect(run("#table(columns: 2, [«a], [b»])", deleteChar(-1))).toBe("#table(columns: 2, [‸], [])");
  });
});

describe("Enter and Shift+Enter", () => {
  it("start a new paragraph", () => {
    expect(run("Hello ‸world", splitBlock)).toBe("Hello\n\n‸world");
  });

  it("add a list item, and end the list from an empty one", () => {
    expect(run("- one‸\n- two", splitBlock)).toBe("- one\n- ‸\n- two");
    expect(run("- one\n- ‸", splitBlock)).toBe("- one\n\n‸");
    expect(run("+ one‸", splitBlock)).toBe("+ one\n+ ‸");
  });

  it("put a new paragraph before a heading from its start", () => {
    expect(run("= ‸Title", splitBlock)).toBe("\n\n= ‸Title");
  });

  it("split a heading: the rest is a paragraph", () => {
    expect(run("= Big ‸title", splitBlock)).toBe("= Big\n\n‸title");
  });

  it("start a new paragraph inside a component", () => {
    expect(run("#question[\n  First ‸second\n]", splitBlock)).toBe("#question[\n  First\n\n  ‸second\n]");
  });

  it("break a line", () => {
    expect(run("Roses are red,‸violets", insertLineBreak)).toBe("Roses are red, \\ ‸violets");
  });
});

describe("units", () => {
  it("step over markup that shows nothing", () => {
    const s = new EditorState("ab *cd* = e");
    const units = unitsOf(s.tree, s.text, () => true);
    expect(units.map((u) => s.text.slice(u.from, u.to))).toEqual(["a", "b", " ", "c", "d", " ", "=", " ", "e"]);
    expect(moveChar(s, 3, 1)).toBe(5);
    expect(moveChar(s, 5, -1)).toBe(4);
  });

  it("make a component's code an edge, a mark's code nothing", () => {
    const s = new EditorState("#question(points: 2)[Hi] and #underline[u]");
    const units = unitsOf(s.tree, s.text, (name) => name === "underline");
    expect(units.map((u) => `${u.kind}:${s.text.slice(u.from, u.to)}`)).toEqual([
      "edge:#question(points: 2)[",
      "char:H",
      "char:i",
      "edge:]",
      "space: ",
      "char:a",
      "char:n",
      "char:d",
      "space: ",
      "char:u",
    ]);
  });
});

describe("escapeMarkup", () => {
  it("keeps plain text as it is", () => {
    expect(escapeMarkup("Hello, world. It's 3 o'clock!")).toBe("Hello, world. It's 3 o'clock!");
  });
});
