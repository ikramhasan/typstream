// What the toolbars and forms are made of, without a browser: every icon the editor's own plugins
// and edu's and mindmap's components name is one the toolbar draws, and form fields write Typst that
// reads back as what was typed.
import { readFileSync } from "node:fs";
import type { EditorParamSpec } from "@typstream/core";
import {
  basicPlugins,
  componentIn,
  DEFAULT_SCHEMA,
  EditorState,
  fromTypstreamPlugin,
  insertText,
  matchesShortcut,
  schemaOf,
  type ToolbarItem,
} from "@typstream/editor-core";
import { edu } from "@typstream/edu";
import { mindmap } from "@typstream/mindmap";
import { loadSyntax } from "@typstream/syntax";
import { beforeAll, describe, expect, it } from "vitest";
import { hasIcon } from "../src/icons";
import { moveHighlight, rank, slashQuery, slashSession } from "../src/insert";
import {
  display,
  formulaProblem,
  isRich,
  listItems,
  plainText,
  quoteUnknown,
  setValue,
  source,
  whileTyping,
} from "../src/panels";
import { shortcutLabel } from "../src/ui";

const icons = (items: readonly ToolbarItem[]): string[] =>
  items.flatMap((i) => [...(i.icon ? [i.icon] : []), ...icons(i.items ?? [])]);

describe("toolbar items", () => {
  it("name icons the toolbar draws", () => {
    const plugins = [...basicPlugins, fromTypstreamPlugin(edu), fromTypstreamPlugin(mindmap)].filter((p) => p !== null);
    const names = plugins.flatMap((p) => [
      ...icons(p.toolbar ?? []),
      ...icons(p.floating ?? []),
      ...(p.insert ?? []).flatMap((i) => (i.icon ? [i.icon] : [])),
      ...(p.components ?? []).flatMap((c) => (c.icon ? [c.icon] : [])),
    ]);
    expect(names.length).toBeGreaterThan(30);
    expect(names.filter((n) => !hasIcon(n))).toEqual([]);
  });

  it("put edu's and mindmap's components in the insert menu, by group", () => {
    const items = [fromTypstreamPlugin(edu), fromTypstreamPlugin(mindmap)].flatMap((p) => p?.insert ?? []);
    expect(items.map((i) => i.label)).toContain("Question");
    expect(items.map((i) => i.label)).toContain("Mind map");
    expect(new Set(items.map((i) => i.group))).toEqual(new Set(["Questions", "Answers", "Blocks", "Drawings"]));
  });

  it("name every component a bar can be on in the teacher's words", () => {
    const specs = [...basicPlugins, fromTypstreamPlugin(edu)].flatMap((p) => p?.components ?? []);
    const label = (name: string) => specs.find((c) => c.name === name)?.label;
    expect(label("line")).toBe("Divider");
    expect(label("pagebreak")).toBe("Page break");
    expect(label("table")).toBe("Table");
    expect(label("ce")).toBe("Chemical formula");
    // A formula's settings: its text, the call's first argument (a parameter named by its place).
    const ce = specs.find((c) => c.name === "ce");
    expect(ce?.icon).toBe("flask-conical");
    expect(ce?.params).toMatchObject([{ name: "0", label: "Formula", type: "text" }]);
  });

  it("write shortcuts as the platform does", () => {
    expect(shortcutLabel("Mod-Shift-x")).toMatch(/^(Ctrl\+Shift\+X|⌘⇧X|⇧⌘X|⌘⇧X)$/u);
    expect(shortcutLabel(undefined)).toBeUndefined();
  });
});

