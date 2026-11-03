// The Plate side: how the value renders (the HTML's own elements, under the renderer's CSS) and what Slate's
// transforms do. Every change becomes an edit of the Typst source (commands.ts) through the editor's session; Slate
// changes its value itself only for what shows at once (typing into a text the source has as it is), and the value is
// otherwise read again from the next compile.

import type { TextEdit } from "@typstream/core";
import { RangeApi, type SlateEditor } from "platejs";
import { createPlatePlugin, type PlateElementProps, useEditorRef } from "platejs/react";
import { createElement, type ReactNode, type Ref, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  type BlockKind,
  blockOf,
  insertBreak,
  insertText,
  join,
  type Mark,
  markOf,
  setBlock,
  unwrapMark,
  wrapMark,
} from "./commands";
import type { Point, Session } from "./session";
import type { TypstAtom, TypstChild, TypstElement, TypstText } from "./types";
import { atomContent } from "./value";

/** Each editor's session: the plugin's transforms need it. */
export const sessions = new WeakMap<object, Session>();

type Path = number[];

// --- rendering -----------------------------------------------------------------------

/** Attributes the node's element had, set as the renderer set them (`style` through the CSSOM: strict CSPs). */
const setAttributes = (el: HTMLElement, attrs: Readonly<Record<string, string>>, had: Set<string>) => {
  for (const name of had) if (!(name in attrs)) el.removeAttribute(name);
  had.clear();
  for (const [name, value] of Object.entries(attrs)) {
    had.add(name);
    if (name === "style") el.style.cssText = value;
    else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }
};

/** Slate's attributes for a node's element, without Plate's classes: the element is the HTML's own. */
const slateAttributes = (attributes: Record<string, unknown>) => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attributes)) {
    if (k === "ref" || k.startsWith("data-slate") || k === "contentEditable" || k === "dir") out[k] = v;
  }
  return out;
};

const useMergedRef =
  <T,>(outer: unknown, inner: { current: T | null }) =>
  (el: T | null) => {
    inner.current = el;
    if (typeof outer === "function") outer(el);
    else if (outer && typeof outer === "object") (outer as { current: T | null }).current = el;
  };

const useAttributes = (attrs: Readonly<Record<string, string>>) => {
  const ref = useRef<HTMLElement | null>(null);
  const had = useRef(new Set<string>());
  useLayoutEffect(() => {
    if (ref.current) setAttributes(ref.current, attrs, had.current);
  }, [attrs]);
  return ref;
};

/** An element of the HTML: its tag, its attributes, its children Slate's. */
export const ElementView = ({ attributes, children, element }: PlateElementProps) => {
  const node = element as unknown as TypstElement;
  const ref = useAttributes(node.attrs);
  return createElement(
    node.tag,
    { ...slateAttributes(attributes as unknown as Record<string, unknown>), ref: useMergedRef(attributes.ref, ref) },
    children,
  );
};

/**
 * An atom: its element with a copy of what it held, not editable. Slate's spacer, which a void element holds, is kept
 * out of it (in the session's hidden holder): inside, it would be a child the renderer's DOM doesn't have, and CSS
 * reads children (`:empty`, `> :last-child`). Atoms aren't selectable, so Slate never puts the caret in one.
 */
export const AtomView = ({ attributes, children, element }: PlateElementProps) => {
  const node = element as unknown as TypstAtom;
  const editor = useEditorRef();
  const holder = sessions.get(editor)?.spacers;
  const ref = useAttributes(node.attrs);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const content = atomContent.get(node);
    const nodes = content
      ? Array.from(content.cloneNode(true).childNodes)
      : // A text Typst wrote that the document didn't: its markup is the text, escaped.
        [el.ownerDocument.createTextNode(unescapeHtml(node.html))];
    el.replaceChildren(...nodes);
  }, [node, ref]);
  return (
    <>
      {createElement(node.tag, {
        ...slateAttributes(attributes as unknown as Record<string, unknown>),
        contentEditable: false,
        ref: useMergedRef(attributes.ref, ref),
      } as Record<string, unknown>)}
      {holder ? createPortal(children, holder) : null}
    </>
  );
};

