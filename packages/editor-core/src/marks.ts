// Text formatting: bold, italic, underline, colours, sizes. In Typst a mark is a wrapper around the
// text it styles: `*…*`, `_…_`, or a call with one content block (`#underline[…]`,
// `#text(fill: red)[…]`). Applying a mark wraps each piece of the selection that lies in one
// markup; removing it splits the wrappers around the selection. Wrappers the editor writes are
// calls (`#strong[…]`), which read the same between letters, where `*` would be text.

import type { TextEdit } from "@typstream/core";
import type { SyntaxKind, SyntaxNode } from "@typstream/syntax";
import { DEFAULT_SCHEMA, type EditorSchema, guardDelimiters, unitsFor } from "./commands";
import { type EditorState, mapSelection, type Selection, type Transaction } from "./state";
import { readString, typstString } from "./text";
import { bodyStart, callArgs, calleeName, contentBlocksIn, findLast, ITEM_NODES, isEmbedded, PREAMBLE } from "./tree";
import { wordAt } from "./units";

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
  /** Written with delimiters (`*…*`, `_…_`) rather than as a call. */
  delimiter: boolean;
  /** Its markup's node. */
  markup: SyntaxNode;
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
            delimiter: true,
            markup: inner,
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
              delimiter: false,
              markup: inner,
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
 * every character is inside such a wrapper, `null` when not all are (or they differ). At a caret,
 * the innermost such wrapper holding it.
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
  if (from === to) {
    // A caret: on when a wrapper holds it, so the toolbar shows what typing (and toggling) does there.
    const w = ws.filter((w) => w.innerFrom <= from && from <= w.innerTo).at(-1);
    if (!w) return null;
    return mark.arg ? (w.args.get(mark.arg) ?? null) : true;
  }
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

/** Whether `mark` is on all of `[from, to)` (a caret: inside a wrapper of it). @beta */
export const isMarked = (
  state: EditorState,
  mark: Mark,
  from = state.from,
  to = state.to,
  schema?: EditorSchema,
): boolean => markValue(state, mark, from, to, schema) !== null;

/** A call's opening, to its content's bracket: `#strong[`, `#text(fill: red)[`. */
const call = (name: string, args: string[]): string => (args.length ? `#${name}(${args.join(", ")})[` : `#${name}[`);

/** The call that opens a wrapper of `mark` with `value`. */
const opening = (mark: Mark, value: string | null): string =>
  call(mark.name, mark.arg && value !== null ? [`${mark.arg}: ${value}`] : []);

/** `w`'s opening with `arg` set to `value`: in its place when it has one, else after its others. */
const withArg = (w: Wrapper, arg: string, value: string): string => {
  const named = new Map(w.args).set(arg, value);
  return call(w.name, [...w.positional, ...[...named].map(([k, v]) => `${k}: ${v}`)]);
};

/**
 * `w`'s opening without `mark`: a `text` keeps its other arguments (`text(fill: red, size: 14pt)`
 * loses only `fill`), anything else goes whole (`""`).
 */
const without = (w: Wrapper, mark: Mark): string => {
  if (!mark.arg || w.name !== "text") return "";
  const args = [...w.positional, ...[...w.args].filter(([k]) => k !== mark.arg).map(([k, v]) => `${k}: ${v}`)];
  return args.length ? call(w.name, args) : "";
};

/** Whether `w` is a mark, which can end and start again anywhere in its text (a component can't). */
const splits = (w: Wrapper, schema: EditorSchema): boolean => w.delimiter || schema.marks.has(w.name);

/** A place in a wrapper's text where it can end: the offset, and the marks inside it open there, outermost first. */
interface Cut {
  at: number;
  open: Wrapper[];
}

/**
 * Where wrapper `w` can be cut at `offset`. Marks inside `w` that hold the offset are cut with it
 * (`open`); out of anything else there (a component, an equation) the offset moves towards `dir`.
 * At a mark's first or last place the cut is outside that mark, which then stays whole: `edges`
 * says for which of the two (`start`, `end`, `both`, or `none`).
 */
