// Commands at the edges the QA pass went over: a selection that crosses a table's edge, words at
// a block's end, Enter at an item's or a heading's ends and inside marks, typing where a caret
// can't be (before a marker, among the document's rules), and the caret's stops into and out of
// an aligned block and a table. All checked with Typst's parser.
import { beforeAll, describe, expect, it } from "vitest";
import { unitsFor } from "../src/commands";
import {
  DEFAULT_SCHEMA,
  deleteSelection,
  deleteWord,
  type EditorCommand,
  insertText,
  moveChar,
  setAlignment,
  splitBlock,
} from "../src/index";
import { wordAt } from "../src/units";
import { load, run, state } from "./support";

beforeAll(load);

const s = DEFAULT_SCHEMA;
const press = (marked: string, command: EditorCommand): string | null => run(marked, (st) => command(st, s));
const move = (marked: string, dir: 1 | -1): string => {
  const st = state(marked);
  const to = moveChar(st, st.selection.head, dir, s);
  return `${st.text.slice(0, to)}‸${st.text.slice(to)}`;
};

describe("alignment", () => {
  it("of a selection across a table's cells aligns each cell's text", () => {
    expect(press("#table(columns: 2, [«One], [Two»], [Three], [Four])", setAlignment("center"))).toBe(
      "#table(columns: 2, [#align(center)[«One]], [#align(center)[Two»]], [Three], [Four])",
    );
  });

  it("goes around a heading, and around paragraphs and headings together", () => {
    expect(press("= Ti‸tle", setAlignment("center"))).toBe("#align(center)[= Ti‸tle]");
    expect(press("«One\n\n= Head\n\nTwo»", setAlignment("center"))).toBe("#align(center)[«One\n\n= Head\n\nTwo»]");
  });

  it("doesn't apply in a list's item, or where the text has it already", () => {
    expect(press("- it‸em\n- other", setAlignment("center"))).toBeNull();
    expect(press("#align(center)[One‸]", setAlignment("center"))).toBeNull();
  });

  it("comes off whole for the default", () => {
    expect(press("#align(center)[One‸]", setAlignment("left"))).toBe("One‸");
    expect(press("#align(center)[«One\n\nTwo»]", setAlignment("left"))).toBe("«One\n\nTwo»");
  });
});

describe("words", () => {
  const word = (marked: string) => {
    const st = state(marked);
    const w = wordAt(unitsFor(st, s), st.text, st.selection.head);
    return st.text.slice(w.from, w.to);
  };

  it("take in a number's point and a word's apostrophe", () => {
    expect(word("costs 0.2‸5 dollars")).toBe("0.25");
    expect(word("don‸'t stop")).toBe("don't");
    expect(word("the teachers‸' room")).toBe("teachers");
    expect(word("x‸ y")).toBe("x");
    expect(word("end.‸")).toBe("");
  });

  it("are deleted up to a block's end, then the break to the next block", () => {
    expect(press("One two‸\n\nThree", deleteWord(-1))).toBe("One ‸\n\nThree");
    expect(press("One two‸\n\nThree", deleteWord(1))).toBe("One two‸Three");
    expect(press("One two\n\n‸Three four", deleteWord(-1))).toBe("One two‸Three four");
    expect(press("- one‸\n- two", deleteWord(-1))).toBe("- ‸\n- two");
    expect(press("= Head‸\n\nText", deleteWord(-1))).toBe("= ‸\n\nText");
  });

  it("stay in a table's cell", () => {
    expect(press("#table(columns: 2, [One‸], [Two])", deleteWord(1))).toBeNull();
    expect(press("#table(columns: 2, [One‸], [Two])", deleteWord(-1))).toBe("#table(columns: 2, [‸~], [Two])");
  });
});

describe("typing where a caret can't be", () => {
  it("goes after a heading's or an item's marker", () => {
    expect(press("‸= Title", insertText("X"))).toBe("= X‸Title");
    expect(press("‸- item", insertText("X"))).toBe("- X‸item");
    expect(press("Text.\n\n‸- item", insertText("X"))).toBe("Text.\n\n- X‸item");
  });

  it("goes to the document's text from among its rules, and before its last newline", () => {
    expect(press("‸#set text(size: 11pt)\n\nText.", insertText("X"))).toBe("#set text(size: 11pt)\n\nX‸Text.");
    expect(press("#set text(size: 11pt)\n‸\nText.", insertText("X"))).toBe("#set text(size: 11pt)\n\nX‸Text.");
    expect(press("Text.\n‸", insertText("X"))).toBe("Text.X‸\n");
  });
});

describe("Enter at a block's edges and in marks", () => {
  it("at an item's start leaves an empty item above; in its middle splits it", () => {
    expect(press("- ‸item", splitBlock)).toBe("- \n- ‸item");
    expect(press("- it‸em", splitBlock)).toBe("- it\n- ‸em");
    expect(press("- one\n  - ‸inner", splitBlock)).toBe("- one\n  - \n  - ‸inner");
  });

  it("in a heading: an empty line above from its start, two headings from its middle, a paragraph after its end", () => {
    expect(press("= ‸Head", splitBlock)).toBe("~\n\n= ‸Head");
    expect(press("= He‸ad", splitBlock)).toBe("= He\n\n= ‸ad");
    expect(press("= Head‸", splitBlock)).toBe("= Head\n\n‸~");
  });

  it("inside a mark ends it and starts it again in the new paragraph", () => {
    expect(press("*bo‸ld* text", splitBlock)).toBe("*bo*\n\n‸*ld* text");
    expect(press("#underline[un‸der] text", splitBlock)).toBe("#underline[un]\n\n‸#underline[der] text");
  });
});

describe("a selection across a table's edge", () => {
  it("deleted or typed over, leaves the table a table and its cells cells", () => {
    expect(press("Be«fore\n\n#table(columns: 2, [One], [T»wo])", deleteSelection)).toBe(
      "Be‸\n\n#table(columns: 2, [~], [wo])",
    );
    expect(press("Be«fore\n\n#table(columns: 2, [One], [T»wo])", insertText("X"))).toBe(
      "BeX‸\n\n#table(columns: 2, [~], [wo])",
    );
    expect(press("#table(columns: 2, [One], [T«wo])\n\nAf»ter", deleteSelection)).toBe(
      "#table(columns: 2, [One], [T‸])\n\nter",
    );
  });

  it("around the whole table takes it", () => {
    expect(press("Be«fore\n\n#table(columns: 2, [One], [Two])\n\nAf»ter", deleteSelection)).toBe("Be‸ter");
  });
});

describe("the caret's stops", () => {
  it("go into and out of an aligned block as between paragraphs", () => {
    expect(move("A‸\n\n#align(center)[Mid]\n\nB", 1)).toBe("A\n\n#align(center)[‸Mid]\n\nB");
    expect(move("A\n\n#align(center)[‸Mid]", -1)).toBe("A‸\n\n#align(center)[Mid]");
    expect(move("#align(center)[Mid‸]\n\nB", 1)).toBe("#align(center)[Mid]‸\n\nB");
  });

  it("go into a table, from cell to cell, and out after its last", () => {
    expect(move("A‸\n\n#table(columns: 2, [One], [Two])", 1)).toBe("A\n\n#table(columns: 2, [‸One], [Two])");
    expect(move("#table(columns: 2, [One‸], [Two])", 1)).toBe("#table(columns: 2, [One], [‸Two])");
    expect(move("#table(columns: 2, [One], [Two‸])\n\nB", 1)).toBe("#table(columns: 2, [One], [Two])‸\n\nB");
  });
});