describe("form fields", () => {
  const field = (type: EditorParamSpec["type"]): EditorParamSpec => ({ name: "x", label: "X", type });

  it("write Typst for what is typed, and read it back", () => {
    for (const [type, typed, typst] of [
      ["number", "2.5", "2.5"],
      ["text", 'He said "hi"', '"He said \\"hi\\""'],
      ["content", "a *b*", "[a \\*b\\*]"],
      ["length", "2cm", "2cm"],
      ["color", "#dc2626", 'rgb("#dc2626")'],
    ] as const) {
      expect(source(field(type), typed), type).toBe(typst);
      expect(display(field(type), typst), type).toBe(typed);
    }
  });

  it("leave an empty field's argument out, and don't write what isn't valid", () => {
    expect(source(field("number"), "")).toBeNull();
    expect(source(field("number"), "two")).toBeUndefined();
    // A size without a unit takes the default's unit, or centimetres.
    expect(source(field("length"), "2")).toBe("2cm");
    expect(source({ ...field("length"), default: "3em" }, "2")).toBe("2em");
    // A decimal comma is a decimal point, with a unit too.
    expect(source(field("length"), "1,5")).toBe("1.5cm");
    expect(source(field("length"), "1,5 cm")).toBe("1.5cm");
    expect(source({ ...field("length"), default: "4em" }, "2,5mm")).toBe("2.5mm");
    expect(source(field("length"), "1,5,2cm")).toBeUndefined();
    for (const size of ["0cm", "-2cm", "2 apples", "5000cm", "2000pt"])
      expect(source(field("length"), size), size).toBeUndefined();
    // Out of range: not written (the fifth of three options, negative points).
    const option = { ...field("number"), min: 1 };
    expect(source(option, "2", 3)).toBe("2");
    expect(source(option, "5", 3)).toBeUndefined();
    expect(source(option, "0", 3)).toBeUndefined();
    expect(source({ ...field("number"), min: 0 }, "-1")).toBeUndefined();
  });

  it("write a count only as a whole number in its range", () => {
    const count = { ...field("number"), min: 1, max: 30, step: 1 };
    expect(source(count, "30")).toBe("30");
    for (const typed of ["2.5", "31", "0", "-3", "1e3", "abc", "2."])
      expect(source(count, typed), typed).toBeUndefined();
    // A measure takes a fraction, and a decimal comma.
    const measure = { ...field("number"), min: 0.01, step: 0.5 };
    expect(source(measure, "2.5")).toBe("2.5");
    expect(source(measure, "2,5")).toBe("2.5");
    expect(source(measure, "0")).toBeUndefined();
  });
});

describe("an argument that is more than plain text", () => {
  beforeAll(() => loadSyntax(readFileSync(new URL("../../syntax/wasm/syntax_bg.wasm", import.meta.url))));
  const content: EditorParamSpec = { name: "answer", label: "Answer", type: "content" };
  const text: EditorParamSpec = { name: "title", label: "Title", type: "text" };

  it("is told from one a field can show and write back", () => {
    for (const plain of ["[two moles]", "[a \\* b]", '"two moles"', "none", "[]"]) {
      expect(isRich(content, plain), plain).toBe(false);
    }
    expect(isRich(text, '"A title"')).toBe(false);
    expect(isRich(content, null)).toBe(false);
    for (const rich of ["[*two* moles]", '[#ce("H2O")]', "[$x^2$]", 'ce("H2O")', "[a #h(1cm) b]", "[one \\ two]"]) {
      expect(isRich(content, rich), rich).toBe(true);
    }
    expect(isRich(text, "upper(name)")).toBe(true);
    expect(isRich({ ...content, type: "number" }, "1 + 1")).toBe(false);
  });

  it("is read as its words, never as Typst", () => {
    expect(plainText('[*two* moles of #ce("H2O")]')).toBe("two moles of H2O");
    expect(plainText('ce("2H2 + O2 -> 2H2O")')).toBe("2H2 + O2 -> 2H2O");
    expect(plainText("[$x^2$ and _more_]")).toBe("x2 and more");
  });
});

