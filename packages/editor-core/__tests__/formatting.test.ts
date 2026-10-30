// Formatting commands on Typst sources, checked with Typst's parser: marks (bold, colours), block
// types (headings, lists), indentation, alignment, components' arguments and tables.
import { beforeAll, describe, expect, it } from "vitest";
import {
  addColumn,
  addRow,
  argumentOf,
  blockType,
  componentAt,
  deleteColumn,
  deleteRow,
  indentItems,
  insertBlock,
  isMarked,
  markValue,
  setAlignment,
  setArgument,
  setBlockType,
  setMark,
  tableAt,
  tableTemplate,
  toggleList,
  toggleMark,
} from "../src/index";
import { load, run, state } from "./support";

beforeAll(load);

const bold = toggleMark({ name: "strong" });
const italic = toggleMark({ name: "emph" });
const underline = toggleMark({ name: "underline" });

describe("marks", () => {
  it("wrap a selection, with delimiters where they read as such", () => {
    expect(run("Hello «world» again", bold)).toBe("Hello *«world»* again");
    expect(run("Hello «world» again", italic)).toBe("Hello _«world»_ again");
  });

  it("use the call inside a word, where `*` would be text", () => {
    expect(run("un«believ»able", bold)).toBe("un#strong[«believ»]able");
  });

  it("wrap other marks with calls", () => {
    expect(run("a «b c» d", underline)).toBe("a #underline[«b c»] d");
  });

  it("are off again when toggled on marked text", () => {
    expect(run("Hello *«world»* again", bold)).toBe("Hello «world» again");
    expect(run("a #underline[«b c»] d", underline)).toBe("a «b c» d");
  });

  it("split a wrapper when only part of it is unmarked", () => {
    expect(run("*bold «and» more*", bold)).toBe("#strong[bold ]«and»#strong[ more]");
  });

  it("don't nest: marked parts are joined into one wrapper", () => {
    expect(run("«a *b* c»", bold)).toBe("*«a b c»*");
  });

  it("wrap each paragraph of a selection on its own", () => {
    expect(run("One «two\n\nthree» four", bold)).toBe("One *«two*\n\n*three»* four");
  });

  it("go inside a heading or a component, never around it", () => {
    expect(run("= «Title»", bold)).toBe("= *«Title»*");
    expect(run("#question[«Body»]", bold)).toBe("#question[*«Body»*]");
  });

  it("are read back from the source", () => {
    const s = state("x *a «b» c* y");
    expect(isMarked(s, { name: "strong" })).toBe(true);
    expect(isMarked(s, { name: "emph" })).toBe(false);
    expect(isMarked(state("x *ab‸c* y"), { name: "strong" })).toBe(true);
  });

  it("set a colour, and change it in place", () => {
    const red = setMark({ name: "text", arg: "fill" }, 'rgb("#e11d48")');
    const out = run("a «word» b", red) as string;
    expect(out).toBe('a #text(fill: rgb("#e11d48"))[«word»] b');
    const blue = setMark({ name: "text", arg: "fill" }, "blue");
    expect(run(out, blue)).toBe("a #text(fill: blue)[«word»] b");
    expect(markValue(state(out), { name: "text", arg: "fill" })).toBe('rgb("#e11d48")');
  });

  it("keep a call's other arguments when one is taken off", () => {
    const off = setMark({ name: "text", arg: "fill" }, null);
    expect(run("#text(fill: red, size: 14pt)[«all»]", off)).toBe("#text(size: 14pt)[«all»]");
  });

  it("write an empty wrapper to type into at a caret", () => {
    expect(run("a ‸ b", bold)).toBe("a #strong[‸] b");
  });
});

