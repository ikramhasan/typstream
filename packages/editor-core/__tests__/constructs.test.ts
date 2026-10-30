// What each construct becomes in the editor, and how a value is written back. Outputs are checked
// by reading them with Typst's parser (the property test does that for generated values).
import { applyEdit, type TextEdit } from "@typstream/core";
import { beforeAll, describe, expect, it } from "vitest";
import { serializeValue, type TypstBlock, TypstDocument, type TypstValue } from "../src/index";
import { loadParser } from "./support/syntax";
import { withoutIds } from "./support/values";

beforeAll(loadParser);

const read = (source: string) => withoutIds(new TypstDocument(source).value);
const p = (...children: TypstBlock["children"]): TypstBlock => ({ type: "p", children }) as TypstBlock;

describe("reading Typst", () => {
  it.each<[string, string, unknown]>([
    ["paragraph", "Hello world", [p({ text: "Hello world" })]],
    ["soft line break", "one\ntwo", [p({ text: "one two" })]],
    ["line break", "one \\\ntwo", [p({ text: "one\ntwo" })]],
    ["escapes and shorthands", "\\*a\\* -- b... ~c", [p({ text: "*a* – b…  c" })]],
    ["strong and emph", "*a* and _b_", [p({ text: "a", bold: true }, { text: " and " }, { text: "b", italic: true })]],
    ["nested marks", "*_a_*", [p({ text: "a", bold: true, italic: true })]],
    ["raw", "`x * y`", [p({ text: "x * y", code: true })]],
    [
      "mark calls",
      "#underline[u] #strike[s] #sub[1] #super[2] #highlight[h]",
      [
        p(
          { text: "u", underline: true },
          { text: " " },
          { text: "s", strikethrough: true },
          { text: " " },
          { text: "1", subscript: true },
          { text: " " },
          { text: "2", superscript: true },
          { text: " " },
          { text: "h", highlight: true },
        ),
      ],
    ],
    [
      "text colour and size",
      '#text(fill: rgb("#E11D48"), size: 14pt)[c]',
      [p({ text: "c", color: "#e11d48", fontSize: "14pt" })],
    ],
    ["named colour", "#text(fill: red)[c]", [p({ text: "c", color: "#ff4136" })]],
    [
      "unknown arguments are code",
      'a #text(weight: "bold")[c]',
      [
        p(
          { text: "a " },
          { type: "typst_inline_code", source: '#text(weight: "bold")[c]', children: [{ text: "" }] },
          { text: "" },
        ),
      ],
    ],
    [
      "a call on its own lines is a block",
      '#text(weight: "bold")[c]',
      [
        {
          type: "typst_code",
          source: '#text(weight: "bold")[c]',
          role: "content",
          call: "text",
          children: [{ text: "" }],
        },
      ],
    ],
    [
      "link",
      '#link("https://typst.app")[Typst]',
      [p({ text: "" }, { type: "a", url: "https://typst.app", children: [{ text: "Typst" }] }, { text: "" })],
    ],
    [
      "bare link",
      "see https://typst.app",
      [
        p(
          { text: "see " },
          { type: "a", url: "https://typst.app", children: [{ text: "https://typst.app" }] },
          { text: "" },
        ),
      ],
    ],
    [
      "inline equation",
      "area $pi r^2$",
      [p({ text: "area " }, { type: "typst_inline_equation", math: "pi r^2", children: [{ text: "" }] }, { text: "" })],
    ],
    [
      "marked equation",
      "*$x$*",
      [
        p(
          { text: "" },
          { type: "typst_inline_equation", math: "x", children: [{ text: "", bold: true }] },
          { text: "" },
        ),
      ],
    ],
    [
      "blank written as underscores",
      "a ____ b",
      [
        p(
          { text: "a " },
          { type: "typst_inline_code", source: "__", children: [{ text: "" }] },
          { text: "" },
          { type: "typst_inline_code", source: "__", children: [{ text: "" }] },
          { text: " b" },
        ),
      ],
    ],
    ["heading with label", "== Intro <intro>", [{ type: "h2", label: "intro", children: [{ text: "Intro" }] }]],
    [
      "display equation",
      "$ x^2 $ <eq>",
      [{ type: "typst_equation", math: "x^2", label: "eq", children: [{ text: "" }] }],
    ],
    [
      "code block",
      "```py\nprint(1)\n\nx\n```",
      [
        {
          type: "code_block",
          lang: "py",
          children: ["print(1)", "", "x"].map((t) => ({ type: "code_line", children: [{ text: t }] })),
        },
      ],
    ],
    // `more` is indented under `a`'s text, not `b`'s, so Typst puts it in `a`.
    [
      "nested lists",
      "- a\n  - b\n\n  more\n+ c\n3. d",
      [
        { type: "p", listStyleType: "disc", indent: 1, children: [{ text: "a" }] },
        { type: "p", listStyleType: "disc", indent: 2, children: [{ text: "b" }] },
        { type: "p", indent: 1, children: [{ text: "more" }] },
        { type: "p", listStyleType: "decimal", indent: 1, children: [{ text: "c" }] },
        { type: "p", listStyleType: "decimal", listRestart: 3, indent: 1, children: [{ text: "d" }] },
      ],
    ],
    [
      "block calls",
      "#align(center)[= T]\n\n#par(justify: true)[j]\n\n#quote(block: true)[q]\n\n#line(length: 100%)\n\n#pagebreak()",
      [
        { type: "h1", align: "center", children: [{ text: "T" }] },
        { type: "p", align: "justify", children: [{ text: "j" }] },
        { type: "blockquote", children: [{ text: "q" }] },
        { type: "hr", children: [{ text: "" }] },
        { type: "typst_pagebreak", children: [{ text: "" }] },
      ],
    ],
    [
      "code on its own lines",
      '#set text(lang: "en")\n#question(points: 2)[Why?]\n// note',
      [
        { type: "typst_code", source: '#set text(lang: "en")', role: "rule", children: [{ text: "" }] },
        {
          type: "typst_code",
          source: "#question(points: 2)[Why?]",
          role: "content",
          call: "question",
          children: [{ text: "" }],
        },
        { type: "typst_code", source: "// note", role: "comment", children: [{ text: "" }] },
      ],
    ],
    [
      "syntax errors are code",
      "a *b\n\nc",
      [{ type: "typst_code", source: "a *b\n\nc", role: "content", children: [{ text: "" }] }],
    ],
    [
      "term lists are code",
      "/ Term: def",
      [{ type: "typst_code", source: "/ Term: def", role: "content", children: [{ text: "" }] }],
    ],
  ])("%s", (_, source, value) => {
    expect(read(source)).toEqual(value);
  });
});

