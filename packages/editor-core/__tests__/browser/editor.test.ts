/// <reference lib="dom" />
// The editor on the real engine worker's pages in Chromium, Firefox and WebKit: clicks land the
// caret where Typst laid the text out, typing and the keyboard change the source, and the pages are
// the page view's own (the same canvases). Run with `pnpm test:browser`.

import { createEngine, type DocumentState, type Engine, type EngineDocument, fromWorker } from "@typstream/engine";
import { loadSyntax } from "@typstream/syntax";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { createEditor, type EditorView, toggleMark } from "../../src/index";

const spawn = () =>
  fromWorker(() => new Worker(new URL("../../../engine/src/worker.ts", import.meta.url), { type: "module" }));

const engines: Engine[] = [];
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
  for (const e of engines.splice(0)) e.dispose();
});

beforeAll(() => loadSyntax());

/** Resolves with the first state that satisfies `done` (now or later). */
const until = (doc: EngineDocument, done: (s: DocumentState) => boolean, ms = 60_000): Promise<DocumentState> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out: ${JSON.stringify(doc.getState().failure)}`)), ms);
    const check = (s: DocumentState) => {
      if (!done(s)) return;
      clearTimeout(timer);
      stop();
      resolve(s);
    };
    const stop = doc.subscribe(check);
    check(doc.getState());
  });

const PREAMBLE = "#set page(width: 300pt, height: 200pt, margin: 20pt)\n";

/** An editor on `text`, once the engine laid it out. */
const open = async (text: string): Promise<{ view: EditorView; doc: EngineDocument }> => {
  const engine = createEngine({ spawn: spawn() });
  engines.push(engine);
  const doc = engine.open({ target: "paged", preamble: PREAMBLE, text, positions: true, pageFormat: "drawing" });
  const el = document.createElement("div");
  el.style.width = "400px";
  document.body.append(el);
  const view = createEditor(el, { doc, text });
  cleanups.push(() => {
    view.destroy();
    el.remove();
  });
  await settled(view, doc);
  return { view, doc };
};

/** Waits until the engine has laid out the editor's current text. */
const settled = async (view: EditorView, doc: EngineDocument) => {
  await until(doc, (s) => s.status === "done" && s.artifactInput === view.state.text);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
};

/** Clicks at a point given in points on page `page` (from 0). */
const clickAt = async (view: EditorView, page: number, x: number, y: number) => {
  const el = view.element.querySelectorAll<HTMLElement>(".typstream-page")[page] as HTMLElement;
  const size = view.layout?.pages[page] as { width: number };
  const k = el.getBoundingClientRect().width / size.width;
  await userEvent.click(el, { position: { x: x * k, y: y * k } });
};

/** The page point of the middle of the glyph showing `text[offset]`. */
const glyphAt = (view: EditorView, offset: number) => {
  const g = view.layout?.glyphs.find((g) => g.from === offset);
  if (!g) throw new Error(`no glyph at ${offset}`);
  return { page: g.page, x: g.x + g.width * 0.25, y: g.y - g.ascent / 3 };
};

describe("the editor on the pages", () => {
  it("shows the document as the page view does: the same canvases", async () => {
    const { view } = await open("= Title\n\nSome *bold* text.");
    expect(view.element.querySelectorAll(".typstream-page canvas").length).toBe(1);
    expect(view.layout?.glyphs.some((g) => g.from >= 0)).toBe(true);
  });

  it("puts the caret where the text was clicked, and types there", async () => {
    const text = "Hello world.";
    const { view, doc } = await open(text);
    const at = glyphAt(view, text.indexOf("world"));
    await clickAt(view, at.page, at.x, at.y);
    expect(view.state.selection.head).toBe(text.indexOf("world"));
    await userEvent.keyboard("big ");
    expect(view.state.text).toBe("Hello big world.");
    await settled(view, doc);
    // The new text is laid out where it was typed.
    const g = view.layout?.glyphs.find((g) => g.from === text.indexOf("world"));
    expect(view.state.text.slice(g?.from, g?.to)).toBe("b");
  });

  it("escapes what is typed, deletes with Backspace, makes paragraphs with Enter", async () => {
    const { view, doc } = await open("Start.");
    view.select({ anchor: 6, head: 6 });
    view.focus();
    await userEvent.keyboard(" a*b #c");
    expect(view.state.text).toBe("Start. a\\*b \\#c");
    await userEvent.keyboard("{Backspace}{Backspace}");
    expect(view.state.text).toBe("Start. a\\*b ");
    await userEvent.keyboard("{Enter}Next");
    expect(view.state.text).toBe("Start. a\\*b\n\nNext");
    await settled(view, doc);
    expect(doc.getState().diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("formats with shortcuts and undoes", async () => {
    const { view } = await open("Make this bold.");
    view.select({ anchor: 10, head: 14 });
    view.focus();
    await userEvent.keyboard("{Control>}b{/Control}");
    // Ctrl, or ⌘ on Apple platforms.
    if (view.state.text === "Make this bold.") await userEvent.keyboard("{Meta>}b{/Meta}");
    expect(view.state.text).toBe("Make this *bold*.");
    expect(view.run(toggleMark({ name: "emph" }))).toBe(true);
    expect(view.undo()).toBe(true);
    expect(view.state.text).toBe("Make this *bold*.");
    expect(view.undo()).toBe(true);
    expect(view.state.text).toBe("Make this bold.");
  });

  it("moves the caret across lines with the arrow keys, by the layout", async () => {
    const text = "One line here.\n\nAnother line.";
    const { view } = await open(text);
    view.select({ anchor: 2, head: 2 });
    view.focus();
    await userEvent.keyboard("{ArrowDown}");
    const head = view.state.selection.head;
    expect(head).toBeGreaterThanOrEqual(text.indexOf("Another"));
    expect(head).toBeLessThanOrEqual(text.indexOf("Another") + 4);
    await userEvent.keyboard("{ArrowUp}");
    expect(view.state.selection.head).toBe(2);
  });

  it("selects a component from its own drawing, and types into a table's cell", async () => {
    const text = "#table(columns: 2, [a], [], [c], [d])";
    const { view, doc } = await open(text);
    // The empty cell: a caret in it.
    const cell = view.layout?.elements.find((e) => e.kind === "cell" && e.cell?.[0] === 1 && e.cell?.[1] === 0);
    expect(cell).toBeDefined();
    const [x, y, w, h] = view.layout?.cellBox(cell as NonNullable<typeof cell>) ?? [0, 0, 0, 0];
    await clickAt(view, 0, x + w / 2, y + h / 2);
    await userEvent.keyboard("b");
    expect(view.state.text).toBe("#table(columns: 2, [a], [b], [c], [d])");
    await settled(view, doc);
  });
});
