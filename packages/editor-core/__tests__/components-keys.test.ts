// Keys and commands in and around components, as the third QA pass used them on the worksheet and
// exam samples (#36): line breaks in cells, emptied cells, a table's header and columns, typing
// beside equations and blanks, Backspace and Delete beside a component, inserting blocks, a
// multiple choice's options and its answer, a mind map's outline, and the caret between blocks.
// Every result is checked with Typst's parser.
import { hasErrors, parse } from "@typstream/syntax";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addRow,
  CURSOR,
  deleteChar,
  deleteColumn,
  deleteRow,
  type EditorSchema,
  type EditorState,
  enterArg,
  indentItems,
  insertBlock,
  insertInline,
  insertLineBreak,
  insertText,
  moveChar,
  removeArg,
  schemaOf,
  setBlockType,
  splitBlock,
  type Transaction,
  tableTemplate,
  toggleList,
} from "../src/index";
import { load, show, state } from "./support";

beforeAll(load);

const schema = schemaOf([
  {
    key: "t",
    components: [
      { name: "question", label: "Question" },
      {
        name: "mcq",
        label: "Multiple choice",
        list: true,
        params: [{ name: "answer", label: "Correct option", type: "number", maxPositional: true }],
      },
      { name: "true-false", label: "True or false" },
      { name: "answer-lines", label: "Lines" },
      { name: "blank", label: "Blank", inline: true },
      { name: "mindmap", label: "Mind map", outline: true },
    ],
  },
]);

type Key = (s: EditorState, schema: EditorSchema) => Transaction | null;
const first =
  (...keys: Key[]): Key =>
  (s, sc) => {
    for (const k of keys) {
      const tr = k(s, sc);
      if (tr) return tr;
    }
    return null;
  };
// As the keymap binds them.
const Enter = first(enterArg, splitBlock);
const ShiftEnter: Key = insertLineBreak;
const Backspace = first(removeArg, deleteChar(-1));
const Delete = deleteChar(1);
const Tab = indentItems(1);
const ShiftTab = indentItems(-1);
const type = (text: string): Key => insertText(text);
const arrow =
  (dir: 1 | -1): Key =>
  (s, sc) => {
    const to = moveChar(s, s.selection.head, dir, sc);
    return { edits: [], selection: { anchor: to, head: to } };
  };
const Left = arrow(-1);
const Right = arrow(1);

/** The document after the keys, marked up; `null` when the last key did nothing. */
const press = (marked: string, ...keys: Key[]): string | null => {
  let s = state(marked);
  let did = true;
  for (const k of keys) {
    const tr = k(s, schema);
    did = tr !== null;
    if (tr) s = s.apply(tr).state;
  }
  expect(hasErrors(parse(s.text)), `parses: ${JSON.stringify(s.text)}`).toBe(false);
  return did ? show(s) : null;
};

describe("line breaks", () => {
  it("Enter in a cell breaks the line, and Backspace or Delete takes the break back whole", () => {
    const cell = "#table(columns: 2, [Dec‸imal], [b])";
    expect(press(cell, Enter)).toBe("#table(columns: 2, [Dec\\ ‸imal], [b])");
    expect(press(cell, Enter, Backspace)).toBe(cell);
    expect(press(cell, Enter, Left)).toBe("#table(columns: 2, [Dec‸\\ imal], [b])");
    expect(press(cell, Enter, Left, Delete)).toBe(cell);
    // The next Backspace is a letter's, not the rest of the break's.
    expect(press(cell, Enter, Backspace, Backspace)).toBe("#table(columns: 2, [De‸imal], [b])");
    expect(press("#table(columns: 2, [Fraction‸], [b])", type("A"), Enter, Backspace)).toBe(
      "#table(columns: 2, [FractionA‸], [b])",
    );
  });

  it("Shift+Enter in a paragraph keeps the text's own spaces, so joining gives it back", () => {
    expect(press("Some ‸*bold* text", ShiftEnter)).toBe("Some \\ ‸*bold* text");
    expect(press("Some ‸*bold* text", ShiftEnter, Backspace)).toBe("Some ‸*bold* text");
    expect(press("one‸ two", ShiftEnter)).toBe("one \\ ‸two");
    expect(press("one‸ two", ShiftEnter, Left, Delete)).toBe("one ‸two");
  });

  it("in an empty cell, the first line stays a line", () => {
    expect(press("#table(columns: 2, [‸~], [~])", Enter)).toBe("#table(columns: 2, [~\\ ‸], [~])");
    expect(press("#table(columns: 2, [‸~], [~])", Enter, type("after"))).toBe("#table(columns: 2, [~\\ after‸], [~])");
  });
});

