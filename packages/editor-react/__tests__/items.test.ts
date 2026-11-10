// What the toolbars and forms are made of, without a browser: every icon the editor's own plugins
// and edu's and mindmap's components name is one the toolbar draws, and form fields write Typst that
// reads back as what was typed.
import type { EditorParamSpec } from "@typstream/core";
import { basicPlugins, fromTypstreamPlugin, type ToolbarItem } from "@typstream/editor-core";
import { edu } from "@typstream/edu";
import { mindmap } from "@typstream/mindmap";
import { describe, expect, it } from "vitest";
import { hasIcon } from "../src/icons";
import { rank } from "../src/insert";
import { display, quoteUnknown, source } from "../src/panels";
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
    expect(source(field("length"), "2")).toBeUndefined();
    // Out of range: not written (the fifth of three options, negative points).
    const option = { ...field("number"), min: 1 };
    expect(source(option, "2", 3)).toBe("2");
    expect(source(option, "5", 3)).toBeUndefined();
    expect(source(option, "0", 3)).toBeUndefined();
    expect(source({ ...field("number"), min: 0 }, "-1")).toBeUndefined();
  });
});

describe("formulas with words", () => {
  it("quote the words the compiler doesn't know, once typed to their end", () => {
    const errs = ["unknown variable: area", "unknown variable: length"];
    expect(quoteUnknown("area = length times width", errs, false)).toBe('"area" = "length" times width');
    expect(quoteUnknown("area = len", ["unknown variable: len"], false)).toBe("area = len");
    expect(quoteUnknown("x = width", ["unknown variable: width"], true)).toBe('x = "width"');
    expect(quoteUnknown('"area" = 2', ["unknown variable: area"], true)).toBe('"area" = 2');
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
    expect(top("num")).toBe("Number line");
    expect(top("ans")).toBe("Answer lines");
    expect(top("tab")).toBe("Table");
  });
});