describe("a list field (a rubric's levels and points)", () => {
  beforeAll(() => loadSyntax(readFileSync(new URL("../../syntax/wasm/syntax_bg.wasm", import.meta.url))));
  const levels: EditorParamSpec = { name: "levels", label: "Levels", type: "list", columnsFrom: 1 };
  const points: EditorParamSpec = { name: "points", label: "Points", type: "list", item: "number" };

  it("writes a line of the field as an item, and reads the items back as lines", () => {
    expect(source(levels, "Excellent\n  Good \n\nFair")).toBe("([Excellent], [Good], [Fair])");
    expect(display(levels, "([Excellent], [Good], [Fair])")).toBe("Excellent\nGood\nFair");
    // Strings, as a model writes them, and what markup would read as more than text.
    expect(display(levels, '("Excellent", "Good")')).toBe("Excellent\nGood");
    expect(source(levels, "A*\n#1")).toBe("([A\\*], [\\#1])");
    expect(display(levels, "([A\\*], [\\#1])")).toBe("A*\n#1");
    // One item is still a list (`([Pass])` would be the content alone).
    expect(source(levels, "Pass")).toBe("([Pass],)");
    expect(display(levels, "([Pass],)")).toBe("Pass");
    // Empty: the argument is left out, for the function's own levels.
    expect(source(levels, " \n")).toBeNull();
    expect(display(levels, "auto")).toBe("");
    expect(display(levels, null)).toBe("");
  });

  it("writes numbers with commas, spaces or semicolons between them; `none` and empty are their own", () => {
    expect(source(points, "4, 3, 2, 1")).toBe("(4, 3, 2, 1)");
    expect(source(points, "4 3;2,1.5")).toBe("(4, 3, 2, 1.5)");
    expect(source(points, "10")).toBe("(10,)");
    expect(display(points, "(4, 3, 2, 1)")).toBe("4, 3, 2, 1");
    expect(display(points, "(10,)")).toBe("10");
    expect(source(points, "none")).toBe("none");
    expect(display(points, "none")).toBe("none");
    expect(source(points, "")).toBeNull();
    expect(display(points, "auto")).toBe("");
    for (const typed of ["four", "4, three", "4 pts"]) expect(source(points, typed), typed).toBeUndefined();
  });

  it("reads a list's items, and tells what isn't a list of values", () => {
    expect(listItems("([Good], [Fair])")).toEqual(["[Good]", "[Fair]"]);
    expect(listItems("(4, 3,)")).toEqual(["4", "3"]);
    expect(listItems("([Only])")).toEqual(["[Only]"]);
    expect(listItems("()")).toEqual([]);
    for (const other of ["auto", "names", "(..names, [More])", "(a: 1)", "range(4)"])
      expect(listItems(other), other).toBeNull();
  });

  it("shows read-only what its lines can't hold: formatting, formulas, a list that is computed", () => {
    for (const plain of ["([Good], [Fair])", '("Good", "Fair")', "auto", "none"])
      expect(isRich(levels, plain), plain).toBe(false);
    for (const rich of ["([*Good*], [Fair])", '([#ce("H2O")],)', "names", "(..names, [More])"])
      expect(isRich(levels, rich), rich).toBe(true);
    expect(isRich(points, "(4, 3, 2, 1)")).toBe(false);
    expect(isRich(points, "(4, 3 + 1)")).toBe(true);
    expect(isRich(points, "range(4)")).toBe(true);
    expect(isRich(levels, null)).toBe(false);
  });

  const schema = schemaOf([{ key: "t", components: [{ name: "rubric", label: "Rubric", rows: true }] }]);
  /** The rubric with a parameter set to what the field holds. */
  const set = (doc: string, param: EditorParamSpec, typed: string): string => {
    const state = new EditorState(doc, { anchor: 0, head: doc.length, node: true });
    const component = componentIn(state, 0, doc.length, schema);
    if (!component) throw new Error("no rubric");
    const tr = setValue(component, param, source(param, typed) ?? null)(state);
    if (!tr) throw new Error("nothing set");
    const after = state.apply(tr).state;
    // The rubric stays selected, whole.
    expect([after.from, after.to, after.selection.node]).toEqual([0, after.text.length, true]);
    return after.text;
  };
  const RUBRIC = "#rubric(\n  ([Content], [Complete], [Partial], [Missing]),\n  ([Units], [All], [Some], [None]),\n)";

  it("gives every row a cell for a level added, where a caret can go", () => {
    expect(set(RUBRIC, { ...levels, default: "([A], [B], [C])" }, "Good\nFair\nPoor\nAbsent")).toBe(
      "#rubric(\n  ([Content], [Complete], [Partial], [Missing], [~]),\n  ([Units], [All], [Some], [None], [~]),\n  levels: ([Good], [Fair], [Poor], [Absent]),\n)",
    );
  });

  it("takes the empty cells past the last level away; cells with text stay", () => {
    const wide =
      "#rubric(\n  ([Content], [Complete], [Partial], [~]),\n  ([Units], [All], [Some], [None]),\n  levels: ([A], [B], [C]),\n)";
    expect(set(wide, levels, "Good\nFair")).toBe(
      "#rubric(\n  ([Content], [Complete], [Partial]),\n  ([Units], [All], [Some], [None]),\n  levels: ([Good], [Fair]),\n)",
    );
  });

  it("leaves the rows alone for the points, and for levels as many as before", () => {
    expect(set(RUBRIC, points, "3, 2, 1")).toBe(RUBRIC.replace("\n)", "\n  points: (3, 2, 1),\n)"));
    expect(set(RUBRIC, levels, "Good\nFair\nPoor")).toBe(
      RUBRIC.replace("\n)", "\n  levels: ([Good], [Fair], [Poor]),\n)"),
    );
  });
});