describe("emptied cells", () => {
  it("keep a line's height, deleted or typed over", () => {
    expect(press("#table(columns: 3, [«1/2], [0.5], [50%»], [1/4])", Delete)).toBe(
      "#table(columns: 3, [‸~], [~], [~], [1/4])",
    );
    expect(press("- a r«uler\n\n#table(columns: 2, [Fraction], [Decimal], [1/2], [0».5])", Backspace)).toBe(
      "- a r‸\n\n#table(columns: 2, [~], [~], [~], [.5])",
    );
    expect(press("#table(columns: 2, [0«.5], [50%], [1/4], [25%])\n\nSome _emp»hasis_ here.", type("Z"))).toBe(
      "#table(columns: 2, [0Z‸], [~], [~], [~])\n\n_hasis_ here.",
    );
  });
});

describe("a table's rows and columns", () => {
  const table = (rows: string) => `#table(\n  columns: 3,\n${rows})`;
  const header =
    "  table.header([Frac‸tion], [Decimal], [Percent]),\n  [1/2], [0.5], [50%],\n  [1/4], [0.25], [25%],\n";

  it("a row added above the header is the header", () => {
    expect(press(table(header), addRow("above"))).toBe(
      table(
        "  table.header([‸~], [~], [~]),\n  [Fraction], [Decimal], [Percent],\n  [1/2], [0.5], [50%],\n  [1/4], [0.25], [25%],\n",
      ),
    );
  });

  it("the header deleted, the row under it is the header", () => {
    expect(press(table(header), deleteRow)).toBe(
      table("  table.header([‸1/2], [0.5], [50%]),\n  [1/4], [0.25], [25%],\n"),
    );
  });

  it("one column left of sized ones is still a list of sizes", () => {
    const sized = "#table(\n  columns: (1fr, 1fr, 1fr),\n  table.header([a], [b], [c]),\n  [d‸], [~], [~],\n)";
    expect(press(sized, deleteColumn, deleteColumn)).toBe(
      "#table(\n  columns: (1fr,),\n  table.header([c]),\n  [‸~],\n)",
    );
    // Read back as a table: a third deletion takes the table.
    expect(press(sized, deleteColumn, deleteColumn, type("z"))).toBe(
      "#table(\n  columns: (1fr,),\n  table.header([c]),\n  [z‸],\n)",
    );
  });
});

