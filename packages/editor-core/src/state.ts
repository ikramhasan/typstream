// The editor's state: the Typst source (the document, PLAN §10.1), its syntax tree and the
// selection. Commands don't change it; they return a transaction (edits to the source and the
// selection after them), and applying one makes a new state and the single `TextEdit` the engine
// and the history get.

import type { TextEdit } from "@typstream/core";
import { parse, type SyntaxNode } from "@typstream/syntax";

/**
 * A selection in the source: `anchor` where it started, `head` where the caret is. With `node`,
 * `[from, to)` is a component selected whole (a table, a question, an equation).
 * @beta
 */
export interface Selection {
  /** Where the selection started (UTF-16 offset). */
  anchor: number;
  /** Where it ends: the caret. */
  head: number;
  /** A component selected whole rather than text. */
  node?: boolean;
}

/**
 * Edits to a state's text and the selection after them. `edits` are in the old text, and don't
 * overlap. Without `selection`, the old one is mapped through the edits.
 * @beta
 */
export interface Transaction {
  /** What changes, in the text before. */
  edits: TextEdit[];
  /** The selection afterwards, in the text after. */
  selection?: Selection;
  /** Join the history entry before (typing). */
  merge?: boolean;
}

/**
 * The document being edited: its source, syntax tree and selection. Immutable; `apply` makes the
 * next one.
 * @beta
 */
export class EditorState {
  /** The Typst source. */
  readonly text: string;
  /** The selection. */
  readonly selection: Selection;
  private parsed: SyntaxNode | null;

  constructor(text: string, selection: Selection = { anchor: 0, head: 0 }, tree?: SyntaxNode) {
    this.text = text;
    const clamp = (n: number) => Math.max(0, Math.min(n, text.length));
    this.selection = { ...selection, anchor: clamp(selection.anchor), head: clamp(selection.head) };
    this.parsed = tree ?? null;
  }

  /** Typst's syntax tree of the text, parsed on first use. */
  get tree(): SyntaxNode {
    this.parsed ??= parse(this.text);
    return this.parsed;
  }

  /** Start of the selection. */
  get from(): number {
    return Math.min(this.selection.anchor, this.selection.head);
  }

  /** End of the selection. */
  get to(): number {
    return Math.max(this.selection.anchor, this.selection.head);
  }

  /** Whether the selection is a caret. */
  get empty(): boolean {
    return this.selection.anchor === this.selection.head;
  }

  /** The state with another selection. */
  select(selection: Selection): EditorState {
    return new EditorState(this.text, selection, this.parsed ?? undefined);
  }

  /** Applies `tr`: the new state, and the one edit it amounts to (`null` when the text is the same). */
  apply(tr: Transaction): { state: EditorState; edit: TextEdit | null } {
    const edits = normalize(tr.edits);
    if (edits.length === 0) return { state: this.select(tr.selection ?? this.selection), edit: null };
    let text = "";
    let at = 0;
    for (const e of edits) {
      text += this.text.slice(at, e.from) + e.insert;
      at = e.to;
    }
    text += this.text.slice(at);
    const first = edits[0] as TextEdit;
    const last = edits[edits.length - 1] as TextEdit;
    const shift = text.length - this.text.length;
    const edit: TextEdit = {
      from: first.from,
      to: last.to,
      insert: text.slice(first.from, last.to + shift),
      origin: "user",
    };
    const selection = tr.selection ?? mapSelection(this.selection, edits);
    return { state: new EditorState(text, selection), edit };
  }
}

/** Edits sorted and checked: no overlaps (touching is fine), no no-ops. */
const normalize = (edits: TextEdit[]): TextEdit[] => {
  const sorted = edits.filter((e) => e.from !== e.to || e.insert !== "").sort((a, b) => a.from - b.from || a.to - b.to);
  for (let i = 1; i < sorted.length; i++) {
    if ((sorted[i] as TextEdit).from < (sorted[i - 1] as TextEdit).to)
      throw new Error("@typstream/editor-core: overlapping edits in a transaction");
  }
  return sorted;
};

/**
 * Maps an offset in the old text through `edits` (sorted, in the old text, not overlapping). At an
 * insertion, `assoc` 1 moves past it and -1 stays before; inside a replaced range, to its end or
 * start.
 * @beta
 */
export const mapThrough = (pos: number, edits: readonly TextEdit[], assoc: 1 | -1 = 1): number => {
  let shift = 0;
  for (const e of edits) {
    if (pos < e.from) break;
    const delta = e.insert.length - (e.to - e.from);
    if (pos > e.to || (pos === e.to && e.from < e.to)) {
      shift += delta;
      continue;
    }
    if (e.from === e.to) {
      // An insertion at `pos`.
      if (assoc < 0) break;
      shift += e.insert.length;
      continue;
    }
    // Inside `[from, to)`.
    return e.from + shift + (assoc < 0 ? 0 : e.insert.length);
  }
  return pos + shift;
};

const mapSelection = (s: Selection, edits: TextEdit[]): Selection => ({
  anchor: mapThrough(s.anchor, edits, s.anchor <= s.head ? -1 : 1),
  head: mapThrough(s.head, edits, 1),
});