describe("formulas with words", () => {
  const beforeAllSyntax = () => loadSyntax(readFileSync(new URL("../../syntax/wasm/syntax_bg.wasm", import.meta.url)));
  it("quote the words the compiler doesn't know, once typed to their end", () => {
    const errs = ["unknown variable: area", "unknown variable: length"];
    expect(quoteUnknown("area = length times width", errs, false)).toBe('"area" = "length" times width');
    expect(quoteUnknown("area = len", ["unknown variable: len"], false)).toBe("area = len");
    expect(quoteUnknown("x = width", ["unknown variable: width"], true)).toBe('x = "width"');
    expect(quoteUnknown('"area" = 2', ["unknown variable: area"], true)).toBe('"area" = 2');
    // A subscript or a power ends a word in math: `CO_2` is `CO` with a 2 below it.
    expect(quoteUnknown("6 CO_2 + x_max^2", ["unknown variable: CO"], true)).toBe('6 "CO"_2 + x_max^2');
    expect(quoteUnknown("v_avg = d", ["unknown variable: avg"], true)).toBe('v_"avg" = d');
    expect(quoteUnknown("kg^2", ["unknown variable: kg"], true)).toBe('"kg"^2');
    // After one letter's dot the word stands alone; after a longer name's it is that symbol's modifier.
    expect(quoteUnknown("x.foo + plus.foo", ["unknown variable: foo"], true)).toBe('x."foo" + plus.foo');
    // A number ends before a word: `3km` is 3 and `km`. Text in quotes stays as it is.
    expect(quoteUnknown("3km + 5 kg", ["unknown variable: km", "unknown variable: kg"], true)).toBe('3"km" + 5 "kg"');
    expect(quoteUnknown('"walk 3 km" + km', ["unknown variable: km"], true)).toBe('"walk 3 km" + "km"');
    expect(quoteUnknown("x2km", ["unknown variable: km"], true)).toBe("x2km");
  });

  it("set the letters a formula multiplies apart, not as a word", () => {
    const unknown = (...words: string[]) => words.map((w) => `unknown variable: ${w}`);
    expect(quoteUnknown("y = 2mx + b", unknown("mx"), true)).toBe("y = 2m x + b");
    expect(quoteUnknown("E = mc^2", unknown("mc"), true)).toBe("E = m c^2");
    expect(quoteUnknown("V = IR, PV = nRT", unknown("IR", "PV", "nRT"), true)).toBe("V = I R, P V = n R T");
    expect(quoteUnknown("ax^2 + bx + c", unknown("ax", "bx"), true)).toBe("a x^2 + b x + c");
    expect(quoteUnknown("mgh + x2", unknown("mgh", "x2"), true)).toBe("m g h + x 2");
    // Units, a sentence's words, molecules and anything longer are text.
    expect(quoteUnknown("5 kg of NaCl", unknown("kg", "of", "NaCl"), true)).toBe('5 "kg" "of" "NaCl"');
    expect(quoteUnknown("Na + avg + mph + mL", unknown("Na", "avg", "mph", "mL"), true)).toBe(
      '"Na" + "avg" + "mph" + "mL"',
    );
    // The caret after what was set apart stays after it.
    expect(quoteUnknown("2mx + b", unknown("mx"), 7)).toBe("2m x + b");
    expect(quoteUnknown("2mx", unknown("mx"), 3)).toBe("2mx");
  });

  it("leave the word the caret is in or just after, wherever that is", () => {
    const errs = ["unknown variable: area", "unknown variable: width"];
    // Typing `area` at the start of `area = width`: the word at the end is typed, this one isn't.
    expect(quoteUnknown("area = width", errs, 4)).toBe('area = "width"');
    expect(quoteUnknown("area = width", errs, 2)).toBe('area = "width"');
    expect(quoteUnknown("area = width", errs, 5)).toBe('"area" = "width"');
    expect(quoteUnknown("area = width", errs, 12)).toBe('"area" = width');
  });

  it("show the word being typed as text on the page, before the compiler has seen it", () => {
    // The caret after `dist`: the page gets it quoted, the field keeps it as typed.
    expect(whileTyping("v = dist", 8)).toBe('v = "dist"');
    expect(whileTyping("area = length times width", 4)).toBe('"area" = length times width');
    // A letter alone is a variable; a word math knows is math's; a quoted one is text already.
    expect(whileTyping("v = d", 5)).toBe("v = d");
    // A name with a digit is one word to math, which doesn't know it.
    expect(whileTyping("y = x2", 6)).toBe("y = x 2");
    expect(whileTyping("y = 2mx", 7)).toBe("y = 2m x");
    expect(whileTyping("y = 2x", 6)).toBe("y = 2x");
    expect(whileTyping("a + sqrt", 8)).toBe("a + sqrt");
    expect(whileTyping("x times", 7)).toBe("x times");
    expect(whileTyping('v = "dist', 9)).toBe('v = "dist');
    // No word at the caret: as typed.
    expect(whileTyping("v = dist + 2", 12)).toBe("v = dist + 2");
  });

  it("say what a formula the page can't show is missing, in a teacher's words", () => {
    beforeAllSyntax();
    expect(formulaProblem("a/b + x^2")).toBeNull();
    expect(formulaProblem('"area" = 2')).toBeNull();
    expect(formulaProblem("sqrt(x")).toBe("A bracket isn't closed.");
    expect(formulaProblem('"area = 2')).toBe("A quote isn't closed.");
    expect(formulaProblem("x^")).toBe("Something is missing at the end.");
    expect(formulaProblem("\\frac{1}{2}")).toMatch(/^No backslashes/);
    // From its first letter on: typed slowly, `\f` never reaches the page.
    expect(formulaProblem("\\f")).toMatch(/^No backslashes/);
    for (const said of ["sqrt(x", "x^", "\\frac{1}{2}"])
      expect(formulaProblem(said)).not.toMatch(/[$#[]|expected|syntax/);
  });
});

describe("the slash menu's order", () => {
  it("puts name matches before keyword and description matches", () => {
    const items = basicPlugins.concat(fromTypstreamPlugin(edu) ?? []).flatMap((p) => p.insert ?? []);
    const top = (q: string) =>
      items
        .map((item, i) => ({ item, i, r: rank(item, q) }))
        .filter((x) => x.r !== null)
        .sort((a, b) => (a.r as number) - (b.r as number) || a.i - b.i)[0]?.item.label;
    expect(top("number l")).toBe("Number line");
    expect(top("ans")).toBe("Answer lines");
    expect(top("tab")).toBe("Table");
    // "line" is in Answer lines' and Number line's names, and in other items' descriptions.
    expect(rank(items.find((i) => i.label === "Divider") as (typeof items)[number], "line")).toBeGreaterThan(
      rank(items.find((i) => i.label === "Number line") as (typeof items)[number], "line") as number,
    );
  });

  it("finds items by the words a teacher has for them", () => {
    const items = basicPlugins.concat(fromTypstreamPlugin(edu) ?? []).flatMap((p) => p.insert ?? []);
    const found = (q: string) => items.filter((i) => rank(i, q) !== null).map((i) => i.label);
    expect(found("heading")).toEqual(expect.arrayContaining(["Heading 1", "Heading 2", "Heading 3"]));
    expect(found("list")).toEqual(expect.arrayContaining(["Bulleted list", "Numbered list"]));
    expect(found("bullet")).toContain("Bulleted list");
    expect(found("fraction")).toContain("Equation");
    expect(found("text box")).toContain("Callout");
    expect(found("chem")).toContain("Chemical formula");
  });
});

describe("the menus' keys", () => {
  it("move the highlight round the list: Down past the end is the first, Up from it the last", () => {
    expect(moveHighlight("ArrowDown", 0, 3)).toBe(1);
    expect(moveHighlight("ArrowDown", 2, 3)).toBe(0);
    expect(moveHighlight("ArrowUp", 0, 3)).toBe(2);
    expect(moveHighlight("ArrowUp", 2, 3)).toBe(1);
    expect(moveHighlight("Home", 2, 3)).toBe(0);
    expect(moveHighlight("End", 0, 3)).toBe(2);
    expect(moveHighlight("Enter", 0, 3)).toBeNull();
    expect(moveHighlight("ArrowDown", 0, 0)).toBeNull();
  });
});

describe("the slash menu's session", () => {
  beforeAll(() => loadSyntax(readFileSync(new URL("../../syntax/wasm/syntax_bg.wasm", import.meta.url))));

  const at = (text: string, caret = text.length) => new EditorState(text, { anchor: caret, head: caret });
  /** The state after `typed`, a key at a time, as the editor types it. */
  const type = (state: EditorState, typed: string): EditorState => {
    let s = state;
    for (const ch of typed) {
      const tr = insertText(ch)(s, DEFAULT_SCHEMA);
      if (tr) s = s.apply(tr).state;
    }
    return s;
  };
  const items = [...basicPlugins, fromTypstreamPlugin(edu), fromTypstreamPlugin(mindmap)].flatMap(
    (p) => p?.insert ?? [],
  );
  const found = (query: string) => items.filter((i) => rank(i, query) !== null).map((i) => i.label);

  it("starts on an empty line, at a line's start and after a space: a `/` in a word is text", () => {
    expect(slashSession(at("Intro.\n\n"))).toMatchObject({ lineStart: 8, line: "", after: 0 });
    expect(slashSession(at(""))).toMatchObject({ lineStart: 0, line: "" });
    // At the start of a line of text, and after a space in it.
    expect(slashSession(at("One\n\nTwo", 5))).toMatchObject({
      lineStart: 5,
      line: "Two",
      within: { before: 0, after: 3 },
    });
    expect(slashSession(at("One two", 4))).toMatchObject({
      lineStart: 0,
      line: "One two",
      within: { before: 4, after: 3 },
    });
    expect(slashSession(at("One two "))).toMatchObject({ within: { before: 8, after: 0 } });
    // In a word, a fraction, a date, an address.
    expect(slashSession(at("One\n\nTwo", 6))).toBeNull();
    expect(slashSession(at("and"))).toBeNull();
    expect(slashSession(at("12"))).toBeNull();
    expect(slashSession(at("See https:"))).toBeNull();
    expect(slashSession(at("See https://typst.app/docs"))).toBeNull();
    // In a table's cell, a question and a list item: at their start, and after a space.
    const table = "#table(columns: 2, [], [B b])";
    expect(slashSession(at(table, table.indexOf("[]") + 1))).toMatchObject({ within: { before: 20 } });
    expect(slashSession(at(table, table.indexOf("B b") + 2))).toMatchObject({ within: { before: 26 } });
    expect(slashSession(at(table, table.indexOf("B b") + 1))).toBeNull();
    expect(slashSession(at("- One\n- ", 8))).toMatchObject({ lineStart: 6, within: { before: 2, after: 0 } });
    expect(slashSession(at("#question[\n  Name it \n]", 21))).toMatchObject({ within: { after: 0 } });
    // Never in a formula or in code as it is written, nor where a `[` is text.
    expect(slashSession(at("$ a $", 4))).toBeNull();
    expect(slashSession(at("$ a + b $", 4))).toBeNull();
    expect(slashSession(at("`a b`", 3))).toBeNull();
    expect(slashSession(at("```\na b\n```", 6))).toBeNull();
    expect(slashSession(at("#table(columns: 2, [A])", 16))).toBeNull();
    expect(slashSession(at("a \\[", 4))).toBeNull();
    expect(slashSession(at("One\n\nTwo", 4))).toMatchObject({ lineStart: 4, line: "", after: 4 });
    expect(slashSession(at("1"))).toBeNull();
    expect(slashSession(new EditorState("\n\nTwo", { anchor: 0, head: 1 }))).toBeNull();
    // A line kept empty by its `~`.
    expect(slashSession(at("One\n\n~\n\nTwo", 6))).toMatchObject({ lineStart: 5, line: "~", after: 5 });
  });

  it("reads the filter from the document as it is typed, whatever the editor escapes", () => {
    const start = at("Intro.\n\n");
    const session = slashSession(start);
    if (!session) throw new Error("no session");
    expect(slashQuery(type(start, "/"), session)).toBe("");
    expect(slashQuery(type(start, "/equ"), session)).toBe("equ");
    expect(slashQuery(type(start, "/2 = 0.5"), session)).toBe("2 = 0.5");
    expect(slashQuery(type(start, "/a*b_c"), session)).toBe("a*b_c");
    // With text after the line, which the filter's end is measured from.
    const mid = at("One\n\n\n\nTwo", 5);
    const inner = slashSession(mid);
    if (!inner) throw new Error("no session");
    expect(slashQuery(type(mid, "/tab"), inner)).toBe("tab");
  });

  it("reads the filter of a `/` typed in a line, and ends when the caret leaves it", () => {
    const start = at("One two three", 4);
    const session = slashSession(start);
    if (!session) throw new Error("no session");
    expect(slashQuery(start, session)).toBeNull();
    const typed = type(start, "/tab");
    expect(typed.text).toBe("One /tabtwo three");
    expect(slashQuery(typed, session)).toBe("tab");
    expect(slashQuery(type(start, "/"), session)).toBe("");
    // The caret before the `/`, or past what was typed; the words before it changed.
    expect(slashQuery(typed.select({ anchor: 4, head: 4 }), session)).toBeNull();
    expect(slashQuery(typed.select({ anchor: 12, head: 12 }), session)).toBeNull();
    expect(slashQuery(new EditorState("Ore /tabtwo three", { anchor: 8, head: 8 }), session)).toBeNull();
    // In a table's cell.
    const table = "#table(columns: 2, [], [B])";
    const cell = at(table, table.indexOf("[]") + 1);
    const inCell = slashSession(cell);
    if (!inCell) throw new Error("no session");
    expect(slashQuery(type(cell, "/eq"), inCell)).toBe("eq");
  });

  it("ends when the `/` is gone or the caret leaves what was typed", () => {
    const start = at("Intro.\n\n");
    const session = slashSession(start);
    if (!session) throw new Error("no session");
    expect(slashQuery(start, session)).toBeNull();
    const typed = type(start, "/eq");
    expect(slashQuery(typed.select({ anchor: 3, head: 3 }), session)).toBeNull();
    expect(slashQuery(typed.select({ anchor: 8, head: typed.text.length }), session)).toBeNull();
    expect(slashQuery(new EditorState("Intro.\n\nq", { anchor: 9, head: 9 }), session)).toBeNull();
  });

  it("finds nothing for what isn't an item's name: `/2 = 0.5` is a sum, not a search", () => {
    expect(found("equ")).toContain("Equation");
    expect(found("2")).toEqual([]);
    expect(found("2 = 0.5")).toEqual([]);
  });
});

describe("the chrome's shortcuts", () => {
  const key = (
    key: string,
    code: string,
    mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>>,
  ) => ({ key, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods }) as KeyboardEvent;

  it("match a keydown by its key and its modifiers, all of them", () => {
    expect(matchesShortcut("Mod-k", key("k", "KeyK", { ctrlKey: true }), false)).toBe(true);
    expect(matchesShortcut("Mod-k", key("K", "KeyK", { ctrlKey: true, shiftKey: true }), false)).toBe(false);
    expect(matchesShortcut("Mod-k", key("k", "KeyK", {}), false)).toBe(false);
    expect(matchesShortcut("Alt-F10", key("F10", "F10", { altKey: true }), false)).toBe(true);
    expect(matchesShortcut("Alt-F10", key("F10", "F10", {}), false)).toBe(false);
    expect(matchesShortcut("Mod-Alt-4", key("4", "Digit4", { ctrlKey: true, altKey: true }), false)).toBe(true);
  });
});
