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

import { diffEdit, type PagedArtifact, type TextEdit } from "@typstream/core";
import { type MountedPaged, mountPaged } from "@typstream/dom";
import type { EngineDocument } from "@typstream/engine";
import { hasErrors, parse } from "@typstream/syntax";
import { indentItems } from "./blocks";
import {
  blockAtOffset,
  canType,
  deleteChar,
  deleteSelection,
  type EditorSchema,
  insertLineBreak,
  insertText,
  moveChar,
  snap,
  splitBlock,
  unitsAt,
} from "./commands";
import { type Component, componentIn, componentsAt, componentsIn } from "./components";
import { History } from "./history";
import { type CaretBox, type Layout, Layout as LayoutClass, type Line, type PageRect } from "./layout";
import { basicPlugins, type EditorCommand, type EditorPlugin, matchesShortcut, schemaOf } from "./plugin";
import { EditorState, mapThrough, type Selection, type Transaction } from "./state";
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
}

/** A mounted editor. @beta */
export interface EditorView {
  /** The editor's root element (`.typstream-editor`), holding the pages. */
  readonly element: HTMLElement;
  /** The document's source and the selection. */
  readonly state: EditorState;
  /** Where the source was laid out, as of the last compile; `null` before the first. */
  readonly layout: Layout | null;
  /** The plugins, the editor's own included. */
  readonly plugins: readonly EditorPlugin[];
  /** What the plugins make of Typst's functions. */
  readonly schema: EditorSchema;
  /** Applies a transaction: the source changes, the engine compiles. */
  dispatch(tr: Transaction): void;
  /** Runs a command; whether it applied. */
  run(command: EditorCommand): boolean;
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
  const plugins = options.plugins ?? basicPlugins;
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
  let layout: Layout | null = null;
  /** The text `layout` was compiled from. */
  let layoutText: string | null = null;
  let shownArtifact: PagedArtifact | null = null;
  const history = new History();
  const listeners = new Set<() => void>();
  let focused = false;
  /** Where the caret goes on up/down: the x it started at. */
  let goalX: number | null = null;
  let composing = false;
  let compositionText = "";

  const notify = () => {
    for (const l of [...listeners]) l();
  };

  // -------------------------------------------------------------------------
  // Offsets between the current text and the layout's

  /** The current text's change from the layout's, as one edit (null when they are the same). */
  let pending: TextEdit | null = null;
  const updatePending = () => {
    pending = layoutText === null || layoutText === state.text ? null : diffEdit(layoutText, state.text);
  };
  /** A current offset in the layout's text, and how many typed characters it is past that. */
  const toLayout = (offset: number): { offset: number; ahead: number } => {
    if (!pending) return { offset, ahead: 0 };
    const { from, to, insert } = pending;
    if (offset <= from) return { offset, ahead: 0 };
    if (offset >= from + insert.length) return { offset: offset - insert.length + (to - from), ahead: 0 };
    // In text typed since: at the end of what it replaced, so many characters on.
    return { offset: to, ahead: offset - from };
  };
  /** A layout offset in the current text. */
  const fromLayout = (offset: number): number => (pending ? mapThrough(offset, [pending], -1) : offset);

  // -------------------------------------------------------------------------
  // Where things are

  const pageEls = (): HTMLElement[] => [...pagesEl.querySelectorAll<HTMLElement>(":scope > .typstream-page")];

