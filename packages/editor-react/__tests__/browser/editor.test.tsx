/// <reference lib="dom" />
// <TypstEditor> on the real engine worker in Chromium, Firefox and WebKit: the toolbars change the
// source, the insert menu adds tables and edu's components, a table's bar adds rows and columns, a
// component's settings edit its arguments, and the pages are drawn as the page view draws them.

import { act, cleanup, render, screen } from "@testing-library/react";
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

const waitFor = async (check: () => boolean, ms = 60_000) => {
  const start = performance.now();
  while (!check()) {
    if (performance.now() - start > ms) throw new Error("timed out");
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
  await waitFor(() => !!(view as EditorView | null)?.layout);
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
    expect(document.querySelectorAll(".typstream-page canvas").length).toBe(1);
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
    expect(view.state.text).toContain("columns: 4");
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
});
