// Text formatting: bold, italic, underline, colours, sizes. In Typst a mark is a wrapper around the
// text it styles: `*…*`, `_…_`, or a call with one content block (`#underline[…]`,
// `#text(fill: red)[…]`). Applying a mark wraps each piece of the selection that lies in one
// markup; removing it splits the wrappers around the selection. Wrappers the editor writes are
// calls (`#strong[…]`), which read the same between letters, where `*` would be text.

import type { TextEdit } from "@typstream/core";
import type { SyntaxNode } from "@typstream/syntax";
import { DEFAULT_SCHEMA, type EditorSchema, unitsFor } from "./commands";
import { type EditorState, mapSelection, type Selection, type Transaction } from "./state";
import { callArgs, calleeName, contentBlocksIn, ITEM_NODES, isEmbedded } from "./tree";

/**
 * A mark: a Typst function wrapping text. `arg` makes it a styled call (`text` with `fill`): its
 * value is the argument's.
 * @beta
 */
export interface Mark {
  /** The function: `strong`, `emph`, `underline`, `text`, `highlight`, … */
  name: string;
  /** For value marks: the named argument (`fill`, `size`, `font`). */
  arg?: string;
}

/** A wrapper in the source: a mark's syntax or call around some markup. */
export interface Wrapper {
  /** The whole wrapper, `#` included for a call. */
  from: number;
  to: number;
  /** Its markup. */
  innerFrom: number;
  innerTo: number;
  /** The function it is. */
  name: string;
  /** Named arguments' source by name (calls only). */
  args: Map<string, string>;
  /** Positional arguments' source, in order (a `highlight`'s none, a `text`'s none). */
  positional: string[];
}

/** Every wrapper in the tree, in source order (outer before inner). */
export const wrappers = (state: EditorState): Wrapper[] => {
  const cache = state as EditorState & { [WRAPPERS]?: Wrapper[] };
  const hit = cache[WRAPPERS];
  if (hit) return hit;
  const text = state.text;
  const out: Wrapper[] = [];
  const visit = (node: SyntaxNode) => {
    const kids = node.children;
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i] as SyntaxNode;
      if (c.kind === "Strong" || c.kind === "Emph") {
        const inner = c.children.find((k) => k.kind === "Markup");
        if (inner)
          out.push({
            from: c.from,
            to: c.to,
            innerFrom: inner.from,
            innerTo: inner.to,
            name: c.kind === "Strong" ? "strong" : "emph",
            args: new Map(),
            positional: [],
          });
      } else if (c.kind === "Hash" && kids[i + 1]?.kind === "FuncCall") {
        const call = kids[i + 1] as SyntaxNode;
        const args = callArgs(call, text);
        const name = calleeName(call, text);
        const blocks = contentBlocksIn(call);
        if (args && name && blocks.length === 1 && args.trailing.length === 1) {
          const inner = (args.trailing[0] as SyntaxNode).children.find((k) => k.kind === "Markup");
          if (inner) {
            const named = new Map<string, string>();
            for (const [k, v] of args.named) named.set(k, text.slice(v.from, v.to));
            out.push({
              from: c.from,
              to: call.to,
              innerFrom: inner.from,
              innerTo: inner.to,
              name,
              args: named,
              positional: args.positional.map((p) => text.slice(p.from, p.to)),
            });
          }
        }
      }
      if (c.children.length) visit(c);
    }
  };
  visit(state.tree);
  cache[WRAPPERS] = out;
  return out;
};
const WRAPPERS = Symbol("wrappers");

const matches = (w: Wrapper, mark: Mark): boolean => w.name === mark.name && (!mark.arg || w.args.has(mark.arg));

/** The text pieces (units of characters) in `[from, to)`, or the one before a caret. */
const pieces = (state: EditorState, from: number, to: number, schema: EditorSchema) => {
  const units = unitsFor(state, schema).filter((u) => u.kind === "char" || u.kind === "atom");
  if (from === to) {
    const before = units.filter((u) => u.to <= from).at(-1);
    const after = units.find((u) => u.from >= from);
    const u = before && (!after || before.to >= from - 16) ? before : after;
    return u ? [u] : [];
  }
  return units.filter((u) => u.from >= from && u.to <= to);
};

/**
 * The value of `mark` over `[from, to)`: `true` (or the argument's source for a value mark) when
 * every character is inside such a wrapper, `null` when not all are (or they differ).
 * @beta
 */
