// One document in the editor: the Typst source, the engine document compiling it to HTML with source spans (spans.ts),
// and the renderer laying that HTML out on pages where nobody sees it. Each layout becomes Plate's value (value.ts), shown
// over the same sheets; each change in Plate becomes an edit of the source (commands.ts), which compiles again.
//
// Typing shows at once: Slate inserts the text into the text node it went into, whose source range then grows with
// it (`rev`: the edits its range already counts). What can't show until the HTML comes back (Enter, a mark, a
// deletion across blocks) leaves the value stale: keys typed meanwhile wait for the next value.

import { diffEdit, type FileDelta, mapPosition, type TextEdit, type TypstreamPlugin } from "@typstream/core";
import { createHtmlRenderer, type HtmlRenderer, registerTypstFonts, type TypstFont } from "@typstream/dom";
import type { DocumentOptions, DocumentState, Engine, EngineDocument } from "@typstream/engine";
import { NODE_TO_KEY } from "slate-dom";
import { applyEdits, keepCode, sequential } from "./commands";
import { createSpans } from "./spans";
import type { TextPart, TypstBlock, TypstText } from "./types";
import { readValue, share } from "./value";

/** What the session needs of the Plate editor: its value and selection, and a way to say they changed. */
export interface SessionEditor {
  children: unknown[];
  selection: { anchor: Point; focus: Point } | null;
  onChange(): void;
}

/** A point in Slate's value. */
export interface Point {
  path: number[];
  offset: number;
}

/** How a session opens its document. */
export interface SessionOptions {
  engine: Engine;
  /** Where the pages go: the renderer's root is made in it. */
  host: HTMLElement;
  editor: SessionEditor;
  source: string;
  plugins?: readonly TypstreamPlugin[];
  inputs?: Record<string, string>;
  files?: FileDelta;
  resolveImage?: DocumentOptions["resolveImage"];
  preamble?: string;
  fonts?: readonly TypstFont[];
  stylesheets?: readonly string[];
  layout?: "fixed" | "fit-width";
  /** The source changed by an edit in the editor. */
  onSource?: (source: string) => void;
  /** A new value is in the editor, or the document's state changed. */
  onUpdate?: () => void;
}

/** One undoable change: the source before and after, and where the caret was. */
interface Step {
  before: string;
  after: string;
  caretBefore: number | null;
  caretAfter: number | null;
  /** When it was made: typing within a moment is one step. */
  time: number;
}

/** Typing within this long (ms), where the last typing ended, is one undo step. */
const COALESCE_MS = 800;

export class Session {
  readonly doc: EngineDocument;
  readonly renderer: HtmlRenderer;
  /** The renderer's root: the sheets, the flow nobody sees, and the editable flow Plate renders into. */
  readonly root: HTMLElement;
  /** The source spans of the HTML, taken off it as the renderer parses it. */
  private readonly spans = createSpans();
  /** Where Slate's spacers for atoms go, out of sight (plugin.tsx, `AtomView`). */
  readonly spacers: HTMLElement;
  /** The input: the Typst being edited. */
  source: string;
  /** Edits of `source` since the value was read, one after another: what the value's ranges are mapped through. */
  pending: TextEdit[] = [];
  /** The value doesn't show the source: something changed it that only a compile can show. */
  stale = false;
  /** Where the caret goes in the next value, as a source offset. */
  caret: number | null = null;
  /** Where the caret was put when the value was read, and the source offset it stands for. */
  private placed: (Point & { pos: number }) | null = null;
  /** Keys pressed while the value was stale, done again on the next. */
  readonly queue: (() => void)[] = [];
  private undos: Step[] = [];
  private redos: Step[] = [];
  private readonly editor: SessionEditor;
  private readonly options: SessionOptions;
  private readonly flow: HTMLElement;
  private readonly observer: MutationObserver;
  private frame = 0;
  private shown: unknown = null;
  private pageCount = 1;
  /** The files the document was given last. */
  private files: FileDelta;
  private composing = false;
  private disposed = false;
  private readonly stop: () => void;

