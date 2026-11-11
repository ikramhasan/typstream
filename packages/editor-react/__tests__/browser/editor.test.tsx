/// <reference lib="dom" />
// <TypstEditor> on the real engine worker in Chromium, Firefox and WebKit: the toolbars change the
// source, the insert menu adds tables and edu's components, a table's bar adds rows and columns, a
// component's settings edit its arguments, and the pages are drawn as the page view draws them.

import { act, cleanup, render, screen, within } from "@testing-library/react";
import type { TypstreamPlugin } from "@typstream/core";
import { COLORS, type EditorView } from "@typstream/editor-core";
import { edu } from "@typstream/edu";
import { createEngine, type Engine, fromWorker } from "@typstream/engine";
import { htmlCompat } from "@typstream/html-compat";
import { mindmap } from "@typstream/mindmap";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { TypstEditor } from "../../src/index";

const spawn = () =>
  fromWorker(() => new Worker(new URL("../../../engine/src/worker.ts", import.meta.url), { type: "module" }));

const engines: Engine[] = [];
afterEach(() => {
  cleanup();
  for (const e of engines.splice(0)) e.dispose();
  // A test that scrolled the window mustn't leave the next one's document scrolled away (WebKit keeps the offset).
  window.scrollTo(0, 0);
});

const waitFor = async (check: () => boolean, ms = 10_000, what = "") => {
  const start = performance.now();
  while (!check()) {
    if (performance.now() - start > ms) throw new Error(`timed out waiting ${what}`);
    await new Promise((r) => setTimeout(r, 30));
  }
};

/** Renders the editor and waits for its pages; returns its view and the last source it reported. */
const mount = async (source: string, plugins: TypstreamPlugin[] = [htmlCompat, edu], width = 820) => {
  const engine = createEngine({ spawn: spawn() });
  engines.push(engine);
  window.scrollTo(0, 0);
  let view: EditorView | null = null;
  const changes: string[] = [];
  render(
    <div style={{ width, padding: width < 400 ? 0 : 24 }}>
      <TypstEditor
        source={source}
        engine={engine}
        plugins={plugins}
        layout="fit-width"
        onReady={(v) => {
          view = v;
        }}
        onChange={(s) => changes.push(s)}
      />
    </div>,
  );
  await waitFor(() => !!(view as EditorView | null)?.layout, 30_000, "for the layout");
  const v = view as unknown as EditorView;
  return { view: v, changes };
};

/** Waits for the engine to lay out the editor's current text. */
const laidOut = (view: EditorView) =>
  waitFor(() => {
    const g = view.layout?.glyphs ?? [];
    return g.length > 0;
  });

/** The floating toolbar over the selection, where it is shown. */
const floatingBar = (): HTMLElement | null => {
  const el = document.querySelector<HTMLElement>('.tse-floating[aria-label="Selection"]');
  return el && getComputedStyle(el).visibility !== "hidden" ? el : null;
};

/** Waits for the floating toolbar to be placed over the selection. */
const floating = async (): Promise<HTMLElement> => {
  await waitFor(() => !!floatingBar(), 5000, "for the floating toolbar");
  return floatingBar() as HTMLElement;
};

/** A real click on a control of a toolbar, by where it is in it: the two toolbars' buttons share labels. */
const clickIn = async (toolbar: HTMLElement, control: HTMLElement) => {
  const t = toolbar.getBoundingClientRect();
  const c = control.getBoundingClientRect();
  await userEvent.click(toolbar, { position: { x: c.left + c.width / 2 - t.left, y: c.top + c.height / 2 - t.top } });
};

/** Where the character at a source offset is drawn, from the editor's corner. */
const pointOf = (view: EditorView, offset: number) => {
  const at = view.layoutOffset(offset);
  const g = view.layout?.glyphs.find((g) => g.from === at);
  if (!g) throw new Error(`no glyph at ${offset}`);
  const r = view.toClient({ page: g.page, x: g.x, y: g.y - g.ascent / 2, width: g.width, height: 1 }) as DOMRect;
  const host = view.element.getBoundingClientRect();
  return { x: r.left + r.width / 4 - host.left, y: r.top - host.top };
};

const fixedBar = () => screen.getByRole("toolbar", { name: "Formatting" });

/** The bar by the selected component, where it is shown. */
const componentBar = (): HTMLElement | null => {
  const el = document.querySelector<HTMLElement>(".tse-bar");
  return el && getComputedStyle(el).visibility !== "hidden" ? el : null;
};

/** Waits for the bar of the component a teacher calls `label`. */
const barOf = async (label: string): Promise<HTMLElement> => {
  await waitFor(() => componentBar()?.getAttribute("aria-label") === label, 5000, `for the bar of ${label}`);
  return componentBar() as HTMLElement;
};

/** Where `source` is in the document. */
const rangeOf = (view: EditorView, source: string): [number, number] => {
  const from = view.state.text.indexOf(source);
  if (from < 0) throw new Error(`no ${source} in the document`);
  return [from, from + source.length];
};

/** Selects `source` whole, as a click on a component does. */
const selectNode = (view: EditorView, source: string) => {
  const [anchor, head] = rangeOf(view, source);
  act(() => view.select({ anchor, head, node: true }));
  view.focus();
};

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const unionOf = (rects: readonly Box[]): Box => {
  if (rects.length === 0) throw new Error("nothing laid out there");
  return {
    left: Math.min(...rects.map((r) => r.left)),
    top: Math.min(...rects.map((r) => r.top)),
    right: Math.max(...rects.map((r) => r.right)),
    bottom: Math.max(...rects.map((r) => r.bottom)),
  };
};

const apart = (a: Box, b: Box) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
const within1 = (inner: Box, outer: Box) =>
  inner.left >= outer.left - 1 &&
  inner.right <= outer.right + 1 &&
  inner.top >= outer.top - 1 &&
  inner.bottom <= outer.bottom + 1;

/** The editor's pane: what its bars, forms and menus stay inside. */
const paneBox = (view: EditorView): Box => (view.element.closest(".tse-root") as HTMLElement).getBoundingClientRect();

const formula = () => screen.getByRole("textbox", { name: /Formula/ }) as HTMLTextAreaElement;
const equationPanel = () => screen.queryByRole("dialog", { name: "Equation" });
/** Waits `n` frames, and for React to render what they set: the toolbars follow the view a frame late. */
const frames = (n = 2) =>
  act(
    () =>
      new Promise<void>((done) => {
        const step = (left: number) => (left ? requestAnimationFrame(() => step(left - 1)) : done());
        step(n);
      }),
  );