export const markValue = (
  state: EditorState,
  mark: Mark,
  from = state.from,
  to = state.to,
  schema: EditorSchema = DEFAULT_SCHEMA,
): string | true | null => {
  const ws = wrappers(state).filter((w) => matches(w, mark));
  let value: string | true | null = null;
  const ps = pieces(state, from, to, schema);
  if (ps.length === 0) return null;
  for (const p of ps) {
    // The innermost matching wrapper decides.
    const w = ws.filter((w) => w.innerFrom <= p.from && p.to <= w.innerTo).at(-1);
    if (!w) return null;
    const v = mark.arg ? (w.args.get(mark.arg) ?? null) : true;
    if (v === null || (value !== null && value !== v)) return null;
    value = v;
  }
  return value;
};

/** Whether `mark` is on all of `[from, to)` (a caret: on the text before it). @beta */
export const isMarked = (
  state: EditorState,
  mark: Mark,
  from = state.from,
  to = state.to,
  schema?: EditorSchema,
): boolean => markValue(state, mark, from, to, schema) !== null;

/** The call that opens a wrapper of `mark` with `value`: `#strong[`, `#text(fill: red)[`. */
const opening = (mark: Mark, value: string | null, rest: Map<string, string> = new Map()): string => {
  const args = [...rest].filter(([k]) => k !== mark.arg).map(([k, v]) => `${k}: ${v}`);
  if (mark.arg && value !== null) args.unshift(`${mark.arg}: ${value}`);
  return args.length ? `#${mark.name}(${args.join(", ")})[` : `#${mark.name}[`;
};

/** Edits that take `mark` off `[from, to)`, splitting wrappers around it. */
const removeEdits = (state: EditorState, mark: Mark, from: number, to: number): TextEdit[] => {
  const text = state.text;
  const edits: TextEdit[] = [];
  let covered = -1;
  for (const w of wrappers(state)) {
    if (!matches(w, mark) || w.innerTo <= from || w.innerFrom >= to || w.from < covered) continue;
    covered = w.to;
    const a = snapOut(state, Math.max(from, w.innerFrom), -1, w);
    const b = snapOut(state, Math.min(to, w.innerTo), 1, w);
    const open = w.name === "strong" || w.name === "emph" ? `#${w.name}[` : text.slice(w.from, w.innerFrom);
    const close = w.name === "strong" || w.name === "emph" ? "]" : text.slice(w.innerTo, w.to);
    const pre = text.slice(w.innerFrom, a).trim() !== "";
    const post = text.slice(b, w.innerTo).trim() !== "";
    // What stays styled by the wrapper's other arguments (`text(fill: red, size: 14pt)` loses only `fill`).
    const others = mark.arg ? [...w.args].filter(([k]) => k !== mark.arg) : [];
    const keptOpen = others.length && b > a ? opening({ name: w.name }, null, new Map(others)) : "";
    // The selected text itself stays put, so the selection does too.
    edits.push({ from: w.from, to: w.innerFrom, insert: pre ? open : "" });
    if (pre || keptOpen) edits.push({ from: a, to: a, insert: (pre ? close : "") + keptOpen });
    if (post || keptOpen) edits.push({ from: b, to: b, insert: (keptOpen ? "]" : "") + (post ? open : "") });
    edits.push({ from: w.innerTo, to: w.to, insert: post ? close : "" });
  }
  return edits;
};

/** `offset` moved out of any construct inside wrapper `w` it falls in (not text), towards `dir`. */
const snapOut = (state: EditorState, offset: number, dir: 1 | -1, w: Wrapper): number => {
  let node: SyntaxNode | undefined = state.tree;
  // Down to the wrapper's markup.
  const stack: SyntaxNode[] = [];
  while (node) {
    stack.push(node);
    node = node.children.find(
      (c) =>
        c.from <= w.innerFrom &&
        w.innerTo <= c.to &&
        !(c.from === w.innerFrom && c.to === w.innerTo && c.kind !== "Markup"),
    );
    if (node && node.from === w.innerFrom && node.to === w.innerTo && node.kind === "Markup") break;
  }
  if (!node) return offset;
  for (const c of node.children) {
    if (c.from < offset && offset < c.to && c.kind !== "Text" && c.kind !== "Space") return dir < 0 ? c.from : c.to;
  }
  return offset;
};

/**
 * The pieces of `[from, to)` a wrapper can go around: runs of a markup's children inside the range
 * (text cut where the range ends), split at paragraph breaks and block items, going into what the
 * range only partly covers.
 */
