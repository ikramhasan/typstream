/// <reference lib="dom" />
// The editor on the real engine worker's pages in Chromium, Firefox and WebKit: clicks land the
// caret where Typst laid the text out, typing and the keyboard change the source, and the pages are
// the page view's own (the same canvases). Run with `pnpm test:browser`.

import { edu, eduExamples } from "@typstream/edu";
import { createEngine, type DocumentState, type Engine, type EngineDocument, fromWorker } from "@typstream/engine";
import { htmlCompat } from "@typstream/html-compat";
import { loadSyntax } from "@typstream/syntax";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import {
  basicPlugins,
  createEditor,
  type EditorOptions,
  type EditorPlugin,
  type EditorView,
  fromTypstreamPlugin,
  insertText,
  toggleMark,
} from "../../src/index";

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
const open = async (
  text: string,
  options: Partial<EditorOptions> = {},
): Promise<{ view: EditorView; doc: EngineDocument }> => {
  const engine = createEngine({ spawn: spawn() });
  engines.push(engine);
  const doc = engine.open({ target: "paged", preamble: PREAMBLE, text, positions: true, pageFormat: "drawing" });
  const el = document.createElement("div");
  el.style.width = "400px";
  document.body.append(el);
  const view = createEditor(el, { doc, text, ...options });
  cleanups.push(() => {
    view.destroy();
    el.remove();
  });
  await settled(view, doc);
  return { view, doc };
};