describe("writing Typst", () => {
  const write = (value: TypstValue): string => serializeValue(value);
  it.each<[string, TypstValue, string]>([
    [
      "text that looks like markup",
      [p({ text: "- not a list *nor* _this_ #x $y$ <z> @w [a] `b` \\ ~ -- -1 ... // c" })],
      "\\- not a list \\*nor\\* \\_this\\_ \\#x \\$y\\$ \\<z> \\@w \\[a\\] \\`b\\` \\\\ \\~ \\-- \\-1 \\... \\// c\n",
    ],
    [
      "markers at the start",
      [p({ text: "= x" }), p({ text: "12. y" }), p({ text: "/ z" })],
      "\\= x\n\n12\\. y\n\n\\/ z\n",
    ],
    ["a URL as text", [p({ text: "go to https://typst.app now" })], "go to https:\\//typst.app now\n"],
    ["bold inside a word", [p({ text: "un" }, { text: "bold", bold: true }, { text: "ed" })], "un#strong[bold]ed\n"],
    ["bold at word edges", [p({ text: "a " }, { text: "bold", bold: true }, { text: "." })], "a *bold*.\n"],
    [
      "marks nest outside in",
      [p({ text: "x", bold: true, italic: true, underline: true, color: "#ff0000" })],
      '#text(fill: rgb("#ff0000"))[#underline[*_x_*]]\n',
    ],
    ["code with a backtick", [p({ text: "a`b", code: true })], '#raw("a`b")\n'],
    [
      "call followed by a name",
      [p({ text: "a", underline: true }, { text: "bc" }), p({ text: "a", code: true, bold: true }, { text: "(b)" })],
      "#underline[a]bc\n\n*`a`*(b)\n",
    ],
    ["line breaks", [p({ text: "a\nb" })], "a\\ b\n"],
    [
      "lists",
      [
        { type: "p", listStyleType: "disc", indent: 1, children: [{ text: "a" }] },
        { type: "p", listStyleType: "disc", indent: 2, children: [{ text: "b" }] },
        { type: "p", indent: 2, children: [{ text: "more" }] },
        { type: "p", listStyleType: "decimal", indent: 1, children: [{ text: "c" }] },
      ],
      "- a\n  - b\n\n    more\n+ c\n",
    ],
    ["empty paragraphs vanish", [p({ text: "a" }), p({ text: "" }), p({ text: "b" })], "a\n\nb\n"],
    [
      "code fences grow",
      [{ type: "code_block", children: [{ type: "code_line", children: [{ text: "```" }] }] }],
      "````\n```\n````\n",
    ],
  ])("%s", (_, value, source) => {
    expect(write(value)).toBe(source);
    expect(read(source)).toEqual(withoutIds(read(write(value)) as TypstValue));
  });
});