describe("typing beside an equation or a blank", () => {
  it("at the end or start of a cell, an option or a statement", () => {
    expect(press("#mcq([Alpha], [Beta $x$‸], answer: 1)", type(" units"))).toBe(
      "#mcq([Alpha], [Beta $x$ units‸], answer: 1)",
    );
    expect(press("#mcq([$+2$], [‸$-2$], answer: 1)", type("e "))).toBe("#mcq([$+2$], [e ‸$-2$], answer: 1)");
    expect(press("#mcq([$+2$], [$-2$‸], answer: 1)", type(" e"))).toBe("#mcq([$+2$], [$-2$ e‸], answer: 1)");
    expect(press("#true-false(answer: true)[Water is #blank(answer: [wet])‸]", type(" wet"))).toBe(
      "#true-false(answer: true)[Water is #blank(answer: [wet]) wet‸]",
    );
    expect(press("#table(columns: 2, [$x$‸], [b])", type(" y"))).toBe("#table(columns: 2, [$x$ y‸], [b])");
  });

  it("joins a paragraph that is only an inline equation", () => {
    expect(press("Intro\n\n$a+b=c$‸\n\nNext", type(" is true"))).toBe("Intro\n\n$a+b=c$ is true‸\n\nNext");
    expect(press("‸$a+b=c$", type("So "))).toBe("So ‸$a+b=c$");
    // After a block on lines of its own, text is a paragraph of its own: after a component's `]` too.
    expect(press("#question[\n  Text\n]‸\n\n= Next", type("T"))).toBe("#question[\n  Text\n]\n\nT‸\n\n= Next");
    expect(press("Intro\n\n‸#question[\n  Text\n]", type("T"))).toBe("Intro\n\nT‸\n\n#question[\n  Text\n]");
    expect(press("#true-false(answer: true)[Water is wet]‸", type("T"))).toBe(
      "#true-false(answer: true)[Water is wet]\n\nT‸",
    );
    expect(press("- a ruler\n\n#line(length: 100%)‸", type("x"))).toBe("- a ruler\n\n#line(length: 100%)\n\nx‸");
  });
});

describe("Backspace and Delete beside a component", () => {
  const question = "#question(points: 1)[\n  Which is balanced?\n  #mcq([Alpha], [Beta], answer: 2)\n]";

  it("select it first, then delete it", () => {
    const after = `${question}\n\n‸~\n\n= Next`;
    expect(press(after, Backspace)).toBe(`${question}‸\n\n= Next`);
    expect(press(after, Backspace, Backspace)).toBe(`[[${question}]]\n\n= Next`);
    expect(press(after, Backspace, Backspace, Backspace)).toBe("= ‸Next");
    expect(press(after, Backspace, Backspace, Backspace, type("x"))).toBe("= x‸Next");
  });

  it("across a line's end, to a component on the next line", () => {
    const text = "#question(points: 1)[\n  Which is balanced?‸\n  #mcq([Alpha], [Beta], answer: 2)\n]";
    expect(press(text, Delete)).toBe(
      "#question(points: 1)[\n  Which is balanced?\n  [[#mcq([Alpha], [Beta], answer: 2)]]\n]",
    );
    expect(press(text, Delete, Delete)).toBe("#question(points: 1)[\n  Which is balanced?‸\n]");
  });

  it("do nothing at the start of a component's text", () => {
    expect(
      press("#question(points: 1)[\n  ‸Which is balanced?\n  #mcq([Alpha], [Beta], answer: 2)\n]", Backspace),
    ).toBeNull();
  });

  it("a deleted one leaves the caret in the text after it, its neighbours a line apart as they were", () => {
    expect(press("given.\n\n[[#line(length: 100%)]]\n\n== Warm-up", Backspace)).toBe("given.\n\n== ‸Warm-up");
    expect(
      press(
        '#question[\n  Balance.\n  + #ce("Na")\n    [[#answer-lines(count: 1)]]\n  + #ce("CH4")\n    #answer-lines(count: 1)\n]',
        Backspace,
      ),
    ).toBe('#question[\n  Balance.\n  + #ce("Na")\n  + ‸#ce("CH4")\n    #answer-lines(count: 1)\n]');
  });
});

describe("Enter above a component on the next line", () => {
  const text = "#question(points: 1)[\n  Which is balanced?‸\n  #mcq([Alpha], [Beta], answer: 2)\n]";

  it("is an empty line, and Backspace takes it back", () => {
    expect(press(text, Enter)).toBe(
      "#question(points: 1)[\n  Which is balanced?\n\n  ‸~\n  #mcq([Alpha], [Beta], answer: 2)\n]",
    );
    expect(press(text, Enter, Backspace)).toBe(text);
    expect(press(text, Enter, Enter, Backspace, Backspace)).toBe(text);
  });
});