  constructor(options: SessionOptions) {
    this.options = options;
    this.editor = options.editor;
    this.source = options.source;
    this.files = options.files ?? {};
    const doc = options.host.ownerDocument;
    this.root = doc.createElement("div");
    options.host.append(this.root);
    if (options.fonts) registerTypstFonts(options.fonts, doc);
    this.doc = options.engine.open({
      target: "html",
      text: options.source,
      spans: true,
      ...(options.inputs ? { inputs: options.inputs } : {}),
      ...(options.files ? { files: options.files } : {}),
      ...(options.resolveImage ? { resolveImage: options.resolveImage } : {}),
      ...(options.preamble ? { preamble: options.preamble } : {}),
      ...(options.plugins?.length ? { plugins: options.plugins } : {}),
    });
    this.renderer = createHtmlRenderer(this.root, {
      plugins: this.doc.plugins,
      onParse: this.spans.take,
      linkTarget: null,
      layout: options.layout ?? "fit-width",
      ...(options.stylesheets ? { stylesheets: options.stylesheets } : {}),
      onPages: (count) => {
        if (count === this.pageCount) return;
        this.pageCount = count;
        this.doc.setInputs({
          ...options.inputs,
          ...(count > 1 ? { "typstream-page-count": String(count) } : {}),
        });
      },
    });
    this.flow = this.root.querySelector(":scope > .typstream-flow:not(.typstream-marginals)") as HTMLElement;
    this.spacers = doc.createElement("div");
    this.spacers.hidden = true;
    this.root.append(this.spacers);
    // The laid-out document stays where it is, unseen: the editable flow over it shows what it reads from it.
    this.flow.style.visibility = "hidden";
    this.flow.setAttribute("aria-hidden", "true");
    this.flow.inert = true;
    this.observer = new MutationObserver(() => this.schedule());
    this.observer.observe(this.flow, { subtree: true, childList: true, characterData: true, attributes: true });
    this.stop = this.doc.subscribe((state) => this.onState(state));
    this.doc.finish();
    this.onState(this.doc.getState());
  }

  /** The editable flow (Plate's content) is styled and placed as the renderer's flow. */
  get flowStyle(): CSSStyleDeclaration {
    return this.flow.style;
  }

  get state(): DocumentState {
    return this.doc.getState();
  }

  private onState(state: DocumentState): void {
    if (this.disposed) return;
    const { artifact } = state;
    if (artifact?.target === "html" && artifact !== this.shown) {
      this.shown = artifact;
      this.renderer.update(artifact.html);
    }
    this.schedule();
    this.options.onUpdate?.();
  }

  /** Reads the value again at the next frame: after a compile, and after the pages move anything. */
  private schedule(): void {
    if (this.frame || this.disposed) return;
    const view = this.root.ownerDocument.defaultView ?? globalThis;
    this.frame = view.requestAnimationFrame(() => {
      this.frame = 0;
      this.read();
    });
  }

  setComposing(composing: boolean): void {
    this.composing = composing;
    if (!composing) this.schedule();
  }

  /** The value from the laid-out flow, if it shows the source as it is. */
  private read(): void {
    const state = this.doc.getState();
    if (this.composing || state.artifact?.target !== "html" || this.shown !== state.artifact) return;
    // Only an artifact of the input as it is (edits change the status at once): its spans index its healed source.
    if (state.status !== "done" && state.status !== "idle") return;
    const { map } = state.heal;
    const spanOf = this.spans.of;
    const editor = this.editor;
    const selection = editor.selection
      ? { anchor: this.toSource(editor.selection.anchor), focus: this.toSource(editor.selection.focus) }
      : null;
    // Elements that changed inside keep their keys: React keeps their DOM and renders their children again.
    const value = share(
      editor.children as TypstBlock[],
      readValue(this.flow, spanOf, this.source, (p, a) => map.toInput(p, a)),
      (old, fresh) => {
        const key = NODE_TO_KEY.get(old as never);
        if (key) NODE_TO_KEY.set(fresh as never, key);
      },
    );
    editor.children = value;
    this.pending = [];
    this.stale = false;
    const caret = this.caret;
    this.caret = null;
    this.placed = null;
    const collapsed = selection && selection.anchor === selection.focus ? selection.anchor : null;
    const at = caret ?? collapsed;
    if (at !== null) {
      const point = this.pointAt(at);
      editor.selection = point ? { anchor: point, focus: point } : null;
      if (point) this.placed = { ...point, pos: at };
    } else if (selection) {
      const anchor = selection.anchor === null ? null : this.pointAt(selection.anchor);
      const focus = selection.focus === null ? null : this.pointAt(selection.focus);
      editor.selection = anchor && focus ? { anchor, focus } : null;
    }
    editor.onChange();
    this.options.onUpdate?.();
    // What was typed meanwhile.
    while (this.queue.length && !this.stale) (this.queue.shift() as () => void)();
  }

  // --- positions ----------------------------------------------------------------------

  /** The node at `path` in the value. */
  nodeAt(path: readonly number[]): unknown {
    let node: unknown = { children: this.editor.children };
    for (const i of path) node = (node as { children?: unknown[] }).children?.[i];
    return node;
  }

  /** `pos`, of the source as the value was read, in the source as it is now (`rev`: edits it already counts). */
  current(pos: number, assoc: 1 | -1, rev = 0): number {
    for (let i = rev; i < this.pending.length; i++) pos = mapPosition(pos, this.pending[i] as TextEdit, assoc);
    return pos;
  }

