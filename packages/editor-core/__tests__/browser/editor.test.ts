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
  type Glyph,
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
  preamble = PREAMBLE,
): Promise<{ view: EditorView; doc: EngineDocument }> => {
  const engine = createEngine({ spawn: spawn() });
  engines.push(engine);
  const doc = engine.open({ target: "paged", preamble, text, positions: true, pageFormat: "drawing" });
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

/**
 * An editor with edu's components on `text`, on edu's pages; `fit` makes the pages as wide as the
 * tests' window, so a click on their right half is in it.
 */
const openEdu = async (text: string, fit = false): Promise<{ view: EditorView; doc: EngineDocument }> => {
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
  el.style.width = fit ? "400px" : "820px";
  document.body.append(el);
  const view = createEditor(el, {
    doc,
    text,
    layout: fit ? "fit-width" : "fixed",
    plugins: [...basicPlugins, fromTypstreamPlugin(edu) as NonNullable<ReturnType<typeof fromTypstreamPlugin>>],
  });
  cleanups.push(() => {
    view.destroy();
    el.remove();
  });
  await settled(view, doc);
  return { view, doc };
};

/**
 * The lines a package drew (glyphs that show none of the document's text), top to bottom then left
 * to right, each one's glyphs left to right: a multiple choice's `(a) H₂O`, then its `(b) NaCl`.
 */
const drawnLines = (view: EditorView) => {
  const lines = new Map<number, Glyph[]>();
  for (const g of view.layout?.glyphs ?? []) if (g.from < 0) lines.set(g.line, [...(lines.get(g.line) ?? []), g]);
  return [...lines.values()]
    .map((glyphs) => glyphs.sort((a, b) => a.x - b.x))
    .sort((a, b) => (a[0] as Glyph).y - (b[0] as Glyph).y || (a[0] as Glyph).x - (b[0] as Glyph).x);
};

/** Clicks a glyph: a quarter into it, so a caret it gives is before it. */
const clickGlyph = (view: EditorView, g: Glyph | undefined) => {
  if (!g) throw new Error("no such glyph");
  return clickAt(view, g.page, g.x + g.width * 0.25, g.y - g.ascent / 3);
};

/** Waits until the engine has laid out the editor's current text. */
const settled = async (view: EditorView, doc: EngineDocument) => {
  await until(doc, (s) => s.status === "done" && view.laidOut);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
};

/** Clicks at a point given in points on page `page` (from 0). */
const clickAt = async (view: EditorView, page: number, x: number, y: number, shift = false) => {
  const el = view.element.querySelectorAll<HTMLElement>(".typstream-page")[page] as HTMLElement;
  const size = view.layout?.pages[page] as { width: number };
  const k = el.getBoundingClientRect().width / size.width;
  await userEvent.click(el, { position: { x: x * k, y: y * k }, modifiers: shift ? ["Shift"] : [] });
};

/** The page point of the middle of the glyph showing `text[offset]`. */
const glyphAt = (view: EditorView, offset: number) => {
  const at = view.layoutOffset(offset);
  const g = view.layout?.glyphs.find((g) => g.from === at);
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
    const g = view.layout?.glyphs.find((g) => g.from === view.layoutOffset(text.indexOf("world")));
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
      const at = view.layoutOffset(offset);
      const g = view.layout?.glyphs.find((g) => g.from === at) as NonNullable<EditorView["layout"]>["glyphs"][0];
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
    expect(view.state.text).toBe("- one\n- two\n\n~");
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
    const { view, doc } = await openEdu(text);
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
    const o = view.layoutOffset(option);
    const plus = view.layout?.glyphs.find((g) => g.from > o && g.from < o + 4);
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

  it("selects a formula among a multiple choice's options from a click on it: the options become content", async () => {
    // Typst draws `ce("H2O")` in edu's package: the pages say where the multiple choice is, not
    // where each option went, until the options are content.
    const text = 'Which is water?\n\n#mcq(ce("H2O"), ce("NaCl"), answer: 1)\n\nAnd salt?';
    const { view, doc } = await openEdu(text, true);
    // `(a) H₂O`: a bracket, the letter, a bracket, then the formula.
    const [first] = drawnLines(view);
    expect(first?.length).toBe(6);
    await clickGlyph(view, first?.[3]);
    await settled(view, doc);
    const written = 'Which is water?\n\n#mcq([#ce("H2O")], [#ce("NaCl")], answer: 1)\n\nAnd salt?';
    expect(view.state.text).toBe(written);
    expect(view.state.selection.node).toBe(true);
    expect(view.state.text.slice(view.state.from, view.state.to)).toBe('#ce("H2O")');
    expect(view.components()[0]?.name).toBe("ce");
    // One step back, and forward again.
    expect(view.undo()).toBe(true);
    expect(view.state.text).toBe(text);
    expect(view.redo()).toBe(true);
    expect(view.state.text).toBe(written);
    // The other option, content now, is selected as any component in a content block is.
    await settled(view, doc);
    await clickGlyph(view, drawnLines(view)[1]?.[3]);
    expect(view.state.text.slice(view.state.from, view.state.to)).toBe('#ce("NaCl")');
    expect(view.state.text).toBe(written);
    expect(doc.getState().diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("leaves the source as it was after a click on an option's letter: the multiple choice is selected", async () => {
    const text = 'Which is water?\n\n#mcq(ce("H2O"), ce("NaCl"), answer: 1)';
    const { view, doc } = await openEdu(text, true);
    await clickGlyph(view, drawnLines(view)[1]?.[1]);
    await settled(view, doc);
    expect(view.state.text).toBe(text);
    expect(view.state.selection).toEqual({ anchor: text.indexOf("#mcq"), head: text.length, node: true });
    // Nothing was done: nothing to undo.
    expect(view.undo()).toBe(false);
    expect(view.state.text).toBe(text);
  });

  it("puts the caret in an option written as a string, where it was clicked", async () => {
    const text = '#mcq("Water", "Salt", answer: 1)';
    const { view, doc } = await openEdu(text, true);
    // `(b) Salt`: the click is on its `S`.
    await clickGlyph(view, drawnLines(view)[1]?.[3]);
    await settled(view, doc);
    expect(view.state.text).toBe("#mcq([Water], [Salt], answer: 1)");
    expect(view.state.selection).toEqual({ anchor: 15, head: 15 });
    await userEvent.keyboard("Sea ");
    expect(view.state.text).toBe("#mcq([Water], [Sea Salt], answer: 1)");
    await settled(view, doc);
    expect(doc.getState().diagnostics.filter((d) => d.severity === "error")).toEqual([]);
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
    const at = view.layoutOffset(view.state.text.indexOf("After."));
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
    expect(view.state.text).toBe("Hey!! you\n\n~");
    await userEvent.keyboard("?");
    expect(view.state.text).toBe("Hey!! you\n\n¿?");
    expect(updates.at(-1)).toBe("Hey!! you\n\n¿?");
    await settled(view, doc);
    expect(view.element.querySelectorAll(".typstream-editor-decoration.found").length).toBe(1);
    // Tab where nothing applies stays in the editor.
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement?.className).toBe("typstream-editor-input");
  });

  it("underlines a link's words in the editor, where Typst draws them as the words around them", async () => {
    const { view, doc } = await open('Read #link("https://typst.app")[the guide] today.');
    await settled(view, doc);
    const marks = [...view.element.querySelectorAll<HTMLElement>(".typstream-editor-decoration.typstream-editor-link")];
    expect(marks).toHaveLength(1);
    const mark = (marks[0] as HTMLElement).getBoundingClientRect();
    // Under "the guide", from its first letter to its last.
    const at = (word: string) => view.layoutOffset(view.state.text.indexOf(word));
    const glyph = (offset: number) => view.layout?.glyphs.find((g) => g.from === offset) as { page: number; x: number };
    const page = view.element.querySelector(".typstream-page")?.getBoundingClientRect() as DOMRect;
    const k = page.width / (view.layout?.pages[0]?.width ?? 1);
    expect(mark.left).toBeCloseTo(page.left + glyph(at("the guide")).x * k, 0);
    expect(mark.right).toBeLessThan(page.left + glyph(at("today")).x * k);
    expect(getComputedStyle(marks[0] as HTMLElement).borderBottomStyle).toBe("dotted");
    // Without the link, nothing.
    view.dispatch({ edits: [{ from: 0, to: view.state.text.length, insert: "Read the guide today." }] });
    await settled(view, doc);
    expect(view.element.querySelector(".typstream-editor-link")).toBeNull();
  });

  it("puts the caret after a table that ends the document, from a click below it", async () => {
    const text = "#table(columns: 2, [a], [b])";
    const { view, doc } = await open(text);
    await clickAt(view, 0, 150, 150);
    expect(view.state.selection).toEqual({ anchor: text.length, head: text.length });
    await userEvent.keyboard("After.");
    expect(view.state.text).toBe(`${text}\n\nAfter.`);
    await settled(view, doc);
    // Below a paragraph a click is the paragraph's, as beside any line.
    await clickAt(view, 0, 30, 150);
    expect(view.state.selection.head).toBeGreaterThanOrEqual(text.length + 2);
    expect(view.state.selection.head).toBeLessThan(view.state.text.length);
  });

  it("takes a click on the room a page break leaves for the text before it, not for the break", async () => {
    const text = "First.\n\n#pagebreak()\n\nSecond.";
    const { view } = await open(text);
    await clickAt(view, 0, 150, 150);
    expect(view.state.selection).toEqual({ anchor: 6, head: 6 });
    // A page with nothing but its break: before the break, where the page's text would start.
    const { view: empty, doc } = await open("First.\n\n#pagebreak()\n\n#pagebreak()\n\nThird.");
    expect(empty.layout?.pages.length).toBe(3);
    await clickAt(empty, 1, 150, 100);
    expect(empty.state.selection).toEqual({ anchor: 22, head: 22 });
    // The caret is drawn on the next frame.
    await settled(empty, doc);
    const caret = empty.element.querySelector(".typstream-editor-caret")?.getBoundingClientRect() as DOMRect;
    const page = empty.element.querySelectorAll(".typstream-page")[1]?.getBoundingClientRect() as DOMRect;
    expect(caret.left - page.left).toBeGreaterThan(10);
    expect(caret.top).toBeGreaterThan(page.top);
    await userEvent.keyboard("New");
    expect(empty.state.text).toBe("First.\n\n#pagebreak()\n\nNew\n\n#pagebreak()\n\nThird.");
    await settled(empty, doc);
  });

  it("selects an equation clicked, puts the caret beside one clicked beside, and Shift+click selects past it", async () => {
    const { view } = await open("$ a^2 $");
    const g = view.layout?.glyphs.find((g) => g.flags & 2) as NonNullable<EditorView["layout"]>["glyphs"][0];
    await clickAt(view, 0, g.x + g.width / 2, g.y - g.ascent / 3);
    expect(view.state.selection).toEqual({ anchor: 0, head: 7, node: true });
    await clickAt(view, 0, 270, g.y - g.ascent / 3);
    expect(view.state.selection).toEqual({ anchor: 7, head: 7 });
    await clickAt(view, 0, 30, g.y - g.ascent / 3);
    expect(view.state.selection).toEqual({ anchor: 0, head: 0 });
    // From a caret in the text before an inline one, a Shift+click on it: up to its far end.
    const text = "Some $x^2$ here.";
    const { view: inline } = await open(text);
    const some = glyphAt(inline, 0);
    await clickAt(inline, some.page, some.x, some.y);
    expect(inline.state.selection.head).toBe(0);
    const x = inline.layout?.glyphs.find((g) => g.flags & 2) as NonNullable<EditorView["layout"]>["glyphs"][0];
    await clickAt(inline, 0, x.x + x.width / 2, x.y - x.ascent / 3, true);
    expect(inline.state.selection).toMatchObject({ anchor: 0, head: text.indexOf(" here") });
    expect(inline.state.selection.node).toBeFalsy();
  });

  it("keeps the arrow keys out of a title a running header shows again", async () => {
    // As edu's exam does: the title on the first page, and small in the header of the pages after.
    const template = `${PREAMBLE}#let sheet(title: [], body) = {
  set page(header: context if here().page() > 1 { text(6pt, title) })
  text(14pt, title)
  parbreak()
  body
}
`;
    const text = "#show: sheet.with(title: [Exam title])\n\nFirst page.\n\n#pagebreak()\n\nSecond page.";
    const { view } = await open(text, {}, template);
    const layout = view.layout as NonNullable<EditorView["layout"]>;
    expect(layout.pages.length).toBe(2);
    // The header's glyphs aren't places in the title.
    const title = view.layoutOffset(text.indexOf("Exam title"));
    expect(layout.glyphs.filter((g) => g.from === title).map((g) => g.page)).toEqual([0]);
    const first = text.indexOf("First page.");
    const second = text.indexOf("Second page.");
    view.select({ anchor: first + 2, head: first + 2 });
    view.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(view.state.selection.head).toBeGreaterThanOrEqual(second);
    // Back up: the first page's line, not the title from the header.
    await userEvent.keyboard("{ArrowUp}");
    expect(view.state.selection.head).toBeGreaterThanOrEqual(first);
    expect(view.state.selection.head).toBeLessThanOrEqual(first + 11);
    // A click on the header's copy isn't a click in the title.
    const copy = layout.glyphs.find((g) => g.page === 1 && g.from < 0) as (typeof layout.glyphs)[0];
    await clickAt(view, 1, copy.x + copy.width / 2, copy.y - copy.ascent / 3);
    expect(view.state.selection.head).toBeGreaterThanOrEqual(first);
  });
});