const unescapeHtml = (html: string) => html.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Text: in the renderer's run (`span.typstream-t`) when it was in one, so it has the run's line box. */
export const TextView = ({
  attributes,
  children,
  text,
}: {
  attributes: Record<string, unknown>;
  children: ReactNode;
  text: unknown;
}) => {
  const node = text as TypstText;
  // Typed into: its spaces stay as typed until the compile (a space typed at its end, where the caret goes on).
  const ref = useAttributes(node.rev === undefined ? (node.run ?? EMPTY) : { ...node.run, "data-typed": "" });
  return createElement("span", { ...attributes, ref: useMergedRef(attributes.ref as Ref<HTMLElement>, ref) }, children);
};

const EMPTY: Readonly<Record<string, string>> = {};

// --- the value's structure -----------------------------------------------------------

const nodeAt = (editor: SlateEditor, path: Path): unknown => {
  let node: unknown = editor;
  for (const i of path) node = (node as { children?: unknown[] }).children?.[i];
  return node;
};

/** The block a point is in: its nearest ancestor that isn't inline. */
const blockPath = (editor: SlateEditor, path: Path): Path => {
  for (let i = path.length - 1; i >= 1; i--) {
    const node = nodeAt(editor, path.slice(0, i)) as TypstElement | undefined;
    if (node && "type" in node && !node.inline) return path.slice(0, i);
  }
  return path.slice(0, 1);
};

const samePath = (a: Path, b: Path) => a.length === b.length && a.every((v, i) => v === b[i]);
const isText = (node: unknown): node is TypstText => typeof (node as TypstText)?.text === "string";

/** The texts (and inline atoms) in document order between two points, with what of them is between. */
const touched = (editor: SlateEditor, start: Point, end: Point) => {
  const out: { node: TypstChild; path: Path; from: number; to: number }[] = [];
  const before = (a: Path, b: Path) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++)
      if (a[i] !== b[i]) return (a[i] as number) < (b[i] as number);
    return a.length < b.length;
  };
  const walk = (node: unknown, path: Path) => {
    if (isText(node)) {
      if (before(path, start.path) || before(end.path, path)) return;
      const from = samePath(path, start.path) ? start.offset : 0;
      const to = samePath(path, end.path) ? end.offset : node.text.length;
      out.push({ node, path, from, to });
      return;
    }
    const n = node as TypstAtom | TypstElement;
    if (n.type === "atom") {
      // Wholly inside: after the start and before the end.
      if (before(start.path, path) && before(path, end.path) && !samePath([...path, 0], end.path))
        out.push({ node: n, path, from: 0, to: 1 });
      return;
    }
    n.children.forEach((c, i) => {
      walk(c, [...path, i]);
    });
  };
  (editor.children as unknown[]).forEach((c, i) => {
    walk(c, [i]);
  });
  return out;
};

/**
 * Deleting what is between two points: the text the document wrote there (its markup, delimiters and calls, stays),
 * equations and other atoms the document wrote that are wholly inside, and the breaks between blocks it crosses
 * where they are only that (paragraphs, items and headings join).
 */
const deletion = (editor: SlateEditor, s: Session, start: Point, end: Point): TextEdit[] => {
  const edits: TextEdit[] = [];
  let last: { block: Path; end: number } | null = null;
  for (const t of touched(editor, start, end)) {
    const node = t.node;
    const block = blockPath(editor, t.path);
    if (isText(node)) {
      const parts = s.partsOf(node);
      if (!parts.length) continue;
      const first = s.toSource({ path: t.path, offset: t.from }) as number;
      if (last && !samePath(last.block, block)) {
        const joined = join(s.source, last.end, first);
        if (joined) edits.push(...joined);
      }
      for (const p of parts) {
        const a = Math.max(t.from, p.at);
        const b = Math.min(t.to, p.at + p.length);
        if (b <= a) continue;
        if (p.exact) edits.push({ from: p.src[0] + (a - p.at), to: p.src[0] + (b - p.at), insert: "" });
        else edits.push({ from: p.src[0], to: p.src[1], insert: "" });
      }
      last = { block, end: s.toSource({ path: t.path, offset: t.to }) as number };
      continue;
    }
    const atom = node as TypstAtom;
    if (!atom.span || !atom.inline) continue;
    const range: [number, number] = [s.current(atom.span[0], 1), s.current(atom.span[1], -1)];
    edits.push({ from: range[0], to: range[1], insert: "" });
    last = { block, end: range[1] };
  }
  return merge(edits);
};