describe("inserting", () => {
  const pageBreak = insertBlock("#pagebreak()\n\n{{cursor}}~");
  const divider = insertBlock("#line(length: 100%)");

  it("a page break in a cell goes after the table: pages break between the document's blocks", () => {
    expect(press("#table(columns: 2, [1/2], [0.‸5])", pageBreak)).toBe(
      "#table(columns: 2, [1/2], [0.5])\n\n#pagebreak()\n\n‸~",
    );
  });

  it("a block in the middle of a paragraph splits it", () => {
    // The template's empty line is left out where text follows: the caret goes to that text.
    expect(press("First para‸graph here.\n\n== Warm-up", pageBreak)).toBe(
      "First para\n\n#pagebreak()\n\n‸graph here.\n\n== Warm-up",
    );
    expect(press("First para‸graph here.", divider)).toBe("First para\n\n[[#line(length: 100%)]]\n\ngraph here.");
    expect(press("First paragraph here.‸", pageBreak)).toBe("First paragraph here.\n\n#pagebreak()\n\n‸~");
  });

  it("at a block's start it goes above the block", () => {
    expect(press("‸= Title\n\nText", divider)).toBe("[[#line(length: 100%)]]\n\n= Title\n\nText");
    expect(press("= Title\n\n‸Text here", divider)).toBe("= Title\n\n[[#line(length: 100%)]]\n\nText here");
  });

  it("on an empty line it takes the line", () => {
    expect(press("A final paragraph.‸", Enter, insertBlock(tableTemplate(2, 2)))).toBe(
      "A final paragraph.\n\n#table(\n  columns: (1fr, 1fr),\n  table.header([‸~], [~]),\n  [~], [~],\n)",
    );
    // A header alone: no empty line in the call.
    expect(press("‸~", insertBlock(tableTemplate(1, 2)))).toBe(
      "#table(\n  columns: (1fr, 1fr),\n  table.header([‸~], [~]),\n)",
    );
  });

  it("in a cell, after the cell's text", () => {
    expect(press("#table(columns: 2, [1/2], [0.5‸])", divider)).toBe(
      "#table(columns: 2, [1/2], [0.5\n\n[[#line(length: 100%)]]])",
    );
  });

  it("an inline equation keeps the selected text", () => {
    expect(press("Write your «name» here", insertInline(`$${CURSOR}x$`))).toBe("Write your name$‸x$ here");
  });
});