  /** Where a caret at a current offset is drawn. */
  const caretBox = (offset: number): CaretBox | null => {
    if (!layout) return null;
    const { offset: at, ahead } = toLayout(offset);
    let box = layout.caret(at, -1);
    let line: Line | null = box ? layout.lineOf(at, -1) : null;
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
    for (const c of selectedComponents()) {
      const range = toLayoutRange(c.from, c.to);
      for (const box of layout.boxes(range.from, range.to)) {
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
    caretEl = null;
    if (anchor === head || composing) {
      const box = caretBox(head);
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
        if (client) {
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
    if (edit) {
      doc.applyEdit(edit);
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
    state = state.select(selection);
    scheduleDraw();
    notify();
  };

  // -------------------------------------------------------------------------
  // Layout from the engine

  const onDoc = () => {
    const s = doc.getState();
    const artifact = s.artifact;
    if (artifact?.target !== "paged" || !artifact.positions || artifact === shownArtifact) return;
    shownArtifact = artifact;
    layout = new LayoutClass(artifact);
    layoutText = s.artifactInput;
    updatePending();
    scheduleDraw();
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
  const resolve = (
    clientX: number,
    clientY: number,
    target: EventTarget | null,
  ): { offset: number } | { component: Component } | null => {
    const point = pointAt(clientX, clientY, target);
    if (!point || !layout) return null;
    const hit = layout.hit(point.page, point.x, point.y);
    const line = hit.line;
    // In a table cell whose text isn't what was hit (an empty cell next to a full one): its start.
    const cellOf = (x: number, y: number) =>
      layout?.elements.find(
        (e) => e.kind === "cell" && e.page === point.page && e.node && within({ x, y }, layout?.cellBox(e) ?? [], 0),
      );
    const cell = cellOf(point.x, point.y);
    if (cell?.node && (!hit.glyph || cellOf(hit.glyph.x + hit.glyph.width / 2, hit.glyph.y) !== cell)) {
      const lt = layoutText ?? state.text;
      const start = lt[cell.node[0]] === "[" ? cell.node[0] + 1 : cell.node[0];
      return { offset: snap(state, fromLayout(start), schema) };
    }
    const onText =
      !!hit.glyph && hit.glyph.from >= 0 && !!line && point.y >= line.top - 4 && point.y <= line.bottom + 4;
    if (onText && hit.offset !== null) return { offset: snap(state, fromLayout(hit.offset), schema) };
    // Off the text, on a component's own drawing (a question's number, a table's rules, a
    // drawing): the innermost component there.
    const inside = (from: number, to: number) => {
      const range = toLayoutRange(from, to);
      return (
        layout
          ?.boxes(range.from, range.to)
          .some((b) => b.page === point.page && within(point, [b.x, b.y, b.width, b.height], 1)) ?? false
      );
    };
    const hits = componentsIn(state, schema).filter((c) => inside(c.from, c.to));
    const innermost = hits.sort((a, b) => a.to - a.from - (b.to - b.from))[0];
    if (innermost) {
      // A table's cell: a caret in it.
      const cell = layout.elements.find(
        (e) => e.kind === "cell" && e.page === point.page && e.node && within(point, layout?.cellBox(e) ?? [], 0),
      );
      if (cell?.node && (innermost.name === "table" || innermost.name === "grid")) {
        const lt = layoutText ?? state.text;
        const start = lt[cell.node[0]] === "[" ? cell.node[0] + 1 : cell.node[0];
        return { offset: snap(state, fromLayout(start), schema) };
      }
      return { component: innermost };
    }
    if (hit.offset === null) return null;
    return { offset: snap(state, fromLayout(hit.offset), schema) };
  };

  const onPointerDown = (e: PointerEvent) => {
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
    if ("component" in hit) {
      select({ anchor: hit.component.from, head: hit.component.to, node: true });
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

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    const hit = resolve(e.clientX, e.clientY, docEl.elementFromPoint(e.clientX, e.clientY));
    if (!hit || "component" in hit) return;
    if (hit.offset !== state.selection.head) select({ anchor: dragAnchor, head: hit.offset });
  };
  const onPointerUp = () => {
    dragging = false;
  };

  pagesHost.addEventListener("pointerdown", onPointerDown);
  pagesHost.addEventListener("pointermove", onPointerMove);
  pagesHost.addEventListener("pointerup", onPointerUp);
  pagesHost.addEventListener("pointercancel", onPointerUp);

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
    const line = layout.lineOf(offset, -1);
    const box = caretBox(state.selection.head);
    if (!line || !box) return false;
    goalX ??= box.x;
    const target = layout.lineBeside(line, dir, goalX);
    if (!target) {
      moveTo(dir < 0 ? 0 : state.text.length, extend);
      return true;
    }
    const at = layout.offsetOnLine(target, goalX);
    if (at === null) return false;
    const keep = goalX;
    moveTo(snap(state, fromLayout(at), schema), extend);
    goalX = keep;
    return true;
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

  const onKeyDown = (e: KeyboardEvent) => {
    if (composing || e.isComposing) return;
    const mod = apple ? e.metaKey : e.ctrlKey;
    const word = apple ? e.altKey : e.ctrlKey;
    const { selection } = state;
    const handled = (() => {
      // Plugins' shortcuts first.
      for (const p of plugins)
        for (const [key, command] of Object.entries(p.shortcuts ?? {}))
          if (matchesShortcut(key, e, apple)) {
            if (!readOnly) run(command);
            return true;
          }
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
          return vertical(e.key === "ArrowUp" ? -1 : 1, e.shiftKey);
        case "Home":
        case "End":
          goalX = null;
          if (mod) {
            moveTo(e.key === "Home" ? 0 : state.text.length, e.shiftKey);
            return true;
          }
          return lineEdge(e.key === "Home" ? -1 : 1, e.shiftKey);
        case "Tab": {
          if (readOnly) return false;
          if (run(indentItems(e.shiftKey ? -1 : 1))) return true;
          // In a table: the next (or previous) cell.
          return moveCell(e.shiftKey ? -1 : 1);
        }
        case "Escape":
          if (selection.node || selection.anchor !== selection.head) {
            moveTo(selection.head, false);
            return true;
          }
          return false;
        case "Backspace":
        case "Delete": {
          if (readOnly) return true;
          const dir = e.key === "Backspace" ? -1 : 1;
          if (word && selection.anchor === selection.head) {
            const to = wordStep(unitsAt(state, schema), state.text, selection.head, dir);
            const s2 = state.select({ anchor: selection.head, head: to });
            const tr = deleteSelection(s2, schema);
            if (tr) dispatch(tr);
            return true;
          }
          run(deleteChar(dir));
          return true;
        }
        case "Enter":
          if (readOnly) return true;
          run(e.shiftKey ? insertLineBreak : splitBlock);
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

  /** Moves the caret to the next or previous table cell. */
  const moveCell = (dir: 1 | -1): boolean => {
    if (!layout) return false;
    const at = toLayout(state.selection.head).offset;
    const cells = layout.elements
      .filter((e): e is typeof e & { node: [number, number] } => e.kind === "cell" && !!e.node)
      .sort((a, b) => a.node[0] - b.node[0]);
    const i = cells.findIndex((c) => c.node[0] <= at && at <= c.node[1]);
    if (i < 0) return false;
    const next = cells[i + dir];
    if (!next?.node) return true;
    const [from, to] = next.node;
    const inner = (layoutText ?? state.text).slice(from, to).startsWith("[") ? from + 1 : from;
    moveTo(snap(state, fromLayout(inner), schema), false);
    void to;
    return true;
  };

  const typeText = (text: string) => {
    if (readOnly || !text) return;
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
      case "insertParagraph":
        e.preventDefault();
        if (!readOnly) run(splitBlock);
        return;
      case "insertLineBreak":
        e.preventDefault();
        if (!readOnly) run(insertLineBreak);
        return;
      case "deleteContentBackward":
      case "deleteContentForward":
        e.preventDefault();
        if (!readOnly) run(deleteChar(e.inputType === "deleteContentBackward" ? -1 : 1));
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
      else if (u.kind === "atom") out += t;
    }
    return out;
  };

  const onCopy = (e: ClipboardEvent, cut: boolean) => {
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
    if (readOnly) return;
    const typst = e.clipboardData?.getData("text/x-typst");
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
    scheduleDraw();
    notify();
  };
  const onBlur = () => {
    focused = false;
    delete element.dataset.focused;
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

  return {
    element,
    get state() {
      return state;
    },
    get layout() {
      return layout;
    },
    plugins,
    schema,
    dispatch,
    run,
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
      if (!layout) return [];
      const range = toLayoutRange(from, to);
      return layout
        .boxes(range.from, range.to)
        .map(toClient)
        .filter((r): r is DOMRect => r !== null);
    },
    toClient,
    destroy() {
      if (frame !== null) win.cancelAnimationFrame(frame);
      ro.disconnect();
      unsubscribe();
      paged.destroy();
      doc.setPositions(false);
      listeners.clear();
      element.remove();
    },
  };
};

const within = (p: { x: number; y: number }, box: readonly number[], pad: number): boolean => {
  const [x, y, w, h] = box as [number, number, number, number];
  return p.x >= x - pad && p.x <= x + w + pad && p.y >= y - pad && p.y <= y + h + pad;
};
