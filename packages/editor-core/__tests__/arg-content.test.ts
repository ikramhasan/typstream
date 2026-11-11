// A click on what an argument written as code shows (#36): a formula among a multiple choice's
// options, a string option, an equation, an answer. `argAsContent` writes the argument as the
// content that shows the same, so it is edited as content is. Results are checked with Typst's parser.
import { hasErrors, parse } from "@typstream/syntax";
import { beforeAll, describe, expect, it } from "vitest";
import { argAsContent, argsAsContent, componentIn, enterArg, moveArg, removeArg, schemaOf } from "../src/index";
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
      { name: "ce", label: "Chemical formula", inline: true },
      { name: "answer-lines", label: "Lines" },
      { name: "student-info", label: "Student details" },
    ],
  },
]);

/** The document after a click on its first `needle` (`delta` characters into it). */
const click = (text: string, needle: string, delta = 0, caret = delta): string | null => {
  const s = state(`‸${text}`);
  const at = text.indexOf(needle);
  expect(at, needle).toBeGreaterThanOrEqual(0);
  const tr = argAsContent(at + delta, at + caret)(s, schema);
  if (!tr) return null;
  const after = s.apply(tr).state;
  expect(hasErrors(parse(after.text)), after.text).toBe(false);
  return show(after);
};

describe("a formula among a multiple choice's options", () => {
  const doc = '#mcq(ce("H2 + O2 -> H2O"), ce("2H2 + O2 -> 2H2O"), ce("H2 + 2O2 -> 2H2O"), answer: 2)';

  it("is selected, as content, when clicked: the others become content too", () => {
    expect(click(doc, "2H2 + O2", 3)).toBe(
      '#mcq([#ce("H2 + O2 -> H2O")], [[[#ce("2H2 + O2 -> 2H2O")]]], [#ce("H2 + 2O2 -> 2H2O")], answer: 2)',
    );
  });

  it("is then a component of its own, with its form", () => {
    const s = state(`‸${doc}`);
    const tr = argAsContent(doc.indexOf("H2 + O2"))(s, schema);
    const after = s.apply(tr ?? { edits: [] }).state;
    const c = componentIn(after, after.from, after.to, schema);
    expect(c?.name).toBe("ce");
    expect(after.text.slice(after.from, after.to)).toBe('#ce("H2 + O2 -> H2O")');
  });

  it("and the keys of a list's items work from it: Tab to the next, Enter a new one", () => {
    const s = state(`‸${doc}`);
    const opened = s.apply(argAsContent(doc.indexOf("H2 + O2"))(s, schema) ?? { edits: [] }).state;
    // The caret after the formula, in its item.
    const inItem = opened.select({ anchor: opened.to, head: opened.to });
    const next = inItem.apply(moveArg(1)(inItem, schema) ?? { edits: [] }).state;
    expect(show(next)).toContain('[«#ce("2H2 + O2 -> 2H2O")»]');
    const added = inItem.apply(enterArg(inItem, schema) ?? { edits: [] }).state;
    expect(show(added)).toBe(
      '#mcq([#ce("H2 + O2 -> H2O")], [‸~], [#ce("2H2 + O2 -> 2H2O")], [#ce("H2 + 2O2 -> 2H2O")], answer: 3)',
    );
  });

  it("is left as it is in content: nothing to rewrite", () => {
    expect(click('#mcq([#ce("H2")], [#ce("O2")])', "H2")).toBeNull();
    expect(click('#ce("H2O")', "H2O")).toBeNull();
    expect(click('Water is #ce("H2O").', "H2O")).toBeNull();
  });

  it("inside a question's text", () => {
    expect(click('#question(points: 1)[Which?\n  #mcq(ce("H2"), ce("O2"))\n]', "O2")).toBe(
      '#question(points: 1)[Which?\n  #mcq([#ce("H2")], [[[#ce("O2")]]])\n]',
    );
  });
});