describe("a multiple choice's options", () => {
  it("Enter in an option's text makes two of it, at its start an empty one before it", () => {
    expect(press("#mcq([Alpha], [Be‸ta], [Gamma], answer: 3)", Enter)).toBe(
      "#mcq([Alpha], [Be], [‸ta], [Gamma], answer: 4)",
    );
    expect(press("#mcq([Alpha], [Be ‸ta], [Gamma], answer: (1, 3))", Enter)).toBe(
      "#mcq([Alpha], [Be], [‸ta], [Gamma], answer: (1, 4))",
    );
    expect(press("#mcq([Alpha], [‸Beta], [Gamma], answer: 2)", Enter)).toBe(
      "#mcq([Alpha], [~], [‸Beta], [Gamma], answer: 3)",
    );
  });

  it("stay one where an option can't end: in bold text, in a formula", () => {
    const bold = "#mcq([Alpha], [Be *bo‸ld* ta], answer: 2)";
    expect(press(bold, Enter)).toBe(bold);
    const formula = "#mcq([Alpha], [Be $x‸ y$ ta], answer: 2)";
    expect(press(formula, Enter)).toBe(formula);
  });

  it("the correct option's number follows its option", () => {
    expect(press("#mcq([Alpha], [Beta‸], [Gamma], answer: 3)", Enter)).toBe(
      "#mcq([Alpha], [Beta], [‸~], [Gamma], answer: 4)",
    );
    expect(press("#mcq([Alpha], [Beta‸], [Gamma], answer: 1)", Enter)).toBe(
      "#mcq([Alpha], [Beta], [‸~], [Gamma], answer: 1)",
    );
    expect(press("#mcq([‸~], [Beta], [Gamma], answer: 3)", Backspace)).toBe("#mcq([‸Beta], [Gamma], answer: 2)");
    expect(press("#mcq(answer: 9, [Alpha‸], [Gamma])", Enter)).toBe("#mcq(answer: 10, [Alpha], [‸~], [Gamma])");
    expect(press("#mcq([Alpha‸], [Beta], answer: 2)", Enter, Backspace)).toBe("#mcq([Alpha‸], [Beta], answer: 2)");
  });

  it("the correct option removed, none is correct", () => {
    expect(press("#mcq([Alpha], [‸~], [Gamma], answer: 2)", Backspace)).toBe("#mcq([Alpha‸], [Gamma], answer: none)");
    expect(press("#mcq([Alpha], [‸~], [Gamma], [Delta], answer: (2, 4))", Backspace)).toBe(
      "#mcq([Alpha‸], [Gamma], [Delta], answer: (3,))",
    );
  });

  it("are lines of text: no heading or list in one", () => {
    const option = "#mcq([Alpha], [Be‸ta], answer: 2)";
    expect(press(option, setBlockType({ kind: "heading", level: 1 }))).toBeNull();
    expect(press(option, toggleList("list"))).toBeNull();
  });
});

describe("block types in a component's content", () => {
  it("a heading at the start of a question's text is written on its line", () => {
    expect(
      press(
        "#question(points: 1)[\n  Wh‸ich is balanced?\n  #mcq([Alpha], [Beta], answer: 2)\n]",
        setBlockType({ kind: "heading", level: 1 }),
      ),
    ).toBe("#question(points: 1)[\n  = Wh‸ich is balanced?\n\n  #mcq([Alpha], [Beta], answer: 2)\n]");
  });

  it("an item made a heading stands apart from its list, at its indentation", () => {
    expect(press("- a\n- ‸b\n- c", setBlockType({ kind: "heading", level: 1 }))).toBe("- a\n\n= ‸b\n\n- c");
    expect(press("#question[\n  Text\n  - a\n  - ‸b\n]", setBlockType({ kind: "heading", level: 1 }))).toBe(
      "#question[\n  Text\n  - a\n\n  = ‸b\n]",
    );
  });

  it("Shift+Tab leaves a top-level item where it is, in indented content too", () => {
    expect(press("#question[\n  Text\n  - a\n  - ‸b\n]", ShiftTab)).toBeNull();
    expect(press("- a\n  - ‸b", ShiftTab)).toBe("- a\n- ‸b");
    expect(press("- a\n  - ‸b", ShiftTab, ShiftTab)).toBeNull();
  });
});

describe("arrow keys between blocks", () => {
  it("stop once between two components", () => {
    const two = (a: string, b: string, c: string) =>
      `#question[\n  First\n  #mcq([Alpha], [Gamma], answer: 2)${a}\n]${b}\n\n#question[\n  ${c}Second\n]`;
    expect(press(two("", "", "‸"), Left)).toBe(two("", "‸", ""));
    expect(press(two("", "", "‸"), Left, Left)).toBe(two("‸", "", ""));
    expect(press(two("‸", "", ""), Right)).toBe(two("", "‸", ""));
    expect(press(two("", "‸", ""), Right)).toBe(two("", "", "‸"));
  });

  it("from a paragraph's end into the component after it, and over one with no text", () => {
    expect(press("Intro text\n\n#question[\n  ‸Second\n]", Left)).toBe("Intro text‸\n\n#question[\n  Second\n]");
    expect(press("Intro text‸\n\n#question[\n  Second\n]", Right)).toBe("Intro text\n\n#question[\n  ‸Second\n]");
    expect(press("Text‸\n\n#answer-lines(count: 2)\n\nNext", Right)).toBe("Text\n\n#answer-lines(count: 2)‸\n\nNext");
    expect(press("Text\n\n#answer-lines(count: 2)‸\n\nNext", Left)).toBe("Text‸\n\n#answer-lines(count: 2)\n\nNext");
  });
});

