import { hasErrors, parse } from "@typstream/syntax";
import { beforeAll, describe, expect, it } from "vitest";
import { copiedTypst, pastePlain, pasteTypst, shownText } from "../src/clipboard";
import { DEFAULT_SCHEMA, deleteSelection, insertText } from "../src/commands";
import { schemaOf } from "../src/plugin";
import type { EditorState } from "../src/state";
import { load, show, state } from "./support";

beforeAll(load);

const plain = (marked: string): string => {
  const s = state(marked);
  return shownText(s, s.from, s.to, DEFAULT_SCHEMA);
};
const typst = (marked: string): string | null => {
  const s = state(marked);
  const out = copiedTypst(s, s.from, s.to, DEFAULT_SCHEMA);
  if (out !== null) expect(hasErrors(parse(out)), `parses: ${JSON.stringify(out)}`).toBe(false);
  return out;
};
const paste = (marked: string, copied: string): string | null => {
  const s = pasteTypst(state(marked), copied, DEFAULT_SCHEMA);
  if (s) expect(hasErrors(parse(s.text)), `parses: ${JSON.stringify(s.text)}`).toBe(false);
  return s && show(s);
};
const pastePlainText = (marked: string, text: string): string | null => {
  const s = pastePlain(state(marked), text, DEFAULT_SCHEMA);
  if (s) expect(hasErrors(parse(s.text)), `parses: ${JSON.stringify(s.text)}`).toBe(false);
  return s && show(s);
};

const TABLE = "#table(\n  columns: 2,\n  [A], [B],\n  [1], [],\n  [x], [y],\n)";

describe("copy: plain text", () => {
  it.each([
    ["paragraphs a blank line apart, a line break in one a space", "«Para one\ntwo\n\nNext»", "Para one two\n\nNext"],
    ["list items on lines", "«- a b\n- c»\n", "a b\nc"],
    ["nested items and terms", "+ «a\n  - sub\n+ b\n\n/ Term: def»", "a\nsub\nb\n\nTerm: def"],
    ["a table's rows on lines, its cells apart by tabs, an empty cell kept", `«${TABLE}»`, "A\tB\n1\t\nx\ty"],
    ["a header's cells", "#table(columns: 2, table.header([«A], [B]), [1], [2»])", "A\tB\n1\t2"],
    ["a multiple choice's options on lines", "#multiple-choice[«A][B][C»]", "A\nB\nC"],
    ["marks' delimiters left out", "Some «*bold* and _it_» x", "bold and it"],
    ["a heading without its marker", "«= Head\n\nText»", "Head\n\nText"],
    ["equations and calls as what they show", 'a «$x^2$ and #ce("H2O")» b', "x^2 and H2O"],
    ["a line break written in the text", "One «two\\\nthree» four", "two\nthree"],
    ["no separator at either end", "- a «b\n- »c", "b"],
    ["escapes resolved, `~` a space", "«a \\* b~c»", "a * b c"],
  ])("%s", (_, marked, expected) => {
    expect(plain(marked)).toBe(expected);
  });
});

describe("copy: Typst", () => {
  it.each([
    ["part of a bold word is bold", "Some *bo«ld* and _it»al_ text", "#strong[ld] and #emph[it]"],
    ["a mark's whole text is the mark as written", "Some *«bold»* text", "*bold*"],
    ["calls cut through are closed and opened again", "#strong[bo«ld] and #emph[it»al]", "#strong[ld] and #emph[it]"],
    ["a mark around the selection comes with it", "Some #text(fill: red)[r«e»d] text", "#text(fill: red)[e]"],
    ["a heading from its first letter to its end is the heading", "= «Heading»\n\nPara", "= Heading"],
    ["part of a heading is text", "= Hea«ding»\n\nPara", "ding"],
    ["an item's whole text is the item", "- «item one»\n- two", "- item one"],
    ["a block's text isn't the block around it", "#align(center)[«Centred»]", "Centred"],
    ["nor a component's", "#question(points: 2)[«What is 2+2?»]", "What is 2+2?"],
    [
      "out of a block: the part in it stays in one",
      "#align(center)[Cen«tred]\n\nNext» one",
      "#align(center)[tred]\n\nNext",
    ],
    ["blocks as they are", "«- a\n- b\n\n= Head»\n", "- a\n- b\n\n= Head"],
    ["cells cut through can't stand alone", "#table(columns: 2, [«A], [B»])", null],
  ])("%s", (_, marked, expected) => {
    expect(typst(marked)).toBe(expected);
  });
});