const cutAt = (
  state: EditorState,
  w: Wrapper,
  offset: number,
  dir: 1 | -1,
  schema: EditorSchema,
  edges: "both" | "start" | "end" | "none" = "both",
): Cut => {
  const ws = wrappers(state);
  const open: Wrapper[] = [];
  let at = offset;
  let markup: SyntaxNode | null = w.markup;
  while (markup) {
    const kids: readonly SyntaxNode[] = markup.children;
    let inner: Wrapper | null = null;
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i] as SyntaxNode;
      // An embedded expression is one construct with its `#`.
      const next: SyntaxNode | undefined = kids[i + 1];
      const expr: SyntaxNode | null = c.kind === "Hash" && next && isEmbedded(next) ? next : null;
      if (expr) i++;
      const end: number = expr ? expr.to : c.to;
      if (at <= c.from || at >= end || c.kind === "Text" || c.kind === "Space") continue;
      const x: Wrapper | undefined = ws.find((x) => x.from === c.from && x.to === end);
      if (x && splits(x, schema) && x.innerFrom <= at && at <= x.innerTo) inner = x;
      else at = dir < 0 ? c.from : end;
      break;
    }
    if (inner) open.push(inner);
    markup = inner ? (inner as Wrapper).markup : null;
  }
  for (let x = open.at(-1); x; x = open.at(-1)) {
    if (at === x.innerFrom && (edges === "both" || edges === "start")) at = x.from;
    else if (at === x.innerTo && (edges === "both" || edges === "end")) at = x.to;
    else break;
    open.pop();
  }
  return { at, open };
};

/** What a mark is taken off: a wrapper of it, and what its pieces around the place are written with. */
const parts = (state: EditorState, mark: Mark, w: Wrapper) => {
  const text = state.text;
  // A piece of `*…*` or `_…_` is a call, which reads the same between letters, where `*` would be text.
  const source = (x: Wrapper) =>
    x.delimiter
      ? { open: `#${x.name}[`, close: "]" }
      : { open: text.slice(x.from, x.innerFrom), close: text.slice(x.innerTo, x.to) };
  /** A wrapper where the mark is off: itself, or what is left of it without the mark. */
  const bare = (x: Wrapper) => {
    if (!matches(x, mark)) return source(x);
    const open = without(x, mark);
    return { open, close: open ? "]" : "" };
  };
  return {
    self: source(w),
    kept: bare(w),
    opens: (xs: Wrapper[]) => xs.map((x) => source(x).open).join(""),
    closes: (xs: Wrapper[]) =>
      [...xs]
        .reverse()
        .map((x) => source(x).close)
        .join(""),
    bareOpens: (xs: Wrapper[]) => xs.map((x) => bare(x).open).join(""),
    bareCloses: (xs: Wrapper[]) =>
      [...xs]
        .reverse()
        .map((x) => bare(x).close)
        .join(""),
    bare,
  };
};

/**
 * Edits that make calls of the delimiters of the marks cut at `a` and at `b`, as their pieces are
 * written (those `mark` comes off lose theirs).
 */
const asCalls = (mark: Mark, a: Wrapper[], b: Wrapper[]): TextEdit[] => {
  const edits: TextEdit[] = [];
  for (const x of new Set([...a, ...b])) {
    if (!x.delimiter) continue;
    const mine = matches(x, mark);
    if (!mine || a.includes(x)) edits.push({ from: x.from, to: x.innerFrom, insert: `#${x.name}[` });
    if (!mine || b.includes(x)) edits.push({ from: x.innerTo, to: x.to, insert: "]" });
  }
  return edits;
};

