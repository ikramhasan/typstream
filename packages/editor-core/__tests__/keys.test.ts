// The editor's keys as commands (keymap.ts), where the caret needs a placeholder to be drawn
// (`caretAnchor`), and how plugins' bindings are ordered and matched, checked with Typst's parser.
import { hasErrors, parse } from "@typstream/syntax";
import { beforeAll, describe, expect, it } from "vitest";
import {
  baseKeymap,
  caretAnchor,
  DEFAULT_SCHEMA,
  deleteChar,
  deleteWord,
  type EditorPlugin,
  insertText,
  keysPlugin,
  moveCell,
  moveChar,
  snap,
  splitBlock,
} from "../src/index";
import { byPriority, matchesShortcut } from "../src/plugin";
import { load, run, state } from "./support";

beforeAll(load);

const s = DEFAULT_SCHEMA;

/** The document with the placeholder (`·`) where `caretAnchor` puts it, or as it is. */
const anchored = (marked: string): string => {
  const st = state(marked);
  const at = caretAnchor(st, s);
  return at === null ? st.text : `${st.text.slice(0, at)}·${st.text.slice(at)}`;
};

describe("caretAnchor: where Typst lays out nothing beside the caret", () => {
  it("after a space ending a paragraph", () => {
    expect(anchored("Hello ‸")).toBe("Hello ·");
    expect(anchored("Hello ‸\n\nNext")).toBe("Hello ·\n\nNext");
    expect(anchored("- item ‸\n- next")).toBe("- item ·\n- next");
    expect(anchored("= Title ‸")).toBe("= Title ·");
  });

  it("in empty paragraphs, items, headings and cells", () => {
    expect(anchored("‸")).toBe("·");
    expect(anchored("A\n\n‸\n\nB")).toBe("A\n\n·\n\nB");
    expect(anchored("A\n\n‸")).toBe("A\n\n·");
    expect(anchored("- a\n- ‸")).toBe("- a\n- ·");
    expect(anchored("= ‸")).toBe("= ·");
    expect(anchored("#table(columns: 2, [a], [‸])")).toBe("#table(columns: 2, [a], [·])");
    expect(anchored("#question[\n  Text\n\n  ‸\n]")).toBe("#question[\n  Text\n\n  ·\n]");
  });

  it("after a line break ending a paragraph", () => {
    expect(anchored("Line \\ ‸")).toBe("Line \\ ·");
  });

  it("not beside text, inside a space between words, or outside markup", () => {
    expect(anchored("Hel‸lo")).toBe("Hello");
    expect(anchored("Hello‸")).toBe("Hello");
    expect(anchored("Hello ‸world")).toBe("Hello world");
    expect(anchored("‸Hello")).toBe("Hello");
    expect(anchored("*bold*‸ ")).toBe("*bold* ");
    expect(anchored("Hello ‸\nworld")).toBe("Hello \nworld");
    expect(anchored("#question[‸\n  Text\n]")).toBe("#question[\n  Text\n]");
    expect(anchored("#let x = ‸1")).toBe("#let x = 1");
    expect(anchored("$x + ‸$")).toBe("$x + $");
    expect(anchored("```\ncode ‸\n```")).toBe("```\ncode \n```");
    expect(anchored("Hello «world»")).toBe("Hello world");
  });

  it("leaves the document parsing as it did", () => {
    for (const doc of ["Hello ‸", "- a\n- ‸", "#table(columns: 2, [a], [‸])", "= ‸", "*bold ‸*", "_it ‸_"]) {
      const placed = anchored(doc).replace("·", " ");
      expect(hasErrors(parse(placed)), doc).toBe(false);
    }
  });
});

describe("Enter out of a list, and in an empty paragraph", () => {
  it("ends a list with a paragraph of its own", () => {
    expect(run("- a\n- ‸", splitBlock)).toBe("- a\n\n‸~");
    // A line of text right after would run into the new paragraph: a blank line between.
    expect(run("- a\n- ‸\nNext line", splitBlock)).toBe("- a\n\n‸~\n\nNext line");
    // A heading or another item after starts a block anyway.
    expect(run("+ a\n+ ‸\n= Next", splitBlock)).toBe("+ a\n\n‸~\n= Next");
    expect(run("#question[\n  + a\n  + ‸\n]", splitBlock)).toBe("#question[\n  + a\n\n  ‸~\n]");
  });

  it("writes empty lines Typst would show as nothing: Enter after Enter adds lines", () => {
    expect(run("A‸", splitBlock)).toBe("A\n\n‸~");
    expect(run("A\n\n‸~", splitBlock)).toBe("A\n\n~\n\n‸~");
    expect(run("‸A", splitBlock)).toBe("~\n\n‸A");
    expect(run("Hel‸lo", splitBlock)).toBe("Hel\n\n‸lo");
    // An empty paragraph without one (the end of the text after a deletion) gets one too.
    expect(run("A\n\n‸\n\nB", splitBlock)).toBe("A\n\n~\n\n‸~\n\nB");
    expect(run("‸", splitBlock)).toBe("~\n\n‸~");
    // In a component's content block.
    expect(run("#question[\n  What?‸\n]", splitBlock)).toBe("#question[\n  What?\n\n  ‸~\n]");
    // Not a blank line of its own: a paragraph is split as usual.
    expect(run("A\n‸\nB", splitBlock)).toBe("A\n\n\n‸\nB");
  });
});