/** Waits until the engine has laid out the editor's current text. */
const settled = async (view: EditorView, doc: EngineDocument) => {
  await until(doc, (s) => s.status === "done" && view.laidOut);
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
    expect(view.state.text).toBe("Start. a\\*b \n\nNext");
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

  it("ends a list with Enter on an empty item, the caret drawn after its bullet (#36)", async () => {
    const { view, doc } = await open("- one");
    view.select({ anchor: 5, head: 5 });
    view.focus();
    const caret = () => view.element.querySelector(".typstream-editor-caret")?.getBoundingClientRect() as DOMRect;
    /** The client box of the glyph showing `text[offset]`. */
    const glyph = (offset: number) => {
      const g = view.layout?.glyphs.find((g) => g.from === offset) as NonNullable<EditorView["layout"]>["glyphs"][0];
      const page = view.element.querySelector(".typstream-page")?.getBoundingClientRect() as DOMRect;
      const k = page.width / (view.layout?.pages[0]?.width ?? 1);
      return {
        left: page.left + g.x * k,
        top: page.top + (g.y - g.ascent) * k,
        bottom: page.top + (g.y + g.descent) * k,
      };
    };
    await userEvent.keyboard("{Enter}two{Enter}");
    expect(view.state.text).toBe("- one\n- two\n- ");
    await settled(view, doc);
    // On the new item's line, below "two", where the items' text starts.
    const two = glyph(view.state.text.indexOf("two"));
    expect(caret().top).toBeGreaterThan(two.bottom - 1);
    expect(Math.abs(caret().left - two.left)).toBeLessThan(2);
    await userEvent.keyboard("{Enter}");
    expect(view.state.text).toBe("- one\n- two\n\n");
    await settled(view, doc);
    await userEvent.keyboard("After the list.");
    expect(view.state.text).toBe("- one\n- two\n\nAfter the list.");
    // Nested: an empty item goes up a level first; Backspace at an item's start too.
    view.select({ anchor: 11, head: 11 });
    await userEvent.keyboard("{Enter}{Tab}");
    expect(view.state.text).toBe("- one\n- two\n  - \n\nAfter the list.");
    await userEvent.keyboard("{Enter}");
    expect(view.state.text).toBe("- one\n- two\n- \n\nAfter the list.");
    await userEvent.keyboard("{Tab}three");
    await settled(view, doc);
    await userEvent.keyboard("{Home}{Backspace}");
    expect(view.state.text).toBe("- one\n- two\n- three\n\nAfter the list.");
    await settled(view, doc);
    expect(doc.getState().diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("leaves a component with Ctrl+Enter (#36)", async () => {
    const { view } = await open("#table(columns: 2, [a], [b])");
    view.select({ anchor: 20, head: 20 });
    view.focus();
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    if (view.state.text.endsWith(")")) await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    await userEvent.keyboard("After.");
    expect(view.state.text).toBe("#table(columns: 2, [a], [b])\n\nAfter.");
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

  it("edits an edu exam on its pages: a question's text, an option, Enter and Backspace, compiling throughout", async () => {
    const exam = eduExamples.find((e) => e.title?.includes("exam-chemistry"))?.output;
    expect(exam).toBeDefined();
    const text = exam as string;
    const engine = createEngine({ spawn: spawn() });
    engines.push(engine);
    const doc = engine.open({
      target: "paged",
      plugins: [htmlCompat, edu],
      text,
      positions: true,
      pageFormat: "drawing",
    });
    const el = document.createElement("div");
    el.style.width = "820px";
    document.body.append(el);
    const view = createEditor(el, {
      doc,
      text,
      plugins: [...basicPlugins, fromTypstreamPlugin(edu) as NonNullable<ReturnType<typeof fromTypstreamPlugin>>],
    });
    cleanups.push(() => {
      view.destroy();
      el.remove();
    });
    await settled(view, doc);
    // Into a question's text.
    const word = text.indexOf("balanced?");
    const at = glyphAt(view, word);
    await clickAt(view, at.page, at.x, at.y);
    expect(view.state.selection.head).toBeGreaterThanOrEqual(word);
    expect(view.state.selection.head).toBeLessThanOrEqual(word + 1);
    const started = performance.now();
    await userEvent.keyboard("really ");
    await settled(view, doc);
    const ms = performance.now() - started;
    expect(view.state.text).toContain("Which equation is really balanced?");
    // An option of a multiple choice: text in a content block of a call, edited in place.
    const option = view.state.text.indexOf("$+2$");
    await settled(view, doc);
    const plus = view.layout?.glyphs.find((g) => g.from > option && g.from < option + 4);
    expect(plus).toBeDefined();
    // Enter and Backspace in the question: a new paragraph, then joined again.
    view.select({ anchor: view.state.text.indexOf("really ") + 7, head: view.state.text.indexOf("really ") + 7 });
    view.focus();
    await userEvent.keyboard("{Enter}");
    expect(view.state.text).toMatch(/really \n\n\s*balanced\?/);
    await userEvent.keyboard("{Backspace}");
    expect(view.state.text).toContain("really balanced?");
    await settled(view, doc);
    expect(doc.getState().diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    // Typing to the new layout: a compile and a frame (CI machines are slower).
    expect(ms).toBeLessThan(3000);
  });

  it("draws the caret after a space ending a paragraph, and on an empty line out of a list", async () => {
    const { view, doc } = await open("Some words\n\n- one\n- two\n\nAfter.");
    const caret = () => view.element.querySelector(".typstream-editor-caret")?.getBoundingClientRect() as DOMRect;
    view.select({ anchor: 10, head: 10 });
    view.focus();
    await settled(view, doc);
    const before = caret();
    // Typst drops a paragraph's last space: the caret still moves past it, as far as a space.
    await userEvent.keyboard(" ");
    await settled(view, doc);
    expect(view.state.text.startsWith("Some words \n")).toBe(true);
    expect(caret().left - before.left).toBeGreaterThan(1.5);
    expect(caret().left - before.left).toBeLessThan(8);
    // The space shows once text follows it, and the placeholder never reaches the source.
    await userEvent.keyboard("more");
    await settled(view, doc);
    expect(view.state.text.startsWith("Some words more\n")).toBe(true);
    // Enter twice at the end of the list: an empty line between it and the next paragraph.
    const end = view.state.text.indexOf("two") + 3;
    view.select({ anchor: end, head: end });
    await userEvent.keyboard("{Enter}{Enter}");
    await settled(view, doc);
    // (The layout's text has the caret's placeholder before "After.": one character on.)
    const at = view.state.text.indexOf("After.") + 1;
    const after = view.layout?.glyphs.find((g) => g.from === at) as { y: number };
    const page = view.element.querySelector(".typstream-page")?.getBoundingClientRect() as DOMRect;
    const k = page.width / (view.layout?.pages[0]?.width ?? 1);
    expect(caret().bottom).toBeLessThan(page.top + after.y * k - 4);
    await userEvent.keyboard("New");
    expect(view.state.text).toBe("Some words more\n\n- one\n- two\n\nNew\n\nAfter.");
    await settled(view, doc);
    expect(doc.getState().diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("lets plugins bind keys where they apply, take typed text, draw over the pages and follow the view", async () => {
    const updates: string[] = [];
    const shout: EditorPlugin = {
      key: "shout",
      // Enter at the end of a line ending in "!" adds another "!"; elsewhere, the editor's Enter.
      keymap: { Enter: (s) => (s.text[s.selection.head - 1] === "!" ? insertText("!")(s) : null) },
      handleTextInput: (s, text) => (text === "?" ? insertText("¿?")(s) : null),
      decorations: (s) => {
        const at = s.text.indexOf("Hey");
        return at < 0 ? [] : [{ from: at, to: at + 3, class: "found" }];
      },
      view: () => ({ update: (v) => updates.push(v.state.text) }),
    };
    const { view, doc } = await open("Hey!", { plugins: [...basicPlugins, shout] });
    view.select({ anchor: 4, head: 4 });
    view.focus();
    await userEvent.keyboard("{Enter}");
    expect(view.state.text).toBe("Hey!!");
    await userEvent.keyboard(" you{Enter}");
    expect(view.state.text).toBe("Hey!! you\n\n");
    await userEvent.keyboard("?");
    expect(view.state.text).toBe("Hey!! you\n\n¿?");
    expect(updates.at(-1)).toBe("Hey!! you\n\n¿?");
    await settled(view, doc);
    expect(view.element.querySelectorAll(".typstream-editor-decoration.found").length).toBe(1);
    // Tab where nothing applies stays in the editor.
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement?.className).toBe("typstream-editor-input");
  });
});