/** Edits that take `mark` off `[from, to)`, splitting wrappers around it. */
const removeEdits = (
  state: EditorState,
  mark: Mark,
  from: number,
  to: number,
  schema: EditorSchema = DEFAULT_SCHEMA,
): TextEdit[] => {
  const text = state.text;
  const ws = wrappers(state);
  const edits: TextEdit[] = [];
  let covered = -1;
  for (const w of ws) {
    // The outermost wrappers of the mark: those inside them go with them.
    if (!matches(w, mark) || w.innerTo <= from || w.innerFrom >= to || w.from < covered) continue;
    covered = w.to;
    const a = cutAt(state, w, Math.max(from, w.innerFrom), -1, schema);
    const b = cutAt(state, w, Math.min(to, w.innerTo), 1, schema);
    if (b.at <= a.at) continue;
    const p = parts(state, mark, w);
    const pre = text.slice(w.innerFrom, a.at).trim() !== "";
    const post = text.slice(b.at, w.innerTo).trim() !== "";
    // The selected text itself stays put, so the selection does too. Marks open at a cut end
    // with the wrapper and start again after it: `#strike[#sub[ab]]#sub[c]`, never `#strike[#sub[ab]c]`.
    const before = (pre ? p.closes(a.open) + p.self.close : "") + p.kept.open + p.bareOpens(a.open);
    const after = p.bareCloses(b.open) + p.kept.close + (post ? p.self.open + p.opens(b.open) : "");
    edits.push({ from: w.from, to: w.innerFrom, insert: pre ? p.self.open : "" });
    if (before) edits.push({ from: a.at, to: a.at, insert: before });
    if (after) edits.push({ from: b.at, to: b.at, insert: after });
    edits.push({ from: w.innerTo, to: w.to, insert: post ? p.self.close : "" }, ...asCalls(mark, a.open, b.open));
    // Wrappers of the mark inside it lose it too, where they are in the range.
    for (const x of ws) {
      if (x === w || x.from < w.innerFrom || x.to > w.innerTo || !matches(x, mark)) continue;
      if (x.to <= a.at || x.from >= b.at) continue;
      if (!a.open.includes(x)) edits.push({ from: x.from, to: x.innerFrom, insert: p.bare(x).open });
      if (!b.open.includes(x)) edits.push({ from: x.innerTo, to: x.to, insert: p.bare(x).close });
    }
  }
  // A `_` left between letters by a call gone from around it (`un#strong[_be_]lievable`) is a call too.
  return [...edits, ...guardDelimiters(state, edits)];
};

/**
 * Takes `mark` off at a caret inside it: the wrapper ends before the caret and starts again after
 * it, and the marks between the two stay around the caret, empty, for what is typed there.
 */
