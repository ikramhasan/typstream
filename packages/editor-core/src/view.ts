// The editor on the pages (#36). The document is shown exactly as the page view shows it, Typst's
// pages painted on canvases by `@typstream/dom`, and edited there: the caret, the selection and
// the component outlines are drawn over the pages from where the engine laid the source out
// (`PagedArtifact.positions`), clicks are resolved against the same, and keys go to a hidden
// textarea (IME and screen keyboards included) and become commands on the source. Every change is
// one `TextEdit` the engine compiles, so what the teacher edits is what prints, exports and
// converts to DOCX.
//
// Between a change and its compile the layout is the previous one: offsets are mapped from the text
// it was compiled from (`DocumentState.artifactInput`) to the current one, and the caret moves on
// by an estimate of what was typed, so it keeps up with typing.
//
// Where Typst lays out nothing beside the caret (a space ending a paragraph, an empty paragraph,
// list item or cell), the engine compiles the text with a placeholder at the caret, so the caret
// has a glyph to stand by and the empty line its height (`caretAnchor`). The source the editor
// reports never has it.

import { diffEdit, type PagedArtifact, type TextEdit } from "@typstream/core";
import { type MountedPaged, mountPaged } from "@typstream/dom";
import type { EngineDocument } from "@typstream/engine";
import { hasErrors, parse } from "@typstream/syntax";
import {
  blockAtOffset,
  canType,
  deleteSelection,
  type EditorSchema,
  insertText,
  moveChar,
  snap,
  splitBlock,
  unitsAt,
} from "./commands";
import { type Compiled, compile, fromCompiled, markersOf, toCompiled } from "./compiled";
import { type Component, componentIn, componentsAt, componentsIn } from "./components";
import { History } from "./history";
import { keysPlugin } from "./keymap";
import { type CaretBox, type Glyph, type Layout, Layout as LayoutClass, type Line, type PageRect } from "./layout";
import { wrappers } from "./marks";
import {
  basicPlugins,
  bindingsOf,
  byPriority,
  type EditorCommand,
  type EditorPlugin,
  matchesShortcut,
  type PluginView,
  schemaOf,
} from "./plugin";
import { EditorState, mapSelection, mapThrough, type Selection, type Transaction } from "./state";
import { escapeMarkup } from "./text";
import { unitBefore, wordAt, wordStep } from "./units";

/** Options of {@link createEditor}. @beta */
export interface EditorOptions {
  /** The document, opened on an engine. The editor compiles it paged, with positions. */
  doc: EngineDocument;
  /** Its text (default: the document's source now, `doc.exportSource()`). The document is set to it, finished. */
  text?: string;
  /** Editor plugins (default: {@link basicPlugins}); a typstream plugin's facet via `fromTypstreamPlugin`. */
  plugins?: readonly EditorPlugin[];
  /** How the pages are laid out in the container, as the page view's `layout` (default `fixed`). */
  layout?: "fixed" | "fit-width";
  /** Called after every change of the source, with the edit. */
  onChange?: (text: string, edit: TextEdit) => void;
  /** Read-only: the caret and selection, no changes. */
  readOnly?: boolean;
  /** Shown where the caret is while the document is empty (`Write something, or press / for blocks`). */
  placeholder?: string;
}

/** A mounted editor. @beta */
export interface EditorView {
  /** The editor's root element (`.typstream-editor`), holding the pages. */
  readonly element: HTMLElement;
  /** The document's source and the selection. */
  readonly state: EditorState;
  /** Where the source was laid out, as of the last compile; `null` before the first. */
  readonly layout: Layout | null;
  /** Whether `layout` shows the current text: no change is waiting for a compile. */
  readonly laidOut: boolean;
  /**
   * Where an offset of the text is among `layout`'s offsets, which count what the editor compiles
   * besides the text (the caret's placeholder, the markers around components).
   */
  layoutOffset(offset: number): number;
  /** The plugins, the editor's own included. */
  readonly plugins: readonly EditorPlugin[];
  /** What the plugins make of Typst's functions. */
  readonly schema: EditorSchema;
  /** Applies a transaction: the source changes, the engine compiles. */
  dispatch(tr: Transaction): void;
  /** Runs a command; whether it applied. */
  run(command: EditorCommand): boolean;
  /** Runs what the keymaps bind to a key (`Enter`, `Mod-b`), as if it were pressed; whether a command applied. */
  runKey(key: string): boolean;
  /** Undoes the last change; whether there was one. */
  undo(): boolean;
  /** Redoes the last undone change. */
  redo(): boolean;
  /** Whether undo and redo can run. */
  readonly history: { readonly canUndo: boolean; readonly canRedo: boolean };
  /** Replaces the whole source (an AI edit, a reload): one edit, kept in the history. */
  setText(text: string): void;
  /** Sets the selection. */
  select(selection: Selection): void;
  /** Focuses the editor (its input). */
  focus(): void;
  /** Whether the editor has focus. */
  readonly focused: boolean;
  /** Calls `listener` after every change of state, layout or focus. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** The selection's rectangles in client coordinates (for a floating toolbar), one per line. */
  selectionRects(): DOMRect[];
  /** The component selected or holding the caret, innermost first. */
  components(): Component[];
  /** A range's boxes on the pages, in client coordinates (a component's, for its controls). */
  boxesOf(from: number, to: number): DOMRect[];
  /** Turns a rectangle on a page into client coordinates. */
  toClient(rect: PageRect): DOMRect | null;
  /** Stops editing: removes the view. */
  destroy(): void;
}

const CSS = `
.typstream-editor { position: relative; outline: none; }
.typstream-editor .typstream-text-layer { pointer-events: none; user-select: none; -webkit-user-select: none; }
.typstream-editor .typstream-links { display: none; }
.typstream-editor .typstream-page { cursor: text; }
.typstream-editor-overlay { position: absolute; inset: 0; pointer-events: none; z-index: 2; }
.typstream-editor-caret { position: absolute; width: 1.5px; margin-left: -0.75px; background: var(--typstream-caret, #111); animation: typstream-blink 1.06s steps(1) infinite; }
.typstream-editor:not([data-focused]) .typstream-editor-caret { display: none; }
.typstream-editor-selection { position: absolute; background: var(--typstream-selection, rgb(37 99 235 / 0.22)); }
.typstream-editor:not([data-focused]) .typstream-editor-selection { background: var(--typstream-selection-inactive, rgb(100 116 139 / 0.18)); }
.typstream-editor-component { position: absolute; outline: 1.5px solid var(--typstream-component, rgb(37 99 235 / 0.55)); outline-offset: 2px; border-radius: 2px; }
.typstream-editor-component[data-selected] { outline-width: 2px; outline-color: var(--typstream-component-selected, rgb(37 99 235)); background: rgb(37 99 235 / 0.06); }
.typstream-editor-input { position: absolute; width: 1px; height: 1em; padding: 0; border: 0; margin: 0; opacity: 0; resize: none; overflow: hidden; white-space: pre; font-size: 16px; caret-color: transparent; color: transparent; background: transparent; outline: none; pointer-events: none; }
.typstream-editor-decoration { position: absolute; }
.typstream-editor-decoration[data-kind="box"] { outline: 1.5px solid var(--typstream-decoration, rgb(234 179 8)); outline-offset: 1px; }
.typstream-editor-placeholder { position: absolute; white-space: nowrap; color: var(--typstream-placeholder, rgb(100 116 139 / 0.75)); font-family: system-ui, sans-serif; line-height: 1; pointer-events: none; }
.typstream-editor-input[data-menu] { pointer-events: auto; z-index: 3; width: 24px; height: 24px; }
.typstream-editor-composition { position: absolute; white-space: pre; background: var(--typstream-composition, rgb(254 240 138 / 0.8)); border-bottom: 1px solid currentColor; font-family: serif; line-height: 1; }
@keyframes typstream-blink { 50% { opacity: 0; } }
@media print { .typstream-editor-overlay { display: none; } }
`;