describe("<TypstEditor>", () => {
  it("shows the fixed toolbar and the pages, and bolds from the toolbar", async () => {
    const { view } = await mount("= Fractions\n\nAdd the fractions below.");
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeTruthy();
    // The page view paints at the next frame (or in idle time), after the layout arrives.
    await waitFor(
      () => document.querySelectorAll(".typstream-page canvas").length === 1,
      10_000,
      "for the page's canvas",
    );
    act(() => view.select({ anchor: 13, head: 16 }));
    await userEvent.click(screen.getAllByRole("button", { name: "Bold" })[0] as HTMLElement);
    expect(view.state.text).toBe("= Fractions\n\n*Add* the fractions below.");
    await page.screenshot({ path: "screenshots/toolbar.png" });
  });

  it("inserts a table from the insert menu and adds a row and a column from its bar", async () => {
    const { view } = await mount("A table:");
    act(() => view.select({ anchor: 8, head: 8 }));
    await userEvent.click(screen.getByRole("button", { name: "Insert" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /^Table/ }));
    expect(view.state.text).toContain("#table(");
    await laidOut(view);
    await waitFor(() => !!screen.queryByRole("button", { name: "Add a row below" }));
    await userEvent.click(screen.getByRole("button", { name: "Add a row below" }));
    await userEvent.click(screen.getByRole("button", { name: "Add a column right" }));
    expect(view.state.text).toContain("columns: (1fr, 1fr, 1fr, 1fr)");
    expect(view.state.text.match(/\n {2}\[/g)?.length).toBe(3);
    await page.screenshot({ path: "screenshots/table.png" });
  });

  it("inserts an edu question, types its text and sets its points on its bar", async () => {
    const { view } = await mount("= Quiz\n\nIntro.");
    act(() => view.select({ anchor: 14, head: 14 }));
    view.focus();
    await userEvent.click(screen.getByRole("button", { name: "Insert" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /^Question/ }));
    expect(view.state.text).toContain("#question(points: 1)[");
    // The sample text is selected: what is typed replaces it.
    await userEvent.keyboard("What is 2 + 2?");
    expect(view.state.text).toContain("[\n  What is 2 + 2?\n]");
    // A number is on the bar, not in a form behind Settings (it has no other settings).
    const bar = await barOf("Question");
    expect(within(bar).queryByRole("button", { name: "Settings" })).toBeNull();
    const points = within(bar).getByRole("textbox", { name: /Points/ });
    await userEvent.fill(points, "3");
    expect(view.state.text).toContain("#question(points: 3)[");
    // Enter gives the keys back to the document.
    await userEvent.keyboard("{Enter}");
    expect(view.focused).toBe(true);
    await page.screenshot({ path: "screenshots/question.png" });
  });

  it("puts the caret in a new multiple choice's first option, and in a new matching's first cell", async () => {
    const { view } = await mount("= Quiz\n\nIntro.");
    act(() => view.select({ anchor: 14, head: 14 }));
    view.focus();
    await userEvent.click(screen.getByRole("button", { name: "Insert" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /^Multiple choice/ }));
    // The first option's sample is selected: what is typed is that option, not a paragraph after the component.
    await userEvent.keyboard("Light");
    expect(view.state.text).toContain("#mcq([Light], [Second option], [Third option], answer: 1)");
    act(() => view.select({ anchor: view.state.text.length, head: view.state.text.length }));
    await userEvent.click(screen.getByRole("button", { name: "Insert" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /^Matching/ }));
    await userEvent.keyboard("Ideas");
    expect(view.state.text).toContain("([Ideas], [its match]),");
  });

  it("edits a mind map's topics on the page", async () => {
    const { view } = await mount("#mindmap[\n  Plants\n  - Roots\n  - Leaves\n]", [htmlCompat, edu, mindmap]);
    const at = view.state.text.indexOf("Leaves") + "Leaves".length;
    const g = view.layout?.glyphs.find((g) => g.to === at);
    expect(g).toBeDefined();
    act(() => view.select({ anchor: at, head: at }));
    view.focus();
    await userEvent.keyboard("{Enter}Stem");
    expect(view.state.text).toBe("#mindmap[\n  Plants\n  - Roots\n  - Leaves\n  - Stem\n]");
    await page.screenshot({ path: "screenshots/mindmap.png" });
  });

  it("links a selection from the toolbar's field", async () => {
    const { view } = await mount("Read the guide today.");
    act(() => view.select({ anchor: 5, head: 14 }));
    view.focus();
    // The fixed toolbar's (the floating one over the selection has one too).
    const fixed = screen.getByRole("toolbar", { name: "Formatting" });
    // A DOM click: the two buttons share a label, which a locator can't tell apart.
    act(() => within(fixed).getByRole("button", { name: "Link" }).click());
    await userEvent.type(screen.getByRole("textbox", { name: /Link to/ }), "https://typst.app{Enter}");
    expect(view.state.text).toBe('Read #link("https://typst.app")[the guide] today.');
  });

  it("inserts from the slash menu, and edits an equation in its field", async () => {
    const { view } = await mount("Intro.\n\n");
    act(() => view.select({ anchor: view.state.text.length, head: view.state.text.length }));
    view.focus();
    await userEvent.keyboard("/");
    await waitFor(() => !!screen.queryByRole("menuitem", { name: /^Equation/ }), 5000, "for the slash menu");
    // The filter is typed into the document, which keeps the focus.
    await userEvent.keyboard("equation");
    expect(view.focused).toBe(true);
    expect(screen.getAllByRole("menuitem").length).toBeLessThan(4);
    await userEvent.keyboard("{Enter}");
    // A new equation is selected whole, with its field: typing goes into its formula.
    expect(view.state.text).toBe("Intro.\n\n$ x $");
    expect(view.state.selection.node).toBe(true);
    await waitFor(() => !!screen.queryByRole("textbox", { name: /Formula/ }), 5000, "for the formula");
    await userEvent.keyboard("a^2 + b^2 = c^2");
    expect(view.state.text).toBe("Intro.\n\n$ a^2 + b^2 = c^2 $");
    await laidOut(view);
    await page.screenshot({ path: "screenshots/equation.png" });
    // Emptied and closed, it goes rather than staying as an invisible `$ $`.
    const field = screen.getByRole("textbox", { name: /Formula/ });
    await userEvent.clear(field);
    await userEvent.keyboard("{Enter}");
    expect(view.state.text).toBe("Intro.\n\n");
  });

  it("leaves the caret after an equation whose last word was quoted on closing", async () => {
    const { view } = await mount("Intro.\n\n$ x $ and more");
    act(() => view.select({ anchor: 8, head: 13, node: true }));
    view.focus();
    await waitFor(() => !!screen.queryByRole("textbox", { name: /Formula/ }), 5000, "for the formula");
    await userEvent.keyboard("v = dist");
    // The word being typed is text on the page (math has no `dist`): never an error there, and
    // never a formula without it.
    expect(view.state.text).toBe('Intro.\n\n$ v = "dist" $ and more');
    expect((screen.getByRole("textbox", { name: /Formula/ }) as HTMLTextAreaElement).value).toBe("v = dist");
    await laidOut(view);
    expect(view.errors).toEqual([]);
    await userEvent.keyboard("{Enter}");
    // Closing writes the word as typed, and the compiler says whether math knows it.
    await waitFor(() => view.state.text === 'Intro.\n\n$ v = "dist" $ and more', 10_000, "for the quoted word");
    expect(screen.queryByRole("dialog", { name: "Equation" })).toBeNull();
    // After the equation as it is now, not where it ended before the quotes.
    expect(view.state.selection).toMatchObject({ anchor: 22, head: 22 });
    expect(view.state.selection.node).toBeFalsy();
  });

  it("sets a passage's font from the font picker's search, and the document's when all of it is selected", async () => {
    const file = (bytes: number) => [{ path: "a.ttf", style: "normal", weight: [100, 900], bytes }];
    const index = {
      version: 1,
      base: "https://fonts.invalid/",
      families: {
        "alpha sans": { name: "Alpha Sans", files: file(1000) },
        "beta serif": { name: "Beta Serif", files: file(1000) },
        "heavy sans": { name: "Heavy Sans", files: file(9_000_000) },
      },
    };
    const fonts: TypstreamPlugin = {
      key: "test-fonts",
      editor: {
        fonts: {
          label: "Test fonts",
          families: ["Alpha Sans"],
          index: `data:application/json,${encodeURIComponent(JSON.stringify(index))}`,
          aliases: { Arial: "Beta Serif" },
        },
      },
    };
    const { view } = await mount("Hello world.", [htmlCompat, fonts]);
    // Named by what it shows, as the block and size menus are: found by its tooltip.
    const button = () => screen.getByTitle("Font");
    act(() => view.select({ anchor: 6, head: 11 }));
    await userEvent.click(button());
    // The short lists: Typst's own families and the plugin's.
    expect(screen.getByRole("menuitem", { name: "Libertinus Serif" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Alpha Sans" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Beta Serif" })).toBeNull();
    // The search finds the index's other families, but not one the engine wouldn't load.
    await userEvent.keyboard("heavy");
    await waitFor(() => !!screen.queryByText("Nothing found"));
    await userEvent.keyboard("{Control>}a{/Control}beta");
    await waitFor(() => !!screen.queryByRole("menuitem", { name: "Beta Serif" }), 5000, "for the index");
    // By the name a family stands in for, too.
    await userEvent.keyboard("{Control>}a{/Control}arial");
    await waitFor(() => !!screen.queryByRole("menuitem", { name: "Beta Serif Like Arial" }));
    await userEvent.keyboard("{Enter}");
    expect(view.state.text).toBe('Hello #text(font: "Beta Serif")[world].');
    expect(view.focused).toBe(true);
    await waitFor(() => button().textContent === "Beta Serif");
    // All of the document: its own rule, and no passage keeps a font.
    act(() => view.select({ anchor: 0, head: view.state.text.length }));
    // Two fonts in the selection: the button names none.
    await waitFor(() => button().textContent === "Font");
    await userEvent.click(button());
    await userEvent.click(screen.getByRole("menuitem", { name: "Alpha Sans" }));
    expect(view.state.text).toBe('#set text(font: "Alpha Sans")\n\nHello world.');
    await waitFor(() => button().textContent === "Alpha Sans");
    await userEvent.click(button());
    await userEvent.click(screen.getByRole("menuitem", { name: "Default" }));
    expect(view.state.text).toBe("Hello world.");
    await waitFor(() => button().textContent === "Font");
  });

  it("mounts once without plugins, keeping its history while it is typed into", async () => {
    const engine = createEngine({ spawn: spawn() });
    engines.push(engine);
    const views: EditorView[] = [];
    const Host = () => {
      const [source, setSource] = useState("Plain text.");
      // No plugins: the editor must not reopen on the re-render every change makes.
      return <TypstEditor source={source} engine={engine} onChange={setSource} onReady={(v) => views.push(v)} />;
    };
    render(<Host />);
    await waitFor(() => !!views[0]?.layout, 30_000, "for the layout");
    const view = views[0] as EditorView;
    act(() => view.select({ anchor: 6, head: 6 }));
    view.focus();
    await userEvent.keyboard("old ");
    await new Promise((r) => setTimeout(r, 300));
    expect(views).toHaveLength(1);
    expect(view.state.text).toBe("Plain old text.");
    expect(view.history.canUndo).toBe(true);
  });

  it("takes a source from outside that equals one it reported earlier (the app's own undo)", async () => {
    const engine = createEngine({ spawn: spawn() });
    engines.push(engine);
    const views: EditorView[] = [];
    let discard = () => {};
    const Host = () => {
      const [source, setSource] = useState("A");
      discard = () => setSource("A");
      return <TypstEditor source={source} engine={engine} onChange={setSource} onReady={(v) => views.push(v)} />;
    };
    render(<Host />);
    await waitFor(() => !!views[0]?.layout, 30_000, "for the layout");
    const view = views[0] as EditorView;
    act(() => view.select({ anchor: 1, head: 1 }));
    view.focus();
    // "Ax", back to "A" (reported twice now), then on to "Abc".
    await userEvent.keyboard("x{Backspace}bc");
    await waitFor(() => view.state.text === "Abc", 5_000, "for the keys");
    await new Promise((r) => setTimeout(r, 100));
    act(() => discard());
    await waitFor(() => view.state.text === "A", 5_000, "for the app's source");
  });

  it("opens the link's field from the floating toolbar, which stays while the field has the focus", async () => {
    const { view } = await mount("Read the guide today.");
    view.focus();
    act(() => view.select({ anchor: 5, head: 14 }));
    const bar = await floating();
    await clickIn(bar, within(bar).getByRole("button", { name: "Link" }));
    await waitFor(() => !!screen.queryByRole("textbox", { name: /Link to/ }), 5000, "for the link's field");
    const field = screen.getByRole("textbox", { name: /Link to/ });
    await waitFor(() => document.activeElement === field, 5000, "for the field's focus");
    await frames();
    expect(floatingBar()).toBe(bar);
    // What is typed goes into the field, not over the selected words.
    await userEvent.keyboard("https://typst.app");
    expect(view.state.text).toBe("Read the guide today.");
    await userEvent.keyboard("{Enter}");
    expect(view.state.text).toBe('Read #link("https://typst.app")[the guide] today.');
    expect(view.focused).toBe(true);
  });

  it("gives an open toolbar menu the keys: arrows, Home and End, letters, Enter, Space and Tab", async () => {
    const { view } = await mount("First line.\n\nSecond line.");
    view.focus();
    act(() => view.select({ anchor: 3, head: 3 }));
    await userEvent.click(screen.getByTitle("Turn into"));
    const menu = screen.getByRole("menu", { name: "Turn into" });
    const entries = within(menu).getAllByRole("menuitem");
    const focused = () => (document.activeElement as HTMLElement).textContent ?? "";
    // The focus is on the block's own kind; no key reaches the document behind.
    expect(focused()).toMatch(/^Text/);
    await userEvent.keyboard("{ArrowDown}");
    expect(focused()).toMatch(/^Heading 1/);
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    expect(document.activeElement).toBe(entries[entries.length - 1]);
    await userEvent.keyboard("{Home}");
    expect(document.activeElement).toBe(entries[0]);
    await userEvent.keyboard("{End}");
    expect(document.activeElement).toBe(entries[entries.length - 1]);
    // A letter goes to the next entry starting with it; one that starts none does nothing.
    await userEvent.keyboard("b");
    expect(focused()).toMatch(/^Bulleted list/);
    await userEvent.keyboard("x{Backspace}{Delete}");
    expect(view.state.text).toBe("First line.\n\nSecond line.");
    expect(view.state.selection).toMatchObject({ anchor: 3, head: 3 });
    await userEvent.keyboard("{Home}{ArrowDown}{Enter}");
    expect(view.state.text).toBe("= First line.\n\nSecond line.");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(view.focused).toBe(true);

    // Tab closes a menu and changes nothing; Space picks as Enter does.
    const align = screen.getByTitle(/^Align \(/);
    await userEvent.click(align);
    expect(screen.getByRole("menu", { name: "Align" })).toBeTruthy();
    expect(align.getAttribute("aria-expanded")).toBe("true");
    await userEvent.keyboard("{Tab}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(view.state.text).toBe("= First line.\n\nSecond line.");
    expect(view.focused).toBe(true);
    act(() => view.select({ anchor: 16, head: 16 }));
    await userEvent.click(align);
    await userEvent.keyboard("c");
    expect(focused()).toMatch(/^Center/);
    await userEvent.keyboard(" ");
    expect(view.state.text).toBe("= First line.\n\n#align(center)[Second line.]");

    // The swatches are a grid: Left and Right along a row, Up and Down between rows.
    const from = view.state.text.indexOf("Second");
    act(() => view.select({ anchor: from, head: from + 6 }));
    const colour = within(fixedBar()).getByTitle("Text colour");
    await clickIn(fixedBar(), colour);
    const swatches = within(screen.getByRole("listbox", { name: "Text colour" })).getAllByRole("option");
    await userEvent.keyboard("{ArrowRight}{ArrowDown}");
    expect(document.activeElement).toBe(swatches[6]);
    const hex = COLORS.find((c) => c.label === (document.activeElement as HTMLElement).title)?.value;
    await userEvent.keyboard("{Enter}");
    expect(view.state.text).toBe(`= First line.\n\n#align(center)[#text(fill: rgb("${hex}"))[Second] line.]`);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("keeps the selection when Escape closes a toolbar menu", async () => {
    const { view } = await mount("First line.\n\nSecond line.");
    view.focus();
    act(() => view.select({ anchor: 0, head: 5 }));
    for (const title of ["Turn into", "Font size", /^Align \(/]) {
      await clickIn(fixedBar(), within(fixedBar()).getByTitle(title));
      expect(screen.getByRole("menu")).toBeTruthy();
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("menu")).toBeNull();
      expect(view.state.selection).toMatchObject({ anchor: 0, head: 5 });
      expect(view.focused).toBe(true);
    }
    await clickIn(fixedBar(), within(fixedBar()).getByTitle("Highlight"));
    expect(screen.getByRole("listbox")).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    // The keys are the document's again, on the selection as it was.
    await userEvent.keyboard("Last");
    expect(view.state.text).toBe("Last line.\n\nSecond line.");
  });

  it("opens the slash menu at the caret, and leaves a `/` that wasn't for it as typed", async () => {
    const { view } = await mount("Intro.\n\n");
    const end = () => view.state.text.length;
    act(() => view.select({ anchor: end(), head: end() }));
    view.focus();
    await userEvent.keyboard("/");
    await waitFor(() => !!screen.queryByRole("menu", { name: "Insert" }), 5000, "for the slash menu");
    await frames();
    const caret = (view.element.querySelector(".typstream-editor-caret") as HTMLElement).getBoundingClientRect();
    const menu = (
      screen.getByRole("menu", { name: "Insert" }).closest(".tse-popover") as HTMLElement
    ).getBoundingClientRect();
    expect(caret.height).toBeGreaterThan(0);
    expect(menu.top).toBeGreaterThanOrEqual(caret.bottom);
    expect(menu.top - caret.bottom).toBeLessThan(16);
    expect(Math.abs(menu.left - caret.left)).toBeLessThan(24);
    // A filter that matches nothing: no menu, and at its first space the `/` is text for good.
    await userEvent.keyboard("2");
    await waitFor(() => !screen.queryByRole("menu"), 5000, "for the menu to go");
    await userEvent.keyboard(" = 0.5");
    await frames();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(view.state.text).toBe("Intro.\n\n\\/2 = 0.5");
    expect(view.focused).toBe(true);
    await userEvent.keyboard("{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}");
    await frames();
    expect(view.state.text).toBe("Intro.\n\n\\/");
    expect(screen.queryByRole("menu")).toBeNull();

    // Escape closes the menu and keeps the `/` and the filter as text; the keys stay the document's.
    await userEvent.keyboard("{Backspace}/eq");
    await waitFor(() => !!screen.queryByRole("menuitem", { name: /^Equation/ }), 5000, "for the slash menu");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => !screen.queryByRole("menu"), 5000, "for the menu to go");
    await userEvent.keyboard("ual");
    expect(view.state.text).toBe("Intro.\n\n\\/equal");
    // An empty line is written `~`, and takes the menu as an empty one does.
    await userEvent.keyboard("{Enter}");
    expect(view.state.text).toBe("Intro.\n\n\\/equal\n\n~");

    // `/` after text on its line is a fraction's, never the menu's.
    await userEvent.keyboard("1/2");
    await frames();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(view.state.text).toBe("Intro.\n\n\\/equal\n\n1/2");

    // The arrows choose, Enter inserts in place of the `/` and its filter; one undo brings them back.
    await userEvent.keyboard("{Enter}/table");
    await waitFor(() => !!screen.queryByRole("menuitem", { name: /^Table/ }), 5000, "for the slash menu");
    const first = () => screen.getAllByRole("menuitem").findIndex((e) => e.hasAttribute("data-highlighted"));
    expect(first()).toBe(0);
    await userEvent.keyboard("{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{ArrowDown}");
    await waitFor(() => first() === 1, 5000, "for the highlight to move");
    await userEvent.keyboard("{ArrowUp}{Enter}");
    const before = "Intro.\n\n\\/equal\n\n1/2\n\n";
    expect(view.state.text.startsWith(before)).toBe(true);
    expect(view.state.text.slice(before.length)).not.toContain("/");
    expect(view.state.text.length).toBeGreaterThan(before.length);
    expect(screen.queryByRole("menu")).toBeNull();
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(view.state.text).toBe(`${before}\\/`);
  });

  it("shows the floating toolbar once the pointer is released, clear of the selection's line", async () => {
    // What shows as the button comes up, heard before the editor hears it: a listener older than its own.
    const atRelease: boolean[] = [];
    const onUp = () => atRelease.push(!!document.querySelector(".tse-floating"));
    window.addEventListener("pointerup", onUp, true);
    const { view } = await mount("= Fractions\n\nAdd the fractions below, then check them.\n\nThen the next ones.");
    const from = pointOf(view, view.state.text.indexOf("fractions"));
    const to = pointOf(view, view.state.text.indexOf("check"));
    await userEvent.dragAndDrop(view.element, view.element, { sourcePosition: from, targetPosition: to });
    window.removeEventListener("pointerup", onUp, true);
    expect(view.state.text.slice(view.state.from, view.state.to)).toMatch(/^f?ractions below, then/);
    expect(atRelease).toEqual([false]);
    const bar = (await floating()).getBoundingClientRect();
    const line = view.selectionRects()[0] as DOMRect;
    // Above the selection, with a gap: the pointer on the selection's line isn't on a button.
    expect(bar.bottom).toBeLessThanOrEqual(line.top - 8);
    expect(bar.bottom).toBeGreaterThan(line.top - 24);
    // A selection made with the keys shows it at once, as before.
    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() => !floatingBar(), 5000, "for the toolbar to go");
    await userEvent.keyboard("{Shift>}{ArrowRight}{ArrowRight}{/Shift}");
    await floating();
  });

  it("puts the floating toolbar below a selection under the fixed toolbar, and hides it when that scrolls away", async () => {
    const lines = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1} of the worksheet.`).join("\n\n");
    const { view } = await mount(lines);
    const at = view.state.text.indexOf("Paragraph 12");
    view.focus();
    act(() => view.select({ anchor: at, head: at + 9 }));
    const fixed = () => fixedBar().getBoundingClientRect();
    const line = () => view.selectionRects()[0] as DOMRect;
    const bar = () => (floatingBar() as HTMLElement).getBoundingClientRect();
    await floating();
    expect(bar().bottom).toBeLessThanOrEqual(line().top - 8);
    // The toolbar is placed again on the scroll's event, a frame later.
    const scrollBy = async (y: number) => {
      window.scrollBy(0, y);
      await frames(3);
    };
    // The line a little under the fixed toolbar: above it, the toolbar would cover the fixed one.
    await scrollBy(line().top - 40);
    await scrollBy(line().top - fixed().bottom - 30);
    expect(line().top - fixed().bottom).toBeCloseTo(30, 0);
    expect(bar().top).toBeGreaterThanOrEqual(line().bottom + 8);
    expect(bar().top).toBeLessThan(line().bottom + 24);
    // The line under the fixed toolbar, then far above it: no toolbar over the fixed one.
    await scrollBy(line().bottom - fixed().top - 10);
    expect(floatingBar()).toBeNull();
    await scrollBy(300);
    expect(floatingBar()).toBeNull();
    // Back in view, it is back.
    await scrollBy(-window.scrollY);
    expect(bar().bottom).toBeLessThanOrEqual(line().top - 8);
    expect(bar().bottom).toBeGreaterThan(line().top - 24);
  });

  it("keeps the floating toolbar and a component's bar apart, and both off the fixed toolbar, as the page scrolls", async () => {
    const lines = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1} of the worksheet.`);
    lines[11] = "#question(points: 1)[\n  Balance these equations.\n]";
    const { view } = await mount(lines.join("\n\n"));
    const at = view.state.text.indexOf("Balance");
    view.focus();
    act(() => view.select({ anchor: at, head: at + 7 }));
    const line = () => view.selectionRects()[0] as DOMRect;
    const fixed = () => fixedBar().getBoundingClientRect();
    await floating();
    await barOf("Question");
    const check = () => {
      const bar = componentBar()?.getBoundingClientRect();
      const float = floatingBar()?.getBoundingClientRect();
      if (bar && float) expect(apart(bar, float)).toBe(true);
      if (bar) expect(bar.top).toBeGreaterThanOrEqual(fixed().bottom);
      if (float) expect(float.top).toBeGreaterThanOrEqual(fixed().bottom);
      return { bar, float };
    };
    // In the middle of the pane: both show, the bar above its question.
    const middle = check();
    const box = unionOf(view.boxesOf(...rangeOf(view, "#question(points: 1)[\n  Balance these equations.\n]")));
    expect(middle.bar && middle.float).toBeTruthy();
    expect((middle.bar as DOMRect).bottom).toBeLessThanOrEqual(box.top);
    // The question's line just under the fixed toolbar: no room above it for either.
    for (let i = 0; i < 2; i++) {
      window.scrollBy(0, line().top - fixed().bottom - 6);
      await frames(3);
    }
    expect(line().top - fixed().bottom).toBeLessThan(12);
    const under = check();
    expect(under.bar && under.float).toBeTruthy();
    const moved = unionOf(view.boxesOf(...rangeOf(view, "#question(points: 1)[\n  Balance these equations.\n]")));
    expect((under.bar as DOMRect).top).toBeGreaterThanOrEqual(moved.bottom);
    // Scrolled away: neither is left over the fixed toolbar or the pane.
    window.scrollBy(0, 400);
    await frames(3);
    expect(componentBar()).toBeNull();
    expect(floatingBar()).toBeNull();
  });

  it("reaches the fixed toolbar with Alt+F10: one Tab stop, the arrows, Escape back to the selection", async () => {
    const { view } = await mount("First line.\n\nSecond line.");
    view.focus();
    act(() => view.select({ anchor: 0, head: 5 }));
    const controls = () => [...fixedBar().querySelectorAll<HTMLButtonElement>("button")];
    const enabled = () => controls().filter((b) => !b.disabled);
    const stops = () => controls().filter((b) => b.tabIndex === 0);
    expect(stops()).toHaveLength(1);
    await userEvent.keyboard("{Alt>}{F10}{/Alt}");
    // Undo and Redo have nothing to do yet: the first control that does.
    expect(enabled()[0]?.disabled).toBe(false);
    expect(document.activeElement).toBe(enabled()[0]);
    expect(controls()[0]?.disabled).toBe(true);
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(enabled()[1]);
    expect(stops()).toEqual([enabled()[1]]);
    await userEvent.keyboard("{End}");
    expect(document.activeElement).toBe(enabled()[enabled().length - 1]);
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(enabled()[0]);
    await userEvent.keyboard("{ArrowLeft}{Home}");
    expect(document.activeElement).toBe(enabled()[0]);
    expect(view.state.text).toBe("First line.\n\nSecond line.");
    await userEvent.keyboard("{Escape}");
    expect(view.focused).toBe(true);
    expect(view.state.selection).toMatchObject({ anchor: 0, head: 5 });
    // A control pressed from the keys acts on that selection.
    await userEvent.keyboard("{Alt>}{F10}{/Alt}");
    const bold = within(fixedBar()).getByRole("button", { name: "Bold" });
    for (let i = 0; i < 20 && document.activeElement !== bold; i++) await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(bold);
    await userEvent.keyboard("{Enter}");
    expect(view.state.text).toBe("*First* line.\n\nSecond line.");
  });

  it("opens the link's field on Ctrl+K, makes a Heading 4 on Ctrl+Alt+4, and shows shortcuts in the menus", async () => {
    const { view } = await mount("Read the guide today.");
    view.focus();
    // Nothing to link at a caret in plain words.
    act(() => view.select({ anchor: 2, head: 2 }));
    await userEvent.keyboard("{Control>}k{/Control}");
    await frames();
    expect(screen.queryByRole("textbox", { name: /Link to/ })).toBeNull();
    act(() => view.select({ anchor: 5, head: 14 }));
    await floating();
    await userEvent.keyboard("{Control>}k{/Control}");
    await waitFor(
      () => document.activeElement === screen.queryByRole("textbox", { name: /Link to/ }),
      5000,
      "for the field",
    );
    await userEvent.keyboard("https://typst.app{Enter}");
    expect(view.state.text).toBe('Read #link("https://typst.app")[the guide] today.');
    // With the caret in a link: its field, with the link in it.
    const inside = view.state.text.indexOf("guide") + 2;
    act(() => view.select({ anchor: inside, head: inside }));
    await userEvent.keyboard("{Control>}k{/Control}");
    await waitFor(() => !!screen.queryByRole("textbox", { name: /Link to/ }), 5000, "for the field");
    expect((screen.getByRole("textbox", { name: /Link to/ }) as HTMLInputElement).value).toBe("https://typst.app");
    await userEvent.keyboard("{Escape}");
    expect(view.focused).toBe(true);
    expect(within(fixedBar()).getByRole("button", { name: "Link" }).title).toBe("Link (Ctrl+K)");
    // The button is drawn as on in a link, and only there.
    await frames();
    expect(within(fixedBar()).getByRole("button", { name: "Link" }).hasAttribute("data-active")).toBe(true);

    act(() => view.select({ anchor: 2, head: 2 }));
    await frames();
    expect(within(fixedBar()).getByRole("button", { name: "Link" }).hasAttribute("data-active")).toBe(false);
    await userEvent.keyboard("{Control>}{Alt>}4{/Alt}{/Control}");
    expect(view.state.text).toBe('==== Read #link("https://typst.app")[the guide] today.');
    await clickIn(fixedBar(), within(fixedBar()).getByTitle("Turn into"));
    expect(screen.getByRole("menuitem", { name: /^Heading 4/ }).textContent).toBe("Heading 4Ctrl+Alt+4");
    await userEvent.keyboard("{Escape}");
    const align = screen.getByTitle(/^Align \(/);
    expect(align.title).toBe("Align (Ctrl+Shift+L, Ctrl+Shift+E, Ctrl+Shift+R)");
    await clickIn(fixedBar(), align);
    expect(screen.getAllByRole("menuitem").map((e) => e.textContent)).toEqual([
      "Align leftCtrl+Shift+L",
      "CenterCtrl+Shift+E",
      "Align rightCtrl+Shift+R",
    ]);
  });

  it("keeps the fixed toolbar one row and the floating toolbar inside a narrow editor", async () => {
    const { view } = await mount("= Fractions\n\nAdd the fractions below, then check them.", [htmlCompat, edu], 320);
    const root = () => (view.element.closest(".tse-root") as HTMLElement).getBoundingClientRect();
    const height = () => fixedBar().getBoundingClientRect().height;
    view.focus();
    act(() => view.select({ anchor: 20, head: 20 }));
    await frames();
    const one = height();
    // One row of buttons, whatever the selection makes them say.
    expect(one).toBeLessThan(48);
    expect(fixedBar().getBoundingClientRect().width).toBeLessThanOrEqual(root().width);
    for (const [anchor, head] of [
      [2, 11],
      [13, 40],
      [0, view.state.text.length],
    ] as const) {
      act(() => view.select({ anchor, head }));
      const bar = (await floating()).getBoundingClientRect();
      await frames();
      expect(height()).toBe(one);
      expect(bar.left).toBeGreaterThanOrEqual(root().left);
      expect(bar.right).toBeLessThanOrEqual(root().right);
    }
    // What the row has no room for is reached by scrolling it, and by the keys.
    const row = fixedBar().querySelector(".tse-fixed-items") as HTMLElement;
    expect(row.scrollWidth).toBeGreaterThan(row.clientWidth);
    await userEvent.keyboard("{Alt>}{F10}{/Alt}{End}");
    // The toolbar's end (a plugin's switch) is in view; the row's last control is the one before it.
    const end = fixedBar().querySelector(".tse-fixed-end") as HTMLElement | null;
    if (end?.contains(document.activeElement)) {
      expect((document.activeElement as HTMLElement).getBoundingClientRect().right).toBeLessThanOrEqual(root().right);
      await userEvent.keyboard("{ArrowLeft}");
    }
    const last = document.activeElement as HTMLElement;
    expect(row.contains(last)).toBe(true);
    expect(last.getBoundingClientRect().right).toBeLessThanOrEqual(row.getBoundingClientRect().right + 1);
    await page.screenshot({ path: "screenshots/narrow.png" });
  });
});

describe("<TypstEditor>: settings forms", () => {
  it("writes only a count its component takes, says what fits, and gives the keys back on Tab", async () => {
    const { view } = await mount("= Quiz\n\n#answer-lines(count: 2)\n\nAfter.");
    selectNode(view, "#answer-lines(count: 2)");
    const bar = await barOf("Answer lines");
    // The count is on the bar; the answer, a text, in its form.
    const lines = within(bar).getByRole("textbox", { name: /^Lines/ }) as HTMLInputElement;
    await userEvent.click(within(bar).getByRole("button", { name: "Settings" }));
    // The keyboard is in the form's first field.
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: /^Answer/ }));
    // By its component: inside the pane, over neither the component nor the fixed toolbar.
    await frames();
    const form = (document.querySelector(".tse-form") as HTMLElement).getBoundingClientRect();
    const box = unionOf(view.boxesOf(...rangeOf(view, "#answer-lines(count: 2)")));
    expect(within1(form, paneBox(view))).toBe(true);
    expect(apart(form, box)).toBe(true);
    expect(apart(form, fixedBar().getBoundingClientRect())).toBe(true);
    expect(
      Math.min(Math.abs(form.top - box.bottom), Math.abs(form.bottom - bar.getBoundingClientRect().top)),
    ).toBeLessThan(24);

    // Half a line and a 31st of 30: not written, and the source keeps the count it had.
    await page.screenshot({ path: "screenshots/settings.png" });
    // Tab past the form's last field closes it: the keys are the document's again.
    await userEvent.keyboard("{Tab}");
    await waitFor(() => !document.querySelector(".tse-form"), 5000, "for the form to close");
    expect(view.focused).toBe(true);
    // On the bar, the field says what fits (in its tooltip) and keeps what it can't take out of the source.
    for (const refused of ["2.5", "31", "0", "-4", "many"]) {
      await userEvent.fill(lines, refused);
      expect(lines.getAttribute("aria-invalid")).toBe("true");
      expect(lines.closest("label")?.title).toBe("A whole number from 1 to 30.");
      expect(view.state.text).toContain("#answer-lines(count: 2)");
    }
    await userEvent.fill(lines, "12");
    expect(lines.getAttribute("aria-invalid")).toBeNull();
    expect(view.state.text).toContain("#answer-lines(count: 12)");
  });

  it("gives a size typed without a unit its field's unit, and refuses what isn't a size", async () => {
    const { view } = await mount("Fill in #blank(answer: [seven], width: 4em) here.");
    selectNode(view, "#blank(answer: [seven], width: 4em)");
    const bar = await barOf("Blank");
    await userEvent.click(within(bar).getByRole("button", { name: "Settings" }));
    const answer = screen.getByRole("textbox", { name: /^Answer/ }) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(answer);
    const width = screen.getByRole("textbox", { name: /^Width/ }) as HTMLInputElement;
    await userEvent.fill(width, "6");
    expect([width.value, screen.queryByRole("alert")?.textContent, view.state.text]).toEqual([
      "6",
      undefined,
      "Fill in #blank(answer: [seven], width: 6em) here.",
    ]);
    // What isn't a size is not written: the blank is as wide as it was before the field was typed in.
    for (const refused of ["2 apples", "0", "-3cm", "9000cm"]) {
      await userEvent.fill(width, refused);
      expect(width.getAttribute("aria-invalid")).toBe("true");
      expect(screen.getByRole("alert").textContent).not.toMatch(/[#$[\]]/);
      expect(view.state.text).toBe("Fill in #blank(answer: [seven], width: 4em) here.");
    }
    await userEvent.fill(width, "2,5cm");
    expect(view.state.text).toBe("Fill in #blank(answer: [seven], width: 2.5cm) here.");
    // Shift+Tab before the first field closes it too.
    answer.focus();
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    await waitFor(() => !document.querySelector(".tse-form"), 5000, "for the form to close");
    expect(view.focused).toBe(true);
  });

  it("shows an answer that is a formula as its words, read-only, and never flattens it", async () => {
    const source = 'Salt is #blank(answer: ce("2Na + Cl2 -> 2NaCl")).';
    const { view } = await mount(source);
    selectNode(view, '#blank(answer: ce("2Na + Cl2 -> 2NaCl"))');
    const bar = await barOf("Blank");
    await userEvent.click(within(bar).getByRole("button", { name: "Settings" }));
    const answer = screen.getByRole("textbox", { name: /^Answer/ }) as HTMLTextAreaElement;
    expect(answer.readOnly).toBe(true);
    // Its words, without the Typst around them.
    expect(answer.value).toBe("2Na + Cl2 -> 2NaCl");
    const form = document.querySelector(".tse-form") as HTMLElement;
    expect(form.textContent).toContain("This has a formula or formatting, so it can't be changed here.");
    expect(form.textContent).not.toMatch(/ce\(|[#"]/);
    // The keyboard starts in the first field that can be typed in, and typing there leaves the answer.
    const width = screen.getByRole("textbox", { name: /^Width/ }) as HTMLInputElement;
    expect(document.activeElement).toBe(width);
    await userEvent.keyboard("5");
    expect(view.state.text).toBe('Salt is #blank(answer: ce("2Na + Cl2 -> 2NaCl"), width: 5em).');
    // Asked for, it is written again as plain text.
    await userEvent.click(within(form).getByRole("button", { name: "Write it again as plain text" }));
    expect(view.state.text).toBe("Salt is #blank(width: 5em).");
    await waitFor(() => !(screen.getByRole("textbox", { name: /^Answer/ }) as HTMLTextAreaElement).readOnly);
    await userEvent.fill(screen.getByRole("textbox", { name: /^Answer/ }), "NaCl");
    expect(view.state.text).toBe("Salt is #blank(width: 5em, answer: [NaCl]).");
  });
});

describe("<TypstEditor>: what a component's package draws", () => {
  /**
   * The lines a package drew (glyphs that show none of the document's text), top to bottom then
   * left to right, each one's glyphs left to right: a multiple choice's `(a) H₂O`, then `(b) NaCl`.
   */
  const drawnLines = (view: EditorView) => {
    type G = NonNullable<EditorView["layout"]>["glyphs"][number];
    const lines = new Map<number, G[]>();
    for (const g of view.layout?.glyphs ?? []) if (g.from < 0) lines.set(g.line, [...(lines.get(g.line) ?? []), g]);
    return [...lines.values()]
      .map((glyphs) => glyphs.sort((a, b) => a.x - b.x))
      .sort((a, b) => (a[0] as G).y - (b[0] as G).y || (a[0] as G).x - (b[0] as G).x);
  };
  /** A real click on a glyph of the page. */
  const clickGlyph = async (view: EditorView, g: ReturnType<typeof drawnLines>[number][number] | undefined) => {
    if (!g) throw new Error("no such glyph");
    const r = view.toClient({ page: g.page, x: g.x, y: g.y - g.ascent / 2, width: g.width, height: 1 }) as DOMRect;
    const host = view.element.getBoundingClientRect();
    await userEvent.click(view.element, { position: { x: r.left + r.width / 4 - host.left, y: r.top - host.top } });
  };

  it("opens the field of a formula among a multiple choice's options from one click on it", async () => {
    const source = 'Which is water?\n\n#mcq(ce("H2O"), ce("NaCl"), answer: 1)\n\nAnd salt?';
    const { view } = await mount(source);
    // `(a) H₂O`: brackets round a letter, then the formula.
    await clickGlyph(view, drawnLines(view)[0]?.[3]);
    await waitFor(() => !!screen.queryByRole("textbox", { name: /^Formula/ }), 5000, "for the field");
    expect(view.state.text).toBe('Which is water?\n\n#mcq([#ce("H2O")], [#ce("NaCl")], answer: 1)\n\nAnd salt?');
    expect(view.state.text.slice(view.state.from, view.state.to)).toBe('#ce("H2O")');
    // Its field is open, with the keyboard in it, the caret after the formula: no Settings to click first,
    // and one panel, its name and Delete on top, not a bar besides.
    const panel = screen.getByRole("dialog", { name: "Chemical formula" });
    expect(within(panel).getByRole("button", { name: "Delete the chemical formula" })).toBeTruthy();
    expect(componentBar()).toBeNull();
    const field = screen.getByRole("textbox", { name: /^Formula/ }) as HTMLInputElement;
    expect(document.activeElement).toBe(field);
    expect([field.value, field.selectionStart]).toEqual(["H2O", 3]);
    await userEvent.keyboard("2");
    expect(view.state.text).toContain('#mcq([#ce("H2O2")], [#ce("NaCl")], answer: 1)');
    await userEvent.keyboard("{Escape}");
    await page.screenshot({ path: "screenshots/option-formula.png" });
    // A click on an option's letter is on the multiple choice.
    await waitFor(() => view.laidOut, 5000, "for the pages");
    await clickGlyph(view, drawnLines(view)[1]?.[1]);
    await barOf("Multiple choice");
    expect(view.state.selection.node).toBe(true);
  });

  it("leaves a multiple choice as it is written after a click on an option's letter", async () => {
    const source = 'Which is water?\n\n#mcq(ce("H2O"), ce("NaCl"), answer: 1)';
    const { view, changes } = await mount(source);
    await clickGlyph(view, drawnLines(view)[1]?.[1]);
    await barOf("Multiple choice");
    await waitFor(() => view.laidOut && view.state.text === source, 5000, "for the source as it was");
    expect(view.state.selection).toEqual({ anchor: source.indexOf("#mcq"), head: source.length, node: true });
    // The app's source ends as it began.
    await frames();
    expect(changes.at(-1) ?? source).toBe(source);
  });

  it("adds and removes a matching's pairs with Tab and Backspace, each cell text on the page", async () => {
    const source = "#matching(\n  ([Dog], [chien]),\n  ([Cat], [chat]),\n)";
    const { view } = await mount(source);
    // A cell is text on the page: a click puts the caret in it.
    const at = pointOf(view, view.state.text.indexOf("[Cat]") + 3);
    await userEvent.click(view.element, { position: at });
    await barOf("Matching");
    await userEvent.keyboard("t");
    expect(view.state.text).toContain("([Catt], [chat]),");
    // Tab past the last cell adds a pair; Backspace in it, still empty, takes it away.
    const last = view.state.text.indexOf("[chat]") + "[chat".length;
    act(() => view.select({ anchor: last, head: last }));
    view.focus();
    await userEvent.keyboard("{Tab}");
    expect(view.state.text).toContain("  ([Catt], [chat]),\n  ([~], [~]),\n)");
    await userEvent.keyboard("Bird");
    expect(view.state.text).toContain("([Bird], [~]),");
    await userEvent.keyboard("{Backspace>4/}{Backspace}");
    expect(view.state.text).toBe("#matching(\n  ([Dog], [chien]),\n  ([Catt], [chat]),\n)");
  });

  it("sets a component's choices and yes/no on its bar, a title that is the kind's name following it", async () => {
    const source = '#callout(kind: "note", title: [Note])[Mind the units.]\n\n#true-false(answer: true)[Ice floats.]';
    const { view } = await mount(source);
    selectNode(view, '#callout(kind: "note", title: [Note])[Mind the units.]');
    const bar = await barOf("Callout");
    await userEvent.selectOptions(within(bar).getByRole("combobox", { name: /Kind/ }), "Warning");
    expect(view.state.text).toContain('#callout(kind: "warning", title: [Warning])[Mind the units.]');
    // One step: Undo brings back both.
    view.undo();
    expect(view.state.text).toBe(source);
    // A title of the teacher's own stays.
    act(() => view.setText(source.replace("[Note]", "[Units]")));
    selectNode(view, '#callout(kind: "note", title: [Units])[Mind the units.]');
    await userEvent.selectOptions(within(await barOf("Callout")).getByRole("combobox", { name: /Kind/ }), "Tip");
    expect(view.state.text).toContain('#callout(kind: "tip", title: [Units])');
    // Two choices are buttons, the one written pressed.
    selectNode(view, "#true-false(answer: true)[Ice floats.]");
    const tf = await barOf("True or false");
    const no = within(tf).getByRole("button", { name: "False" });
    expect(within(tf).getByRole("button", { name: "True" }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(no);
    expect(view.state.text).toContain("#true-false(answer: false)[Ice floats.]");
    // The keys stay the document's.
    expect(view.focused).toBe(true);
  });

  it("marks a multiple choice's correct option by its letter on the bar", async () => {
    const { view } = await mount("#mcq([Venus], [Mercury], [Mars], answer: 1)");
    const at = view.state.text.indexOf("Mars") + 1;
    act(() => view.select({ anchor: at, head: at }));
    view.focus();
    const bar = await barOf("Multiple choice");
    expect(within(bar).getByTitle("Correct option: a").getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(within(bar).getByTitle("Correct option: b"));
    expect(view.state.text).toBe("#mcq([Venus], [Mercury], [Mars], answer: 2)");
    // An option more: a letter more.
    await userEvent.keyboard("{End}{Enter}Earth");
    await waitFor(() => !!within(bar).queryByTitle("Correct option: d"), 5000, "for d");
  });

  it("shows the answers on the pages while its switch is on, to edit there, the document unchanged", async () => {
    const source = "Water boils at #blank(answer: [100]) °C.";
    const { view } = await mount(source);
    const answers = () => within(fixedBar()).getByRole("button", { name: "Show answers" });
    expect(answers().getAttribute("aria-pressed")).toBe("false");
    // Hidden: the answer isn't on the page.
    expect(view.boxesOf(source.indexOf("100"), source.indexOf("100") + 3)).toEqual([]);
    await userEvent.click(answers());
    expect(answers().getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => view.boxesOf(source.indexOf("100"), source.indexOf("100") + 3).length > 0, 10_000, "for it");
    expect(view.state.text).toBe(source);
    // A click on it puts the caret in it.
    await userEvent.click(view.element, { position: pointOf(view, source.indexOf("100") + 2) });
    await userEvent.keyboard("{Backspace}{Backspace}21");
    expect(view.state.text).toBe("Water boils at #blank(answer: [210]) °C.");
    await page.screenshot({ path: "screenshots/answers.png" });
    await userEvent.click(answers());
    await waitFor(() => view.boxesOf(source.indexOf("100"), source.indexOf("100") + 3).length === 0, 10_000, "gone");
  });
});

describe("<TypstEditor>: bars and names", () => {
  it("names every component in the teacher's words, with one outline and its bar by it", async () => {
    const source = [
      "First words.",
      "#line(length: 100%)",
      'Water is #ce("H2O") and ice.',
      "#table(\n  columns: 2,\n  [A], [B],\n  [C], [D],\n)",
      "#circle(radius: 6pt)",
      "#pagebreak()",
      "Last words.",
    ].join("\n\n");
    const { view } = await mount(source);
    const cases: [string, string][] = [
      ["#line(length: 100%)", "Divider"],
      ['#ce("H2O")', "Chemical formula"],
      ["#circle(radius: 6pt)", "Component"],
      ["#pagebreak()", "Page break"],
    ];
    for (const [src, label] of cases) {
      selectNode(view, src);
      const bar = (await barOf(label)).getBoundingClientRect();
      await frames();
      // The teacher's name, never the function's.
      expect((componentBar() as HTMLElement).textContent).not.toMatch(/line\(|pagebreak|circle|ce\b/);
      expect(
        within(componentBar() as HTMLElement).getByRole("button", { name: `Delete the ${label.toLowerCase()}` }),
      ).toBeTruthy();
      // One outline, around the component.
      expect([label, view.element.querySelectorAll(".typstream-editor-component").length]).toEqual([label, 1]);
      const boxes = view.boxesOf(...rangeOf(view, src));
      if (boxes.length === 0) continue;
      const box = unionOf(boxes);
      // The bar by it: above, or below where there is no room above; in the pane, off the fixed toolbar.
      expect(apart(bar, box)).toBe(true);
      expect(Math.min(Math.abs(box.top - bar.bottom), Math.abs(bar.top - box.bottom))).toBeLessThan(16);
      expect(within1(bar, paneBox(view))).toBe(true);
      expect(apart(bar, fixedBar().getBoundingClientRect())).toBe(true);
    }
    // A chemical formula's field opens on Enter (and on a click).
    selectNode(view, '#ce("H2O")');
    await barOf("Chemical formula");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => !!screen.queryByRole("textbox", { name: /^Formula/ }), 5000, "for the field");
    const field = screen.getByRole("textbox", { name: /^Formula/ }) as HTMLInputElement;
    expect(field.value).toBe("H2O");
    await userEvent.fill(field, "CO2");
    expect(view.state.text).toContain('Water is #ce("CO2") and ice.');
    await page.screenshot({ path: "screenshots/bars.png" });
  });

  it("opens a formula's field on a click or Enter, never on a key that selected it", async () => {
    const source = 'Salt is #ce("NaCl") here.';
    const { view } = await mount(source);
    const end = source.indexOf(" here");
    act(() => view.select({ anchor: end, head: end }));
    view.focus();
    // Backspace beside it selects it; its field stays shut, so the next Backspace deletes it, not its last letter.
    await userEvent.keyboard("{Backspace}");
    await barOf("Chemical formula");
    await frames();
    expect(screen.queryByRole("textbox", { name: /^Formula/ })).toBeNull();
    expect(view.focused).toBe(true);
    // Enter opens it, the keyboard in it.
    await userEvent.keyboard("{Enter}");
    await waitFor(() => !!screen.queryByRole("textbox", { name: /^Formula/ }), 5000, "for the field");
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: /^Formula/ }));
    expect(view.state.text).toBe(source);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => view.focused, 5000, "for the keys back on the page");
    expect(view.state.selection.node).toBe(true);
    await userEvent.keyboard("{Backspace}");
    expect(view.state.text).toBe("Salt is  here.");
  });

  it("puts a table's bar and its ➕ on the table as it is drawn, not on the line it stands on", async () => {
    const { view } = await mount("Before.\n\n#table(\n  columns: 2,\n  [A], [B],\n  [C], [D],\n)\n\nAfter.");
    const cell = view.state.text.indexOf("[A]") + 1;
    view.focus();
    act(() => view.select({ anchor: cell, head: cell }));
    const bar = (await barOf("Table")).getBoundingClientRect();
    await waitFor(() => document.querySelectorAll(".tse-edge").length === 2, 5000, "for the table's edges");
    const [from, to] = [view.state.text.indexOf("#table("), view.state.text.indexOf("\n\nAfter.")];
    const box = unionOf(view.boxesOf(from, to));
    const pane = paneBox(view);
    // Two narrow columns: the table is far narrower than the page.
    expect(box.right - box.left).toBeLessThan((pane.right - pane.left) / 3);
    expect(view.element.querySelectorAll(".typstream-editor-component")).toHaveLength(1);
    const outline = (view.element.querySelector(".typstream-editor-component") as HTMLElement).getBoundingClientRect();
    expect(Math.abs(outline.right - box.right)).toBeLessThan(6);
    const centre = (label: string) => {
      const r = screen.getByRole("button", { name: label }).getBoundingClientRect();
      return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
    };
    // On its bottom border, in its middle; on its right border, in its middle.
    expect(Math.abs(centre("Add a row").y - box.bottom)).toBeLessThan(2);
    expect(Math.abs(centre("Add a row").x - (box.left + box.right) / 2)).toBeLessThan(2);
    expect(Math.abs(centre("Add a column").x - box.right)).toBeLessThan(2);
    expect(Math.abs(centre("Add a column").y - (box.top + box.bottom) / 2)).toBeLessThan(2);
    expect(bar.bottom).toBeLessThanOrEqual(box.top);
    expect(box.top - bar.bottom).toBeLessThan(16);
    await userEvent.click(screen.getByRole("button", { name: "Add a column" }));
    expect(view.state.text).toContain("columns: 3");
    await page.screenshot({ path: "screenshots/table-edges.png" });
  });

  it("says so when an address can't be a link, and leaves the words as they were", async () => {
    const { view } = await mount("Read the guide today.");
    act(() => view.select({ anchor: 5, head: 14 }));
    view.focus();
    act(() => within(fixedBar()).getByRole("button", { name: "Link" }).click());
    const field = screen.getByRole("textbox", { name: /Link to/ });
    await userEvent.type(field, "javascript:alert(1){Enter}");
    expect(screen.getByRole("alert").textContent).toMatch(/This address can't be used/);
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(view.state.text).toBe("Read the guide today.");
    // Typing again takes the message away; a good address is taken.
    await userEvent.clear(field);
    expect(screen.queryByRole("alert")).toBeNull();
    await userEvent.type(field, "https://typst.app{Enter}");
    expect(view.state.text).toBe('Read #link("https://typst.app")[the guide] today.');
  });
});

describe("<TypstEditor>: menus and the toolbar's state", () => {
  it("moves through the insert menu with the arrows, around its ends, Home and End, the item in view", async () => {
    const { view } = await mount("Intro.\n\nSecond line.");
    view.focus();
    act(() => view.select({ anchor: 6, head: 6 }));
    await userEvent.click(screen.getByRole("button", { name: "Insert" }));
    const items = () => screen.getAllByRole("menuitem");
    const at = () => items().findIndex((e) => e.hasAttribute("data-highlighted"));
    const inView = () => {
      const item = (items()[at()] as HTMLElement).getBoundingClientRect();
      const list = (document.querySelector(".tse-searchable .tse-scroll") as HTMLElement).getBoundingClientRect();
      return item.top >= list.top - 1 && item.bottom <= list.bottom + 1;
    };
    expect(at()).toBe(0);
    // The caret stays drawn where the item will go, while the search has the keyboard.
    const root = view.element.closest(".tse-root") as HTMLElement;
    const caret = view.element.querySelector(".typstream-editor-caret") as HTMLElement;
    expect(root.hasAttribute("data-inserting")).toBe(true);
    expect(view.focused).toBe(false);
    expect(getComputedStyle(caret).display).not.toBe("none");
    expect(caret.getBoundingClientRect().height).toBeGreaterThan(0);
    // Up from the first is the last, scrolled into view; Down from it the first again.
    await userEvent.keyboard("{ArrowUp}");
    await frames();
    expect(at()).toBe(items().length - 1);
    expect(inView()).toBe(true);
    await userEvent.keyboard("{ArrowDown}");
    await frames();
    expect(at()).toBe(0);
    expect(inView()).toBe(true);
    await userEvent.keyboard("{End}");
    await frames();
    expect(at()).toBe(items().length - 1);
    expect(inView()).toBe(true);
    await userEvent.keyboard("{Home}{ArrowDown}{ArrowDown}");
    expect(at()).toBe(2);
    // Words a teacher looks for find what the editor calls otherwise.
    for (const [query, label] of [
      ["bullet", "Bulleted list"],
      ["heading", "Heading 1"],
      ["fraction", "Equation"],
      ["text box", "Callout"],
    ] as const) {
      await userEvent.fill(screen.getByRole("textbox", { name: "Search what to insert" }), query);
      expect((items()[0] as HTMLElement).textContent?.startsWith(label)).toBe(true);
    }
    await userEvent.keyboard("{Escape}");
    await frames();
    expect(root.hasAttribute("data-inserting")).toBe(false);
  });

  it("opens the slash menu after a space and in a table's cell, and puts a block there as the insert menu does", async () => {
    const { view } = await mount("One two\n\n#table(\n  columns: 2,\n  [A], [],\n)");
    view.focus();
    act(() => view.select({ anchor: 7, head: 7 }));
    const menu = () => screen.queryByRole("menu", { name: "Insert" });
    // In a word it is a `/`.
    await userEvent.keyboard("/");
    await frames();
    expect(menu()).toBeNull();
    expect(view.state.text.startsWith("One two/\n")).toBe(true);
    // After a space, the menu: the item takes the place of the `/` and its filter.
    await userEvent.keyboard("{Backspace} /divid");
    await waitFor(() => !!screen.queryByRole("menuitem", { name: /^Divider/ }), 5000, "for the slash menu");
    // The menu follows the typing a frame late.
    await waitFor(() => screen.getAllByRole("menuitem").length === 1, 5000, "for the menu's one match");
    await userEvent.keyboard("{Enter}");
    expect(menu()).toBeNull();
    expect(view.state.text).not.toContain("/");
    expect(view.state.text.startsWith("One two")).toBe(true);
    expect(view.state.text).toContain("#line(length: 100%)");
    // An empty cell is where a word could start.
    const cell = view.state.text.indexOf("[]") + 1;
    act(() => view.select({ anchor: cell, head: cell }));
    await userEvent.keyboard("/bla");
    await waitFor(() => !!screen.queryByRole("menuitem", { name: /^Blank/ }), 5000, "for the cell's slash menu");
    await userEvent.keyboard("{Enter}");
    expect(view.state.text).toContain("[A], [#blank(answer: [answer])]");
  });

  it("disables what can't be done where the caret is: Align in a list's item", async () => {
    const { view } = await mount("A paragraph.\n\n- First item\n- Second item");
    view.focus();
    const align = () => within(fixedBar()).getByTitle(/^Align \(/) as HTMLButtonElement;
    act(() => view.select({ anchor: 3, head: 3 }));
    await frames();
    expect(align().disabled).toBe(false);
    const item = view.state.text.indexOf("First") + 2;
    act(() => view.select({ anchor: item, head: item }));
    await frames();
    expect(align().disabled).toBe(true);
    // The keys' way to it does nothing either, so the button doesn't lie.
    await userEvent.keyboard("{Control>}{Shift>}e{/Shift}{/Control}");
    expect(view.state.text).toBe("A paragraph.\n\n- First item\n- Second item");
    // The menu's entries say so too, where it opens for the others.
    act(() => view.select({ anchor: 3, head: 3 }));
    await frames();
    await clickIn(fixedBar(), align());
    expect(screen.getAllByRole("menuitem").every((e) => !(e as HTMLButtonElement).disabled)).toBe(true);
  });

  it("keeps the caret in the document on a press on a greyed button or on the toolbar's empty room", async () => {
    const { view } = await mount("A paragraph.");
    await userEvent.click(view.element, { position: pointOf(view, 2) });
    expect(view.focused).toBe(true);
    const bar = fixedBar();
    const redo = within(bar).getByRole("button", { name: "Redo" }) as HTMLButtonElement;
    expect(redo.disabled).toBe(true);
    await clickIn(bar, redo);
    expect(view.focused).toBe(true);
    await userEvent.keyboard("Q");
    expect(view.state.text).toContain("Q");
    // Between two controls, on a separator.
    await clickIn(bar, bar.querySelector(".tse-separator") as HTMLElement);
    expect(view.focused).toBe(true);
    // The room beside the pages, in the editor's box.
    const root = view.element.closest(".tse-root") as HTMLElement;
    const toolbar = bar.getBoundingClientRect();
    const box = root.getBoundingClientRect();
    await userEvent.click(root, { position: { x: 3, y: toolbar.bottom - box.top + 3 } });
    expect(view.focused).toBe(true);
    await userEvent.keyboard("R");
    expect(view.state.text).toContain("QR");
  });

  it("keeps menus, forms and a table's controls inside a narrow editor", async () => {
    const source = "= Quiz\n\n#answer-lines(count: 2)\n\n#table(\n  columns: 2,\n  [A], [B],\n)";
    const { view } = await mount(source, [htmlCompat, edu], 320);
    const pane = () => paneBox(view);
    const inside = (el: Element | null) => {
      const r = (el as Element).getBoundingClientRect();
      return r.left >= pane().left - 1 && r.right <= pane().right + 1;
    };
    view.focus();
    act(() => view.select({ anchor: 6, head: 6 }));
    await userEvent.click(screen.getByRole("button", { name: "Insert" }));
    await frames();
    expect(inside(document.querySelector(".tse-searchable"))).toBe(true);
    await userEvent.keyboard("{Escape}");
    selectNode(view, "#answer-lines(count: 2)");
    const bar = await barOf("Answer lines");
    expect(inside(bar)).toBe(true);
    await userEvent.click(within(bar).getByRole("button", { name: "Settings" }));
    await frames();
    expect(inside(document.querySelector(".tse-form"))).toBe(true);
    await userEvent.keyboard("{Escape}");
    const cell = view.state.text.indexOf("[A]") + 1;
    act(() => view.select({ anchor: cell, head: cell }));
    view.focus();
    expect(inside(await barOf("Table"))).toBe(true);
    await waitFor(() => document.querySelectorAll(".tse-edge").length > 0, 5000, "for the table's edges");
    for (const edge of document.querySelectorAll(".tse-edge")) expect(inside(edge)).toBe(true);
    await page.screenshot({ path: "screenshots/narrow-components.png" });
  });
});

describe("<TypstEditor>: the equation's field", () => {
  /** A new equation after `Intro.`, from the insert menu. */
  const insertEquation = async (label: RegExp = /^Inline equation/) => {
    const mounted = await mount("Intro.\n\nSecond line.");
    mounted.view.focus();
    act(() => mounted.view.select({ anchor: 6, head: 6 }));
    await userEvent.click(screen.getByRole("button", { name: "Insert" }));
    await userEvent.click(screen.getByRole("menuitem", { name: label }));
    await waitFor(() => !!equationPanel() && document.activeElement === formula(), 5000, "for the formula's focus");
    return mounted;
  };

  it("takes the keyboard for a new equation, its sample selected, and keeps the page's formula while one is unfinished", async () => {
    const { view } = await insertEquation();
    expect(view.state.text).toBe("Intro.$x$\n\nSecond line.");
    expect([formula().selectionStart, formula().selectionEnd]).toEqual([0, 1]);
    await userEvent.keyboard("x^");
    // Not a formula yet: the page keeps the last one, and the field says so without alarm.
    expect(view.state.text).toBe("Intro.$x$\n\nSecond line.");
    expect(formula().getAttribute("aria-invalid")).toBeNull();
    expect((equationPanel() as HTMLElement).textContent).toContain("Not finished yet");
    // Done on it stays, and says what is missing: nothing is cut off silently.
    await userEvent.keyboard("{Enter}");
    expect(equationPanel()).not.toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("Something is missing at the end.");
    expect(formula().getAttribute("aria-invalid")).toBe("true");
    expect(formula().value).toBe("x^");
    expect(document.activeElement).toBe(formula());
    await userEvent.keyboard("2");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(view.state.text).toBe("Intro.$x^2$\n\nSecond line.");
    // Done leaves the caret after the equation: what is typed next is the paragraph's.
    await userEvent.keyboard("{Enter}");
    await waitFor(() => !equationPanel(), 5000, "for the panel to close");
    expect(view.focused).toBe(true);
    expect(view.state.selection).toMatchObject({ anchor: 11, head: 11 });
    await userEvent.keyboard(" ok");
    expect(view.state.text).toBe("Intro.$x^2$ ok\n\nSecond line.");
  });

  it("closes on a click on the page as Done does, the words of the formula as text", async () => {
    const { view } = await insertEquation(/^Equation/);
    expect(view.state.text).toBe("Intro.\n\n$ x $\n\nSecond line.");
    await userEvent.keyboard("v = speed");
    await laidOut(view);
    await userEvent.click(view.element, { position: pointOf(view, view.state.text.indexOf("line.")) });
    await waitFor(() => !equationPanel(), 5000, "for the panel to close");
    await waitFor(() => view.state.text === 'Intro.\n\n$ v = "speed" $\n\nSecond line.', 10_000, "for the word");
    // The click did its own: the caret is where it was, and the keys are the document's.
    expect(view.state.selection.node).toBeFalsy();
    expect(view.state.selection.head).toBeGreaterThan(view.state.text.indexOf("Second"));
    expect(view.focused).toBe(true);
    await waitFor(() => view.laidOut && view.errors.length === 0, 10_000, "for the page without an error");
  });

  it("keeps the last formula the page could show when the compiler refuses one, and says why", async () => {
    const { view } = await insertEquation();
    await userEvent.keyboard("a + b");
    await waitFor(() => view.laidOut, 5000, "for the layout");
    await userEvent.keyboard(" + sqrt()");
    // Parses, but a root of nothing is an error: the page goes back to what it showed.
    await waitFor(() => !!screen.queryByRole("alert"), 10_000, "for the message");
    expect(screen.getByRole("alert").textContent).toBe("Something is missing inside the brackets.");
    expect(formula().value).toBe("a + b + sqrt()");
    await waitFor(() => view.laidOut && view.errors.length === 0, 10_000, "for the page without the error");
    expect(view.state.text).not.toContain("sqrt()");
    expect(view.state.text).toContain("$a + b");
    // Done stays on it; Escape leaves with the page's formula.
    await userEvent.keyboard("{Enter}");
    expect(equationPanel()).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => !equationPanel(), 5000, "for the panel to close");
    expect(view.state.text).not.toContain("sqrt()");
    expect(view.focused).toBe(true);
  });

  it("sets a word with a subscript, or after a letter's dot, as text: the page never shows the error", async () => {
    const { view } = await insertEquation();
    // `CO_2` is `CO` with a 2 below it, and `k.zeq` is `k`, a dot and `zeq`: math knows neither word.
    await userEvent.keyboard("6 CO_2 + k.zeq = 1");
    await waitFor(() => view.state.text.startsWith('Intro.$6 "CO"_2 + k."zeq" = 1$'), 10_000, "for the words as text");
    await waitFor(() => view.laidOut && view.errors.length === 0, 10_000, "for the page without an error");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(formula().value).toBe('6 "CO"_2 + k."zeq" = 1');
  });

  it("sets the letters after a number apart, and a unit after one as text, left by Enter", async () => {
    const { view } = await insertEquation();
    // `2mx` is 2 and a word `mx` to math, which it doesn't know: a teacher means 2 times m times x. Enter
    // comes before the compiler has said so, and it names one word at a time.
    // `at` is math's @, which `v = u + at` doesn't mean.
    await userEvent.keyboard("v = 2mx + at + 3km");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => view.state.text.startsWith('Intro.$v = 2m x + a t + 3"km"$'), 10_000, "for the letters apart");
    await waitFor(() => view.laidOut && view.errors.length === 0, 10_000, "for the page without an error");
    expect(equationPanel()).toBeNull();
  });

  it("opens on an equation the page can't show, with its formula to mend", async () => {
    const { view } = await mount("Intro.\n\nBefore $a + sqrt()$ after.");
    await waitFor(() => view.errors.length > 0, 10_000, "for the error");
    selectNode(view, "$a + sqrt()$");
    await waitFor(() => !!screen.queryByRole("alert"), 5000, "for the panel's message");
    expect(formula().value).toBe("a + sqrt()");
    expect(screen.getByRole("alert").textContent).toBe(
      "The page can't show this formula. Change it here, or delete it.",
    );
    const panel = (equationPanel() as HTMLElement).getBoundingClientRect();
    expect(within1(panel, paneBox(view))).toBe(true);
    expect(apart(panel, fixedBar().getBoundingClientRect())).toBe(true);
    await userEvent.fill(formula(), "a + sqrt(2)");
    expect(view.state.text).toBe("Intro.\n\nBefore $a + sqrt(2)$ after.");
    await waitFor(() => view.laidOut && view.errors.length === 0, 10_000, "for the page");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("leaves a formula nothing was typed into as the document has it", async () => {
    // The document's own `at` (math's @) isn't a teacher's `a` times `t`: only what is typed is read that way.
    const text = "Intro.\n\nBefore $x at y$ after.";
    const { view } = await mount(text);
    selectNode(view, "$x at y$");
    await waitFor(() => !!equationPanel(), 5000, "for the panel");
    formula().focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => !equationPanel(), 5000, "for the panel to close");
    expect(view.state.text).toBe(text);
  });

  it("undoes in the field a burst of typing at a time, and never past what was typed there", async () => {
    const { view } = await insertEquation();
    await userEvent.keyboard("a+b");
    await new Promise((r) => setTimeout(r, 900));
    await userEvent.keyboard("+c");
    expect(view.state.text).toBe("Intro.$a+b+c$\n\nSecond line.");
    const undo = () => userEvent.keyboard("{Control>}z{/Control}");
    await undo();
    expect([formula().value, view.state.text]).toEqual(["a+b", "Intro.$a+b$\n\nSecond line."]);
    await undo();
    expect([formula().value, view.state.text]).toEqual(["x", "Intro.$x$\n\nSecond line."]);
    // Nothing more of the field's to undo: the document's undo would bring `a+b` back.
    await undo();
    await undo();
    expect([formula().value, view.state.text]).toEqual(["x", "Intro.$x$\n\nSecond line."]);
    await userEvent.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    expect([formula().value, view.state.text]).toEqual(["a+b", "Intro.$a+b$\n\nSecond line."]);
    await userEvent.keyboard("{Control>}y{/Control}");
    expect([formula().value, view.state.text]).toEqual(["a+b+c", "Intro.$a+b+c$\n\nSecond line."]);
    await userEvent.keyboard("{Control>}y{/Control}");
    expect([formula().value, view.state.text]).toEqual(["a+b+c", "Intro.$a+b+c$\n\nSecond line."]);
    expect(document.activeElement).toBe(formula());
  });

  it("shows the document's formula when the document's undo reopens it, and writes nothing of its own", async () => {
    const { view } = await insertEquation();
    await userEvent.keyboard("a+b");
    await userEvent.keyboard("{Enter}");
    expect(view.state.text).toBe("Intro.$a+b$\n\nSecond line.");
    await waitFor(() => !equationPanel(), 5000, "for the panel to close");
    // The document's undo, a step at a time: each formula it comes to is the field's too.
    for (let i = 0; i < 4 && view.state.text !== "Intro.\n\nSecond line."; i++) {
      await userEvent.keyboard("{Control>}z{/Control}");
      const text = view.state.text;
      await frames(4);
      await new Promise((r) => setTimeout(r, 150));
      expect(view.state.text).toBe(text);
      if (equationPanel()) expect(`$${formula().value}$`).toBe(text.slice(6, text.indexOf("\n")));
    }
    expect(view.state.text).toBe("Intro.\n\nSecond line.");
    await waitFor(() => !equationPanel(), 5000, "for the panel to close");
  });

  it("keeps the keyboard in the formula and the field in place when the equation goes on its own line", async () => {
    const { view } = await insertEquation();
    await userEvent.keyboard("a+b");
    await waitFor(() => view.laidOut, 5000, "for the layout");
    await frames(3);
    const left = () => (equationPanel() as HTMLElement).getBoundingClientRect().left;
    const before = left();
    await userEvent.click(screen.getByRole("checkbox", { name: "On its own line" }));
    expect(view.state.text).toBe("Intro.$ a+b $\n\nSecond line.");
    expect(document.activeElement).toBe(formula());
    await waitFor(() => view.laidOut, 5000, "for the layout");
    await frames(3);
    expect(Math.abs(left() - before)).toBeLessThan(1);
    await userEvent.keyboard("+c");
    expect(view.state.text).toBe("Intro.$ a+b+c $\n\nSecond line.");
    // Done and what is typed next in one go: the keys after Enter are the paragraph's, none lost.
    await userEvent.keyboard("{Enter} so");
    expect(view.state.text).toBe("Intro.$ a+b+c $ so\n\nSecond line.");
  });

  it("takes text that comes without a key into the selected equation: over a new one's sample, after another's formula", async () => {
    const { view } = await mount("Intro. $x$ and $y + 1$ here.");
    const input = (data: string) =>
      act(() => {
        (document.activeElement as HTMLElement).dispatchEvent(
          new InputEvent("beforeinput", { data, inputType: "insertText", bubbles: true, cancelable: true }),
        );
      });
    selectNode(view, "$y + 1$");
    await waitFor(() => !!equationPanel(), 5000, "for the panel");
    // The keys are still the page's: a character from the picker is the formula's.
    expect(view.focused).toBe(true);
    input("²");
    expect(view.state.text).toBe("Intro. $x$ and $y + 1²$ here.");
    await waitFor(() => document.activeElement === formula(), 5000, "for the field's focus");
    await userEvent.keyboard("{Escape}");
    selectNode(view, "$x$");
    await waitFor(() => !!equationPanel() && formula().value === "x", 5000, "for the panel");
    const data = new DataTransfer();
    data.setData("text/plain", "a/b");
    act(() => {
      (document.activeElement as HTMLElement).dispatchEvent(
        // Firefox fills a made event's clipboard from `dataType` and `data`, not from `clipboardData`.
        new ClipboardEvent("paste", {
          clipboardData: data,
          dataType: "text/plain",
          data: "a/b",
          bubbles: true,
          cancelable: true,
        } as ClipboardEventInit),
      );
    });
    expect(view.state.text).toBe("Intro. $a/b$ and $y + 1²$ here.");
  });
});
