// The source spans of an HTML compile with `spans` (`CompileParams.spans`, engine-wasm's spans.rs), taken off the
// markup as the renderer parses it (dom's `onParse`) and kept on the nodes: the DOM is then the one the HTML target
// has without them, and the editor knows where each text and element came from.
//
// engine-wasm wraps each text node from the document in `<typstream-text data-src="from to">` and marks elements from
// its markup with `data-typstream-span="from to"`. Typst cuts text at spaces into pieces (one node per word and space):
// unwrapped, the pieces next to each other are one text again, as the HTML without wrappers parses, with the source of
// each piece kept as a part of it.

/** A piece of a text node and the source it came from (offsets in the compiled document). */
export interface SourcePart {
  /** Where it starts in the text as Typst wrote it, and how long it is there. */
  at: number;
  length: number;
  from: number;
  to: number;
}

/**
 * Where a node came from: an element's syntax node (a `*strong*`, a heading); a text's first part's start to its last
 * part's end, the text as Typst wrote it (the renderer may drop spaces from it, the pages cut it), and its parts.
 */
export interface SourceSpan {
  from: number;
  to: number;
  text?: string;
  parts?: readonly SourcePart[];
}

const TEXT = "typstream-text";
const ATTRIBUTE = "data-typstream-span";

/** `"from to"`; `null` for `-1 -1` (the preamble's) or anything else. */
const parse = (value: string | null): { from: number; to: number } | null => {
  const [from, to] = (value ?? "").split(" ").map(Number) as [number, number];
  return Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to >= from ? { from, to } : null;
};

/** Takes spans off markup (`take`, the renderer's `onParse`) and gives each node's (`of`). */
export const createSpans = () => {
  const spans = new WeakMap<Node, SourceSpan>();

  const take = (content: DocumentFragment): void => {
    for (const el of Array.from(content.querySelectorAll(`[${ATTRIBUTE}]`))) {
      const span = parse(el.getAttribute(ATTRIBUTE));
      if (span) spans.set(el, span);
      el.removeAttribute(ATTRIBUTE);
    }
    const wrappers = Array.from(content.querySelectorAll(TEXT));
    if (wrappers.length === 0) return;
    const pieces = new Map<Node, { from: number; to: number }>();
    const parents = new Set<Node>();
    for (const el of wrappers) {
      const span = parse(el.getAttribute("data-src"));
      for (const node of Array.from(el.childNodes)) if (span && node.nodeType === 3) pieces.set(node, span);
      if (el.parentNode) parents.add(el.parentNode);
      el.replaceWith(...Array.from(el.childNodes));
    }
    // Texts side by side are one, as they parse without the wrappers.
    for (const parent of parents) {
      let first: Text | null = null;
      let parts: SourcePart[] = [];
      const done = () => {
        if (first && parts.length)
          spans.set(first, {
            from: (parts[0] as SourcePart).from,
            to: (parts[parts.length - 1] as SourcePart).to,
            text: first.data,
            parts,
          });
        first = null;
        parts = [];
      };
      for (const node of Array.from(parent.childNodes)) {
        if (node.nodeType !== 3) {
          done();
          continue;
        }
        const text = node as Text;
        const piece = pieces.get(text);
        const at = first ? (first as Text).data.length : 0;
        if (piece && text.data) parts.push({ at, length: text.data.length, ...piece });
        if (first) {
          (first as Text).appendData(text.data);
          text.remove();
        } else first = text;
      }
      done();
    }
  };

  return { take, of: (node: Node): SourceSpan | null => spans.get(node) ?? null };
};