const SHEET = Symbol.for("typstream.editor.css");

const ensureStyles = (doc: Document) => {
  const holder = doc as Document & { [SHEET]?: true };
  if (holder[SHEET]) return;
  holder[SHEET] = true;
  if ("adoptedStyleSheets" in doc && typeof CSSStyleSheet === "function" && "replaceSync" in CSSStyleSheet.prototype) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
  } else {
    const style = doc.createElement("style");
    style.textContent = CSS;
    doc.head.append(style);
  }
};

/** Whether the platform's shortcuts use ⌘. */
const isApple = (win: Window) => /Mac|iPhone|iPad|iPod/.test(win.navigator.platform || win.navigator.userAgent);

/** A line holding a list item's marker and nothing else (`- `, `+ `, `1. `, `/ `). */
const EMPTY_ITEM = /^[ \t]*(?:[-+/]|\d+\.)[ \t]*$/;

/** Percent of `total`, for positions inside a page element. */
const pct = (v: number, total: number) => `${((v / total) * 100).toFixed(4)}%`;

/**
 * Mounts the editor on `container`: the document's pages, editable.
 * @beta
 */
export const createEditor = (container: HTMLElement, options: EditorOptions): EditorView => {
  const doc = options.doc;
  const docEl = container.ownerDocument;
  const win = docEl.defaultView as Window;
  ensureStyles(docEl);
  const given = options.plugins ?? basicPlugins;
  // Every editor has its keys; a plugin of higher priority binds the same key where it applies.
  const plugins = given.some((p) => p.key === keysPlugin.key) ? given : [...given, keysPlugin];
  const ordered = byPriority(plugins);
  const schema = schemaOf(plugins);
  const apple = isApple(win);
  const readOnly = options.readOnly === true;

  const element = docEl.createElement("div");
  element.className = "typstream-editor";
  container.append(element);
  const pagesHost = docEl.createElement("div");
  element.append(pagesHost);
  const input = docEl.createElement("textarea");
  input.className = "typstream-editor-input";
  input.setAttribute("autocomplete", "off");
  input.setAttribute("autocorrect", "off");
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("spellcheck", "false");
  input.setAttribute("aria-label", "Document editor");
  input.setAttribute("aria-multiline", "true");
  input.setAttribute("role", "textbox");
  if (readOnly) input.readOnly = true;
  element.append(input);

  doc.setPositions(true);
  const paged: MountedPaged = mountPaged(pagesHost, doc, { layout: options.layout ?? "fixed", linkTarget: null });
  const pagesEl = paged.view.element;

  let state = new EditorState(options.text ?? doc.exportSource());
  // The caret starts where text can be typed: the first character's place, not in a heading's marker or code.
  {
    const units = unitsAt(state, schema);
    // A character's place: the space between two rules of a preamble isn't where text shows.
    const first = units.find((u) => u.kind === "char") ?? units.find((u) => u.kind === "space");
    if (first) state = state.select({ anchor: first.from, head: first.from });
  }
  // Edits are offsets into the document's input: it must be the editor's text.
  doc.set(state.text);
  doc.finish();
  /** The text the engine has: the editor's, with the caret's placeholder and the calls' markers (compiled.ts). */
  let sent: Compiled = { text: state.text, plain: state.text, inserts: [] };
  /** Texts sent lately, by what was compiled: a layout's offsets are in one of them. */
  const versions = new Map<string, Compiled>([[sent.text, sent]]);
  let layout: Layout | null = null;
  /** The text `layout` was compiled from. */
  let layoutText: string | null = null;
  /** What that text was: the editor's text then, and the insertions. */
  let compiled: Compiled | null = null;
  let shownArtifact: PagedArtifact | null = null;
  const history = new History();
  const listeners = new Set<() => void>();
  let focused = false;
  /** Where the caret goes on up/down: the x it started at. */
  let goalX: number | null = null;
  let composing = false;
  let compositionText = "";

  /** Plugins' own views, made once the view exists (below). */
  let pluginViews: PluginView[] = [];
  /** The state the plugins' views last saw. */
  let seen = state;
  const notify = () => {
    const previous = seen;
    seen = state;
    for (const v of pluginViews) v.update?.(api, previous);
    for (const l of [...listeners]) l();
  };

  /** Brings the engine's text up to the state: the change, the caret's placeholder and the markers moved. */
  const syncDoc = () => {
    const next = compile(state, schema, focused);
    const edit = diffEdit(sent.text, next.text);
    if (!edit) return;
    sent = next;
    versions.set(next.text, next);
    // The engine compiles at most the last few: older ones are never laid out.
    if (versions.size > 32) versions.delete(versions.keys().next().value as string);
    doc.applyEdit(edit);
  };

  // -------------------------------------------------------------------------
  // Offsets between the current text and the layout's

  /** The current text's change from the layout's, as one edit (null when they are the same). */
  let pending: TextEdit | null = null;
  const updatePending = () => {
    pending = compiled === null || compiled.plain === state.text ? null : diffEdit(compiled.plain, state.text);
  };
  /** A current offset in the editor's text as the layout had it, and how many typed characters it is past that. */
  const toLayoutPlain = (offset: number): { offset: number; ahead: number } => {
    if (!pending) return { offset, ahead: 0 };
    const { from, to, insert } = pending;
    if (offset <= from) return { offset, ahead: 0 };
    if (offset >= from + insert.length) return { offset: offset - insert.length + (to - from), ahead: 0 };
    // In text typed since: at the end of what it replaced, so many characters on.
    return { offset: to, ahead: offset - from };
  };
  /** A current offset in the layout's text (with its insertions), and how many typed characters it is past that. */
  const toLayout = (offset: number): { offset: number; ahead: number } => {
    const p = toLayoutPlain(offset);
    return compiled ? { offset: toCompiled(compiled, p.offset), ahead: p.ahead } : p;
  };
  /** A layout offset in the current text. */
  const fromLayout = (offset: number): number => {
    const plain = compiled ? fromCompiled(compiled, offset) : offset;
    return pending ? mapThrough(plain, [pending], -1) : plain;
  };

  /**
   * Where a call that shows none of the document went (a number line, answer lines): between its
   * markers (compiled.ts). On one line, from one to the other; else the column's width from the
   * first's line down to the second, page by page.
   */
  const atomRects = (from: number, to: number): PageRect[] => {
    if (!layout || !compiled) return [];
    const m = markersOf(compiled, toLayoutPlain(from).offset, toLayoutPlain(to).offset);
    if (!m) return [];
    // A marker's element is its call's node: past its `#`.
    const marker = (at: number) =>
      layout?.elements.find((e) => e.kind === "metadata" && e.node && e.node[0] >= at && e.node[0] <= at + 1);
    const a = marker(m.open);
    const b = marker(m.close);
    if (!a || !b) return [];
    const lines = (page: number) => layout?.lines.filter((l) => l.page === page) ?? [];
    const column = (page: number) => {
      const ls = lines(page);
      const size = layout?.pages[page] ?? { width: 0, height: 0 };
      const left = Math.min(a.x, ...ls.map((l) => l.left));
      const right = Math.max(size.width - left, ...ls.map((l) => l.right));
      const top = Math.min(size.height * 0.08, ...ls.map((l) => l.top));
      const bottom = Math.max(size.height - top, ...ls.map((l) => l.bottom));
      return { left, right, top, bottom };
    };
    if (a.page === b.page && Math.abs(a.y - b.y) < 2) {
      // In a line of text: the line's height, from one marker to the other.
      const line = layout.lineAt(a.page, a.x, a.y);
      const top = line && Math.abs(line.top - a.y) < 30 ? line.top : a.y - 10;
      const bottom = line && Math.abs(line.top - a.y) < 30 ? line.bottom : a.y + 4;
      return [{ page: a.page, x: a.x, y: top, width: Math.max(b.x - a.x, 2), height: bottom - top }];
    }
    const out: PageRect[] = [];
    for (let page = a.page; page <= b.page; page++) {
      const c = column(page);
      const top = page === a.page ? a.y : c.top;
      const bottom = page === b.page ? b.y : c.bottom;
      if (bottom - top > 0.5) out.push({ page, x: c.left, y: top, width: c.right - c.left, height: bottom - top });
    }
    return out;
  };

  /** A component's boxes on the pages: what its call lays out, and between its markers when it shows none of the document. */
  const rangeRects = (from: number, to: number): PageRect[] => {
    if (!layout) return [];
    const range = toLayoutRange(from, to);
    return [...layout.boxes(range.from, range.to), ...atomRects(from, to)];
  };

  // -------------------------------------------------------------------------
  // Where things are

  const pageEls = (): HTMLElement[] => [...pagesEl.querySelectorAll<HTMLElement>(":scope > .typstream-page")];

  /** Where a caret at a current offset is drawn. */
  const caretBox = (offset: number): CaretBox | null => {
    if (!layout) return null;
    const { offset: at, ahead } = toLayout(offset);
    let box = layout.caret(at, -1);
    let line: Line | null = box ? layout.lineOf(at, -1) : null;
    if (!box) box = pieceCaret(offset);
    if (!box) box = fallbackCaret(at);
    if (!box) return null;
    if (ahead > 0) {
      // Characters typed since the layout: on by an average character's width.
      const height = box.bottom - box.top;
      box = { ...box, x: box.x + ahead * height * 0.42 };
      void line;
      line = null;
    }
    return box;
  };

  /**
   * A caret at the start or end of a piece shown whole (an equation, a call), where no glyph of the
   * document's text starts or ends: by the piece's first or last glyph, else its markers' box.
   */
  const pieceCaret = (offset: number): CaretBox | null => {
    if (!layout) return null;
    const units = unitsAt(state, schema);
    const u = units.find((x) => x.kind === "atom" && (x.from === offset || x.to === offset));
    if (!u) return null;
    const start = u.from === offset;
    const r = toLayoutRange(u.from, u.to);
    let best: Glyph | null = null;
    for (const g of layout.glyphs) {
      if (g.from < r.from || g.to > r.to || g.from < 0) continue;
      if (!best || (start ? g.from < best.from : g.to > best.to)) best = g;
    }
    if (best) {
      const x = start ? best.x : best.x + best.width;
      return { page: best.page, x, top: best.y - best.ascent, bottom: best.y + best.descent };
    }
    const rects = atomRects(u.from, u.to);
    const rect = start ? rects[0] : rects[rects.length - 1];
    if (!rect) return null;
    const h = Math.min(rect.height, 16);
    return { page: rect.page, x: start ? rect.x : rect.x + rect.width, top: rect.y, bottom: rect.y + h };
  };

  /**
   * A caret where no glyph is: in an empty table cell (its element), or on a line of its own after
   * the text before (a new paragraph: Typst lays an empty one out as nothing).
   */
  const fallbackCaret = (at: number): CaretBox | null => {
    if (!layout) return null;
    const lt = layoutText ?? state.text;
    // An empty cell or list item: where its element starts.
    const cell = layout.elements.find(
      (e) => (e.kind === "cell" || e.kind === "item-body") && e.node && e.node[0] <= at && at <= e.node[1],
    );
    if (cell) {
      const size = 11;
      const inset = cell.kind === "cell" ? 5 : 0;
      return { page: cell.page, x: cell.x + inset, top: cell.y + inset, bottom: cell.y + inset + size * 1.3 };
    }
    const { prev, next } = layout.neighbors(at);
    const item = emptyItemCaret(at, prev);
    if (item) return item;
    if (prev) {
      const between = lt.slice(prev.to, at);
      const lines = between.split("\n").length - 1;
      const height = prev.ascent + prev.descent;
      const line = layout.lines[prev.line] as Line;
      if (lines >= 2) {
        // A new paragraph after it: a line below, at the start of the paragraph's lines.
        const left = paragraphLeft(prev.line);
        const top = line.bottom + height * 0.65;
        return { page: prev.page, x: left, top, bottom: top + height };
      }
      return { page: prev.page, x: prev.x + prev.width, top: prev.y - prev.ascent, bottom: prev.y + prev.descent };
    }
    if (next) return { page: next.page, x: next.x, top: next.y - next.ascent, bottom: next.y + next.descent };
    // An empty document: the first page's top left margin.
    const page = layout.pages[0];
    if (!page) return null;
    const margin = Math.min(page.width, page.height) * 0.119;
    return { page: 0, x: margin, top: margin, bottom: margin + 14 };
  };

  /**
   * A caret in an empty list item: after its bullet or number. Typst lays the item out as its
   * marker alone, glyphs that show no source, on a line of its own after the text before; the
   * caret goes where the item's text would start, as in the item before it.
   */
  const emptyItemCaret = (at: number, prev: Glyph | null): CaretBox | null => {
    if (!layout) return null;
    const lt = layoutText ?? state.text;
    const lineStart = lt.lastIndexOf("\n", at - 1) + 1;
    const lineEnd = lt.indexOf("\n", at);
    if (!EMPTY_ITEM.test(lt.slice(lineStart, at)) || lt.slice(at, lineEnd < 0 ? lt.length : lineEnd).trim())
      return null;
    // Empty items in a row are lines of markers alone: this one is the nth after the text before.
    const lines = lt
      .slice(prev ? prev.to : 0, lineStart)
      .split("\n")
      .slice(prev ? 1 : 0);
    let nth = lines.filter((l) => EMPTY_ITEM.test(l)).length;
    for (let i = prev ? prev.line + 1 : 0; i < layout.lines.length; i++) {
      const line = layout.lines[i] as Line;
      const glyphs = layout.glyphs.slice(line.first, line.last + 1);
      if (glyphs.some((g) => g.from >= 0)) return null;
      if (nth-- > 0) continue;
      const marker = glyphs[glyphs.length - 1] as Glyph;
      const end = marker.x + marker.width;
      // The gap between a marker and its text, from the item before when its line starts with one.
      let gap = (marker.ascent + marker.descent) * 0.45;
      const above = prev ? layout.glyphs.slice((layout.lines[prev.line] as Line).first) : [];
      const text = above.findIndex((g) => g.from >= 0);
      if (text > 0 && (above[0] as Glyph).from < 0) {
        const m = above[text - 1] as Glyph;
        gap = (above[text] as Glyph).x - (m.x + m.width);
      }
      return { page: marker.page, x: end + gap, top: marker.y - marker.ascent, bottom: marker.y + marker.descent };
    }
    return null;
  };

  /** The left edge of the lines of the paragraph `line` is in: the leftmost of the lines above it that stack. */
  const paragraphLeft = (lineIndex: number): number => {
    if (!layout) return 0;
    const line = layout.lines[lineIndex] as Line;
    let left = line.left;
    for (let i = lineIndex - 1; i >= 0 && i > lineIndex - 30; i--) {
      const l = layout.lines[i] as Line;
      if (l.page !== line.page || l.bottom > line.top + 1 || line.top - l.bottom > 12) break;
      left = Math.min(left, l.left);
    }
    return left;
  };

  /** Converts a page rectangle to client coordinates. */
  const toClient = (rect: PageRect): DOMRect | null => {
    const el = pageEls()[rect.page];
    const page = layout?.pages[rect.page];
    if (!el || !page) return null;
    const r = el.getBoundingClientRect();
    const k = r.width / page.width;
    return new DOMRect(r.left + rect.x * k, r.top + rect.y * k, rect.width * k, rect.height * k);
  };

  /** A client point as a page and a point on it, in points. */
  const pointAt = (
    clientX: number,
    clientY: number,
    target: EventTarget | null,
  ): { page: number; x: number; y: number } | null => {
    if (!layout) return null;
    const els = pageEls();
    let index = target instanceof Element ? els.indexOf(target.closest(".typstream-page") as HTMLElement) : -1;
    if (index < 0) {
      // Between pages: the nearest one.
      let best = Number.POSITIVE_INFINITY;
      els.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        const d = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0;
        if (d < best) {
          best = d;
          index = i;
        }
      });
    }
    const el = els[index];
    const page = layout.pages[index];
    if (!el || !page) return null;
    const r = el.getBoundingClientRect();
    const k = page.width / r.width;
    return { page: index, x: (clientX - r.left) * k, y: (clientY - r.top) * k };
  };

  // -------------------------------------------------------------------------
  // Drawing

  let frame: number | null = null;
  const scheduleDraw = () => {
    if (frame === null) frame = win.requestAnimationFrame(draw);
  };
  /** Overlays by page index. */
  const overlays: HTMLElement[] = [];
  const overlayFor = (index: number): HTMLElement | null => {
    const el = pageEls()[index];
    if (!el) return null;
    let overlay = overlays[index];
    if (!overlay || overlay.parentElement !== el) {
      overlay = docEl.createElement("div");
      overlay.className = "typstream-editor-overlay";
      overlay.setAttribute("aria-hidden", "true");
      el.append(overlay);
      overlays[index] = overlay;
    }
    return overlay;
  };
  const place = (el: HTMLElement, page: number, x: number, y: number, w: number | null, h: number) => {
    const size = layout?.pages[page];
    if (!size) return;
    el.style.left = pct(x, size.width);
    el.style.top = pct(y, size.height);
    if (w !== null) el.style.width = pct(w, size.width);
    el.style.height = pct(h, size.height);
  };

  let caretEl: HTMLElement | null = null;
  const draw = () => {
    frame = null;
    for (const o of overlays) o?.replaceChildren();
    if (!layout) return;
    const { anchor, head, node } = state.selection;
    // Components: the selected one, or the ones holding the caret.
    // A node selection that is no component with a form (an equation, a call of no plugin's) is outlined too.
    const outlined = selectedComponents().map((c) => ({ from: c.from, to: c.to }));
    if (node && outlined.length === 0) outlined.push({ from: Math.min(anchor, head), to: Math.max(anchor, head) });
    for (const c of outlined) {
      for (const box of rangeRects(c.from, c.to)) {
        const overlay = overlayFor(box.page);
        if (!overlay) continue;
        const el = docEl.createElement("div");
        el.className = "typstream-editor-component";
        if (node && c.from === Math.min(anchor, head) && c.to === Math.max(anchor, head)) el.dataset.selected = "";
        place(el, box.page, box.x, box.y, box.width, box.height);
        overlay.append(el);
      }
    }
    if (anchor !== head && !node) {
      const range = toLayoutRange(Math.min(anchor, head), Math.max(anchor, head));
      for (const r of layout.rects(range.from, range.to)) {
        const overlay = overlayFor(r.page);
        if (!overlay) continue;
        const el = docEl.createElement("div");
        el.className = "typstream-editor-selection";
        place(el, r.page, r.x, r.y, r.width, r.height);
        overlay.append(el);
      }
    }
    for (const p of plugins)
      for (const d of p.decorations?.(state, schema) ?? []) {
        const range = toLayoutRange(d.from, d.to);
        const box = d.kind === "box";
        for (const r of box ? rangeRects(d.from, d.to) : layout.rects(range.from, range.to)) {
          const overlay = overlayFor(r.page);
          if (!overlay) continue;
          const el = docEl.createElement("div");
          el.className = d.class ? `typstream-editor-decoration ${d.class}` : "typstream-editor-decoration";
          el.dataset.kind = box ? "box" : "text";
          if (d.color) {
            if (box) el.style.outlineColor = d.color;
            else el.style.background = d.color;
          }
          place(el, r.page, r.x, r.y, r.width, r.height);
          overlay.append(el);
        }
      }
    caretEl = null;
    if (anchor === head || composing) {
      const box = caretBox(head);
      if (box && options.placeholder && !composing && state.text.trim() === "") {
        const overlay = overlayFor(box.page);
        if (overlay) {
          const hint = docEl.createElement("span");
          hint.className = "typstream-editor-placeholder";
          hint.textContent = options.placeholder;
          const size = layout.pages[box.page] as { width: number };
          const k = (pageEls()[box.page]?.getBoundingClientRect().width ?? size.width) / size.width;
          hint.style.fontSize = `${(box.bottom - box.top) * k * 0.62}px`;
          place(hint, box.page, box.x + 2, box.top + (box.bottom - box.top) * 0.2, null, box.bottom - box.top);
          hint.style.height = "";
          overlay.append(hint);
        }
      }
      if (box) {
        const overlay = overlayFor(box.page);
        if (overlay) {
          caretEl = docEl.createElement("div");
          caretEl.className = "typstream-editor-caret";
          place(caretEl, box.page, box.x, box.top, null, box.bottom - box.top);
          overlay.append(caretEl);
          if (composing && compositionText) {
            const comp = docEl.createElement("span");
            comp.className = "typstream-editor-composition";
            comp.textContent = compositionText;
            const size = layout.pages[box.page] as { width: number };
            const k = (pageEls()[box.page]?.getBoundingClientRect().width ?? size.width) / size.width;
            comp.style.fontSize = `${(box.bottom - box.top) * k * 0.8}px`;
            place(comp, box.page, box.x, box.top, null, box.bottom - box.top);
            comp.style.height = "";
            overlay.append(comp);
          }
        }
        // The input follows the caret, so IME windows open by it.
        const client = toClient({ page: box.page, x: box.x, y: box.top, width: 1, height: box.bottom - box.top });
        const host = element.getBoundingClientRect();
        if (client && !("menu" in input.dataset)) {
          input.style.left = `${client.left - host.left}px`;
          input.style.top = `${client.top - host.top}px`;
          input.style.height = `${Math.max(client.height, 12)}px`;
        }
      }
    }
  };

  const toLayoutRange = (from: number, to: number) => ({ from: toLayout(from).offset, to: toLayout(to).offset });

  const selectedComponents = (): Component[] => {
    const { anchor, head, node } = state.selection;
    if (node) {
      const c = componentIn(state, Math.min(anchor, head), Math.max(anchor, head), schema);
      return c ? [c] : [];
    }
    // Only components with a spec draw an outline (a table, an edu question), the innermost.
    const known = new Set(plugins.flatMap((p) => (p.components ?? []).map((c) => c.name)));
    const around = componentsAt(state, head, schema).filter((c) => known.has(c.name));
    return around.slice(0, 1);
  };

  const scrollToCaret = () => {
    win.requestAnimationFrame(() => {
      const el = caretEl;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > win.innerHeight) el.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  };

  // -------------------------------------------------------------------------
  // Changing the state

  const setState = (next: EditorState, edit: TextEdit | null, record: { merge?: boolean } | null) => {
    const before = state;
    state = next;
    syncDoc();
    if (edit) {
      if (record) history.record(before.text, next.text, before.selection, next.selection, record.merge);
      options.onChange?.(next.text, edit);
    }
    updatePending();
    scheduleDraw();
    notify();
  };

  const dispatch = (tr: Transaction) => {
    if (readOnly && tr.edits.length) return;
    const { state: next, edit } = state.apply(tr);
    goalX = null;
    setState(next, edit, { merge: tr.merge });
  };

  const run = (command: EditorCommand): boolean => {
    const tr = command(state, schema);
    if (!tr) return false;
    dispatch(tr);
    // From a menu or a toolbar: what it made may be off screen (a page break, a table at the end),
    // and is laid out with the next compile.
    scrollToCaret();
    scrollOnLayout = true;
    return true;
  };

  const restore = (to: { text: string; selection: Selection } | null): boolean => {
    if (!to) return false;
    const edit = diffEdit(state.text, to.text);
    const next = new EditorState(to.text, to.selection);
    setState(next, edit, null);
    return true;
  };

  const select = (selection: Selection) => {
    // Leaving an empty mark the toolbar put at the caret (bold, then a click elsewhere): it goes,
    // rather than staying in the source as `#strong[]`.
    const w = state.empty
      ? wrappers(state).find((x) => x.innerFrom === x.innerTo && x.innerFrom === state.selection.head)
      : undefined;
    const next = state.select(selection);
    if (w && (next.from < w.from || next.to > w.to)) {
      const edits = [{ from: w.from, to: w.to, insert: "" }];
      const moved = new EditorState(state.apply({ edits }).state.text, mapSelection(selection, edits));
      setState(moved, diffEdit(state.text, moved.text), { merge: true });
      return;
    }
    state = next;
    syncDoc();
    scheduleDraw();
    notify();
  };

  // -------------------------------------------------------------------------
  // Layout from the engine

  /** Scroll to the caret once the next layout arrives (after a command from a menu). */
  let scrollOnLayout = false;
  const onDoc = () => {
    const s = doc.getState();
    const artifact = s.artifact;
    if (artifact?.target !== "paged" || !artifact.positions || artifact === shownArtifact) return;
    shownArtifact = artifact;
    layout = new LayoutClass(artifact);
    layoutText = s.artifactInput;
    compiled = (layoutText !== null && versions.get(layoutText)) || {
      text: layoutText ?? "",
      plain: layoutText ?? "",
      inserts: [],
    };
    updatePending();
    scheduleDraw();
    if (scrollOnLayout && layoutText === sent.text) {
      scrollOnLayout = false;
      scrollToCaret();
    }
    notify();
  };
  const unsubscribe = doc.subscribe(onDoc);
  onDoc();

  // -------------------------------------------------------------------------
  // Mouse

  let dragging = false;
  let dragAnchor = 0;
  let clicks = 0;
  let lastClick = 0;
  let lastClickAt = { x: 0, y: 0 };

  /** The current offset under a client point, or a component to select there. */
  /** A piece shown whole (an equation, a call) that a click selects rather than putting the caret at its edge. */
  const selectable = (from: number, to: number): boolean => {
    const text = state.text;
    if (text[from] === "$") return true;
    const c = componentIn(state, from, to, schema);
    if (c && plugins.some((p) => p.components?.some((spec) => spec.name === c.name))) return true;
    // On a line of its own: a block (a number line, a page break).
    const start = text.lastIndexOf("\n", from - 1) + 1;
    const eol = text.indexOf("\n", to);
    return text.slice(start, from).trim() === "" && text.slice(to, eol < 0 ? undefined : eol).trim() === "";
  };
  /** What a click on a piece shown whole does: selects it, or puts the caret at the edge nearer to `x`. */
  const onPiece = (from: number, to: number, nearStart: boolean): { offset: number } | { node: Range } =>
    selectable(from, to) ? { node: { from, to } } : { offset: nearStart ? from : to };

  /** The current offset under a client point, or a piece to select there (a component, an equation). */
  const resolve = (
    clientX: number,
    clientY: number,
    target: EventTarget | null,
  ): { offset: number } | { node: Range } | null => {
    const point = pointAt(clientX, clientY, target);
    if (!point || !layout) return null;
    const hit = layout.hit(point.page, point.x, point.y);
    const line = hit.line;
    // In a table cell whose text isn't what was hit (an empty cell next to a full one): its start.
    // Only a table's or grid's the document writes: a component a package lays out as a grid (an
    // edu question) has cells too, which aren't for the caret.
    const ownCell = (e: { node?: [number, number] | null }) => {
      if (!e.node) return false;
      const c = componentsAt(state, fromLayout(e.node[0]) + 1, schema)[0];
      return !!c && (c.name === "table" || c.name === "grid");
    };
    const cellOf = (x: number, y: number) =>
      layout?.elements.find(
        (e) =>
          e.kind === "cell" &&
          e.page === point.page &&
          e.node &&
          within({ x, y }, layout?.cellBox(e) ?? [], 0) &&
          ownCell(e),
      );
    const cell = cellOf(point.x, point.y);
    if (cell?.node && (!hit.glyph || cellOf(hit.glyph.x + hit.glyph.width / 2, hit.glyph.y) !== cell)) {
      const lt = layoutText ?? state.text;
      const start = lt[cell.node[0]] === "[" ? cell.node[0] + 1 : cell.node[0];
      return { offset: snap(state, fromLayout(start), schema) };
    }
    const units = unitsAt(state, schema);
    // Off any glyph, inside the drawing of a piece shown whole (answer lines under a line of
    // text, a number line): that piece, before the nearest text.
    const g = hit.glyph;
    const onGlyph =
      !!g &&
      point.x >= g.x - 1 &&
      point.x <= g.x + g.width + 1 &&
      point.y >= g.y - g.ascent &&
      point.y <= g.y + g.descent;
    if (!onGlyph) {
      const inPiece = (u: { from: number; to: number }) =>
        rangeRects(u.from, u.to).some((b) => b.page === point.page && within(point, [b.x, b.y, b.width, b.height], 0));
      // Components count where they show no text at the click's height (answer lines under a
      // question's text, their answer hidden): a click beside a line of text is the text's.
      const textAt = (c: { from: number; to: number }) => {
        const r = toLayoutRange(c.from, c.to);
        return (
          layout
            ?.rects(r.from, r.to)
            .some((b) => b.page === point.page && point.y >= b.y - 2 && point.y <= b.y + b.height + 2) ?? false
        );
      };
      const piece = [...units.filter((u) => u.kind === "atom"), ...componentsIn(state, schema)]
        .filter((c) => inPiece(c) && !textAt(c))
        .sort((a, b) => a.to - a.from - (b.to - b.from))[0];
      if (piece) {
        const box = rangeRects(piece.from, piece.to).find((b) => b.page === point.page);
        return onPiece(piece.from, piece.to, !box || point.x < box.x + box.width / 2);
      }
    }
    const onText =
      !!hit.glyph && hit.glyph.from >= 0 && !!line && point.y >= line.top - 4 && point.y <= line.bottom + 4;
    if (onText && hit.offset !== null && hit.glyph) {
      const at = fromLayout(hit.offset);
      // A glyph of an equation or of a call's arguments (`ce("H2O")`): the piece it is part of.
      const glyphAt = fromLayout(hit.glyph.from);
      const piece = units.find((u) => u.kind === "atom" && u.from <= glyphAt && glyphAt < u.to);
      if (piece && (hit.glyph.flags & 2 || (piece.from < at && at < piece.to))) {
        const box = rangeRects(piece.from, piece.to).find((b) => b.page === point.page);
        return onPiece(piece.from, piece.to, !box || point.x < box.x + box.width / 2);
      }
      return { offset: snap(state, at, schema) };
    }
    // Off the text, on a component's own drawing (a question's number, a table's rules, a number
    // line): the innermost component or piece there.
    const inside = (from: number, to: number) =>
      rangeRects(from, to).some((b) => b.page === point.page && within(point, [b.x, b.y, b.width, b.height], 1));
    const pieces = units.filter((u) => u.kind === "atom" && inside(u.from, u.to));
    const hits: Range[] = [...componentsIn(state, schema).filter((c) => inside(c.from, c.to)), ...pieces];
    const innermost = hits.sort((a, b) => a.to - a.from - (b.to - b.from))[0];
    if (innermost) {
      // A table's cell: a caret in it.
      const cell = layout.elements.find(
        (e) => e.kind === "cell" && e.page === point.page && e.node && within(point, layout?.cellBox(e) ?? [], 0),
      );
      const c = componentIn(state, innermost.from, innermost.to, schema);
      if (cell?.node && c && (c.name === "table" || c.name === "grid")) {
        const lt = layoutText ?? state.text;
        const start = lt[cell.node[0]] === "[" ? cell.node[0] + 1 : cell.node[0];
        return { offset: snap(state, fromLayout(start), schema) };
      }
      if (pieces.includes(innermost as (typeof pieces)[number])) {
        const box = rangeRects(innermost.from, innermost.to).find((b) => b.page === point.page);
        return onPiece(innermost.from, innermost.to, !box || point.x < box.x + box.width / 2);
      }
      return { node: { from: innermost.from, to: innermost.to } };
    }
    if (hit.offset === null) return null;
    return { offset: snap(state, fromLayout(hit.offset), schema) };
  };

  /**
   * A right click: the caret there (unless it is in the selection), and the hidden input under the
   * pointer holding the selected text, so the browser's menu is an editing one: Cut, Copy and Paste
   * reach the clipboard handlers below.
   */
  const onMenuDown = (e: PointerEvent) => {
    const hit = resolve(e.clientX, e.clientY, e.target);
    if (hit && "offset" in hit && (state.empty || hit.offset < state.from || hit.offset > state.to))
      select({ anchor: hit.offset, head: hit.offset });
    focusInput();
    const host = element.getBoundingClientRect();
    input.style.left = `${e.clientX - host.left - 12}px`;
    input.style.top = `${e.clientY - host.top - 12}px`;
    input.dataset.menu = "";
    input.value = state.empty ? "\u200b" : shownText(state.from, state.to);
    input.select();
  };
  const onContextMenu = () => {
    // The menu is open: the input stops catching the pointer, and goes back to the caret.
    win.setTimeout(() => {
      delete input.dataset.menu;
      scheduleDraw();
    }, 0);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button === 2) return onMenuDown(e);
    if (e.button !== 0) return;
    const target = e.target as Element | null;
    if (target?.closest(".typstream-island")) return;
    const now = e.timeStamp;
    clicks =
      now - lastClick < 450 && Math.hypot(e.clientX - lastClickAt.x, e.clientY - lastClickAt.y) < 6 ? clicks + 1 : 1;
    lastClick = now;
    lastClickAt = { x: e.clientX, y: e.clientY };
    const hit = resolve(e.clientX, e.clientY, e.target);
    e.preventDefault();
    focusInput();
    if (!hit) return;
    goalX = null;
    if ("node" in hit) {
      select({ anchor: hit.node.from, head: hit.node.to, node: true });
      return;
    }
    const at = hit.offset;
    if (clicks === 2) {
      const word = wordAt(unitsAt(state, schema), state.text, at);
      select({ anchor: word.from, head: word.to });
      return;
    }
    if (clicks >= 3) {
      const block = blockAtOffset(state, at, schema);
      if (block) select({ anchor: textStart(block.from, block.to), head: block.to });
      return;
    }
    if (e.shiftKey) select({ anchor: state.selection.anchor, head: at });
    else select({ anchor: at, head: at });
    dragging = true;
    dragAnchor = e.shiftKey ? state.selection.anchor : at;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };

  /** Where a block's text starts: past a heading's or item's marker. */
  const textStart = (from: number, to: number): number => {
    const units = unitsAt(state, schema);
    const u = units.find((x) => x.from >= from && x.kind !== "edge");
    return u && u.from <= to ? u.from : from;
  };

  /** Where the pointer is while dragging, for scrolling on past the panel's edge. */
  let dragPoint: { x: number; y: number } | null = null;
  let scrolling: number | null = null;
  const dragTo = (x: number, y: number) => {
    const hit = resolve(x, y, docEl.elementFromPoint(x, y));
    if (!hit || "node" in hit) return;
    if (hit.offset !== state.selection.head) select({ anchor: dragAnchor, head: hit.offset });
  };
  /** Dragging a selection past the top or bottom of the panel scrolls it, faster the further out. */
  const autoscroll = () => {
    scrolling = null;
    if (!dragging || !dragPoint) return;
    const viewport = scrollParent();
    const top = viewport ? viewport.getBoundingClientRect().top : 0;
    const bottom = viewport ? viewport.getBoundingClientRect().bottom : win.innerHeight;
    const edge = 24;
    const over =
      dragPoint.y < top + edge
        ? dragPoint.y - top - edge
        : dragPoint.y > bottom - edge
          ? dragPoint.y - bottom + edge
          : 0;
    if (over === 0) return;
    const by = Math.sign(over) * Math.min(40, Math.abs(over) / 2 + 2);
    if (viewport) viewport.scrollBy({ top: by });
    else win.scrollBy({ top: by });
    dragTo(dragPoint.x, Math.min(Math.max(dragPoint.y, top + 1), bottom - 1));
    scrolling = win.requestAnimationFrame(autoscroll);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    dragPoint = { x: e.clientX, y: e.clientY };
    dragTo(e.clientX, e.clientY);
    if (scrolling === null) scrolling = win.requestAnimationFrame(autoscroll);
  };
  const onPointerUp = () => {
    dragging = false;
    dragPoint = null;
  };

  pagesHost.addEventListener("pointerdown", onPointerDown);
  pagesHost.addEventListener("pointermove", onPointerMove);
  pagesHost.addEventListener("pointerup", onPointerUp);
  pagesHost.addEventListener("pointercancel", onPointerUp);
  pagesHost.addEventListener("contextmenu", onContextMenu);
  input.addEventListener("contextmenu", onContextMenu);

  // -------------------------------------------------------------------------
  // Keys

  const focusInput = () => {
    if (docEl.activeElement !== input) input.focus({ preventScroll: true });
  };

  const moveTo = (head: number, extend: boolean) => {
    const anchor = extend ? state.selection.anchor : head;
    select({ anchor, head });
    scrollToCaret();
  };

  const vertical = (dir: 1 | -1, extend: boolean): boolean => {
    if (!layout) return false;
    const { offset } = toLayout(state.selection.head);
    const box = caretBox(state.selection.head);
    if (!box) return false;
    // The caret's line: where its glyph is, or (beside an equation or a component's drawing,
    // with no glyph of its own) the line where it is drawn.
    const line = layout.lineOf(offset, -1) ?? layout.lineAt(box.page, box.x, (box.top + box.bottom) / 2);
    if (!line) return false;
    goalX ??= box.x;
    // The next line with a place for the caret: lines of a package's drawing (no text of the
    // document) are passed over.
    let target = layout.lineBeside(line, dir, goalX);
    let at: number | null = null;
    for (let hops = 0; target && hops < 40; hops++) {
      at = layout.offsetOnLine(target, goalX) ?? pieceOnLine(target, goalX);
      // A place on that line other than where the caret is (snapped out of an equation, it can be).
      if (at !== null && snap(state, fromLayout(at), schema) !== state.selection.head) break;
      at = null;
      target = layout.lineBeside(target, dir, goalX);
    }
    if (!target || at === null) {
      moveTo(dir < 0 ? 0 : state.text.length, extend);
      return true;
    }
    const keep = goalX;
    moveTo(snap(state, fromLayout(at), schema), extend);
    goalX = keep;
    return true;
  };

  /**
   * On a line of a piece's drawing only (a formula `ce()` draws, no text of the document): the
   * piece's edge nearer to `x`, as a layout offset.
   */
  const pieceOnLine = (line: Line, x: number): number | null => {
    for (const u of unitsAt(state, schema)) {
      if (u.kind !== "atom") continue;
      const rects = rangeRects(u.from, u.to).filter(
        (r) => r.page === line.page && r.y < line.bottom && r.y + r.height > line.top,
      );
      const r = rects[0];
      if (!r) continue;
      return toLayout(x < r.x + r.width / 2 ? u.from : u.to).offset;
    }
    return null;
  };

  const lineEdge = (dir: 1 | -1, extend: boolean): boolean => {
    if (!layout) return false;
    const { offset } = toLayout(state.selection.head);
    const line = layout.lineOf(offset, dir < 0 ? 1 : -1);
    const range = line && layout.lineRange(line);
    if (!range) return false;
    let at = dir < 0 ? range.from : range.to;
    // The space at a line's end belongs to the line break: the caret goes before it.
    if (dir > 0 && /\s/.test((layoutText ?? state.text)[at - 1] ?? "") && line.last > line.first) at--;
    moveTo(snap(state, fromLayout(at), schema), extend);
    return true;
  };

  /** The previous key was Escape: Tab may leave the editor, for keyboard users. */
  let escaped = false;

  /**
   * The keymaps' commands for a key, plugins by priority: the first that applies runs. `matched`
   * says whether any binding had the key (the editor's, even when nothing applied there).
   */
  const runBindings = (matches: (key: string) => boolean): { matched: boolean; ran: boolean } => {
    let matched = false;
    for (const p of ordered)
      for (const [key, commands] of bindingsOf(p)) {
        if (!matches(key)) continue;
        matched = true;
        for (const command of commands) {
          const tr = command(state, schema);
          if (!tr) continue;
          if (!readOnly || tr.edits.length === 0) dispatch(tr);
          scrollToCaret();
          return { matched, ran: true };
        }
      }
    return { matched, ran: false };
  };

  const runKey = (key: string): boolean => runBindings((k) => k === key).ran;

  const onKeyDown = (e: KeyboardEvent) => {
    if (composing || e.isComposing) return;
    // Text a context menu left in the input (see `onMenu`) isn't typed.
    if (input.value && !composing) input.value = "";
    const wasEscaped = escaped;
    escaped = e.key === "Escape";
    if (e.key === "Tab" && wasEscaped) return;
    const mod = apple ? e.metaKey : e.ctrlKey;
    const word = apple ? e.altKey : e.ctrlKey;
    const { selection } = state;
    const handled = (() => {
      for (const p of ordered) if (p.handleKeyDown?.(api, e)) return true;
      const { matched } = runBindings((key) => matchesShortcut(key, e, apple));
      if (matched) return true;
      switch (e.key) {
        case "ArrowLeft":
        case "ArrowRight": {
          const dir = e.key === "ArrowLeft" ? -1 : 1;
          goalX = null;
          if (!e.shiftKey && selection.anchor !== selection.head) {
            moveTo(dir < 0 ? state.from : state.to, false);
            return true;
          }
          const at = word
            ? wordStep(unitsAt(state, schema), state.text, selection.head, dir)
            : moveChar(state, selection.head, dir, schema);
          moveTo(at, e.shiftKey);
          return true;
        }
        case "ArrowUp":
        case "ArrowDown":
          // A component selected: the caret before (up) or after (down) it.
          if (selection.node && !e.shiftKey) {
            moveTo(e.key === "ArrowUp" ? state.from : state.to, false);
            return true;
          }
          if (mod) {
            moveTo(e.key === "ArrowUp" ? 0 : state.text.length, e.shiftKey);
            return true;
          }
          return vertical(e.key === "ArrowUp" ? -1 : 1, e.shiftKey);
        case "PageUp":
        case "PageDown":
          return page(e.key === "PageUp" ? -1 : 1, e.shiftKey);
        case "Home":
        case "End":
          goalX = null;
          if (mod) {
            moveTo(e.key === "Home" ? 0 : state.text.length, e.shiftKey);
            return true;
          }
          return lineEdge(e.key === "Home" ? -1 : 1, e.shiftKey);
        case "Escape":
          if (selection.node || selection.anchor !== selection.head) {
            moveTo(selection.head, false);
            return true;
          }
          return false;
        case "Backspace":
        case "Delete":
        case "Enter":
          // Keys the keymaps left alone (read-only, or no command applied) are still the editor's.
          return true;
      }
      if (mod && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "z") {
          if (e.shiftKey) redo();
          else undo();
          return true;
        }
        if (k === "y" && !apple) {
          redo();
          return true;
        }
        if (k === "a") {
          select({ anchor: 0, head: state.text.length });
          return true;
        }
      }
      return false;
    })();
    if (handled) e.preventDefault();
  };

  /** PageUp and PageDown: the caret a screen up or down, at the same x. */
  const page = (dir: 1 | -1, extend: boolean): boolean => {
    if (!layout) return false;
    const box = caretBox(state.selection.head);
    const client = box && toClient({ page: box.page, x: box.x, y: box.top, width: 1, height: box.bottom - box.top });
    if (!box || !client) return false;
    goalX ??= box.x;
    const viewport = scrollParent();
    const height = viewport ? viewport.clientHeight : win.innerHeight;
    const y = client.top + client.height / 2 + dir * height * 0.9;
    const els = pageEls();
    // The page at that height (or the nearest), and the point on it.
    const target = els.find((el) => {
      const r = el.getBoundingClientRect();
      return y >= r.top && y <= r.bottom;
    });
    const hit = resolve(client.left, y, target ?? null);
    if (!hit || "node" in hit) {
      moveTo(dir < 0 ? 0 : state.text.length, extend);
      return true;
    }
    const keep = goalX;
    moveTo(hit.offset, extend);
    goalX = keep;
    if (viewport) viewport.scrollBy({ top: dir * height * 0.9 });
    else win.scrollBy({ top: dir * height * 0.9 });
    return true;
  };

  /** The nearest ancestor that scrolls (the pages' panel), or `null` for the window. */
  const scrollParent = (): HTMLElement | null => {
    for (let el = element.parentElement; el; el = el.parentElement) {
      const { overflowY } = win.getComputedStyle(el);
      if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) return el;
    }
    return null;
  };

  const typeText = (text: string) => {
    if (readOnly || !text) return;
    // A component or equation selected: what is typed goes after it, never over it.
    if (state.selection.node) state = state.select({ anchor: state.to, head: state.to });
    for (const p of ordered) {
      const own = p.handleTextInput?.(state, text, schema);
      if (own) {
        dispatch(own);
        scrollToCaret();
        return;
      }
    }
    const tr = insertText(text)(state, schema);
    if (!tr) return;
    dispatch(tr);
    if (/^[ ~]$/.test(text)) applyInputRules();
    scrollToCaret();
  };

  /** After a space: a Markdown-like shortcut at the line's start becomes its block. */
  const applyInputRules = () => {
    const head = state.selection.head;
    const lineStart = state.text.lastIndexOf("\n", head - 1) + 1;
    const line = state.text.slice(lineStart, head);
    for (const p of plugins)
      for (const rule of p.inputRules ?? []) {
        const m = rule.match.exec(line);
        if (!m) continue;
        const tr = rule.run(state, { from: lineStart, to: head, match: m }, schema);
        if (tr) {
          dispatch({ ...tr, merge: true });
          return;
        }
      }
  };

  const onBeforeInput = (e: InputEvent) => {
    if (composing) return;
    switch (e.inputType) {
      case "insertText":
      case "insertReplacementText":
        e.preventDefault();
        typeText(e.data ?? e.dataTransfer?.getData("text/plain") ?? "");
        return;
      // What screen keyboards and IMEs send instead of keys: the same bindings as the keys.
      case "insertParagraph":
        e.preventDefault();
        runKey("Enter");
        return;
      case "insertLineBreak":
        e.preventDefault();
        runKey("Shift-Enter");
        return;
      case "deleteContentBackward":
      case "deleteContentForward":
        e.preventDefault();
        runKey(e.inputType === "deleteContentBackward" ? "Backspace" : "Delete");
        return;
      case "deleteWordBackward":
      case "deleteWordForward":
        e.preventDefault();
        runKey(e.inputType === "deleteWordBackward" ? "Word-Backspace" : "Word-Delete");
        return;
      case "historyUndo":
        e.preventDefault();
        undo();
        return;
      case "historyRedo":
        e.preventDefault();
        redo();
        return;
    }
  };

  const onInput = () => {
    // Whatever reached the textarea anyway (a browser that ignored preventDefault): typed text.
    if (composing) return;
    const v = input.value;
    input.value = "";
    if (v) typeText(v);
  };

  const onCompositionStart = () => {
    composing = true;
    compositionText = "";
    scheduleDraw();
  };
  const onCompositionUpdate = (e: CompositionEvent) => {
    compositionText = e.data ?? "";
    scheduleDraw();
  };
  const onCompositionEnd = (e: CompositionEvent) => {
    composing = false;
    compositionText = "";
    input.value = "";
    typeText(e.data ?? "");
  };

  // -------------------------------------------------------------------------
  // Clipboard

  /**
   * What a piece shown whole gives as plain text: an equation its formula, a call the strings it
   * writes (`ce("H2O")`: H2O), never its Typst.
   */
  const atomText = (source: string): string => {
    if (source.startsWith("$")) return source.slice(1, -1).trim();
    const strings = [...source.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => (m[1] as string).replace(/\\(.)/g, "$1"));
    return strings.join(" ");
  };

  /** The text a range shows (escapes resolved, markup's code left out), for copying as plain text. */
  const shownText = (from: number, to: number): string => {
    const units = unitsAt(state, schema);
    let out = "";
    for (let i = Math.max(0, unitBefore(units, from)); i < units.length; i++) {
      const u = units[i];
      if (!u || u.from >= to) break;
      if (u.to <= from) continue;
      const t = state.text.slice(u.from, u.to);
      if (u.kind === "break") out += "\n\n";
      else if (u.kind === "space") out += t.includes("\n") ? " " : t.replace(/~/g, " ");
      else if (u.kind === "char")
        out += t.startsWith("\\") && t.length === 2 ? t.slice(1) : t === "~" ? " " : t.startsWith("\\") ? "\n" : t;
      else if (u.kind === "atom") out += atomText(t);
    }
    return out;
  };

  const onCopy = (e: ClipboardEvent, cut: boolean) => {
    input.value = "";
    if (state.selection.anchor === state.selection.head) return;
    e.preventDefault();
    e.clipboardData?.setData("text/plain", shownText(state.from, state.to));
    // Typst as it is, for a paste here that keeps the formatting, only if it stands on its own: a
    // selection cutting through `*bold*` would paste an unclosed delimiter.
    const slice = state.text.slice(state.from, state.to);
    if (!hasErrors(parse(slice))) e.clipboardData?.setData("text/x-typst", slice);
    if (cut && !readOnly) {
      const tr = deleteSelection(state, schema);
      if (tr) dispatch(tr);
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    e.preventDefault();
    input.value = "";
    if (readOnly) return;
    const data = e.clipboardData;
    if (data) for (const p of ordered) if (p.handlePaste?.(api, data)) return;
    let typst = e.clipboardData?.getData("text/x-typst");
    // One list item copied, pasted into an item: its text, not an item nested in this one.
    const lineStart = state.text.lastIndexOf("\n", state.from - 1) + 1;
    const marker = /^[ \t]*(?:[-+/]|\d+\.)[ \t]+/;
    if (typst && !typst.includes("\n") && marker.test(typst) && marker.test(state.text.slice(lineStart, state.from)))
      typst = typst.replace(marker, "");
    const plain = e.clipboardData?.getData("text/plain") ?? "";
    if (typst && canType(state, state.from) && !hasErrors(parse(typst))) {
      const del = state.empty ? null : deleteSelection(state, schema);
      const base = del ? state.apply(del).state : state;
      const at = base.selection.head;
      const tr = {
        edits: [{ from: at, to: at, insert: typst }],
        selection: { anchor: at + typst.length, head: at + typst.length },
      };
      const end = base.apply(tr).state;
      const edit = diffEdit(state.text, end.text);
      dispatch({ edits: edit ? [edit] : [], selection: end.selection });
      return;
    }
    if (!plain) return;
    // Paragraphs of plain text: blank lines between them.
    const paragraphs = plain.replace(/\r\n?/g, "\n").split(/\n\s*\n/);
    const del = state.empty ? null : deleteSelection(state, schema);
    let s = del ? state.apply(del).state : state;
    paragraphs.forEach((p, i) => {
      if (i > 0) {
        const split = splitBlock(s, schema);
        if (split) s = s.apply(split).state;
      }
      const lines = p.split("\n").map((l) => l.trim());
      const at = s.selection.head;
      const before = s.text.slice(s.text.lastIndexOf("\n", at - 1) + 1, at);
      const insert = lines.map((l, j) => escapeMarkup(l, j === 0 ? before : "", "")).join(" ");
      s = s.apply({
        edits: [{ from: at, to: at, insert }],
        selection: { anchor: at + insert.length, head: at + insert.length },
      }).state;
    });
    const edit = diffEdit(state.text, s.text);
    dispatch({ edits: edit ? [edit] : [], selection: s.selection });
  };

  const onFocus = () => {
    focused = true;
    element.dataset.focused = "";
    syncDoc();
    scheduleDraw();
    notify();
  };
  const onBlur = () => {
    focused = false;
    delete element.dataset.focused;
    syncDoc();
    scheduleDraw();
    notify();
  };

  input.addEventListener("keydown", onKeyDown);
  input.addEventListener("beforeinput", onBeforeInput as EventListener);
  input.addEventListener("input", onInput);
  input.addEventListener("compositionstart", onCompositionStart);
  input.addEventListener("compositionupdate", onCompositionUpdate as EventListener);
  input.addEventListener("compositionend", onCompositionEnd as EventListener);
  input.addEventListener("copy", (e) => onCopy(e, false));
  input.addEventListener("cut", (e) => onCopy(e, true));
  input.addEventListener("paste", onPaste);
  input.addEventListener("focus", onFocus);
  input.addEventListener("blur", onBlur);

  // Redraw when pages change size (the overlays are in percent, but the input is in pixels).
  const ro = new ResizeObserver(() => scheduleDraw());
  ro.observe(element);

  const undo = (): boolean => restore(history.undo(state.text));
  const redo = (): boolean => restore(history.redo(state.text));

  const api: EditorView = {
    element,
    get state() {
      return state;
    },
    get layout() {
      return layout;
    },
    layoutOffset: (offset) => toLayout(offset).offset,
    get laidOut() {
      return layout !== null && layoutText === sent.text;
    },
    plugins,
    schema,
    dispatch,
    run,
    runKey,
    undo,
    redo,
    history: {
      get canUndo() {
        return history.canUndo;
      },
      get canRedo() {
        return history.canRedo;
      },
    },
    setText(text) {
      const edit = diffEdit(state.text, text);
      if (!edit) return;
      const head = mapThrough(state.selection.head, [edit], 1);
      setState(new EditorState(text, { anchor: head, head }), edit, {});
    },
    select,
    focus: focusInput,
    get focused() {
      return focused;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    selectionRects() {
      if (!layout || state.selection.anchor === state.selection.head) return [];
      const range = toLayoutRange(state.from, state.to);
      return layout
        .rects(range.from, range.to)
        .map(toClient)
        .filter((r): r is DOMRect => r !== null);
    },
    components: selectedComponents,
    boxesOf(from, to) {
      return rangeRects(from, to)
        .map(toClient)
        .filter((r): r is DOMRect => r !== null);
    },
    toClient,
    destroy() {
      for (const v of pluginViews) v.destroy?.();
      pluginViews = [];
      if (frame !== null) win.cancelAnimationFrame(frame);
      if (scrolling !== null) win.cancelAnimationFrame(scrolling);
      ro.disconnect();
      unsubscribe();
      paged.destroy();
      doc.setPositions(false);
      listeners.clear();
      element.remove();
    },
  };
  pluginViews = plugins.flatMap((p) => (p.view ? [p.view(api)] : []));
  return api;
};

/** A range of the source. */
interface Range {
  from: number;
  to: number;
}

const within = (p: { x: number; y: number }, box: readonly number[], pad: number): boolean => {
  const [x, y, w, h] = box as [number, number, number, number];
  return p.x >= x - pad && p.x <= x + w + pad && p.y >= y - pad && p.y <= y + h + pad;
};