describe("paste: Typst", () => {
  it.each([
    ["bold beside a letter is a call (`*` there is a star)", "Hello‸world", "*bold*", "Hello#strong[bold]‸world"],
    ["bold between spaces stays as written", "Hello ‸ world", "*bold*", "Hello *bold*‸ world"],
    ["a heading into a line of text is its text", "Hello ‸world", "= Heading", "Hello Heading‸world"],
    [
      "on an empty line it is the heading, the line's `~` gone",
      "Hello\n\n~‸\n\nworld",
      "= Heading",
      "Hello\n\n= Heading‸\n\nworld",
    ],
    ["a list on an empty line", "Hello\n\n‸~\n\nworld", "- a\n- b", "Hello\n\n- a\n- b‸\n\nworld"],
    ["blocks into a paragraph stand apart from it", "Hello ‸world", "- a\n- b", "Hello \n\n- a\n- b‸\n\nworld"],
    ["at a paragraph's end", "Hello world‸", "- a\n- b", "Hello world\n\n- a\n- b‸"],
    ["an item into an item is its text", "- one‸\n- two", "- a", "- onea‸\n- two"],
    ["into an empty item too", "- ‸\n- two", "- a", "- a‸\n- two"],
    ["a whole document into an empty one", "‸", "= Heading\n\nPara\n", "= Heading\n\nPara‸"],
    ["into a cell", "#table(columns: 2, [A‸], [B])", "_x_", "#table(columns: 2, [A#emph[x]‸], [B])"],
  ])("%s", (_, marked, copied, expected) => {
    expect(paste(marked, copied)).toBe(expected);
  });

  it.each([
    ["several lines beside an item's text", "- one‸\n- two", "- a\n- b"],
    ["several lines in a cell", "#table(columns: 2, [A‸], [B])", "a\n\nb"],
    ["into an equation", "$x‸$", "*x*"],
    ["what doesn't parse", "Hello ‸world", "*unclosed"],
  ])("not %s (its text is pasted instead)", (_, marked, copied) => {
    expect(paste(marked, copied)).toBeNull();
  });

  it("what was copied pastes back the same", () => {
    for (const marked of [
      "Some *bo«ld* and _it»al_ text",
      "= «Heading»\n\nPara",
      "- «item one»\n- two",
      `«${TABLE}»`,
    ]) {
      const copied = typst(marked) as string;
      expect(paste("‸", copied)).toBe(`${copied}‸`);
    }
  });
});

describe("paste: components", () => {
  const QUESTION = "#question(points: 1)[\n  Which?\n  #mcq([A], [B], answer: 1)\n]";
  const edu = schemaOf([
    {
      key: "t",
      components: [
        { name: "question", label: "Question" },
        { name: "mcq", label: "Multiple choice", list: true },
        { name: "mindmap", label: "Mind map", outline: true },
      ],
    },
  ]);
  const pasteIn = (marked: string, copied: string): string | null => {
    const s = pasteTypst(state(marked), copied, edu);
    if (s) expect(hasErrors(parse(s.text)), `parses: ${JSON.stringify(s.text)}`).toBe(false);
    return s && show(s);
  };

  it.each([
    [
      "at a line's end a divider goes after the list, not into the item",
      "- a pencil\n- a ruler‸\n\nNext",
      "#line(length: 100%)",
      "- a pencil\n- a ruler\n\n#line(length: 100%)‸\n\nNext",
    ],
    [
      "in the middle of a sentence it goes between its halves",
      "#question[\n  Balance thes‸e equations.\n]",
      QUESTION,
      `#question[\n  Balance thes\n\n  ${QUESTION.replace(/\n/g, "\n  ")}‸\n\n  e equations.\n]`,
    ],
    [
      "on an empty line it takes the line, its `~` gone",
      `Text\n\n‸~\n\n= Next`,
      QUESTION,
      `Text\n\n${QUESTION}‸\n\n= Next`,
    ],
    ["at a block's start it goes above the block", `Text\n\n= ‸Next`, QUESTION, `Text\n\n${QUESTION}‸\n\n= Next`],
    [
      "several of them",
      "One‸\n\nTwo",
      `${QUESTION}\n\n#line(length: 100%)`,
      `One\n\n${QUESTION}\n\n#line(length: 100%)‸\n\nTwo`,
    ],
  ])("%s", (_, marked, copied, expected) => {
    expect(pasteIn(marked, copied)).toBe(expected);
  });

  it("over itself selected, nothing changes but the selection", () => {
    const doc = `Text\n\n[[${QUESTION}]]\n\n= Next`;
    const s = state(doc);
    const copied = copiedTypst(s, s.from, s.to, edu);
    expect(copied).toBe(QUESTION);
    const del = deleteSelection(s, edu);
    const base = del ? s.apply(del).state : s;
    const pasted = pasteTypst(base, copied as string, edu);
    expect(pasted && show(pasted)).toBe(`Text\n\n${QUESTION}‸\n\n= Next`);
  });

  it("typing after one pasted is a paragraph after it", () => {
    const pasted = pasteTypst(state("Text\n\n‸~"), QUESTION, edu) as EditorState;
    const tr = insertText("T")(pasted, edu);
    expect(tr && show(pasted.apply(tr).state)).toBe(`Text\n\n${QUESTION}\n\nT‸`);
  });

  it("not in an option or a mind map: what it shows is pasted as text", () => {
    expect(pasteIn("#mcq([Al‸pha], [Beta], answer: 1)", "#line(length: 100%)")).toBeNull();
    expect(pasteIn("#mindmap[\n  Main\n  - Fir‸st\n]", QUESTION)).toBeNull();
  });
});

describe("paste: plain text", () => {
  it.each([
    [
      "every line a paragraph, blank lines or not",
      "Hello ‸world",
      "one\ntwo\n\n\nthree",
      "Hello one\n\ntwo\n\nthree‸world",
    ],
    ["an empty line's `~` goes", "Hello\n\n~‸", "one\ntwo", "Hello\n\none\n\ntwo‸"],
    ["in a list, lines are items", "- item‸\n- next", "one\ntwo", "- itemone\n- two‸\n- next"],
    ["after a heading, paragraphs", "= Title‸", "one\ntwo", "= Titleone\n\ntwo‸"],
    [
      "markup characters are text",
      "‸",
      "- dash\n* star *x*\n1. num\n#hash",
      "\\- dash\n\n\\* star \\*x\\*\n\n1\\. num\n\n\\#hash‸",
    ],
    ["tabs are spaces, Windows line ends lines", "a‸", "x\ty\r\nz", "ax y\n\nz‸"],
  ])("%s", (_, marked, text, expected) => {
    expect(pastePlainText(marked, text)).toBe(expected);
  });

  it("nothing pasted is nothing", () => {
    expect(pastePlainText("a‸", "")).toBeNull();
    expect(pastePlainText("a‸", "\n \n")).toBeNull();
  });
});