/** Edits in the text's order, overlapping ones merged. */
const merge = (edits: TextEdit[]): TextEdit[] => {
  const sorted = [...edits].sort((a, b) => a.from - b.from || a.to - b.to);
  const out: TextEdit[] = [];
  for (const e of sorted) {
    const prev = out[out.length - 1];
    if (prev && e.from < prev.to) out[out.length - 1] = { from: prev.from, to: Math.max(prev.to, e.to), insert: "" };
    else out.push(e);
  }
  return out;
};

/** The source offset where the block holding `path` starts its text: its first text the document wrote as it is. */
const blockStart = (editor: SlateEditor, s: Session, path: Path): number | null => {
  const block = blockPath(editor, path);
  let found: number | null = null;
  const walk = (node: unknown) => {
    if (found !== null) return;
    if (isText(node)) {
      const p = s.partsOf(node).find((p) => node.text.slice(p.at, p.at + p.length).trim());
      if (p) found = p.src[0];
      return;
    }
    const n = node as TypstElement | TypstAtom;
    if (n.type === "el") n.children.forEach(walk);
  };
  walk(nodeAt(editor, block));
  return found;
};

// --- commands ------------------------------------------------------------------------

/** A key pressed while the value is stale waits for the next one. */
const later = (s: Session, run: () => void): boolean => {
  if (!s.stale) return false;
  s.queue.push(run);
  return true;
};

/** The marks the selection's start is in. */
export const activeMarks = (editor: SlateEditor, s: Session): Set<Mark> => {
  const out = new Set<Mark>();
  const at = editor.selection?.anchor.path;
  if (!at) return out;
  for (let i = 1; i < at.length; i++) {
    const node = nodeAt(editor, at.slice(0, i)) as TypstElement;
    if (node?.type !== "el") continue;
    if (node.tag === "strong" || node.tag === "b") out.add("bold");
    if (node.tag === "em" || node.tag === "i") out.add("italic");
    if (node.span) {
      const mark = markOf(s.source, s.current(node.span[0], 1), s.current(node.span[1], -1));
      if (mark) out.add(mark);
    }
  }
  return out;
};

/** What the block at the selection's start is. */
export const activeBlock = (editor: SlateEditor, s: Session): BlockKind | null => {
  const at = editor.selection?.anchor.path;
  const start = at ? blockStart(editor, s, at) : null;
  return start === null ? null : blockOf(s.source, start);
};

/** Puts the selection in `mark`, or takes it out of it. */
export const toggleMark = (editor: SlateEditor, s: Session, mark: Mark): void => {
  const sel = editor.selection;
  if (!sel || later(s, () => toggleMark(editor, s, mark))) return;
  // In it: its syntax goes (the whole of it: `*a b*` around `b` is all `a b` unmarked).
  for (let i = sel.anchor.path.length - 1; i >= 1; i--) {
    const node = nodeAt(editor, sel.anchor.path.slice(0, i)) as TypstElement;
    if (node?.type !== "el" || !node.span) continue;
    const from = s.current(node.span[0], 1);
    const to = s.current(node.span[1], -1);
    if (markOf(s.source, from, to) !== mark) continue;
    const edits = unwrapMark(s.source, from, to);
    if (edits) s.apply(edits);
    return;
  }
  if (RangeApi.isCollapsed(sel)) return;
  const [start, end] = RangeApi.edges(sel);
  const a = s.toSource(start);
  const b = s.toSource(end);
  if (a === null || b === null || /\n[ \t]*\n/.test(s.source.slice(a, b))) return;
  const edits = wrapMark(s.source, a, b, mark);
  if (edits) s.apply(edits);
};