describe("an outline (a mind map)", () => {
  const map = (topic: string, a: string, detail: string, b: string) =>
    `#mindmap[\n  ${topic}\n  - ${a}\n    - ${detail}\n  - ${b}\n]`;

  it("Enter on the topic starts its first branch", () => {
    expect(press(map("Cells‸", "First", "A detail", "Second"), Enter, type("Nucleus"))).toBe(
      "#mindmap[\n  Cells\n  - Nucleus‸\n  - First\n    - A detail\n  - Second\n]",
    );
    expect(press(map("Ce‸lls", "First", "A detail", "Second"), Enter)).toBe(
      "#mindmap[\n  Ce\n  - ‸lls\n  - First\n    - A detail\n  - Second\n]",
    );
    // No branch above the topic.
    expect(press(map("‸Cells", "First", "A detail", "Second"), Enter)).toBe(
      map("‸Cells", "First", "A detail", "Second"),
    );
  });

  it("Enter on an empty branch stays in the map", () => {
    const end = "#mindmap[\n  Main\n  - First\n  - Second‸\n]";
    expect(press(end, Enter, Enter)).toBe("#mindmap[\n  Main\n  - First\n  - Second\n  - ‸\n]");
    expect(press(end, Enter, Enter, Backspace)).toBe(end);
  });

  it("Backspace at a branch's start joins the branch above; the first stays a branch", () => {
    expect(press(map("Main", "‸First", "A detail", "Second"), Backspace)).toBe(
      map("Main", "‸First", "A detail", "Second"),
    );
    expect(press(map("Main", "First", "‸A detail", "Second"), Backspace)).toBe(
      "#mindmap[\n  Main\n  - First\n  - ‸A detail\n  - Second\n]",
    );
    expect(press(map("Main", "First", "A detail", "‸Second"), Backspace)).toBe(
      "#mindmap[\n  Main\n  - First\n    - A detail‸Second\n]",
    );
  });

  it("Delete at the topic's end leaves the first branch a branch", () => {
    expect(press(map("Main‸", "First", "A detail", "Second"), Delete)).toBeNull();
    expect(press(map("Main", "First‸", "A detail", "Second"), Delete)).toBe(
      "#mindmap[\n  Main\n  - First‸A detail\n  - Second\n]",
    );
  });

  it("Tab and Shift+Tab move a branch a level, never out of the map", () => {
    expect(press(map("Main", "First", "A detail", "Sec‸ond"), ShiftTab)).toBeNull();
    expect(press(map("Main", "First", "A detail", "Sec‸ond"), Tab)).toBe(
      "#mindmap[\n  Main\n  - First\n    - A detail\n    - Sec‸ond\n]",
    );
    expect(press(map("Main", "First", "A detail", "Sec‸ond"), Tab, ShiftTab)).toBe(
      map("Main", "First", "A detail", "Sec‸ond"),
    );
  });

  it("its branches stay a list: no heading, no paragraph", () => {
    const branch = map("Main", "Fir‸st", "A detail", "Second");
    expect(press(branch, setBlockType({ kind: "heading", level: 1 }))).toBeNull();
    expect(press(branch, toggleList("list"))).toBeNull();
    expect(press(branch, Enter)).toBe("#mindmap[\n  Main\n  - Fir\n  - ‸st\n    - A detail\n  - Second\n]");
  });
});