describe("empty lines", () => {
  it("are replaced by what is typed", () => {
    expect(run("A\n\n‸~\n\nB", (st) => insertText("x")(st, s))).toBe("A\n\nx‸\n\nB");
    expect(run("A\n\n~‸", (st) => insertText("x")(st, s))).toBe("A\n\nx‸");
    expect(run("#table(columns: 2, [‸~], [b])", (st) => insertText("x")(st, s))).toBe("#table(columns: 2, [x‸], [b])");
    // A `~` in text is a non-breaking space, not an empty line.
    expect(run("a~‸b", (st) => insertText("x")(st, s))).toBe("a~x‸b");
  });

  it("go whole with Backspace and Delete; a cell keeps its own", () => {
    expect(run("A\n\n‸~", deleteChar(-1))).toBe("A‸");
    expect(run("A\n\n‸~\n\nB", deleteChar(-1))).toBe("A‸\n\nB");
    expect(run("A\n\n‸~\n\nB", deleteChar(1))).toBe("A‸\n\nB");
    expect(run("‸~\n\nB", deleteChar(-1))).toBe("‸B");
    // Across the break: the empty line goes, not joined into the text.
    expect(run("A\n\n~\n\n‸B", deleteChar(-1))).toBe("A‸\n\nB");
    expect(run("A‸\n\n~\n\nB", deleteChar(1))).toBe("A‸\n\nB");
    expect(run("#table(columns: 2, [‸~], [b])", deleteChar(-1))).toBe("#table(columns: 2, [‸~], [b])");
  });

  it("are one place for the caret", () => {
    expect(snap(state("A\n\n~‸"), 4, s)).toBe(3);
    expect(moveChar(state("A\n\n‸~\n\nB"), 3, 1, s)).toBeGreaterThan(4);
  });
});

describe("keys", () => {
  it("deletes words back and forth", () => {
    expect(run("Hello world‸", (st) => deleteWord(-1)(st, s))).toBe("Hello ‸");
    expect(run("‸Hello world", (st) => deleteWord(1)(st, s))).toBe("‸ world");
    expect(run("Hello «wor»ld", (st) => deleteWord(-1)(st, s))).toBe("Hello ‸ld");
    expect(run("‸", (st) => deleteWord(-1)(st, s))).toBe(null);
  });

  it("moves through a table's cells, and adds a row after the last", () => {
    const table = "#table(columns: 2, [a‸], [bb], [c], [])";
    expect(run(table, (st) => moveCell(1)(st, s))).toBe("#table(columns: 2, [a], [«bb»], [c], [])");
    expect(run("#table(columns: 2, [a], [bb], [c‸], [])", (st) => moveCell(1)(st, s))).toBe(
      "#table(columns: 2, [a], [bb], [c], [‸])",
    );
    expect(run("#table(columns: 2, [a], [bb‸], [c], [])", (st) => moveCell(-1)(st, s))).toBe(
      "#table(columns: 2, [«a»], [bb], [c], [])",
    );
    expect(run("#table(columns: 2, [a], [b‸])", (st) => moveCell(1)(st, s))).toContain("[~], [‸~]");
    expect(run("Not a table‸", (st) => moveCell(1)(st, s))).toBe(null);
  });

  it("keeps Tab in the editor where nothing else applies", () => {
    const tab = baseKeymap.Tab as readonly ((st: ReturnType<typeof state>, sc: typeof s) => unknown)[];
    const first = tab.map((c) => c(state("Hello‸"), s)).find((tr) => tr !== null);
    expect(first).toEqual({ edits: [], selection: { anchor: 5, head: 5 } });
  });
});

describe("plugins' bindings", () => {
  const key = (init: Partial<KeyboardEventInit> & { key: string; code?: string }) =>
    ({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, code: "", ...init }) as KeyboardEvent;

  it("matches Mod and Word on both platforms", () => {
    expect(matchesShortcut("Mod-b", key({ key: "b", ctrlKey: true }), false)).toBe(true);
    expect(matchesShortcut("Mod-b", key({ key: "b", metaKey: true }), true)).toBe(true);
    expect(matchesShortcut("Mod-b", key({ key: "b", ctrlKey: true }), true)).toBe(false);
    expect(matchesShortcut("Word-Backspace", key({ key: "Backspace", ctrlKey: true }), false)).toBe(true);
    expect(matchesShortcut("Word-Backspace", key({ key: "Backspace", altKey: true }), true)).toBe(true);
    expect(matchesShortcut("Word-Backspace", key({ key: "Backspace", ctrlKey: true }), true)).toBe(false);
    expect(matchesShortcut("Backspace", key({ key: "Backspace", ctrlKey: true }), false)).toBe(false);
    expect(matchesShortcut("Enter", key({ key: "Enter" }), false)).toBe(true);
    expect(matchesShortcut("Shift-Enter", key({ key: "Enter" }), false)).toBe(false);
    expect(matchesShortcut("Mod-Alt-1", key({ key: "¡", code: "Digit1", metaKey: true, altKey: true }), true)).toBe(
      true,
    );
  });

  it("orders plugins by priority, then as given; the editor's keys last", () => {
    const a: EditorPlugin = { key: "a" };
    const b: EditorPlugin = { key: "b", priority: 10 };
    const c: EditorPlugin = { key: "c" };
    expect(byPriority([keysPlugin, a, b, c]).map((p) => p.key)).toEqual(["b", "a", "c", "keys"]);
  });
});