describe("a list's items written as strings and equations", () => {
  it("a string becomes its text, the caret where it was clicked", () => {
    expect(click('#mcq("Water", "Salt", answer: 1)', "Salt", 0, 2)).toBe("#mcq([Water], [Sa‸lt], answer: 1)");
  });

  it("with what markup would read as more than text escaped, and quotes left straight", () => {
    expect(click('#mcq("x_1 * 2", "it\'s #1")', "x_1")).toBe("#mcq([‸x\\_1 \\* 2], [it\\'s \\#1])");
  });

  it("a string with escapes: the caret at its end", () => {
    expect(click('#mcq("say \\"hi\\"", "b")', "say")).toBe('#mcq([say \\"hi\\"‸], [b])');
  });

  it("an equation is selected", () => {
    expect(click("#mcq($x^2$, $2x$, answer: 2)", "2x")).toBe("#mcq([$x^2$], [[[$2x$]]], answer: 2)");
  });

  it("a mix, with content items left alone", () => {
    expect(click('#mcq([One], "Two", ce("H2"), 4)', "Two", 1)).toBe('#mcq([One], [T‸wo], [#ce("H2")], 4)');
  });

  it("a number or a variable isn't content: nothing", () => {
    expect(click("#mcq(1, 2)", "2")).toBeNull();
    expect(click("#mcq(first, second)", "second")).toBeNull();
  });

  it("a string with a line break stays: content would read it as a space", () => {
    expect(click('#mcq("a\\nb", "c")', "a")).toBeNull();
  });
});

describe("a component among another's arguments", () => {
  it("a named one: the answer's formula", () => {
    expect(click('#answer-lines(count: 1, answer: ce("H2O"))', "H2O")).toBe(
      '#answer-lines(count: 1, answer: [[[#ce("H2O")]]])',
    );
  });

  it("only components: another call's strings stay code", () => {
    expect(click('#student-info("name", "class")', "class")).toBeNull();
    expect(click('#answer-lines(answer: upper("abc"))', "abc")).toBeNull();
    expect(click('#answer-lines(count: 1, answer: "Water")', "Water")).toBeNull();
  });

  it("the innermost, through calls that aren't components", () => {
    expect(click('#answer-lines(answer: text(fill: red, ce("H2O")))', "H2O")).toBe(
      '#answer-lines(answer: text(fill: red, [[[#ce("H2O")]]]))',
    );
  });

  it("not a call of an equation's", () => {
    expect(click('The value $ce("H2O") + 1$ here', "H2O")).toBeNull();
    expect(click('#answer-lines(answer: $ce("H2O")$)', "H2O")).toBeNull();
  });
});

/** The document after a click on the component at its first `needle`, shown whole. */
const whole = (text: string, needle = "#"): string | null => {
  const s = state(`‸${text}`);
  const tr = argsAsContent(text.indexOf(needle))(s, schema);
  if (!tr) return null;
  const after = s.apply(tr).state;
  expect(hasErrors(parse(after.text)), after.text).toBe(false);
  return show(after);
};

describe("a click on a component whose arguments its package draws", () => {
  // Typst's pages don't say where `ce("H2")` or "Water" went (the package's glyphs): all of them
  // become content, the component selected, and the pages of that text say which was clicked.
  it("formulas among a list's items all become content, the component still selected", () => {
    expect(whole('#mcq(ce("H2 + O2 -> H2O"), ce("2H2 + O2 -> 2H2O"), answer: 2)')).toBe(
      '[[#mcq([#ce("H2 + O2 -> H2O")], [#ce("2H2 + O2 -> 2H2O")], answer: 2)]]',
    );
  });

  it("a list's strings and equations too; content, numbers and variables stay", () => {
    expect(whole('#mcq("Yes", "No")')).toBe("[[#mcq([Yes], [No])]]");
    expect(whole('#mcq([One], "it\'s", $x^2$, ce("H2"), 4, other, answer: 1)')).toBe(
      '[[#mcq([One], [it\\\'s], [$x^2$], [#ce("H2")], 4, other, answer: 1)]]',
    );
  });

  it("a named argument's component, and one inside a call that isn't a component", () => {
    expect(whole('#answer-lines(count: 1, answer: ce("NaCl"))')).toBe(
      '[[#answer-lines(count: 1, answer: [#ce("NaCl")])]]',
    );
    expect(whole('#answer-lines(answer: text(fill: red, ce("H2O")))')).toBe(
      '[[#answer-lines(answer: text(fill: red, [#ce("H2O")]))]]',
    );
  });

  it("the outermost only: a component in a component's arguments is one argument", () => {
    expect(whole('#mcq(mcq(ce("H2"), "b"), "c")')).toBe('[[#mcq([#mcq(ce("H2"), "b")], [c])]]');
  });

  it("not a list's own strings where it isn't a list: they are names, not text", () => {
    expect(whole('#student-info("name", "class")')).toBeNull();
    expect(whole('#answer-lines(count: 1, answer: "Water")')).toBeNull();
  });

  it("nothing where the arguments are content already, or equations' calls", () => {
    expect(whole('#mcq([#ce("H2")], [Water], answer: 1)')).toBeNull();
    expect(whole('#answer-lines(answer: $ce("H2O")$)')).toBeNull();
    expect(whole("#question(points: 2)[Which?]")).toBeNull();
  });

  it("the component in a question's text, not the question", () => {
    const doc = '#question(points: 1)[Which?\n  #mcq(ce("H2"), ce("O2"))\n]';
    expect(whole(doc, "#mcq")).toBe('#question(points: 1)[Which?\n  [[#mcq([#ce("H2")], [#ce("O2")])]]\n]');
    // The question's own arguments hold no component written as code.
    expect(whole(doc)).toBeNull();
  });

  it("a call in code isn't a component shown whole: nothing", () => {
    expect(whole('#mcq(mcq(ce("H2")))', "mcq(ce")).toBeNull();
    expect(whole('#let x = mcq(ce("H2"))', "mcq")).toBeNull();
  });
});