/** Turns the block at the selection into `kind` (a list or a heading again: back to a paragraph). */
export const setBlockKind = (editor: SlateEditor, s: Session, kind: BlockKind): void => {
  const at = editor.selection?.anchor.path;
  if (!at || later(s, () => setBlockKind(editor, s, kind))) return;
  const start = blockStart(editor, s, at);
  if (start === null) return;
  const now = blockOf(s.source, start);
  const edits = setBlock(s.source, start, now === kind && kind !== "paragraph" ? "paragraph" : kind);
  if (edits) s.apply(edits);
};

// --- the plugin ----------------------------------------------------------------------

const textAt = (editor: SlateEditor, point: Point) => nodeAt(editor, point.path) as TypstText | undefined;

/** The HTML's elements, rendered as they are. @internal */
export const ElementPlugin = createPlatePlugin({ key: "el", node: { isElement: true, component: ElementView } });

/** Atoms: void, shown from what they were read from. @internal */
export const AtomPlugin = createPlatePlugin({
  key: "atom",
  node: { isElement: true, isVoid: true, component: AtomView },
});

/**
 * Typst's editing: elements and atoms render the HTML's DOM, and Slate's transforms become edits of the source.
 * @internal
 */
export const TypstPlugin = createPlatePlugin({
  key: "typst",
  // Slate's own transforms and checks, taken before they are overridden: the overrides call them.
}).overrideEditor(
  ({
    editor,
    tf: { insertText: slateInsertText, deleteBackward, deleteForward },
    api: { isInline, isVoid, isSelectable },
  }) => {
    const tf = { deleteBackward, deleteForward };
    return {
      api: {
        isInline: (element) =>
          (element as { type?: string }).type === "el" || (element as { type?: string }).type === "atom"
            ? (element as unknown as TypstElement).inline
            : isInline(element),
        isVoid: (element) => (element as { type?: string }).type === "atom" || isVoid(element),
        isSelectable: (element) => (element as { type?: string }).type !== "atom" && isSelectable(element),
      },
      transforms: {
        // The value is read from the HTML: Slate's rules for it (blocks or inlines, no empty texts) don't hold there.
        normalizeNode() {},
        insertText(text) {
          const s = sessions.get(editor);
          const sel = editor.selection;
          if (!s || !sel || later(s, () => editor.tf.insertText(text))) return;
          const [start, end] = RangeApi.edges(sel);
          const at = s.toSource(start);
          if (at === null) return;
          const removed = RangeApi.isCollapsed(sel) ? [] : deletion(editor, s, start, end);
          const inserted = insertText(s.source, at, text);
          const insert = inserted[0]?.insert ?? "";
          const leaf = textAt(editor, start);
          const found = leaf ? s.locate(leaf, start.offset) : null;
          // Shown at once: text typed as it is into a piece of text the source has as it is.
          if (removed.length || !leaf || !found?.exact || found.pos !== at || insert !== text || s.stale) {
            s.apply([...removed, ...inserted], { caret: at + insert.length });
            return;
          }
          const parts = s.partsOf(leaf);
          s.apply(inserted, {
            local: () => {
              slateInsertText(text);
              const now = textAt(editor, start);
              if (now)
                editor.tf.setNodes(
                  {
                    parts: s.shifted(parts, found.index, start.offset, now.text.length - leaf.text.length),
                    rev: s.pending.length,
                  } as never,
                  { at: start.path },
                );
            },
          });
        },
        deleteBackward(unit) {
          remove(editor, tf, -1, unit ?? "character");
        },
        deleteForward(unit) {
          remove(editor, tf, 1, unit ?? "character");
        },
        deleteFragment() {
          const s = sessions.get(editor);
          const sel = editor.selection;
          if (!s || !sel || RangeApi.isCollapsed(sel) || later(s, () => editor.tf.deleteFragment())) return;
          const [start, end] = RangeApi.edges(sel);
          const at = s.toSource(start);
          s.apply(deletion(editor, s, start, end), { caret: at });
        },
        insertBreak() {
          breakLine(editor, false);
        },
        insertSoftBreak() {
          breakLine(editor, true);
        },
        insertData(data) {
          const text = data.getData("text/plain");
          if (text) editor.tf.insertText(text);
        },
        insertFragment() {},
        undo() {
          sessions.get(editor)?.undo();
        },
        redo() {
          sessions.get(editor)?.redo();
        },
      },
    };
  },
);