const removeAt = (state: EditorState, mark: Mark, schema: EditorSchema): Transaction | null => {
  const at = state.from;
  const text = state.text;
  const w = wrappers(state).find((w) => matches(w, mark) && w.innerFrom <= at && at <= w.innerTo);
  if (!w) return null;
  // A caret in something that can't be cut (it shouldn't be): the mark comes off that.
  const a = cutAt(state, w, at, -1, schema);
  const b = cutAt(state, w, at, 1, schema);
  if (a.at < b.at) {
    const edits = removeEdits(state, mark, a.at, b.at, schema);
    return { edits, selection: mapSel(state.selection, edits) };
  }
  // A mark that would be left empty on one side of the caret doesn't end there: it starts after
  // the caret (or ends before it) instead.
  const here = cutAt(state, w, at, 1, schema, "none");
  const left = cutAt(state, w, at, -1, schema, "start");
  const right = cutAt(state, w, at, 1, schema, "end");
  const p = parts(state, mark, w);
  const pre = text.slice(w.innerFrom, left.at).trim() !== "";
  const post = text.slice(right.at, w.innerTo).trim() !== "";
  const before = (pre ? p.closes(left.open) + p.self.close : "") + p.kept.open + p.bareOpens(here.open);
  const after = p.bareCloses(here.open) + p.kept.close + (post ? p.self.open + p.opens(right.open) : "");
  const edits = [
    { from: w.from, to: w.innerFrom, insert: pre ? p.self.open : "" },
    { from: left.at, to: right.at, insert: before + after },
    { from: w.innerTo, to: w.to, insert: post ? p.self.close : "" },
    // Not the delimiters at the caret, which the pieces written there replace.
    ...asCalls(mark, left.open, right.open).filter((e) => e.to <= left.at || e.from >= right.at),
  ].sort((a, b) => a.from - b.from || a.to - b.to);
  const grown = edits.filter((e) => e.from < left.at).reduce((n, e) => n + e.insert.length - (e.to - e.from), 0);
  return { edits, selection: caretAt(left.at + grown + before.length) };
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

/** The marks Typst has delimiters for. */
const DELIMITERS: Record<string, string | undefined> = { strong: "*", emph: "_" };

/**
 * Whether `delimiter` (`*`, `_`) can wrap `[from, to)`: not between letters, where Typst reads it
 * as text, nor beside another of it (`_a__b_` is not two pieces of italic).
 */
const delimiterFits = (text: string, from: number, to: number, delimiter: string): boolean => {
  const word = (c: string | undefined) => c !== undefined && (c === delimiter || /[\p{L}\p{N}]/u.test(c));
  return !word(text[from - 1]) && !word(text[to]) && !/\s/.test(text[from] ?? " ") && !/\s/.test(text[to - 1] ?? " ");
};

/**
 * The marks around exactly the text of `[from, to)`, innermost first: those a command changes
 * rather than writing another inside or around them.
 */
const exactWrappers = (state: EditorState, from: number, to: number, schema: EditorSchema): Wrapper[] => {
  const shown = unitsFor(state, schema).filter((u) => u.kind !== "space" && u.kind !== "break");
  const first = shown.find((u) => u.from >= from);
  const last = findLast(shown, (u) => u.to <= to);
  if (!first || !last || first.from > last.from) return [];
  return [...wrappers(state)]
    .reverse()
    .filter(
      (w) =>
        splits(w, schema) &&
        w.innerFrom <= first.from &&
        last.to <= w.innerTo &&
        shown.find((u) => u.from >= w.innerFrom) === first &&
        findLast(shown, (u) => u.to <= w.innerTo) === last,
    );
};

/** Edits that put `mark` on `[from, to)`, which has none of it. */
const addEdits = (
  state: EditorState,
  mark: Mark,
  value: string | true,
  from: number,
  to: number,
  schema: EditorSchema,
): TextEdit[] => {
  const text = state.text;
  if (mark.arg && value !== true) {
    // A call of the function around exactly this text (a `text` with a size taking a colour or
    // a font) takes the argument: one call, not one inside the other. Not a call with something
    // else in front of its text (`#text(red)[…]` stays as written).
    const arg = mark.arg;
    const exact = exactWrappers(state, from, to, schema).find(
      (w) => w.name === mark.name && !w.delimiter && w.positional.length === 0,
    );
    if (exact) return [{ from: exact.from, to: exact.innerFrom, insert: withArg(exact, arg, value) }];
  }
  const edits: TextEdit[] = [];
  for (const seg of segments(state, from, to, schema)) {
    const delimiter = DELIMITERS[mark.name];
    const fits = delimiter !== undefined && delimiterFits(text, seg.from, seg.to, delimiter);
    const open = fits ? delimiter : opening(mark, value === true ? null : value);
    const close = fits ? delimiter : "]";
    edits.push({ from: seg.from, to: seg.from, insert: open }, { from: seg.to, to: seg.to, insert: close });
  }
  return edits.sort((a, b) => a.from - b.from || a.to - b.to);
};

/** Whether two wrappers are the same mark with the same arguments. */
const alike = (a: Wrapper, b: Wrapper): boolean =>
  a.name === b.name &&
  a.positional.join() === b.positional.join() &&
  a.args.size === b.args.size &&
  [...a.args].every(([k, v]) => b.args.get(k) === v);

/**
 * The state with the wrappers of `mark` a command left side by side at the selection made one:
 * bold put back on the `b` of `b#strong[old]` gives `*bold*`, not `*b*#strong[old]`.
 */
const joined = (state: EditorState, mark: Mark, schema: EditorSchema): EditorState => {
  // Not where a delimiter inside would meet the other's text: `*_a_b*` has no italic.
  const meet = (a: Wrapper, b: Wrapper, text: string) => /[*_]/.test(`${text[a.innerTo - 1]}${text[b.innerFrom]}`);
  for (let s = state; ; ) {
    const ws = wrappers(s).filter((w) => w.name === mark.name && splits(w, schema));
    const pair = ws
      .map((a) => [a, ws.find((b) => b.from === a.to)] as const)
      .find(([a, b]) => b && alike(a, b) && !meet(a, b, s.text) && a.from <= s.to && b.to >= s.from);
    const [a, b] = pair ?? [];
    if (!a || !b) return s;
    const edits: TextEdit[] = [{ from: a.innerTo, to: b.innerFrom, insert: "" }];
    const delimiter = DELIMITERS[a.name];
    if (delimiter !== undefined && a.args.size + a.positional.length === 0) {
      // Delimiters again where they read as such.
      const inner = s.text.slice(a.innerFrom, a.innerTo) + s.text.slice(b.innerFrom, b.innerTo);
      const nested = ws.some((x) => x.name === a.name && x.from >= a.innerFrom && x.to <= b.innerTo && x !== b);
      const fits = delimiterFits(s.text, a.from, b.to, delimiter) && inner.trim() === inner && !nested;
      edits.unshift({ from: a.from, to: a.innerFrom, insert: fits ? delimiter : `#${a.name}[` });
      edits.push({ from: b.innerTo, to: b.to, insert: fits ? delimiter : "]" });
    }
    s = s.apply({ edits, selection: mapSel(s.selection, edits) }).state;
  }
};

/** Marks of which text has one at most: putting one on takes the other off. */
const EXCLUSIVE = new Map([
  ["sub", "super"],
  ["super", "sub"],
]);

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
    if (state.selection.node) return null;
    // The steps of the command, each on the state the one before left; one transaction.
    let end = state;
    const steps: Transaction[] = [];
    const step = (tr: Transaction | null) => {
      if (!tr || tr.edits.length === 0) return;
      end = end.apply(tr).state;
      steps.push(tr);
    };
    const edit = (edits: TextEdit[]) => step({ edits, selection: mapSel(end.selection, edits) });
    const done = (): Transaction => {
      // One step's edits as they are (the selected text stays put); more, as one edit.
      if (steps.length === 1 && end.text === state.apply(steps[0] as Transaction).state.text)
        return steps[0] as Transaction;
      const all = diffEdit(state.text, end.text);
      return { edits: all ? [all] : [], selection: end.selection };
    };
    // Subscript on superscript text replaces it.
    const other = value === null ? undefined : EXCLUSIVE.get(mark.name);
    if (state.empty) {
      // A caret: an empty wrapper to type into, or a split of the wrapper it is in.
      if (other) step(removeAt(end, { name: other }, schema));
      if (value === null) step(removeAt(end, mark, schema));
      else {
        const open = opening(mark, value === true ? null : value);
        step({
          edits: [{ from: end.from, to: end.from, insert: `${open}]` }],
          selection: caretAt(end.from + open.length),
        });
      }
      return steps.length ? done() : null;
    }
    if (other) edit(removeEdits(end, { name: other }, end.from, end.to, schema));
    const on = wrappers(end).filter((w) => matches(w, mark) && w.innerTo > end.from && w.innerFrom < end.to);
    const exact = exactWrappers(end, end.from, end.to, schema).find((w) => matches(w, mark));
    if (mark.arg && typeof value === "string" && exact && on.every((w) => w === exact)) {
      // The one wrapper of the mark here is around exactly this text: its value changes, in its
      // place, whatever other marks are inside it.
      edit([{ from: exact.from, to: exact.innerFrom, insert: withArg(exact, mark.arg, value) }]);
    } else {
      // Off first (no nested wrappers of one mark), then on.
      edit(removeEdits(end, mark, end.from, end.to, schema));
      if (value !== null) edit(addEdits(end, mark, value, end.from, end.to, schema));
    }
    if (value !== null) end = joined(end, mark, schema);
    return steps.length ? done() : { edits: [], selection: state.selection };
  };