const segments = (
  state: EditorState,
  from: number,
  to: number,
  schema: EditorSchema,
): { from: number; to: number }[] => {
  const text = state.text;
  const out: { from: number; to: number }[] = [];
  const markup = (node: SyntaxNode) => {
    let run: { from: number; to: number } | null = null;
    const flush = () => {
      if (run && run.to > run.from) {
        // No wrapper around the spaces at its ends.
        let a = run.from;
        let b = run.to;
        while (a < b && /\s/.test(text[a] as string)) a++;
        while (b > a && /\s/.test(text[b - 1] as string)) b--;
        if (b > a) out.push({ from: a, to: b });
      }
      run = null;
    };
    const add = (a: number, b: number) => {
      a = Math.max(a, from);
      b = Math.min(b, to);
      if (b <= a) return;
      if (run && run.to === a) run.to = b;
      else {
        flush();
        run = { from: a, to: b };
      }
    };
    const kids = node.children;
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i] as SyntaxNode;
      const expr =
        c.kind === "Hash" && kids[i + 1] && isEmbedded(kids[i + 1] as SyntaxNode) ? (kids[i + 1] as SyntaxNode) : null;
      const end = expr ? expr.to : c.to;
      if (end <= from || c.from >= to) {
        if (expr) i++;
        continue;
      }
      if (c.kind === "Parbreak") flush();
      else if (ITEM_NODES.has(c.kind)) {
        flush();
        for (const k of c.children) if (k.kind === "Markup") markup(k);
      } else if (c.kind === "Text" || c.kind === "Space") add(c.from, c.to);
      else if (expr) {
        i++;
        const name = expr.kind === "FuncCall" ? calleeName(expr, text) : null;
        const inline = name === null || schema.inline.has(name) || schema.marks.has(name);
        if (from <= c.from && expr.to <= to && inline) add(c.from, expr.to);
        else {
          flush();
          for (const block of contentBlocksIn(expr)) for (const k of block.children) if (k.kind === "Markup") markup(k);
        }
      } else if (from <= c.from && c.to <= to) add(c.from, c.to);
      else {
        flush();
        for (const k of c.children) if (k.kind === "Markup") markup(k);
      }
    }
    flush();
  };
  markup(state.tree);
  return out;
};

/** Whether `*`/`_` can wrap `[from, to)`: not between letters, where Typst reads it as text. */
const delimiterFits = (text: string, from: number, to: number): boolean => {
  const word = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
  return !word(text[from - 1]) && !word(text[to]) && !/\s/.test(text[from] ?? " ") && !/\s/.test(text[to - 1] ?? " ");
};

/**
 * Turns `mark` on over the selection (removing it where it already is, so it isn't nested), or off
 * if it is on all of it. On a caret, writes an empty wrapper to type into, or splits the one the
 * caret is in.
 * @beta
 */
export const toggleMark =
  (mark: Mark) =>
  (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA): Transaction | null => {
    const on = isMarked(state, mark, state.from, state.to, schema);
    return setMark(mark, on ? null : true)(state, schema);
  };

/**
 * Sets `mark` over the selection to `value` (the argument's Typst source, e.g. `rgb("#e11d48")`, or
 * `true` for a plain mark), or takes it off with `null`.
 * @beta
 */
export const setMark =
  (mark: Mark, value: string | true | null) =>
  (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA): Transaction | null => {
    const text = state.text;
    const { from, to } = state;
    if (state.selection.node) return null;
    if (from === to) {
      // A caret: an empty wrapper to type into, or a split of the wrapper it is in.
      const w = wrappers(state)
        .filter((w) => matches(w, mark) && w.innerFrom <= from && from <= w.innerTo)
        .at(-1);
      if (value === null) {
        if (!w) return null;
        const open = w.name === "strong" || w.name === "emph" ? `#${w.name}[` : text.slice(w.from, w.innerFrom);
        const close = w.name === "strong" || w.name === "emph" ? "]" : text.slice(w.innerTo, w.to);
        const pre = text.slice(w.innerFrom, from);
        const post = text.slice(from, w.innerTo);
        const before = pre ? open + pre + close : "";
        const insert = `${before}${post ? open + post + close : ""}`;
        return { edits: [{ from: w.from, to: w.to, insert }], selection: caretAt(w.from + before.length) };
      }
      const open = opening(mark, value === true ? null : value);
      return { edits: [{ from, to, insert: `${open}]` }], selection: caretAt(from + open.length) };
    }
    // An exact wrapper with another value: change the argument only.
    if (mark.arg && value !== null && value !== true) {
      const exact = wrappers(state).find(
        (w) =>
          matches(w, mark) &&
          snapText(state, w.innerFrom) === snapText(state, from) &&
          snapText(state, w.innerTo, -1) === snapText(state, to, -1),
      );
      if (exact) {
        const edits = [{ from: exact.from, to: exact.innerFrom, insert: opening(mark, value, exact.args) }];
        return { edits, selection: mapSel(state.selection, edits) };
      }
    }
    const removed = removeEdits(state, mark, from, to);
    if (value === null) return { edits: removed, selection: mapSel(state.selection, removed) };
    if (removed.length) {
      // Off first (no nested wrappers of one mark), then on, as one edit.
      const mid = state.apply({ edits: removed, selection: mapSel(state.selection, removed) }).state;
      const again = setMark(mark, value)(mid, schema);
      const end = again ? mid.apply(again).state : mid;
      const edit = diffEdit(text, end.text);
      return { edits: edit ? [edit] : [], selection: end.selection };
    }
    const edits: TextEdit[] = [];
    for (const seg of segments(state, from, to, schema)) {
      const delimiter = (mark.name === "strong" || mark.name === "emph") && delimiterFits(text, seg.from, seg.to);
      const open = delimiter ? (mark.name === "strong" ? "*" : "_") : opening(mark, value === true ? null : value);
      const close = delimiter ? open : "]";
      edits.push({ from: seg.from, to: seg.from, insert: open }, { from: seg.to, to: seg.to, insert: close });
    }
    const sorted = edits.sort((a, b) => a.from - b.from || a.to - b.to);
    return { edits: sorted, selection: mapSel(state.selection, sorted) };
  };