  /** A text's pieces, in the source as it is now. */
  partsOf(text: TypstText): TextPart[] {
    return (text.parts ?? []).map((p) => {
      const from = this.current(p.src[0], 1, text.rev);
      return { ...p, src: [from, Math.max(from, this.current(p.src[1], -1, text.rev))] };
    });
  }

  /** A text's range in the source as it is now: from its first piece's start to its last's end. */
  rangeOf(text: TypstText): [number, number] | null {
    const parts = this.partsOf(text);
    if (!parts.length) return null;
    return [(parts[0] as TextPart).src[0], (parts[parts.length - 1] as TextPart).src[1]];
  }

  /**
   * The piece of a text a caret at `offset` is in, and where that is in the source: inside an exact piece, at the end
   * of one (typing goes on with it) or the start of one; else at the nearer edge of a node, or of the piece beside a
   * gap (text a template wrote).
   */
  locate(text: TypstText, offset: number): { index: number; pos: number; exact: boolean } | null {
    const parts = this.partsOf(text);
    if (!parts.length) return null;
    const end = (p: TextPart) => p.at + p.length;
    let i = parts.findIndex((p) => p.exact && p.at < offset && offset <= end(p));
    if (i < 0) i = parts.findIndex((p) => p.exact && p.at === offset);
    if (i >= 0) {
      const p = parts[i] as TextPart;
      return { index: i, pos: p.src[0] + (offset - p.at), exact: true };
    }
    i = parts.findIndex((p) => p.at <= offset && offset <= end(p));
    if (i >= 0) {
      const p = parts[i] as TextPart;
      return { index: i, pos: offset - p.at <= end(p) - offset ? p.src[0] : p.src[1], exact: false };
    }
    // In a gap: the end of the piece before it, else the start of the one after.
    const before = parts.filter((p) => end(p) <= offset).pop();
    if (before) return { index: parts.indexOf(before), pos: before.src[1], exact: false };
    return { index: 0, pos: (parts[0] as TextPart).src[0], exact: false };
  }

  /** Where a point in the value is in the source. */
  toSource(point: Point): number | null {
    // The caret placed after a compile: where it was in the source, which the point may only show (after a space
    // Typst doesn't show).
    const placed = this.placed;
    if (placed && placed.offset === point.offset && placed.path.join() === point.path.join()) return placed.pos;
    const text = this.nodeAt(point.path) as TypstText | undefined;
    if (!text || typeof text.text !== "string") return null;
    const found = this.locate(text, point.offset);
    if (found) return found.pos;
    // A text the document didn't write (a space a template put): the edge of the text beside it in its parent.
    const parent = this.nodeAt(point.path.slice(0, -1)) as { children: unknown[] };
    const i = point.path[point.path.length - 1] as number;
    for (let j = i - 1; j >= 0; j--) {
      const r = this.rangeOf(parent.children[j] as TypstText);
      if (r) return r[1];
    }
    for (let j = i + 1; j < parent.children.length; j++) {
      const r = this.rangeOf(parent.children[j] as TypstText);
      if (r) return r[0];
    }
    return null;
  }

  /**
   * The point showing source offset `pos`: in an exact piece holding it (the end of one before the start of the
   * next), else at the edge of a node around it, else at the start of the first piece after it.
   */
  pointAt(pos: number): Point | null {
    let inside: Point | null = null;
    let start: Point | null = null;
    let around: Point | null = null;
    let after: { point: Point; from: number } | null = null;
    let before: { point: Point; to: number } | null = null;
    const walk = (node: unknown, path: number[]) => {
      if (typeof (node as TypstText).text === "string") {
        for (const p of this.partsOf(node as TypstText)) {
          const [from, to] = p.src;
          if (p.exact && from < pos && pos <= to) inside ??= { path, offset: p.at + pos - from };
          else if (p.exact && from === pos) start ??= { path, offset: p.at };
          else if (!p.exact && from <= pos && pos <= to)
            around ??= { path, offset: pos - from < to - pos ? p.at : p.at + p.length };
          else if (from > pos && (!after || from < after.from)) after = { point: { path, offset: p.at }, from };
          if (to <= pos && (!before || to > before.to)) before = { point: { path, offset: p.at + p.length }, to };
        }
        return;
      }
      const children = (node as { children?: unknown[] }).children;
      if ((node as { type?: string }).type === "atom" || !children) return;
      children.forEach((child, i) => {
        walk(child, [...path, i]);
      });
    };
    (this.editor.children as unknown[]).forEach((child, i) => {
      walk(child, [i]);
    });
    // Text Typst doesn't show (a space at a paragraph's end): the end of the text before it on its line.
    const b = before as { point: Point; to: number } | null;
    const onLine = b && /^[ \t]*$/.test(this.source.slice(b.to, pos)) ? b.point : null;
    return inside ?? start ?? around ?? onLine ?? (after as { point: Point } | null)?.point ?? null;
  }