// ---------------------------------------------------------------------------
// Fonts

const FONT: Mark = { name: "text", arg: "font" };

/** The family a `font` argument names (the first of a list): `"Lora"`, `("Lora", "Noto Sans")`. */
const familyOf = (source: string): string | null => {
  const first = /"(?:[^"\\]|\\.)*"/.exec(source)?.[0];
  return first ? readString(first) : null;
};

/** The document's own `#set text(…)` rules that name a font (not those inside components), in order. */
const fontRules = (state: EditorState) => {
  const text = state.text;
  const kids = state.tree.children;
  const out: { from: number; to: number; value: SyntaxNode; named: SyntaxNode; args: SyntaxNode; alone: boolean }[] =
    [];
  for (let i = 0; i + 1 < kids.length; i++) {
    const rule = kids[i + 1] as SyntaxNode;
    if ((kids[i] as SyntaxNode).kind !== "Hash" || rule.kind !== "SetRule") continue;
    const callee = rule.children.find((c) => c.kind === "Ident");
    const args = callArgs(rule, text);
    const value = args?.named.get("font");
    const named = args?.namedNodes.get("font");
    // A conditional rule (`set text(…) if …`) isn't the document's font.
    if (!callee || text.slice(callee.from, callee.to) !== "text" || !args || !value || !named) continue;
    if (rule.children.some((c) => c.kind === "If")) continue;
    const alone = args.named.size + args.positional.length === 1;
    out.push({ from: (kids[i] as SyntaxNode).from, to: rule.to, value, named, args: args.node, alone });
  }
  return out;
};