/** `offset` past spaces (to the right, or left with `dir` -1): where a wrapper's text starts. */
const snapText = (state: EditorState, offset: number, dir: 1 | -1 = 1): number => {
  let o = offset;
  if (dir > 0) while (o < state.text.length && /\s/.test(state.text[o] as string)) o++;
  else while (o > 0 && /\s/.test(state.text[o - 1] as string)) o--;
  return o;
};

const caretAt = (at: number): Selection => ({ anchor: at, head: at });

const mapSel = (s: Selection, edits: readonly TextEdit[]): Selection =>
  mapSelection(
    s,
    [...edits].sort((a, b) => a.from - b.from || a.to - b.to),
  );

const diffEdit = (a: string, b: string): TextEdit | null => {
  if (a === b) return null;
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  let end = 0;
  while (end < max - start && a.charCodeAt(a.length - 1 - end) === b.charCodeAt(b.length - 1 - end)) end++;
  return { from: start, to: a.length - end, insert: b.slice(start, b.length - end) };
};

/**
 * The URL of the link at the selection (its `#link("…")[…]`), or `null`.
 * @beta
 */
export const linkAt = (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA): string | null => {
  const ps = pieces(state, state.from, state.to, schema);
  const p = ps[0];
  if (!p) return null;
  const w = wrappers(state)
    .filter((w) => w.name === "link" && w.innerFrom <= p.from && p.to <= w.innerTo)
    .at(-1);
  const url = w?.positional[0];
  return url ? (/^"((?:[^"\\]|\\.)*)"$/.exec(url)?.[1]?.replace(/\\(.)/g, "$1") ?? null) : null;
};

/**
 * Makes the selection a link to `url` (`#link("…")[…]`), changes the link it is in, or takes links
 * off it with `null`. On a caret, writes the URL as the link's text.
 * @beta
 */
export const setLink =
  (url: string | null) =>
  (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA): Transaction | null => {
    const quoted = url === null ? null : `"${url.replace(/["\\]/g, "\\$&")}"`;
    const around = wrappers(state)
      .filter((w) => w.name === "link" && w.innerFrom <= state.from && state.to <= w.innerTo)
      .at(-1);
    if (around && quoted !== null) {
      // Another URL for the link the selection is in.
      const edits = [{ from: around.from, to: around.innerFrom, insert: `#link(${quoted})[` }];
      return { edits, selection: mapSel(state.selection, edits) };
    }
    if (quoted === null) {
      const edits = removeEdits(state, { name: "link" }, state.from, state.to);
      return edits.length ? { edits, selection: mapSel(state.selection, edits) } : null;
    }
    if (state.empty) {
      const shown = escapeLinkText(url ?? "");
      const insert = `#link(${quoted})[${shown}]`;
      return { edits: [{ from: state.from, to: state.from, insert }], selection: caretAt(state.from + insert.length) };
    }
    const edits: TextEdit[] = [];
    for (const seg of segments(state, state.from, state.to, schema))
      edits.push(
        { from: seg.from, to: seg.from, insert: `#link(${quoted})[` },
        { from: seg.to, to: seg.to, insert: "]" },
      );
    const sorted = edits.sort((a, b) => a.from - b.from || a.to - b.to);
    return { edits: sorted, selection: mapSel(state.selection, sorted) };
  };

/** A URL as a link's text: markup's characters escaped. */
const escapeLinkText = (url: string): string => url.replace(/[\\*_`$#<>@[\]~/]/g, "\\$&");
