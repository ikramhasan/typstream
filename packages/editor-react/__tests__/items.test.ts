// The insert and slash menus' items: the basic blocks, Typst's, and what plugins add through
// their `editor` facet, grouped as the plugins say, and filtered by the slash menu's query.
import { definePlugin } from "@typstream/core";
import { edu, eduEditorItems } from "@typstream/edu";
import type { PlateEditor } from "platejs/react";
import { describe, expect, it } from "vitest";
import { filterGroups, insertGroups } from "../src/items";

// The items' actions need an editor; listing them doesn't.
const editor = {} as PlateEditor;
const labels = (groups: ReturnType<typeof insertGroups>) => groups.map((g) => [g.label, g.items.map((i) => i.label)]);

describe("menu items", () => {
  it("lists the basic blocks and Typst's", () => {
    const groups = insertGroups(editor, [], true);
    expect(labels(groups)).toEqual([
      [
        "Basic blocks",
        [
          "Text",
          "Heading 1",
          "Heading 2",
          "Heading 3",
          "Heading 4",
          "Heading 5",
          "Heading 6",
          "Bulleted list",
          "Numbered list",
          "Quote",
          "Code block",
        ],
      ],
      ["Typst", ["Equation", "Inline equation", "Table", "Divider", "Page break", "Typst code"]],
    ]);
    // The insert menu adds blocks; turning a block into text is the slash menu's.
    expect(insertGroups(editor, [], false)[0]?.items.map((i) => i.label)).not.toContain("Text");
  });

  it("adds a plugin's items in its groups, once each", () => {
    const groups = insertGroups(editor, [edu], true).slice(2);
    expect(groups.map((g) => g.label)).toEqual(["Questions", "Answers", "Boxes", "Drawings"]);
    expect(groups.flatMap((g) => g.items).length).toBe(eduEditorItems.length);
    const plugin = definePlugin({
      key: "acme/notes",
      editor: {
        slashItems: [{ key: "note", label: "Note", insert: "#note[]" }],
        toolbar: [{ key: "note", label: "Note", insert: "#note[]" }],
      },
    });
    expect(labels(insertGroups(editor, [plugin], true).slice(2))).toEqual([["acme/notes", ["Note"]]]);
  });

  it("filters by label and keywords", () => {
    const groups = filterGroups(insertGroups(editor, [edu], true), "math");
    expect(groups.flatMap((g) => g.items).map((i) => i.label)).toEqual(["Equation", "Inline equation", "Number line"]);
    expect(filterGroups(insertGroups(editor, [], true), "zzz").every((g) => g.items.length === 0)).toBe(true);
  });
});
