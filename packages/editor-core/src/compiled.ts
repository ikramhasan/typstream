// The text the engine compiles for the editor: the editor's own, with insertions that are never
// part of the source. The caret's placeholder (where Typst lays out nothing beside the caret, see
// `caretAnchor`), and markers around calls that show none of the document (a number line, answer
// lines, an `mcq` of `ce()` options): Typst draws a component made in its package with spans in the
// package, so the engine's positions can't say where it went. A `#metadata` beside it is the
// document's own, is placed where the call's content starts and ends, and lays nothing out (the same
// pages, glyph for glyph). Offsets go between the two texts through the insertions.

import type { SyntaxNode } from "@typstream/syntax";
import { caretAnchor, type EditorSchema } from "./commands";
import type { EditorState } from "./state";
import { calleeName } from "./tree";

/** What the editor inserts: the caret's placeholder, or a marker before (`open`) or after (`close`) a call. */
export interface Insertion {
  /** Where, in the editor's text. */
  at: number;
  /** What. */
  text: string;
  /** Which. */
  kind: "open" | "close" | "caret";
  /** A `close` marker's call's end, when the marker is further on (after the call's label). */
  of?: number;
  /** Where it is in the compiled text. */
  start: number;
}

/** A compiled text: the editor's (`plain`) with its insertions. */
export interface Compiled {
  text: string;
  plain: string;
  inserts: Insertion[];
}

/** The caret's placeholder: a glyph, invisible (a zero-width space has the line's height but no glyph). */
export const PLACEHOLDER = "\u00a0";

/** A marker: placed, tagged, laid out as nothing. */
export const MARKER = '#metadata("typstream")';

/** At most this many calls get markers: they cost nothing to lay out, but each is an insertion to map through. */
const MAX_MARKERS = 400;

/** Calls (`#name(…)`), not rules, bindings or imports, which a marker beside could change. */
const CALL = /^#[\p{L}_][\p{L}\p{N}_.-]*\(/u;

/** Calls that get no markers: a column break at the end of a page's last column would start a page for one after it. */
const UNMARKED = new Set(["colbreak"]);

// Of two insertions at one place: a call's end marker, then the caret's placeholder, then the next call's start marker.
const RANK = { close: 0, caret: 1, open: 2 } as const;

/** The text to compile for `state`: its placeholder only while the editor has focus. */
export const compile = (state: EditorState, schema: EditorSchema, focused: boolean): Compiled => {
  const plain = state.text;
  const inserts: Omit<Insertion, "start">[] = [];
  let markers = 0;
  // Every call set in markup that isn't a text style: one that shows none of the document (a
  // number line), or whose content may not show (answer lines with their hidden answer).
  const visit = (node: SyntaxNode) => {
    const kids = node.children;
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i] as SyntaxNode;
      const call = kids[i + 1];
      if (node.kind === "Markup" && c.kind === "Hash" && call?.kind === "FuncCall" && markers < MAX_MARKERS) {
        const name = calleeName(call, plain);
        if (
          name !== null &&
          !schema.marks.has(name) &&
          !UNMARKED.has(name) &&
          CALL.test(plain.slice(c.from, c.from + 64))
        ) {
          markers++;
          // A label after the call (on its line or a later one: Typst skips spaces and paragraph
          // breaks) is the call's: a marker between them would take it (`@fig` would then
          // reference metadata), so the end marker goes after the label.
          let j = i + 2;
          while (kids[j]?.kind === "Space" || kids[j]?.kind === "Parbreak") j++;
          const label = kids[j]?.kind === "Label" ? kids[j] : undefined;
          inserts.push(
            { at: c.from, text: MARKER, kind: "open" },
            label
              ? { at: label.to, text: MARKER, kind: "close", of: call.to }
              : { at: call.to, text: MARKER, kind: "close" },
          );
        }
      }
      if (c.children.length) visit(c);
    }
  };
  visit(state.tree);
  const caret = focused ? caretAnchor(state, schema) : null;
  if (caret !== null) inserts.push({ at: caret, text: PLACEHOLDER, kind: "caret" });
  inserts.sort((a, b) => a.at - b.at || RANK[a.kind] - RANK[b.kind]);
  let text = "";
  let last = 0;
  const placed: Insertion[] = [];
  for (const ins of inserts) {
    text += plain.slice(last, ins.at);
    placed.push({ ...ins, start: text.length });
    text += ins.text;
    last = ins.at;
  }
  text += plain.slice(last);
  return { text, plain, inserts: placed };
};

/**
 * An offset of the editor's text in the compiled text: past a call's end marker, before the caret's
 * placeholder and the next call's start marker (the glyph after the offset comes after the former).
 */
export const toCompiled = (c: Compiled, at: number): number => {
  let shift = 0;
  for (const ins of c.inserts) {
    if (ins.at > at || (ins.at === at && ins.kind !== "close")) break;
    shift += ins.text.length;
  }
  return at + shift;
};

/** A compiled text's offset in the editor's text: inside an insertion, where it was inserted. */
export const fromCompiled = (c: Compiled, offset: number): number => {
  let shift = 0;
  for (const ins of c.inserts) {
    if (offset < ins.start) break;
    if (offset < ins.start + ins.text.length) return ins.at;
    shift += ins.text.length;
  }
  return offset - shift;
};

/** The markers' places in the compiled text for the call at `[from, to)` of the editor's text, if it has them. */
export const markersOf = (c: Compiled, from: number, to: number): { open: number; close: number } | null => {
  const open = c.inserts.find((i) => i.kind === "open" && i.at === from);
  const close = c.inserts.find((i) => i.kind === "close" && (i.of ?? i.at) === to);
  return open && close ? { open: open.start, close: close.start } : null;
};
