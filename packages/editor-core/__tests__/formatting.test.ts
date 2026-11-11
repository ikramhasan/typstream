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
  fontAt,
  indentItems,
  insertBlock,
  isMarked,
  linkAt,
  markValue,
  setAlignment,
  setArgument,
  setBlockType,
  setFont,
  setLink,
  setMark,
  tableAt,
  tableTemplate,
  toggleList,
  toggleMark,
} from "../src/index";
import { load, run, state } from "./support";

/** `value`, which the test expects to be there. */
const the = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error("expected a value");
  return value;
};

beforeAll(load);

const bold = toggleMark({ name: "strong" });
const italic = toggleMark({ name: "emph" });
const underline = toggleMark({ name: "underline" });
const strike = toggleMark({ name: "strike" });
const sub = toggleMark({ name: "sub" });
const sup = toggleMark({ name: "super" });
const size = (value: string | null) => setMark({ name: "text", arg: "size" }, value);
const colour = (value: string | null) => setMark({ name: "text", arg: "fill" }, value);
const RED = 'rgb("#dc2626")';
const BLUE = 'rgb("#2563eb")';
const YELLOW = 'rgb("#fef08a")';

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
    // Right after strong text, typing isn't bold, so the toolbar doesn't say it is and Ctrl+B starts bold.
    expect(isMarked(state("x *abc*‸ y"), { name: "strong" })).toBe(false);
    expect(run("x *abc*‸ y", bold)).toBe("x *abc*#strong[‸] y");
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

  it("come off text that is all another mark, which stays", () => {
    expect(run("Answer _#underline[«every question»]_ in", italic)).toBe("Answer #underline[«every question»] in");
    expect(run("Answer *#strike[«every question»]* in", bold)).toBe("Answer #strike[«every question»] in");
    expect(run("every #strike[#sub[«question»]] in", strike)).toBe("every #sub[«question»] in");
    expect(run(`every #underline[#text(fill: ${RED})[«question»]] in`, underline)).toBe(
      `every #text(fill: ${RED})[«question»] in`,
    );
    expect(run(`#text(size: 18pt)[#text(fill: ${RED})[«every question»]]`, size(null))).toBe(
      `#text(fill: ${RED})[«every question»]`,
    );
    expect(run(`#text(fill: ${RED})[#highlight(fill: ${YELLOW})[«every question»]]`, colour(null))).toBe(
      `#highlight(fill: ${YELLOW})[«every question»]`,
    );
    // The middle one of three, and the innermost.
    expect(run("a #strike[#sub[#underline[«question»]]] b", sub)).toBe("a #strike[#underline[«question»]] b");
    expect(run("a #strike[#sub[#underline[«question»]]] b", underline)).toBe("a #strike[#sub[«question»]] b");
  });

  it("come off three nested marks one at a time, in whatever order they went on", () => {
    const marks = [bold, underline, strike];
    const orders = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    const on = (order: number[]) =>
      order.reduce((doc, i) => run(doc, the(marks[i])) as string, "Answer «every question» in");
    for (const order of orders) {
      for (const off of order) {
        // What is left is what the other two alone write.
        expect(run(on(order), the(marks[off]))).toBe(on(order.filter((i) => i !== off)));
      }
    }
  });

  it("come off part of nested marks: the marks inside end and start again around it", () => {
    expect(run("a #strike[#sub[que«st»ion]] b", strike)).toBe("a #strike[#sub[que]]#sub[«st»]#strike[#sub[ion]] b");
    expect(run("a #strike[#sub[que«st»ion]] b", sub)).toBe("a #strike[#sub[que]«st»#sub[ion]] b");
    expect(run("a #strike[#sub[«que»stion]] b", strike)).toBe("a #sub[«que»]#strike[#sub[stion]] b");
    expect(run("a #strike[x #sub[ques«tion] y»] b", strike)).toBe("a #strike[x #sub[ques]]#sub[«tion] y» b");
    expect(run("a #strike[«x #sub[ques»tion] y] b", strike)).toBe("a «x #sub[ques»]#strike[#sub[tion] y] b");
    expect(run("a _x #underline[que«st»ion] y_ b", italic)).toBe(
      "a #emph[x #underline[que]]#underline[«st»]#emph[#underline[ion] y] b",
    );
    expect(run("a *x _que«st»ion_ y* b", bold)).toBe("a #strong[x #emph[que]]#emph[«st»]#strong[#emph[ion] y] b");
    // A component in a mark isn't cut: the mark comes off all of it.
    expect(run("#strike[a #question[b«c»d] e]", strike)).toBe("#strike[a ]#question[b«c»d]#strike[ e]");
  });

  it("come off nested marks in every paragraph, a list's items, a heading and a table's cell", () => {
    expect(run("One *#underline[«two]*\n\n*#underline[three»]* four", bold)).toBe(
      "One #underline[«two]\n\n#underline[three»] four",
    );
    expect(
      run(
        `- one #underline[#text(fill: ${RED})[«two three]]\n- #underline[#text(fill: ${RED})[four»]] five`,
        underline,
      ),
    ).toBe(`- one #text(fill: ${RED})[«two three]\n- #text(fill: ${RED})[four»] five`);
    expect(run("= A #underline[_«big»_] title", underline)).toBe("= A _«big»_ title");
    expect(run("#table(columns: 2, [a #strike[#sub[«b»]] c], [d])", strike)).toBe(
      "#table(columns: 2, [a #sub[«b»] c], [d])",
    );
  });

  it("split at a caret inside nested marks, the others around the caret for what is typed", () => {
    expect(run("a *bo‸ld* b", bold)).toBe("a #strong[bo]‸#strong[ld] b");
    expect(run("a #strike[#sub[que‸stion]] b", strike)).toBe("a #strike[#sub[que]]#sub[‸]#strike[#sub[stion]] b");
    expect(run("a #strike[#sub[que‸stion]] b", sub)).toBe("a #strike[#sub[que]‸#sub[stion]] b");
    expect(run("a #strike[#sub[‸question]] b", strike)).toBe("a #sub[‸]#strike[#sub[question]] b");
    expect(run("a #strike[#sub[question‸]] b", strike)).toBe("a #strike[#sub[question]]#sub[‸] b");
    expect(run("a _#underline[que‸stion]_ b", italic)).toBe(
      "a #emph[#underline[que]]#underline[‸]#emph[#underline[stion]] b",
    );
    expect(run(`a #text(size: 18pt)[#text(fill: ${RED})[que‸stion]] b`, size(null))).toBe(
      `a #text(size: 18pt)[#text(fill: ${RED})[que]]#text(fill: ${RED})[‸]#text(size: 18pt)[#text(fill: ${RED})[stion]] b`,
    );
    // Another mark is armed inside them.
    expect(run("a #strike[#sub[que‸stion]] b", bold)).toBe("a #strike[#sub[que#strong[‸]stion]] b");
  });

  it("change the value of a mark around other marks", () => {
    expect(run(`#text(size: 18pt)[#text(fill: ${RED})[«every question»]]`, size("24pt"))).toBe(
      `#text(size: 24pt)[#text(fill: ${RED})[«every question»]]`,
    );
    expect(run(`#text(fill: ${RED})[#underline[«every question»]]`, colour(BLUE))).toBe(
      `#text(fill: ${BLUE})[#underline[«every question»]]`,
    );
    expect(run(`#text(fill: ${RED})[#highlight(fill: ${YELLOW})[#underline[«every question»]]]`, colour(BLUE))).toBe(
      `#text(fill: ${BLUE})[#highlight(fill: ${YELLOW})[#underline[«every question»]]]`,
    );
    // On part of it: that part's own call, with what the inner one gave it.
    expect(run(`#text(size: 18pt)[#text(fill: ${RED})[every «question»]]`, size("24pt"))).toBe(
      `#text(size: 18pt)[#text(fill: ${RED})[every ]]#text(fill: ${RED}, size: 24pt)[«question»]`,
    );
    expect(run(`#text(size: 18pt)[#text(fill: ${RED})[every «question»]]`, colour(BLUE))).toBe(
      `#text(size: 18pt)[#text(fill: ${RED})[every ]#text(fill: ${BLUE})[«question»]]`,
    );
  });

  it("put a size and a colour on the same text in one call, each coming off alone", () => {
    const sized = run("Answer «every question» in", size("18pt")) as string;
    const both = run(sized, colour(RED)) as string;
    expect(both).toBe(`Answer #text(size: 18pt, fill: ${RED})[«every question»] in`);
    // A value changes where it is written.
    expect(run(both, size("24pt"))).toBe(`Answer #text(size: 24pt, fill: ${RED})[«every question»] in`);
    expect(run(both, colour(BLUE))).toBe(`Answer #text(size: 18pt, fill: ${BLUE})[«every question»] in`);
    expect(run(both, size(null))).toBe(`Answer #text(fill: ${RED})[«every question»] in`);
    expect(run(both, colour(null))).toBe(sized);
    expect(run(run(both, size(null)) as string, colour(null))).toBe("Answer «every question» in");
    // Around another mark, in a heading and in a table's cell.
    expect(run(`a #text(fill: ${RED})[#underline[«b»]] c`, size("18pt"))).toBe(
      `a #text(fill: ${RED}, size: 18pt)[#underline[«b»]] c`,
    );
    expect(run(`a #underline[#text(fill: ${RED})[«b»]] c`, size("18pt"))).toBe(
      `a #underline[#text(fill: ${RED}, size: 18pt)[«b»]] c`,
    );
    expect(run(run("= A «big» title", size("18pt")) as string, colour(RED))).toBe(
      `= A #text(size: 18pt, fill: ${RED})[«big»] title`,
    );
    expect(run(run("#table(columns: 2, [a «b» c], [d])", colour(RED)) as string, size("18pt"))).toBe(
      `#table(columns: 2, [a #text(fill: ${RED}, size: 18pt)[«b»] c], [d])`,
    );
    // Not the call around more text than the selection.
    expect(run(`#text(size: 18pt)[every «question»]`, colour(RED))).toBe(
      `#text(size: 18pt)[every #text(fill: ${RED})[«question»]]`,
    );
  });

  it("read one call inside another as written, and take either off", () => {
    const nested = `#text(size: 18pt)[#text(fill: ${RED})[«every question»]]`;
    expect(markValue(state(nested), { name: "text", arg: "size" })).toBe("18pt");
    expect(markValue(state(nested), { name: "text", arg: "fill" })).toBe(RED);
    expect(run(nested, colour(null))).toBe("#text(size: 18pt)[«every question»]");
    expect(run(nested, size(null))).toBe(`#text(fill: ${RED})[«every question»]`);
    expect(run(nested, colour(BLUE))).toBe(`#text(size: 18pt)[#text(fill: ${BLUE})[«every question»]]`);
  });

  it("have subscript and superscript replace each other", () => {
    expect(run("a #super[«question»] b", sub)).toBe("a #sub[«question»] b");
    expect(run("a #sub[«question»] b", sup)).toBe("a #super[«question»] b");
    expect(run("a #sub[«question»] b", sub)).toBe("a «question» b");
    expect(run("a #super[que«st»ion] b", sub)).toBe("a #super[que]#sub[«st»]#super[ion] b");
    expect(run("a «x #super[question] y» b", sub)).toBe("a #sub[«x question y»] b");
    expect(run("a #strike[#super[«question»]] b", sub)).toBe("a #strike[#sub[«question»]] b");
    // At a caret, what is typed next is the one asked for only.
    expect(run("a #super[que‸stion] b", sub)).toBe("a #super[que]#sub[‸]#super[stion] b");
    expect(run("a #sub[question‸] b", sup)).toBe("a #sub[question]#super[‸] b");
  });

  it("join the pieces of one mark a command leaves side by side", () => {
    const off = run("Some *«b»old* text", bold) as string;
    expect(off).toBe("Some «b»#strong[old] text");
    expect(run(off, bold)).toBe("Some *«b»old* text");
    expect(run(run("Some *b«ol»d* text", bold) as string, bold)).toBe("Some *b«ol»d* text");
    expect(run(run("Some *bol«d»* text", bold) as string, bold)).toBe("Some *bol«d»* text");
    expect(run(run("Some #underline[b«ol»d] text", underline) as string, underline)).toBe(
      "Some #underline[b«ol»d] text",
    );
    // Inside a word the joined mark is a call: `*` would be text there.
    expect(run("un#strong[be]«liev»able", bold)).toBe("un#strong[be«liev»]able");
    // A colour next to the same colour, not next to another.
    const blue = run(`Some #text(fill: ${RED})[b«ol»d] text`, colour(BLUE)) as string;
    expect(blue).toBe(`Some #text(fill: ${RED})[b]#text(fill: ${BLUE})[«ol»]#text(fill: ${RED})[d] text`);
    expect(run(blue, colour(RED))).toBe(`Some #text(fill: ${RED})[b«ol»d] text`);
    // Italic beside italic's delimiter is a call (`_a__b_` isn't two pieces), then one piece.
    expect(run("Some _a_ «b» text", italic)).toBe("Some _a_ _«b»_ text");
    expect(run("Some _a_«,» text", italic)).toBe("Some _a«,»_ text");
  });

  it("keep a `_` or `*` mark a mark where one comes off around it: between letters it is a call", () => {
    expect(run("un#strong[«_be_»]lievable", bold)).toBe("un«#emph[be]»lievable");
    expect(run("un#underline[«*be*»]lievable", underline)).toBe("un«#strong[be]»lievable");
    expect(run(`un#text(fill: ${RED})[«_be_»]lievable`, colour(null))).toBe("un«#emph[be]»lievable");
    expect(run('un#text(font: "Lora")[«_be_»]lievable', setFont(null))).toBe("un«#emph[be]»lievable");
    expect(run("#strong[«_b_]#strong[c»] d", bold)).toBe("«#emph[b]c» d");
    expect(run("un#strong[b«e»]_lievable_ x", bold)).toBe("un#strong[b]«e»#emph[lievable] x");
    // Bold over more than has it: off, then on all of it.
    expect(run("un«#strong[_be_]liev»able", bold)).toBe("un#strong[«#emph[be]liev»]able");
    // Next to a space it stays as written.
    expect(run("Some #strong[«_bold_»] text", bold)).toBe("Some «_bold_» text");
    // One cut with the mark is calls: a piece of it can end between letters.
    expect(run("un#underline[_b«e»_]lievable", underline)).toBe("un#underline[#emph[b]]#emph[«e»]lievable");
    expect(run("un#underline[«_b»e_]lievable", underline)).toBe("un«#emph[b»]#underline[#emph[e]]lievable");
    expect(run("un#strong[_b‸e_]lievable", bold)).toBe("un#strong[#emph[b]]#emph[‸]#strong[#emph[e]]lievable");
  });
});

