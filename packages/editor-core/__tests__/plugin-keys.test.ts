// The shortcuts the toolbars' items name (plugin.ts): each one a menu shows is bound to what its
// entry does, checked with Typst's parser; and the ones only the toolbars can act on (a field).
import { beforeAll, describe, expect, it } from "vitest";
import { basicPlugins, blocksPlugin, DEFAULT_SCHEMA, type EditorState, type ToolbarItem } from "../src/index";
import { bindingsOf, matchesShortcut } from "../src/plugin";
import { load, run, state } from "./support";

beforeAll(load);

const s = DEFAULT_SCHEMA;

/** A keydown as a browser sends it. */
const key = (
  key: string,
  code: string,
  mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>>,
) => ({ key, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods }) as KeyboardEvent;

/** What the plugins' bindings do with a key, on a marked-up document. */
const press = (marked: string, event: KeyboardEvent): string | null => {
  for (const p of basicPlugins)
    for (const [name, commands] of bindingsOf(p)) {
      if (!matchesShortcut(name, event, false)) continue;
      for (const command of commands) {
        const out = run(marked, (st: EditorState) => command(st, s));
        if (out !== null) return out;
      }
    }
  return null;
};

const toolbar = (): ToolbarItem[] => basicPlugins.flatMap((p) => [...(p.toolbar ?? []), ...(p.floating ?? [])]);
const entries = (key: string): ToolbarItem[] => toolbar().find((i) => i.key === key)?.items ?? [];

describe("the toolbar items' shortcuts", () => {
  it("Ctrl+Alt+4 makes a Heading 4, as Ctrl+Alt+1 to 3 make theirs", () => {
    expect(press("A ti‸tle", key("4", "Digit4", { ctrlKey: true, altKey: true }))).toBe("==== A ti‸tle");
    expect(press("A ti‸tle", key("3", "Digit3", { ctrlKey: true, altKey: true }))).toBe("=== A ti‸tle");
    // On a Mac, Alt changes what the key types: the physical key counts.
    const mac = key("¢", "Digit4", { metaKey: true, altKey: true });
    expect(matchesShortcut("Mod-Alt-4", mac, true)).toBe(true);
  });

  it("every entry of Turn into names its shortcut, and each is bound", () => {
    const turnInto = toolbar().find((i) => i.label === "Turn into");
    const items = turnInto?.items ?? [];
    expect(items.map((i) => i.label)).toContain("Heading 4");
    const bound = new Set(bindingsOf(blocksPlugin).map(([name]) => name));
    for (const item of items) {
      expect(item.shortcut, item.label).toBeTruthy();
      expect(bound.has(item.shortcut as string), item.label).toBe(true);
    }
  });

  it("the Align entries name the shortcuts they have, and the keys do what the entries do", () => {
    const align = entries("align");
    expect(align.map((i) => [i.label, i.shortcut])).toEqual([
      ["Align left", "Mod-Shift-l"],
      ["Center", "Mod-Shift-e"],
      ["Align right", "Mod-Shift-r"],
    ]);
    for (const item of align) {
      const letter = (item.shortcut as string).slice(-1);
      const event = key(letter.toUpperCase(), `Key${letter.toUpperCase()}`, { ctrlKey: true, shiftKey: true });
      // Left where the paragraph isn't yet: a paragraph is left-aligned as it is.
      const doc = item.key === "align-left" ? "#align(center)[Some ‸words.]" : "Some ‸words.";
      const byKey = press(doc, event);
      expect(byKey, item.label).not.toBeNull();
      expect(byKey).toBe(run(doc, (st) => (item.run ? item.run(st, s) : null)));
    }
    expect(press("Some ‸words.", key("E", "KeyE", { ctrlKey: true, shiftKey: true }))).toContain("#align(center)");
  });

  it("the link's field has Ctrl+K in both toolbars, bound to no command: the toolbars open it", () => {
    for (const p of basicPlugins)
      for (const list of [p.toolbar, p.floating]) {
        const link = list?.find((i) => i.key === "link");
        if (link) expect(link.shortcut).toBe("Mod-k");
      }
    expect(toolbar().filter((i) => i.key === "link")).toHaveLength(2);
    const k = key("k", "KeyK", { ctrlKey: true });
    expect(matchesShortcut("Mod-k", k, false)).toBe(true);
    expect(press("Some «words».", k)).toBeNull();
  });
});

describe("the insert menu's own items", () => {
  const items = basicPlugins.flatMap((p) => p.insert ?? []);
  const item = (label: string) => items.find((i) => i.label === label);

  it("has headings and lists, found by those words: they turn the caret's line into one", () => {
    for (const [label, out] of [
      ["Heading 1", "= A ti‸tle"],
      ["Heading 2", "== A ti‸tle"],
      ["Heading 3", "=== A ti‸tle"],
      ["Bulleted list", "- A ti‸tle"],
      ["Numbered list", "+ A ti‸tle"],
    ] as const) {
      const found = item(label);
      expect(found, label).toBeDefined();
      expect(
        run("A ti‸tle", (st) => found?.run(st, s) ?? null),
        label,
      ).toBe(out);
    }
    expect(item("Bulleted list")?.keywords).toContain("bullet");
    // A fraction is written in an equation.
    expect(item("Equation")?.keywords).toContain("fraction");
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
  });

  it("names a divider and a page break for the bar over one, as the menu does", () => {
    const names = Object.fromEntries(basicPlugins.flatMap((p) => p.components ?? []).map((c) => [c.name, c.label]));
    expect(names).toMatchObject({ line: "Divider", pagebreak: "Page break", table: "Table" });
    expect(item("Divider")).toBeDefined();
    expect(item("Page break")).toBeDefined();
  });
});

describe("the marks' decorations", () => {
  it("marks a link's words, so the editor can show that they are one", () => {
    const st = state('Read #link("https://typst.app")[the *guide*] and #link("mailto:a@b.c")[write], not *this*.‸');
    const found = basicPlugins.flatMap((p) => p.decorations?.(st, s) ?? []);
    expect(found.map((d) => [st.text.slice(d.from, d.to), d.class])).toEqual([
      ["the *guide*", "typstream-editor-link"],
      ["write", "typstream-editor-link"],
    ]);
    expect(basicPlugins.flatMap((p) => p.decorations?.(state("No links *here*.‸"), s) ?? [])).toEqual([]);
  });
});