describe("a component's rows (a rubric's criteria)", () => {
  const rubric = schemaOf([{ key: "t", components: [{ name: "rubric", label: "Rubric", rows: true }] }]);
  const press = (marked: string, command: typeof removeArg): string | null => {
    const s = state(marked);
    const tr = command(s, rubric);
    if (!tr) return null;
    const after = s.apply(tr).state;
    expect(hasErrors(parse(after.text)), after.text).toBe(false);
    return show(after);
  };
  const two = "#rubric(\n  ([Thesis], [Clear], [Vague]),\n  ([Evidence], [Strong], [Thi‸n]),\n  points: (2, 1),\n)";

  it("Tab past the last cell of the last row adds a row of empty cells, set apart as the rows are", () => {
    expect(press(two, moveArg(1))).toBe(
      "#rubric(\n  ([Thesis], [Clear], [Vague]),\n  ([Evidence], [Strong], [Thin]),\n  ([‸~], [~], [~]),\n  points: (2, 1),\n)",
    );
    expect(press("#rubric(([Thesis], [Cle‸ar]))", moveArg(1))).toBe("#rubric(([Thesis], [Clear]), ([‸~], [~]))");
    expect(press("#rubric(([The‸sis],))", moveArg(1))).toBe("#rubric(([Thesis],), ([‸~],))");
  });

  it("Tab elsewhere goes to the next cell, through the rows", () => {
    expect(press("#rubric(([Thesis], [Cle‸ar]), ([Evidence], [Strong]))", moveArg(1))).toBe(
      "#rubric(([Thesis], [Clear]), ([«Evidence»], [Strong]))",
    );
    // Level names written before the rows are cells too: from the last, the first row.
    expect(press("#rubric(levels: ([Good], [Fa‸ir]), ([Thesis], [Clear], [Vague]))", moveArg(1))).toBe(
      "#rubric(levels: ([Good], [Fair]), ([«Thesis»], [Clear], [Vague]))",
    );
  });

  it("Backspace in an empty row's first cell removes the row", () => {
    expect(press("#rubric(\n  ([Thesis], [Clear]),\n  ([‸~], [~]),\n)", removeArg)).toBe(
      "#rubric(\n  ([Thesis], [Clear‸]),\n)",
    );
    // Not the only row, not one with text, not from another cell.
    expect(press("#rubric(([‸~], [~]))", removeArg)).toBeNull();
    expect(press("#rubric(([Thesis], [Clear]), ([‸~], [Vague]))", removeArg)).toBeNull();
    expect(press("#rubric(([Thesis], [Clear]), ([~], [‸~]))", removeArg)).toBeNull();
  });

  it("a multiple choice in a rubric's cell keeps its own keys", () => {
    const both = schemaOf([
      {
        key: "t",
        components: [
          { name: "rubric", label: "Rubric", rows: true },
          { name: "mcq", label: "Multiple choice", list: true },
        ],
      },
    ]);
    const s = state("#rubric(([Thesis], [#mcq([One], [Tw‸o])]))");
    const tr = moveArg(1)(s, both);
    expect(show(s.apply(tr ?? { edits: [] }).state)).toBe("#rubric(([Thesis], [#mcq([One], [Two], [‸~])]))");
  });
});