describe("block types", () => {
  it("make a paragraph a heading, and back", () => {
    expect(run("Intro‸\n\nText", setBlockType({ kind: "heading", level: 2 }))).toBe("== Intro‸\n\nText");
    expect(run("== Intro‸\n\nText", setBlockType({ kind: "paragraph" }))).toBe("Intro‸\n\nText");
  });

  it("join a paragraph's lines into one heading line", () => {
    expect(run("Two‸\nlines", setBlockType({ kind: "heading", level: 1 }))).toBe("= Two‸ lines");
  });

  it("keep a blank line between a former heading and the text after it", () => {
    expect(run("= Title‸\nText", setBlockType({ kind: "paragraph" }))).toBe("Title‸\n\nText");
  });

  it("turn paragraphs into one list, and back", () => {
    expect(run("«One\n\nTwo»", toggleList("list"))).toBe("- «One\n- Two»");
    expect(run("- «One\n- Two»", toggleList("list"))).toBe("«One\n\nTwo»");
    expect(run("- On‸e\n- Two", toggleList("enum"))).toBe("+ On‸e\n- Two");
  });

  it("are read from the source", () => {
    expect(blockType(state("== Ti‸tle"))).toEqual({ kind: "heading", level: 2 });
    expect(blockType(state("- it‸em"))).toEqual({ kind: "list" });
    expect(blockType(state("pa‸ra"))).toEqual({ kind: "paragraph" });
  });

  it("indent and outdent list items", () => {
    expect(run("- one\n- tw‸o", indentItems(1))).toBe("- one\n  - tw‸o");
    expect(run("- one\n  - tw‸o", indentItems(-1))).toBe("- one\n- tw‸o");
  });

  it("align blocks, and change or take off the alignment", () => {
    const centered = run("Ti‸tle\n\nText", setAlignment("center")) as string;
    expect(centered).toBe("#align(center)[Ti‸tle]\n\nText");
    expect(run(centered, setAlignment("right"))).toBe("#align(right)[Ti‸tle]\n\nText");
    expect(run(centered, setAlignment("left"))).toBe("Ti‸tle\n\nText");
  });
});

describe("components", () => {
  it("set, change and remove a named argument", () => {
    const s = state("#question[Wh‸at?]");
    const q = componentAt(s, s.from);
    expect(q?.name).toBe("question");
    const added = run("#question[Wh‸at?]", (st) => setArgument(componentAt(st, st.from)!, "points", "2")(st)) as string;
    expect(added).toBe("#question(points: 2)[Wh‸at?]");
    expect(argumentOf(state(added), componentAt(state(added), 15)!, "points")).toBe("2");
    const changed = run(added, (st) => setArgument(componentAt(st, st.from)!, "points", "5")(st)) as string;
    expect(changed).toBe("#question(points: 5)[Wh‸at?]");
    expect(run(changed, (st) => setArgument(componentAt(st, st.from)!, "points", null)(st))).toBe("#question[Wh‸at?]");
  });

  it("are inserted as a block after the caret's paragraph, or on its empty line", () => {
    expect(run("First para‸graph.\n\nNext.", insertBlock("#question[{{cursor}}]"))).toBe(
      "First paragraph.\n\n#question[‸]\n\nNext.",
    );
    expect(run("A\n\n‸\n\nB", insertBlock("#pagebreak()"))).toBe("A\n\n[[#pagebreak()]]\n\nB");
  });
});

describe("tables", () => {
  const table = "#table(\n  columns: 2,\n  table.header([A], [B]),\n  [a1], [b1],\n  [a2], [b‸2],\n)";

  it("are read as rows and columns", () => {
    const t = tableAt(state(table));
    expect(t?.columns).toBe(2);
    expect(t?.header).toBe(true);
    expect(t?.cells).toEqual([
      ["[A]", "[B]"],
      ["[a1]", "[b1]"],
      ["[a2]", "[b2]"],
    ]);
  });

  it("get rows and columns, the caret in the new cell", () => {
    expect(run(table, addRow("below"))).toBe(
      "#table(\n  columns: 2,\n  table.header([A], [B]),\n  [a1], [b1],\n  [a2], [b2],\n  [], [‸],\n)",
    );
    expect(run(table, addColumn("left"))).toBe(
      "#table(\n  columns: 3,\n  table.header([A], [], [B]),\n  [a1], [], [b1],\n  [a2], [‸], [b2],\n)",
    );
  });

  it("lose rows and columns", () => {
    expect(run(table, deleteRow)).toBe("#table(\n  columns: 2,\n  table.header([A], [B]),\n  [a1], [‸b1],\n)");
    expect(run(table, deleteColumn)).toBe("#table(\n  columns: 1,\n  table.header([A]),\n  [a1],\n  [‸a2],\n)");
  });

  it("keep column sizes", () => {
    const sized = "#table(columns: (1fr, 2fr), [a], [b‸])";
    expect(run(sized, addColumn("right"))).toBe("#table(\n  columns: (1fr, 2fr, 2fr),\n  [a], [b], [‸],\n)");
  });

  it("are inserted from a template", () => {
    expect(run("Text‸", insertBlock(tableTemplate(2, 2)))).toBe(
      "Text\n\n#table(\n  columns: 2,\n  table.header([‸], []),\n  [], [],\n)",
    );
  });
});