describe("fonts", () => {
  const lora = setFont("Lora");
  const off = setFont(null);

  it("wrap a selection in a text call, and change or drop one that is there", () => {
    expect(run("Hello «world» again", lora)).toBe('Hello #text(font: "Lora")[«world»] again');
    expect(run('Hello #text(font: "Inter")[«world»] again', lora)).toBe('Hello #text(font: "Lora")[«world»] again');
    expect(run('Hello #text(font: "Inter")[«world»] again', off)).toBe("Hello «world» again");
    expect(run('A #text(font: "Inter")[b«c»d] e', lora)).toBe(
      'A #text(font: "Inter")[b]#text(font: "Lora")[«c»]#text(font: "Inter")[d] e',
    );
    // A family's name is a string, whatever is in it.
    expect(run("«a» b", setFont('A "B"'))).toBe('#text(font: "A \\"B\\"")[«a»] b');
  });

  it("join a text call that styles the same text otherwise", () => {
    expect(run("Hello #text(size: 14pt)[«world»] again", lora)).toBe(
      'Hello #text(size: 14pt, font: "Lora")[«world»] again',
    );
    expect(run('A #text(font: "Lora")[«b»] c', setMark({ name: "text", arg: "size" }, "14pt"))).toBe(
      'A #text(font: "Lora", size: 14pt)[«b»] c',
    );
    // Not a call with something else in front of its text (`#text(red)[…]` stays as written).
    expect(run("A #text(red)[«b»] c", lora)).toBe('A #text(red)[#text(font: "Lora")[«b»]] c');
  });

  it("set the document's font when everything it shows is selected", () => {
    expect(run("«= Title\n\nHello world\n»", lora)).toBe('#set text(font: "Lora")\n\n«= Title\n\nHello world\n»');
    // After its imports and rules, before its template, whose fields aren't the document's text.
    expect(run('#import "@preview/x:1.0.0": *\n#show: exam.with(title: [T])\n\n«= Title\n\nHello»', lora)).toBe(
      '#import "@preview/x:1.0.0": *\n#set text(font: "Lora")\n#show: exam.with(title: [T])\n\n«= Title\n\nHello»',
    );
    expect(run("«#show: exam.with(title: [T])\n\nHello»", lora)).toBe(
      '#set text(font: "Lora")\n«#show: exam.with(title: [T])\n\nHello»',
    );
    expect(run("#set text(size: 12pt)\n\n«Hello»", lora)).toBe(
      '#set text(size: 12pt)\n#set text(font: "Lora")\n\n«Hello»',
    );
    // Part of it is a passage's font.
    expect(run("= Title\n\n«Hello world»", lora)).toBe('= Title\n\n#text(font: "Lora")[«Hello world»]');
  });

  it("change the rule the document has, and leave no passage a font of its own", () => {
    expect(run('#set text(font: "Inter")\n\n«= Title\n\nHello #text(font: "Kalam")[you]»', lora)).toBe(
      '#set text(font: "Lora")\n\n«= Title\n\nHello you»',
    );
    expect(run('#set text(font: "Inter", size: 12pt)\n#set text(size: 11pt, font: ("A", "B"))\n\n«Hello»', lora)).toBe(
      '#set text(font: "Lora", size: 12pt)\n#set text(size: 11pt)\n\n«Hello»',
    );
  });

  it("take the rule away for the default font", () => {
    expect(run('#set text(font: "Inter")\n\n«= Title\n\nHello»', off)).toBe("«= Title\n\nHello»");
    expect(run('#set page(margin: 2cm)\n#set text(font: "Inter")\n\n«Hello»', off)).toBe(
      "#set page(margin: 2cm)\n\n«Hello»",
    );
    expect(run('#set text(font: "Inter", size: 12pt)\n\n«Hello»', off)).toBe("#set text(size: 12pt)\n\n«Hello»");
    expect(run("«Hello»", off)).toBe(null);
  });

  it("are read at the selection: a passage's, else the document's", () => {
    expect(fontAt(state("Hello ‸world"))).toBe(null);
    expect(fontAt(state('A #text(font: "Inter")[b‸c] d'))).toBe("Inter");
    expect(fontAt(state('#set text(font: "Lora")\n\nA #text(font: "Inter")[bc] ‸d'))).toBe("Lora");
    expect(fontAt(state('#set text(font: ("Lora", "Noto Sans"))\n\nA‸'))).toBe("Lora");
    // More than one in the selection: none to show.
    expect(fontAt(state('#set text(font: "Lora")\n\n«A #text(font: "Inter")[bc] d»'))).toBe(null);
    // A rule inside a component is that component's.
    expect(fontAt(state('#block[#set text(font: "Lora")\nx]\n\nA‸'))).toBe(null);
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
    // A caret in a list: the whole list changes kind, as in a word processor.
    expect(run("- On‸e\n- Two", toggleList("enum"))).toBe("+ On‸e\n+ Two");
    expect(run("Intro\n\n- On‸e\n- Two\n\nAfter", toggleList("enum"))).toBe("Intro\n\n+ On‸e\n+ Two\n\nAfter");
  });

  it("align the blocks around a list, not the list (its numbers would stay at the margin)", () => {
    const out = (run("«Para\n\n- a\n- b\n\nEnd»", setAlignment("center")) ?? "").replace(/[«»]/g, "");
    expect(out).toBe("#align(center)[Para]\n\n- a\n- b\n\n#align(center)[End]");
    expect(run("- «a\n- b»", setAlignment("center"))).toBe(null);
  });

  it("leave a centred paragraph's alignment when it becomes a list", () => {
    expect(run("#align(center)[Some te‸xt]", toggleList("list"))).toBe("- Some te‸xt");
  });

  it("keep headings when a selection around them becomes a list", () => {
    expect(run("«One\n\n== Head\n\nTwo»", toggleList("list"))).toBe("- «One\n\n== Head\n\n- Two»");
  });

  it("are read from the source", () => {
    // Text in a mark or a cell is a paragraph's.
    expect(blockType(state("Some #strong[bo‸ld] text"))).toEqual({ kind: "paragraph" });
    expect(blockType(state("#table(columns: 2, [a‸], [b])"))).toEqual({ kind: "paragraph" });
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

describe("block types where a block has no text, or the caret is past it", () => {
  const h3 = setBlockType({ kind: "heading", level: 3 });
  const para = setBlockType({ kind: "paragraph" });

  it("reads the type of an empty heading or item, the caret after its marker", () => {
    expect(blockType(state("== ‸"))).toEqual({ kind: "heading", level: 2 });
    expect(blockType(state("Text.\n\n- ‸\n\nMore."))).toEqual({ kind: "list" });
    expect(blockType(state("- one\n+ ‸"))).toEqual({ kind: "enum" });
    expect(blockType(state("Hello ‸"))).toEqual({ kind: "paragraph" });
  });

  it("changes an empty heading or item, and never writes a second marker", () => {
    expect(run("== ‸", h3)).toBe("=== ‸");
    expect(run("== ‸", para)).toBe("‸");
    expect(run("== ‸\n\nText", toggleList("list"))).toBe("- ‸\n\nText");
    expect(run("- ‸", toggleList("list"))).toBe("‸");
    expect(run("- ‸", toggleList("enum"))).toBe("+ ‸");
    expect(run("- one\n- ‸", h3)).toBe("- one\n\n=== ‸");
    expect(run("- one\n- ‸", toggleList("enum"))).toBe("+ one\n+ ‸");
    // Nothing to align yet.
    expect(run("== ‸", setAlignment("center"))).toBe(null);
  });

  it("takes the caret after a block's last space for the block's", () => {
    expect(run("Hello ‸", h3)).toBe("=== Hello ‸");
    expect(run("Hello ‸\n\nMore", toggleList("list"))).toBe("- Hello ‸\n\nMore");
    expect(run("Hello ‸", setAlignment("center"))).toBe("#align(center)[Hello ‸]");
    expect(run("- one ‸\n- two", h3)).toBe("=== one ‸\n\n- two");
    expect(run("#table(columns: 2, [a ‸], [b])", toggleList("list"))).toBe("#table(columns: 2, [- a ‸], [b])");
  });

  it("changes an item nested in another alone, and its list with it", () => {
    expect(run("- one\n  - tw‸o\n- three", toggleList("enum"))).toBe("- one\n  + tw‸o\n- three");
    expect(run("+ one\n  - two\n  - th‸ree\n+ four", toggleList("enum"))).toBe("+ one\n  + two\n  + th‸ree\n+ four");
    expect(run("- one\n  - ‸\n- three", toggleList("enum"))).toBe("- one\n  + ‸\n- three");
    // Out of the list it is a paragraph of the item it was nested in.
    expect(run("- one\n  - tw‸o\n- three", toggleList("list"))).toBe("- one\n\n  tw‸o\n\n- three");
  });

  it("keeps the items nested in an item on their lines when the item changes", () => {
    expect(run("- o‸ne\n  - two\n- three", toggleList("enum"))).toBe("+ o‸ne\n  - two\n+ three");
    expect(run("- o‸ne\n  - two\n- three", h3)).toBe("=== o‸ne\n  - two\n\n- three");
    expect(run("- o‸ne\n  more\n  - two", h3)).toBe("=== o‸ne more\n  - two");
  });
});

describe("components", () => {
  it("set, change and remove a named argument", () => {
    const s = state("#question[Wh‸at?]");
    const q = componentAt(s, s.from);
    expect(q?.name).toBe("question");
    const added = run("#question[Wh‸at?]", (st) =>
      setArgument(the(componentAt(st, st.from)), "points", "2")(st),
    ) as string;
    expect(added).toBe("#question(points: 2)[Wh‸at?]");
    expect(argumentOf(state(added), the(componentAt(state(added), 15)), "points")).toBe("2");
    const changed = run(added, (st) => setArgument(the(componentAt(st, st.from)), "points", "5")(st)) as string;
    expect(changed).toBe("#question(points: 5)[Wh‸at?]");
    expect(run(changed, (st) => setArgument(the(componentAt(st, st.from)), "points", null)(st))).toBe(
      "#question[Wh‸at?]",
    );
  });

  it("give a new argument a line of its own in a call written an argument a line", () => {
    const set = (doc: string, value: string | null) =>
      run(doc, (st) => setArgument(the(componentAt(st, st.from + 1)), "points", value)(st));
    const rows = "‸#rubric(\n  ([A], [a]),\n  ([B], [b])";
    expect(set(`${rows},\n)`, "(2, 1)")).toBe(`${rows},\n  points: (2, 1),\n)`);
    expect(set(`${rows}\n)`, "(2, 1)")).toBe(`${rows},\n  points: (2, 1),\n)`);
    // And takes the line away with it.
    expect(set(`${rows},\n  points: (2, 1),\n)`, null)).toBe(`${rows},\n)`);
    expect(set(`${rows},\n  points: (2, 1),\n  levels: ([X], [Y]),\n)`, null)).toBe(
      `${rows},\n  levels: ([X], [Y]),\n)`,
    );
    // On one line, as before.
    expect(set("‸#rubric(([A], [a]), ([B], [b]))", "none")).toBe("‸#rubric(([A], [a]), ([B], [b]), points: none)");
    expect(set("‸#rubric(([A], [a]), points: none, levels: ([X],))", null)).toBe(
      "‸#rubric(([A], [a]), levels: ([X],))",
    );
  });

  it("are inserted as a block after the caret's paragraph, or on its empty line", () => {
    expect(run("First paragraph.‸\n\nNext.", insertBlock("#question[{{cursor}}]"))).toBe(
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
      "#table(\n  columns: 2,\n  table.header([A], [B]),\n  [a1], [b1],\n  [a2], [b2],\n  [~], [‸~],\n)",
    );
    expect(run(table, addColumn("left"))).toBe(
      "#table(\n  columns: 3,\n  table.header([A], [~], [B]),\n  [a1], [~], [b1],\n  [a2], [‸~], [b2],\n)",
    );
  });

  it("lose rows and columns", () => {
    expect(run(table, deleteRow)).toBe("#table(\n  columns: 2,\n  table.header([A], [B]),\n  [a1], [‸b1],\n)");
    expect(run(table, deleteColumn)).toBe("#table(\n  columns: 1,\n  table.header([A]),\n  [a1],\n  [‸a2],\n)");
  });

  it("keep column sizes", () => {
    const sized = "#table(columns: (1fr, 2fr), [a], [b‸])";
    expect(run(sized, addColumn("right"))).toBe("#table(\n  columns: (1fr, 2fr, 2fr),\n  [a], [b], [‸~],\n)");
  });

  it("are inserted from a template", () => {
    expect(run("Text‸", insertBlock(tableTemplate(2, 2)))).toBe(
      "Text\n\n#table(\n  columns: (1fr, 1fr),\n  table.header([‸~], [~]),\n  [~], [~],\n)",
    );
  });
});

describe("links", () => {
  it("wrap a selection, change their URL and come off", () => {
    const linked = run("See «the site» now", setLink("https://example.org")) as string;
    expect(linked).toBe('See #link("https://example.org")[«the site»] now');
    expect(linkAt(state(linked))).toBe("https://example.org");
    expect(run(linked, setLink("https://typst.app"))).toBe('See #link("https://typst.app")[«the site»] now');
    expect(run(linked, setLink(null))).toBe("See «the site» now");
  });

  it("come off whole from a caret in them, and show at a caret", () => {
    const linked = 'See #link("https://example.org")[the s‸ite] now';
    expect(linkAt(state(linked))).toBe("https://example.org");
    expect(run(linked, setLink(null))).toBe("See the s‸ite now");
  });

  it("get the scheme they need", () => {
    expect(run("«here»", setLink("example.com"))).toBe('#link("https://example.com")[«here»]');
    expect(run("«mail»", setLink("ada@example.org"))).toBe('#link("mailto:ada@example.org")[«mail»]');
    expect(run("«page»", setLink("#top"))).toBe('#link("#top")[«page»]');
  });

  it("write the URL as the text at a caret", () => {
    expect(run("Go ‸", setLink("https://x.org/a_b"))).toBe('Go #link("https://x.org/a_b")[https:\\/\\/x.org\\/a\\_b]‸');
  });

  it("refuse a target that would run code", () => {
    for (const url of [
      "javascript:alert(1)",
      " JavaScript:alert(1)",
      "java\tscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
    ]) {
      expect(setLink(url)(state("every «question» in"))).toBeNull();
      expect(setLink(url)(state("every que‸stion in"))).toBeNull();
      expect(setLink(url)(state("every ‸ in"))).toBeNull();
      expect(setLink(url)(state('every #link("https://example.org")[que‸stion] in'))).toBeNull();
    }
    // A word that only starts like one is a host.
    expect(run("«here»", setLink("database.example.com"))).toBe('#link("https://database.example.com")[«here»]');
  });

  it("make the word a caret is in the link's text", () => {
    const link = setLink("example.com");
    expect(run("every que‸stion in", link)).toBe('every #link("https://example.com")[que‸stion] in');
    expect(run("every *que‸stion* in", link)).toBe('every *#link("https://example.com")[que‸stion]* in');
    expect(run("- one tw‸o three", link)).toBe('- one #link("https://example.com")[tw‸o] three');
    expect(run("= A bi‸g title", link)).toBe('= A #link("https://example.com")[bi‸g] title');
    expect(run("#table(columns: 2, [a bb‸b c], [d])", link)).toBe(
      '#table(columns: 2, [a #link("https://example.com")[bb‸b] c], [d])',
    );
    // Between words, and where there is no word, the URL is the text.
    expect(run("every ‸question in", link)).toBe(
      'every #link("https://example.com")[https:\\/\\/example.com]‸question in',
    );
    expect(run("every question‸ in", link)).toBe(
      'every question#link("https://example.com")[https:\\/\\/example.com]‸ in',
    );
    expect(run("‸", link)).toBe('#link("https://example.com")[https:\\/\\/example.com]‸');
  });

  it("leave a `_` mark a mark where its link goes from around it between letters", () => {
    const off = setLink(null);
    expect(run('un#link("https://example.org")[_b‸e_]lievable', off)).toBe("un#emph[b‸e]lievable");
    expect(run('un#link("https://example.org")[«_be_»]lievable', off)).toBe("un«#emph[be]»lievable");
    expect(run('un#link("https://example.org")[_b«e»_]lievable', off)).toBe(
      'un#link("https://example.org")[#emph[b]]#emph[«e»]lievable',
    );
  });
});