/**
 * The font family at the selection: that of the `#text(font: …)[…]` around it, else the document's
 * (its last `#set text(font: …)` before the selection). `null` when the selection is in more than
 * one, or the document names none (Typst's own, or its template's).
 * @beta
 */
export const fontAt = (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA): string | null => {
  const { from, to } = state;
  const v = markValue(state, FONT, from, to, schema);
  if (typeof v === "string") return familyOf(v);
  // Part of the selection in a font of its own: no one family.
  if (wrappers(state).some((w) => matches(w, FONT) && w.innerFrom < to && w.innerTo > from)) return null;
  const rule = fontRules(state)
    .filter((r) => r.from <= from)
    .at(-1);
  return rule ? familyOf(state.text.slice(rule.value.from, rule.value.to)) : null;
};

/** What a document starts with that shows nothing: its imports, bindings and rules. */
const RULE = /^#(?:import|set|show|let)\b/;

/**
 * The rule that sets the whole document's font, where it goes: after the imports and rules the
 * document starts with, before its template (`#show: exam.with(…)`, whose title then follows the
 * font too) or its first text.
 */
const documentRule = (state: EditorState, value: string): TextEdit => {
  const kids = state.tree.children;
  let i = 0;
  let at = 0;
  while (i < kids.length) {
    const c = kids[i] as SyntaxNode;
    if (c.kind === "Hash" && PREAMBLE.has((kids[i + 1] as SyntaxNode | undefined)?.kind as SyntaxKind)) {
      at = (kids[i + 1] as SyntaxNode).to;
      i += 2;
    } else if (c.kind === "Space" || c.kind === "Parbreak" || c.kind === "LineComment" || c.kind === "BlockComment")
      i++;
    else break;
  }
  const rule = `#set text(font: ${value})`;
  // On a line of its own after the last of them; else the document's first line, text after a blank one.
  if (at > 0) return { from: at, to: at, insert: `\n${rule}` };
  const next = kids[i];
  const template = next?.kind === "Hash" && kids[i + 1]?.kind === "ShowRule";
  return { from: 0, to: 0, insert: `${rule}${template ? "\n" : "\n\n"}` };
};

/**
 * Sets the font family of the selection (`null`: the document's own again). A selection of the
 * whole document changes the document's font instead, as its own `#set text(font: …)`: titles,
 * numbers and what components draw follow it, which wrapping every paragraph wouldn't reach.
 * @beta
 */
export const setFont =
  (family: string | null) =>
  (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA): Transaction | null => {
    if (state.selection.node) return null;
    const value = family === null ? null : typstString(family);
    const { from, to } = state;
    const text = state.text;
    // Everything the document shows: its text and components, not its rules or its template's fields.
    const body = bodyStart(state.tree);
    const shown = unitsFor(state, schema).filter(
      (u) => u.from >= body && (u.kind === "char" || (u.kind === "atom" && !RULE.test(text.slice(u.from, u.from + 8)))),
    );
    const whole = from < to && shown.length > 0 && shown.every((u) => u.from >= from && u.to <= to);
    if (!whole) return setMark(FONT, value)(state, schema);
    // No passage keeps a font of its own, and one rule names the document's.
    const edits = removeEdits(state, FONT, from, to, schema);
    const rules = fontRules(state);
    for (const [i, r] of rules.entries()) {
      if (i === 0 && value !== null) edits.push({ from: r.value.from, to: r.value.to, insert: value });
      else if (r.alone) {
        // Its line with it; at the document's start, the blank line after it too.
        let end = r.to;
        while (text[end] === "\n" && (r.from === 0 || end === r.to)) end++;
        edits.push({ from: r.from, to: end, insert: "" });
      } else {
        // The argument with the comma on one side of it.
        const kids = r.args.children.filter((c) => c.kind !== "Space" && c.kind !== "Comma");
        const at = kids.indexOf(r.named);
        const next = kids[at + 1];
        const prev = kids[at - 1];
        if (next && next.kind !== "RightParen") edits.push({ from: r.named.from, to: next.from, insert: "" });
        else if (prev) edits.push({ from: prev.to, to: r.named.to, insert: "" });
      }
    }
    if (rules.length === 0 && value !== null) edits.push(documentRule(state, value));
    if (edits.length === 0) return null;
    const sorted = edits.sort((a, b) => a.from - b.from || a.to - b.to);
    return { edits: sorted, selection: mapSel(state.selection, sorted) };
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
  // A caret: the link around it. A selection: the link around its text.
  const p = state.empty ? { from: state.from, to: state.from } : pieces(state, state.from, state.to, schema)[0];
  if (!p) return null;
  const w = wrappers(state)
    .filter((w) => w.name === "link" && w.innerFrom <= p.from && p.to <= w.innerTo)
    .at(-1);
  const url = w?.positional[0];
  return url ? (/^"((?:[^"\\]|\\.)*)"$/.exec(url)?.[1]?.replace(/\\(.)/g, "$1") ?? null) : null;
};

