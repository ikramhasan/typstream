// The laid-out HTML as the editor's value. The renderer lays the document out on pages in a flow nobody sees
// (`@typstream/dom`'s pages: breaks, spacing, columns, all by moving DOM); this reads that flow back as Slate nodes,
// element by element, so Plate renders the very DOM the renderer made and the document looks the same.
//
// What the document's text made is editable: elements holding text whose source the engine marked (`spans`), and
// that text, with its range. Everything else is an atom, shown from its markup: a template's words and numbering,
// pictures and equations, spacing, the pages' spacers.

import type { SourceSpan } from "./spans";
import type { Span, TextPart, TypstAtom, TypstBlock, TypstChild, TypstElement, TypstText } from "./types";

const HTML_NS = "http://www.w3.org/1999/xhtml";
/** The renderer's text runs (runs.ts, `wrapRuns`), which hold one text each, and the pages' spacers (pages.ts). */
const RUN = "typstream-t";
const SPACER = "typstream-break";

/** Where a node came from (spans.ts), in the compiled document. */
export type SpanOf = (node: Node) => SourceSpan | null;

const attrsOf = (el: Element): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) out[a.name] = a.value;
  return out;
};

const isInline = (el: Element, view: Window): boolean => {
  const display = view.getComputedStyle(el).display;
  return display.startsWith("inline") || display === "ruby" || display === "contents";
};

/**
 * What an atom shows: a copy of the element it was read from, made then (the renderer replaces what it changes).
 * Copied, not parsed again from its markup: the sanitized DOM is shown as it was sanitized.
 */
export const atomContent = new WeakMap<TypstAtom, Element>();

const atom = (el: Element, view: Window, span?: Span): TypstAtom => {
  const node: TypstAtom = {
    type: "atom",
    tag: el.localName,
    attrs: attrsOf(el),
    inline: isInline(el, view),
    ...(el.namespaceURI && el.namespaceURI !== HTML_NS ? { ns: el.namespaceURI } : {}),
    html: el.innerHTML,
    ...(span ? { span } : {}),
    children: [{ text: "" }],
  };
  atomContent.set(node, el.cloneNode(true) as Element);
  return node;
};

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A text Typst wrote that the document didn't (a template's, a numbering's): an atom, in its run's span. */
const textAtom = (text: string, run: Record<string, string> | undefined, inline = true): TypstAtom => ({
  type: "atom",
  tag: run ? "span" : "typstream-text",
  attrs: run ?? {},
  inline,
  html: escapeHtml(text),
  children: [{ text: "" }],
});

/**
 * The flow's content as the editor's value. `toInput` maps the compiled document's offsets (healed) to `source`'s,
 * the text being edited: a piece is exact when it is `source`'s characters there.
 */
export const readValue = (
  flow: Element,
  spanOf: SpanOf,
  source: string,
  toInput: (pos: number, assoc?: 1 | -1) => number = (p) => p,
): TypstBlock[] => {
  const view = flow.ownerDocument.defaultView as Window;
  /** Elements with text the document wrote, found once. */
  const editable = new WeakMap<Element, boolean>();
  const hasEditable = (el: Element): boolean => {
    const known = editable.get(el);
    if (known !== undefined) return known;
    let found = false;
    if (!el.namespaceURI || el.namespaceURI === HTML_NS) {
      for (const child of Array.from(el.childNodes)) {
        if (
          child.nodeType === 3 ? !!spanOf(child)?.parts?.length : child.nodeType === 1 && hasEditable(child as Element)
        ) {
          found = true;
          break;
        }
      }
    }
    editable.set(el, found);
    return found;
  };

  /** A text as Typst wrote it and its pieces, in `source`'s offsets. */
  type Written = { text: string; parts: { at: number; length: number; from: number; to: number; exact: boolean }[] };
  const written = (span: NonNullable<ReturnType<SpanOf>>): Written | null => {
    if (span.text === undefined || !span.parts?.length) return null;
    const text = span.text;
    return {
      text,
      parts: span.parts.map((p) => {
        const from = toInput(p.from);
        const to = Math.max(from, toInput(p.to, -1));
        return {
          at: p.at,
          length: p.length,
          from,
          to,
          exact: source.slice(from, to) === text.slice(p.at, p.at + p.length),
        };
      }),
    };
  };

  /** The pieces of `w` in `[start, start + length)` of its text, from there. */
  const clip = (w: Written, start: number, length: number): TextPart[] => {
    const out: TextPart[] = [];
    for (const p of w.parts) {
      const a = Math.max(p.at, start);
      const b = Math.min(p.at + p.length, start + length);
      if (b <= a) continue;
      // An exact piece cut keeps its characters; a node cut still stands for all of it.
      const src: Span = p.exact ? [p.from + (a - p.at), p.from + (b - p.at)] : [p.from, p.to];
      out.push({ at: a - start, length: b - a, src, exact: p.exact });
    }
    return out;
  };

  /** The text the pages split last, and how much of it the texts read so far had: what's left goes on from there. */
  let carry: { w: Written; end: number } | null = null;

  const textOf = (node: Text, run?: Record<string, string>): TypstText | TypstAtom | null => {
    const data = node.data;
    if (data === "") return null;
    const span = spanOf(node);
    const w = span ? written(span) : null;
    let parts: TextPart[] = [];
    if (w) {
      // The renderer drops spaces Typst drops, and the pages cut a text where a page starts: what is left of it.
      const at = w.text.startsWith(data)
        ? 0
        : w.text.endsWith(data)
          ? w.text.length - data.length
          : w.text.indexOf(data);
      if (at >= 0) {
        parts = clip(w, at, data.length);
        carry = { w, end: at + data.length };
      } else carry = null;
    } else if (carry && carry.w.text.slice(carry.end, carry.end + data.length) === data) {
      parts = clip(carry.w, carry.end, data.length);
      carry = { w: carry.w, end: carry.end + data.length };
    }
    if (!parts.length) return data.trim() ? textAtom(data, run) : { text: data, ...(run ? { run } : {}) };
    return { text: data, parts, ...(run ? { run } : {}) };
  };

  const children = (el: Element): TypstChild[] => {
    const out: TypstChild[] = [];
    carry = null;
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 3) {
        const text = textOf(child as Text);
        if (text) out.push(text);
        continue;
      }
      if (child.nodeType !== 1) continue;
      const inner = child as Element;
      if (inner.classList.contains(RUN)) {
        // A run is its text: the text renders the run's span (`renderText`). A spacer the pages put in it splits it.
        const run = attrsOf(inner);
        for (const node of Array.from(inner.childNodes)) {
          if (node.nodeType === 3) {
            const text = textOf(node as Text, run);
            if (text) out.push(text);
          } else if (node.nodeType === 1) out.push(atom(node as Element, view));
        }
        continue;
      }
      const spacer = inner.classList.contains(SPACER);
      const saved: typeof carry = carry;
      out.push(nodeOf(inner));
      carry = spacer ? saved : null;
    }
    return out;
  };

  const nodeOf = (el: Element): TypstBlock => {
    const s = spanOf(el);
    const span: Span | undefined = s ? [toInput(s.from), Math.max(toInput(s.from), toInput(s.to, -1))] : undefined;
    if (!hasEditable(el)) return atom(el, view, span);
    const kids = children(el);
    // An element with nothing to type into: Slate would show an empty one as an empty line.
    if (!kids.some((k) => "type" in k || (k as TypstText).parts)) return atom(el, view, span);
    const node: TypstElement = {
      type: "el",
      tag: el.localName,
      attrs: attrsOf(el),
      inline: isInline(el, view),
      ...(span ? { span } : {}),
      children: kids,
    };
    return node;
  };

  const out: TypstBlock[] = [];
  for (const child of Array.from(flow.childNodes)) {
    if (child.nodeType === 1) out.push(nodeOf(child as Element));
    else if (child.nodeType === 3 && (child as Text).data.trim())
      out.push(textAtom((child as Text).data, undefined, false));
  }
  return out;
};