  /**
   * A text's pieces after `delta` characters were typed (or, below 0, deleted) at `offset` of it, in piece `index`:
   * read before the change, they are its pieces after it, in the source as it is then.
   */
  shifted(parts: readonly TextPart[], index: number, offset: number, delta: number): TextPart[] {
    return parts.map((p, i) => {
      if (i < index) return p;
      if (i === index) return { ...p, length: p.length + delta, src: [p.src[0], p.src[1] + delta] };
      return {
        ...p,
        at: p.at + (p.at >= offset ? delta : 0),
        src: [p.src[0] + delta, p.src[1] + delta],
      };
    });
  }

  // --- edits --------------------------------------------------------------------------

  /**
   * Applies `edits` (in the source's coordinates as it is) to the source and the engine document. `local` shows them
   * in the value itself (Slate's own change to a text, made by the caller); without it the value is stale until the
   * next one, whose caret goes to `caret`.
   */
  apply(given: readonly TextEdit[], how: { local?: () => void; caret?: number | null; undo?: false } = {}): void {
    if (given.length === 0) return;
    let edits = given;
    let options = how;
    const before = this.source;
    // Never into the code beside text it shows: an edit that would go on with an expression ends it first.
    const kept = keepCode(before, edits);
    if (kept.some((e, i) => e !== edits[i])) {
      const last = kept[kept.length - 1] as TextEdit;
      const shift = kept.reduce((n, e) => n + e.insert.length - (e.to - e.from), 0);
      options = { ...options, local: undefined, caret: options.caret != null ? options.caret + 1 : last.to + shift };
      edits = kept;
    }
    const seq = sequential(edits);
    const after = applyEdits(before, edits);
    if (after === before) return;
    const caretBefore = this.editor.selection ? this.toSource(this.editor.selection.anchor) : null;
    this.placed = null;
    this.source = after;
    for (const e of seq) this.doc.applyEdit(e);
    this.pending.push(...seq);
    if (options.local) options.local();
    else {
      this.stale = true;
      this.caret = options.caret ?? null;
    }
    if (options.undo !== false) this.record(before, after, caretBefore, options.caret ?? null, !!options.local);
    this.options.onSource?.(after);
    this.options.onUpdate?.();
  }

  private record(
    before: string,
    after: string,
    caretBefore: number | null,
    caretAfter: number | null,
    typing: boolean,
  ) {
    const now = Date.now();
    const last = this.undos[this.undos.length - 1];
    this.redos = [];
    if (typing && last && last.after === before && now - last.time < COALESCE_MS) {
      last.after = after;
      last.caretAfter = caretAfter;
      last.time = now;
      return;
    }
    this.undos.push({ before, after, caretBefore, caretAfter, time: typing ? now : 0 });
    if (this.undos.length > 200) this.undos.shift();
  }

  get canUndo(): boolean {
    return this.undos.length > 0;
  }

  get canRedo(): boolean {
    return this.redos.length > 0;
  }

  undo(): void {
    const step = this.undos.pop();
    if (!step) return;
    this.redos.push(step);
    this.replace(step.before, step.caretBefore);
  }

  redo(): void {
    const step = this.redos.pop();
    if (!step) return;
    this.undos.push({ ...step, time: 0 });
    this.replace(step.after, step.caretAfter);
  }

  /** The source becomes `text` (undo, redo, a new document given): the change between them as one edit. */
  replace(text: string, caret: number | null = null): void {
    const edit = diffEdit(this.source, text);
    if (!edit) return;
    this.apply([edit], { caret: caret ?? edit.from + edit.insert.length, undo: false });
  }

  /** The document's files are `files` now: what changed goes to the engine document. */
  setFiles(files: FileDelta): void {
    const delta: FileDelta = {};
    for (const [path, content] of Object.entries(files)) if (this.files[path] !== content) delta[path] = content;
    for (const path of Object.keys(this.files)) if (!(path in files)) delta[path] = null;
    this.files = files;
    if (Object.keys(delta).length) this.doc.setFiles(delta);
  }

  /** Starts over with `text`: what an app gives as the document. */
  reset(text: string): void {
    if (text === this.source) return;
    this.undos = [];
    this.redos = [];
    this.queue.length = 0;
    this.source = text;
    this.pending = [];
    this.stale = true;
    this.caret = null;
    this.doc.set(text);
    this.doc.finish();
  }

  dispose(): void {
    this.disposed = true;
    if (this.frame) (this.root.ownerDocument.defaultView ?? globalThis).cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.stop();
    this.doc.dispose();
    this.renderer.dispose();
    this.root.remove();
  }
}