/**
 * A URL as typed, with the scheme it needs: `example.com` is `https://example.com`, an e-mail
 * address a `mailto:` link; one with a scheme, a path or an anchor stays.
 */
export const withScheme = (url: string): string => {
  const u = url.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) || /^[/#?.]/.test(u)) return u;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(u)) return `mailto:${u}`;
  return `https://${u}`;
};

/**
 * Whether a link's target would run code where the document is shown (`javascript:`, `data:`,
 * `vbscript:`), read as browsers read it: whatever the case, spaces and control characters dropped.
 */
const runsCode = (url: string): boolean => {
  const read = [...url].filter((c) => c.charCodeAt(0) > 0x20).join("");
  return /^(?:javascript|data|vbscript):/i.test(read);
};

/**
 * Makes the selection a link to `url` (`#link("…")[…]`), changes the link it is in, or takes links
 * off it with `null`. On a caret in a word, the word is the link's text; anywhere else, the URL is
 * written as its text. A target that would run code (`javascript:`, `data:`, `vbscript:`) is refused.
 * @beta
 */
export const setLink =
  (given: string | null) =>
  (state: EditorState, schema: EditorSchema = DEFAULT_SCHEMA): Transaction | null => {
    if (given !== null && runsCode(given)) return null;
    const url = given === null ? null : withScheme(given);
    const quoted = url === null ? null : `"${url.replace(/["\\]/g, "\\$&")}"`;
    const around = wrappers(state)
      .filter((w) => w.name === "link" && w.innerFrom <= state.from && state.to <= w.innerTo)
      .at(-1);
    if (around && quoted === null && (state.empty || (state.from <= around.innerFrom && around.innerTo <= state.to))) {
      // The link the caret (or the whole link) is in comes off whole: its text stays.
      const off = [
        { from: around.from, to: around.innerFrom, insert: "" },
        { from: around.innerTo, to: around.to, insert: "" },
      ];
      const edits = [...off, ...guardDelimiters(state, off)].sort((a, b) => a.from - b.from || a.to - b.to);
      return { edits, selection: mapSel(state.selection, edits) };
    }
    if (around && quoted !== null) {
      // Another URL for the link the selection is in.
      const edits = [{ from: around.from, to: around.innerFrom, insert: `#link(${quoted})[` }];
      return { edits, selection: mapSel(state.selection, edits) };
    }
    if (quoted === null) {
      const edits = removeEdits(state, { name: "link" }, state.from, state.to, schema);
      return edits.length ? { edits, selection: mapSel(state.selection, edits) } : null;
    }
    // A caret inside a word stands for the word.
    const word = state.empty ? wordAt(unitsFor(state, schema), state.text, state.from) : state;
    if (state.empty && !(word.from < state.from && state.from < word.to)) {
      const shown = escapeLinkText(url ?? "");
      const insert = `#link(${quoted})[${shown}]`;
      return { edits: [{ from: state.from, to: state.from, insert }], selection: caretAt(state.from + insert.length) };
    }
    const edits: TextEdit[] = [];
    for (const seg of segments(state, word.from, word.to, schema))
      edits.push(
        { from: seg.from, to: seg.from, insert: `#link(${quoted})[` },
        { from: seg.to, to: seg.to, insert: "]" },
      );
    const sorted = edits.sort((a, b) => a.from - b.from || a.to - b.to);
    return { edits: sorted, selection: mapSel(state.selection, sorted) };
  };

/** A URL as a link's text: markup's characters escaped. */
const escapeLinkText = (url: string): string => url.replace(/[\\*_`$#<>@[\]~/]/g, "\\$&");
