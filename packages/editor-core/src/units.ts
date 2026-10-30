// What a caret moves over and Backspace deletes: the visible pieces of the document in source
// order. Characters of text (a grapheme each), spaces, paragraph breaks, and atoms (an equation, a
// call that shows no text of the document). Markup's delimiters (`*`, `_`, `= `, `- `, `#strong[`)
// show nothing, so the caret steps over them; a component's own code (`#question(points: 2)[`) is
// an edge the caret crosses but Backspace doesn't delete.

import type { SyntaxNode } from "@typstream/syntax";
import { calleeName, contentBlocksIn, isEmbedded } from "./tree";

/**
 * A visible piece of the document: `char` (a grapheme of text, an escape, a shorthand, a quote, a
 * line break), `space`, `break` (a blank line between paragraphs), `atom` (shown whole: an
 * equation, an image, a call with no text of the document), `edge` (a component's code around its
 * text: not deleted by Backspace, crossed by arrows).
 * @beta
 */
export interface Unit {
  /** Kind of piece, see above. */
  kind: "char" | "space" | "break" | "atom" | "edge";
  /** Start in the source. */
  from: number;
  /** End in the source. */
  to: number;
}

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter() : null;

const graphemes = (text: string, from: number, out: Unit[]) => {
  if (!segmenter) {
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      const pair = code >= 0xd800 && code <= 0xdbff && i + 1 < text.length;
      out.push({ kind: "char", from: from + i, to: from + i + (pair ? 2 : 1) });
      if (pair) i++;
    }
    return;
  }
  for (const { index, segment } of segmenter.segment(text))
    out.push({ kind: /^\s+$/.test(segment) ? "space" : "char", from: from + index, to: from + index + segment.length });
};

/**
 * The document's units in source order. `transparent(name)` says whether a call is a mark (text
 * styling such as `strong` or `text`), whose code is skipped like a delimiter, rather than a
 * component, whose code is an edge.
 * @beta
 */
export const unitsOf = (root: SyntaxNode, text: string, transparent: (name: string) => boolean): Unit[] => {
  const out: Unit[] = [];
  const markup = (node: SyntaxNode) => {
    const kids = node.children;
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i] as SyntaxNode;
      switch (c.kind) {
        case "Text":
          graphemes(text.slice(c.from, c.to), c.from, out);
          break;
        case "Space":
          out.push({ kind: "space", from: c.from, to: c.to });
          break;
        case "Parbreak":
          out.push({ kind: "break", from: c.from, to: c.to });
          break;
        case "Linebreak":
        case "Escape":
        case "Shorthand":
        case "SmartQuote":
        case "Link":
          out.push({ kind: "char", from: c.from, to: c.to });
          break;
        case "Strong":
        case "Emph":
          for (const k of c.children) if (k.kind === "Markup") markup(k);
          break;
        case "Heading":
        case "ListItem":
        case "EnumItem":
        case "TermItem":
          for (const k of c.children) if (k.kind === "Markup") markup(k);
          break;
        case "Raw":
          raw(c);
          break;
        case "Equation":
        case "Ref":
          out.push({ kind: "atom", from: c.from, to: c.to });
          break;
        case "Hash": {
          const expr = kids[i + 1];
          if (!expr || !isEmbedded(expr)) break;
          i++;
          embedded(c, expr);
          break;
        }
        case "Error":
          out.push({ kind: "atom", from: c.from, to: c.to });
          break;
        default:
          // Labels, comments: nothing shows.
          break;
      }
    }
  };
  const raw = (node: SyntaxNode) => {
    for (const k of node.children) {
      if (k.kind === "Text") graphemes(text.slice(k.from, k.to), k.from, out);
      else if (k.kind === "Raw") raw(k);
    }
  };
  const embedded = (hash: SyntaxNode, expr: SyntaxNode) => {
    const blocks = contentBlocksIn(expr);
    if (blocks.length === 0) {
      out.push({ kind: "atom", from: hash.from, to: expr.to });
      return;
    }
    const name = expr.kind === "FuncCall" ? calleeName(expr, text) : null;
    const skip = name !== null && transparent(name);
    let at = hash.from;
    for (const block of blocks) {
      const inner = block.children.find((k) => k.kind === "Markup");
      const from = inner?.from ?? block.from + 1;
      if (!skip && from > at) out.push({ kind: "edge", from: at, to: from });
      if (inner) markup(inner);
      at = inner?.to ?? from;
    }
    if (!skip && expr.to > at) out.push({ kind: "edge", from: at, to: expr.to });
  };
  markup(root);
  return out;
};

