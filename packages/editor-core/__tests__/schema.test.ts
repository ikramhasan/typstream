// What plugins tell the commands (the schema), and the places a document has for a caret: its own
// text after the rules it starts with, and one place where several offsets show the same caret.
import type { TypstreamPlugin } from "@typstream/core";
import { beforeAll, describe, expect, it } from "vitest";
import { bodyRange } from "../src/commands";
import { basicPlugins, caretPlace, DEFAULT_SCHEMA, EditorState, fromTypstreamPlugin, schemaOf } from "../src/index";
import { load } from "./support";

beforeAll(load);

const quiz: TypstreamPlugin = {
  key: "quiz",
  editor: {
    marks: ["term"],
    inline: ["blank"],
    components: [
      {
        name: "mcq",
        label: "Multiple choice",
        template: "#mcq([{{cursor}}First], [Second])",
        list: true,
        params: [
          { name: "columns", label: "Columns", type: "number" },
          { name: "answer", label: "Correct option", type: "number", maxPositional: true },
        ],
      },
      { name: "map", label: "Map", template: "#map[\n  {{cursor}}Topic\n]", outline: true },
      { name: "formula", label: "Formula", template: '#formula("{{cursor}}")', inline: true },
    ],
  },
};

describe("schemaOf", () => {
  const plugin = fromTypstreamPlugin(quiz);
  const schema = schemaOf([...basicPlugins, ...(plugin ? [plugin] : [])]);

  it("adds the plugins' marks, inline calls and components to Typst's own", () => {
    for (const m of DEFAULT_SCHEMA.marks) expect(schema.marks.has(m), m).toBe(true);
    expect(schema.marks.has("term")).toBe(true);
    // A mark is set in a line too.
    expect(["term", "blank", "formula"].filter((n) => schema.inline.has(n))).toEqual(["term", "blank", "formula"]);
    expect(schema.inline.has("mcq")).toBe(false);
    expect(["table", "grid", "mcq", "map", "formula"].filter((n) => schema.components?.has(n))).toHaveLength(5);
  });

  it("knows which components' arguments are items, and the argument that numbers one of them", () => {
    expect([...(schema.lists ?? [])]).toEqual(["mcq"]);
    expect([...(schema.indexes ?? [])]).toEqual([["mcq", "answer"]]);
  });

  it("knows which components' content is an outline", () => {
    expect([...(schema.outlines ?? [])]).toEqual(["map"]);
  });

  it("takes no index from a component that isn't a list", () => {
    const loose = schemaOf([
      {
        key: "x",
        components: [
          { name: "pick", label: "Pick", template: "#pick()", params: quiz.editor?.components?.[0]?.params },
        ],
      },
    ]);
    expect(loose.indexes?.size).toBe(0);
    expect(loose.lists?.size).toBe(0);
  });
});

describe("the document's own text", () => {
  const range = (text: string) => {
    const { from, to } = bodyRange(new EditorState(text));
    return text.slice(from, to);
  };

  it("starts after the rules a document begins with, and ends at its last character", () => {
    expect(range('#import "@typstream/edu:0.1.0": *\n#set text(size: 11pt)\n\n= Title\n\nText.\n')).toBe(
      "= Title\n\nText.",
    );
    expect(range("= Title\n\nText.")).toBe("= Title\n\nText.");
    expect(range("\n\nText.\n\n")).toBe("Text.");
  });

  it("is empty, after the rules, in a document with nothing else", () => {
    const text = "#set page(margin: 2cm)\n";
    const { from, to } = bodyRange(new EditorState(text));
    expect(from).toBe(to);
    expect(from).toBeGreaterThanOrEqual(text.indexOf("\n"));
    expect(bodyRange(new EditorState(""))).toEqual({ from: 0, to: 0 });
  });
});

describe("caretPlace", () => {
  const place = (marked: string) => {
    const at = marked.indexOf("‸");
    const text = marked.replace("‸", "");
    const to = caretPlace(new EditorState(text), at);
    return `${text.slice(0, to)}‸${text.slice(to)}`;
  };

  it("is after a heading's or a list item's marker, not before it", () => {
    expect(place("Text.\n\n‸= Title")).toBe("Text.\n\n= ‸Title");
    expect(place("‸- One\n- Two")).toBe("- ‸One\n- Two");
    expect(place("- One\n‸- Two")).toBe("- One\n- ‸Two");
    expect(place("+ One\n  ‸- Inner")).toBe("+ One\n  - ‸Inner");
  });

  it("is where the text starts, among the rules a document begins with", () => {
    expect(place("‸#set text(size: 11pt)\n\nText.")).toBe("#set text(size: 11pt)\n\n‸Text.");
    expect(place("#set text(size: 11pt)‸\n\nText.")).toBe("#set text(size: 11pt)\n\n‸Text.");
  });

  it("is before the newline that ends a block's text, and after the one that starts it", () => {
    expect(place("#box[\n  Text.\n‸]")).toBe("#box[\n  Text.‸\n]");
    expect(place("Text.\n‸")).toBe("Text.‸\n");
  });

  it("leaves a place in the text where it is", () => {
    for (const marked of ["Te‸xt.", "Text.‸", "= Ti‸tle", "- ‸One", "A line.\n\n‸Another."])
      expect(place(marked)).toBe(marked);
  });
});