const breakLine = (editor: SlateEditor, soft: boolean) => {
  const s = sessions.get(editor);
  const sel = editor.selection;
  if (!s || !sel || later(s, () => breakLine(editor, soft))) return;
  const [start, end] = RangeApi.edges(sel);
  const at = s.toSource(start);
  if (at === null) return;
  const removed = RangeApi.isCollapsed(sel) ? [] : deletion(editor, s, start, end);
  const inserted = insertBreak(s.source, at, soft);
  const caret = (inserted[0]?.from ?? at) + (inserted[0]?.insert.length ?? 0);
  s.apply([...removed, ...inserted], { caret });
};

/** Backspace (`dir` -1) and Delete (1). */
const remove = (
  editor: SlateEditor,
  tf: { deleteBackward: (unit: never) => void; deleteForward: (unit: never) => void },
  dir: 1 | -1,
  unit: "character" | "word" | "line" | "block",
) => {
  const s = sessions.get(editor);
  const sel = editor.selection;
  if (!s || !sel) return;
  if (later(s, () => remove(editor, tf, dir, unit))) return;
  if (!RangeApi.isCollapsed(sel)) {
    editor.tf.deleteFragment();
    return;
  }
  const point = sel.anchor;
  const other = dir < 0 ? editor.api.before(point, { unit }) : editor.api.after(point, { unit });
  if (!other) return;
  const [start, end] = dir < 0 ? [other, point] : [point, other];
  const sameText = samePath(start.path, end.path);
  const leaf = textAt(editor, point);
  // At a block's start, Backspace makes a heading or an item a paragraph before it joins blocks.
  if (dir < 0 && !sameText && !samePath(blockPath(editor, start.path), blockPath(editor, end.path))) {
    const from = blockStart(editor, s, end.path);
    if (from !== null && s.toSource(end) === from && blockOf(s.source, from) !== "paragraph") {
      const edits = setBlock(s.source, from, "paragraph");
      if (edits) {
        s.apply(edits, { caret: from - (edits[0] ? edits[0].to - edits[0].from - edits[0].insert.length : 0) });
        return;
      }
    }
  }
  const edits = deletion(editor, s, start, end);
  if (edits.length === 0) return;
  const caret = s.toSource(start);
  // Shown at once: characters of one exact piece of text.
  const found = leaf && sameText ? s.locate(leaf, dir < 0 ? point.offset : start.offset) : null;
  const piece = found && leaf ? s.partsOf(leaf)[found.index] : undefined;
  const inside = !!piece && piece.exact && piece.at <= start.offset && end.offset <= piece.at + piece.length;
  if (leaf && found && inside && edits.length === 1 && !s.stale) {
    const parts = s.partsOf(leaf);
    s.apply(edits, {
      local: () => {
        if (dir < 0) tf.deleteBackward(unit as never);
        else tf.deleteForward(unit as never);
        const now = textAt(editor, start);
        if (now)
          editor.tf.setNodes(
            {
              parts: s.shifted(parts, found.index, start.offset, now.text.length - leaf.text.length),
              rev: s.pending.length,
            } as never,
            { at: start.path },
          );
      },
    });
    return;
  }
  s.apply(edits, { caret });
};
