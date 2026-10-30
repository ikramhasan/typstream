/// <reference lib="dom" />
// <TypstEditor> on the real engine worker in Chromium, Firefox and WebKit: the toolbars change the
// source, the insert menu adds tables and edu's components, a table's bar adds rows and columns, a
// component's settings edit its arguments, and the pages are drawn as the page view draws them.

import { act, cleanup, render, screen, within } from "@testing-library/react";
import type { EditorView } from "@typstream/editor-core";
import { edu } from "@typstream/edu";
import { createEngine, type Engine, fromWorker } from "@typstream/engine";
import { mindmap } from "@typstream/mindmap";
import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { TypstEditor } from "../../src/index";

const spawn = () =>
  fromWorker(() => new Worker(new URL("../../../engine/src/worker.ts", import.meta.url), { type: "module" }));

const engines: Engine[] = [];
afterEach(() => {
  cleanup();
  for (const e of engines.splice(0)) e.dispose();
});

const waitFor = async (check: () => boolean, ms = 10_000, what = "") => {
  const start = performance.now();
  while (!check()) {
    if (performance.now() - start > ms) throw new Error(`timed out waiting ${what}`);
    await new Promise((r) => setTimeout(r, 30));
  }
};

/** Renders the editor and waits for its pages; returns its view and the last source it reported. */
const mount = async (source: string, plugins = [edu]) => {
  const engine = createEngine({ spawn: spawn() });
  engines.push(engine);
  let view: EditorView | null = null;
  const changes: string[] = [];
  render(
    <div style={{ width: 820, padding: 24 }}>
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

describe("<TypstEditor>", () => {
  it("shows the fixed toolbar and the pages, and bolds from the toolbar", async () => {
    const { view } = await mount("= Fractions\n\nAdd the fractions below.");
    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeTruthy();
    // The page view paints at the next frame (or in idle time), after the layout arrives.
    await waitFor(() => document.querySelectorAll(".typstream-page canvas").length === 1, 10_000, "for the page's canvas");
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

  it("inserts an edu question, types its text and sets its points from its settings", async () => {
    const { view } = await mount("= Quiz\n\nIntro.");
    act(() => view.select({ anchor: 14, head: 14 }));
    view.focus();
    await userEvent.click(screen.getByRole("button", { name: "Insert" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /^Question/ }));
    expect(view.state.text).toContain("#question(points: 1)[");
    await userEvent.keyboard("What is 2 + 2? ");
    expect(view.state.text).toContain("What is 2 + 2? Question text");
    await waitFor(() => !!screen.queryByRole("button", { name: "Settings" }));
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    const points = screen.getByRole("spinbutton", { name: /Points/ });
    await userEvent.clear(points);
    await userEvent.type(points, "3");
    expect(view.state.text).toContain("#question(points: 3)[");
    await page.screenshot({ path: "screenshots/question.png" });
  });

  it("edits a mind map's topics on the page", async () => {
    const { view } = await mount("#mindmap[\n  Plants\n  - Roots\n  - Leaves\n]", [edu, mindmap]);
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
    await waitFor(() => !!screen.queryByRole("textbox", { name: "Search what to insert" }), 5000, "for the slash menu");
    await userEvent.keyboard("equation");
    await userEvent.keyboard("{Enter}");
    expect(view.state.text).toBe("Intro.\n\n$ x =  $");
    // Selected whole, an equation shows its field.
    const at = view.state.text.indexOf("$");
    act(() => view.select({ anchor: at, head: view.state.text.length, node: true }));
    const field = await waitFor(
      () => !!screen.queryByRole("textbox", { name: /Formula/ }),
      5000,
      "for the formula",
    ).then(() => screen.getByRole("textbox", { name: /Formula/ }));
    await userEvent.clear(field);
    await userEvent.type(field, "a^2 + b^2 = c^2");
    expect(view.state.text).toBe("Intro.\n\n$ a^2 + b^2 = c^2 $");
    await laidOut(view);
    await page.screenshot({ path: "screenshots/equation.png" });
  });
});