describe("editing", () => {
  const source = '#set text(lang: "en")\n\n= Title   <t>\n\nFirst  paragraph, *as written*.\n\n- one\n- two\n\nLast.\n';

  it("changes only the edited block", () => {
    const doc = new TypstDocument(source);
    const value = doc.value.map((block) =>
      block.type === "p" && block.children[0] && "text" in block.children[0] && block.children[0].text === "Last."
        ? { ...block, children: [{ text: "Last,", bold: true }, { text: " edited." }] }
        : block,
    ) as TypstValue;
    const edit = doc.update(value);
    expect(edit?.origin).toBe("user");
    expect(edit && edit.from >= source.indexOf("Last.") && edit.to <= source.indexOf("Last.") + 5).toBe(true);
    expect(doc.source).toBe(source.replace("Last.", "*Last,* edited."));
    expect(applyEdit(source, edit as TextEdit)).toBe(doc.source);
    expect(doc.update(value)).toBeNull();
  });

  it("writes a new block between untouched ones", () => {
    const doc = new TypstDocument(source);
    const value = [...doc.value];
    value.splice(2, 0, p({ text: "New." }));
    expect(doc.serialize(value)).toBe(source.replace("= Title   <t>\n\n", "= Title   <t>\n\nNew.\n\n"));
  });

  it("keeps a list's other items when one changes", () => {
    const doc = new TypstDocument(source);
    const value = doc.value.map((block) =>
      block.type === "p" && block.listStyleType && JSON.stringify(block.children).includes("two")
        ? { ...block, children: [{ text: "deux" }] }
        : block,
    ) as TypstValue;
    expect(doc.serialize(value)).toBe(source.replace("- two", "- deux"));
  });

  it("keeps ids of unchanged units across an outside edit", () => {
    const doc = new TypstDocument(source);
    const before = doc.value.map((b) => b.id);
    const after = doc.setSource(source.replace("Last.", "Last!")).map((b) => b.id);
    expect(after.slice(0, -1)).toEqual(before.slice(0, -1));
    expect(after.at(-1)).not.toBe(before.at(-1));
  });

  it("maps blocks to their source", () => {
    const doc = new TypstDocument(source);
    const heading = doc.value.find((b) => b.type === "h1");
    const range = heading?.id ? doc.rangeOf(heading.id) : undefined;
    expect(range && source.slice(range.from, range.to)).toBe("= Title   <t>");
    expect(doc.blockAt(source.indexOf("Title"))).toBe(heading?.id);
  });
});