// --- structural sharing ------------------------------------------------------------------

/** Keys by node object: a subtree reused from the last value is keyed once. */
const keys = new WeakMap<object, string>();

const keyOf = (node: TypstChild): string => {
  const known = keys.get(node);
  if (known !== undefined) return known;
  let key: string;
  if (!("type" in node)) key = `t${JSON.stringify([node.text, node.parts, node.run])}`;
  else if (node.type === "atom")
    key = `a${JSON.stringify([node.tag, node.attrs, node.inline, node.ns, node.html, node.span])}`;
  else
    key = `e${JSON.stringify([node.tag, node.attrs, node.inline, node.span])}[${node.children.map(keyOf).join(",")}]`;
  keys.set(node, key);
  return key;
};

/**
 * `next` with the nodes of `prev` it has unchanged (the same objects, so Slate keeps their keys and React their DOM):
 * a compile changes a block or two, and the DOM being typed into must stay. An element that changed only inside, at
 * the same place, is given to `keep` with the one it replaces (to take its key: its DOM stays, its children change).
 */
export const share = (
  prev: readonly TypstChild[],
  next: readonly TypstBlock[],
  keep?: (old: TypstChild, fresh: TypstChild) => void,
): TypstBlock[] => {
  // Alike nodes (two spacings, two spaces) each once: Slate finds a node's path by its object.
  const known = new Map<string, TypstChild[]>();
  const remember = (node: TypstChild) => {
    const key = keyOf(node);
    const list = known.get(key);
    if (list) list.push(node);
    else known.set(key, [node]);
    if ("type" in node && node.type === "el") node.children.forEach(remember);
  };
  prev.forEach(remember);
  const used = new Set<TypstChild>();
  const free = (n: TypstChild): boolean =>
    !used.has(n) && (!("type" in n) || n.type !== "el" || n.children.every(free));
  const take = (n: TypstChild) => {
    used.add(n);
    if ("type" in n && n.type === "el") n.children.forEach(take);
  };
  const shell = (n: TypstElement) => JSON.stringify([n.tag, n.attrs, n.inline]);
  const reuse = (node: TypstChild, old: TypstChild | undefined): TypstChild => {
    const same = known.get(keyOf(node))?.find(free);
    if (same) {
      take(same);
      return same;
    }
    if (!("type" in node) || node.type !== "el") return node;
    const before = old && "type" in old && old.type === "el" && shell(old) === shell(node) ? old : undefined;
    const fresh: TypstElement = { ...node, children: node.children.map((c, i) => reuse(c, before?.children[i])) };
    if (before && keep) {
      used.add(before);
      keep(before, fresh);
    }
    return fresh;
  };
  return next.map((n, i) => reuse(n, prev[i]) as TypstBlock);
};