/** Index of the last unit ending at or before `offset` (-1 for none). */
export const unitBefore = (units: readonly Unit[], offset: number): number => {
  let lo = 0;
  let hi = units.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((units[mid] as Unit).to <= offset) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
};

/** Index of the first unit starting at or after `offset` (`units.length` for none). */
export const unitAfter = (units: readonly Unit[], offset: number): number => {
  let lo = 0;
  let hi = units.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((units[mid] as Unit).from < offset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

/** The unit containing `offset` strictly inside it, if any (a caret can't be there). */
export const unitInside = (units: readonly Unit[], offset: number): Unit | null => {
  const i = unitBefore(units, offset) + 1;
  const u = units[i];
  return u && u.from < offset && offset < u.to ? u : null;
};

/**
 * Where a caret at `offset` moves one step left (`dir` -1) or right (1): over one unit, edges
 * crossed without stopping. Lands at the end of the unit before (left) or the start of the one
 * after (right), so the caret keeps the formatting of the text it comes from.
 * @beta
 */
export const step = (units: readonly Unit[], offset: number, dir: 1 | -1): number => {
  if (dir < 0) {
    let i = unitBefore(units, offset);
    while (i >= 0 && (units[i] as Unit).kind === "edge") i--;
    if (i < 0) return offset;
    const u = units[i] as Unit;
    // Land where the unit before it ends, if that is just before it (no edge between): the same
    // spot, in the formatting of the text before.
    const prev = units[i - 1];
    return prev && prev.to === u.from && prev.kind !== "edge" && prev.kind !== "break" ? prev.to : u.from;
  }
  let i = unitAfter(units, offset);
  // `offset` inside a unit: to its end.
  const inside = unitInside(units, offset);
  if (inside) return inside.to;
  while (i < units.length && (units[i] as Unit).kind === "edge") i++;
  if (i >= units.length) return offset;
  return (units[i] as Unit).to;
};

/** Where a word starts or ends next to `offset`, for Ctrl/Alt + arrows and double clicks. */
export const wordStep = (units: readonly Unit[], text: string, offset: number, dir: 1 | -1): number => {
  const isWord = (u: Unit) => u.kind === "char" && /[\p{L}\p{N}_]/u.test(text.slice(u.from, u.to));
  if (dir < 0) {
    let i = unitBefore(units, offset);
    while (i >= 0 && !isWord(units[i] as Unit)) i--;
    while (i > 0 && isWord(units[i - 1] as Unit) && (units[i - 1] as Unit).to >= (units[i] as Unit).from - 8) i--;
    return i >= 0 ? (units[i] as Unit).from : offset;
  }
  let i = unitAfter(units, offset);
  while (i < units.length && !isWord(units[i] as Unit)) i++;
  while (
    i + 1 < units.length &&
    isWord(units[i + 1] as Unit) &&
    (units[i + 1] as Unit).from <= (units[i] as Unit).to + 8
  )
    i++;
  return i < units.length ? (units[i] as Unit).to : offset;
};

/** The word around `offset`: `[from, to)` of the run of word characters it touches. */
export const wordAt = (units: readonly Unit[], text: string, offset: number): { from: number; to: number } => {
  const isWord = (u: Unit | undefined) => !!u && u.kind === "char" && /[\p{L}\p{N}_]/u.test(text.slice(u.from, u.to));
  let i = unitAfter(units, offset);
  if (!isWord(units[i]) || (units[i] as Unit).from !== offset) i = unitBefore(units, offset);
  if (!isWord(units[i])) return { from: offset, to: offset };
  let a = i;
  let b = i;
  while (a > 0 && isWord(units[a - 1]) && (units[a - 1] as Unit).to >= (units[a] as Unit).from - 8) a--;
  while (b + 1 < units.length && isWord(units[b + 1]) && (units[b + 1] as Unit).from <= (units[b] as Unit).to + 8) b++;
  return { from: (units[a] as Unit).from, to: (units[b] as Unit).to };
};
