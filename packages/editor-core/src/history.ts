// Undo and redo over the source. An entry holds the text and selection before and after a change.
// Typing joins the entry before it, as word processors group words: while the caret is where the
// last keystroke left it, up to a pause between words, and no further than a few words. A run of
// Backspaces is one entry likewise, apart from the typing before it.

import type { Selection } from "./state";

interface Entry {
  before: string;
  after: string;
  selectionBefore: Selection;
  selectionAfter: Selection;
  /** When it started, and when it last grew. */
  start: number;
  time: number;
  merge: boolean;
  /** Whether it added text (typing) or took some away (Backspace): the two don't join. */
  grows: boolean;
}

/** How long typing keeps joining one entry (ms). */
const MERGE_MS = 1000;
/** After a pause this long, the space after a word starts a new entry (ms). */
const WORD_PAUSE_MS = 300;
/** An entry this old ends with the word being typed (ms). */
const GROUP_MS = 2500;

const isSpace = (c: string | undefined): boolean => c === undefined || /[\s~]/.test(c);
/** Entries kept. */
const LIMIT = 300;

/**
 * The editor's undo history.
 * @beta
 */
export class History {
  private done: Entry[] = [];
  private undone: Entry[] = [];

  /**
   * Records a change from `before` to `after`. `merge` joins typing into the entry before; `now`
   * is the time of the change (ms).
   */
  record(
    before: string,
    after: string,
    selectionBefore: Selection,
    selectionAfter: Selection,
    merge = false,
    now = Date.now(),
  ): void {
    if (before === after) return;
    const last = this.done[this.done.length - 1];
    const grows = after.length > before.length;
    // The typed character is the space after a word: where an entry can end.
    const at = selectionAfter.head;
    const boundary = grows && isSpace(after[at - 1]) && !isSpace(after[at - 2]);
    const joins =
      merge &&
      last?.merge &&
      last.after === before &&
      last.grows === grows &&
      now - last.time < MERGE_MS &&
      // The caret is where the entry left it: a click or an arrow key since ends the entry.
      selectionBefore.anchor === selectionBefore.head &&
      last.selectionAfter.head === selectionBefore.head &&
      !(boundary && (now - last.time > WORD_PAUSE_MS || now - last.start > GROUP_MS));
    if (last && joins) {
      last.after = after;
      last.selectionAfter = selectionAfter;
      last.time = now;
    } else {
      this.done.push({ before, after, selectionBefore, selectionAfter, start: now, time: now, merge, grows });
      if (this.done.length > LIMIT) this.done.shift();
    }
    this.undone = [];
  }

  /** The text and selection to go back to, if `current` is where the last entry left off. */
  undo(current: string): { text: string; selection: Selection } | null {
    const entry = this.done.pop();
    if (!entry || entry.after !== current) {
      // Changed from outside since: the history no longer applies.
      if (entry) this.done = [];
      return null;
    }
    this.undone.push(entry);
    return { text: entry.before, selection: entry.selectionBefore };
  }

  /** The text and selection to go forward to. */
  redo(current: string): { text: string; selection: Selection } | null {
    const entry = this.undone.pop();
    if (!entry || entry.before !== current) {
      if (entry) this.undone = [];
      return null;
    }
    this.done.push({ ...entry, merge: false });
    return { text: entry.after, selection: entry.selectionAfter };
  }

  /** Whether there is something to undo. */
  get canUndo(): boolean {
    return this.done.length > 0;
  }

  /** Whether there is something to redo. */
  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  /** Forgets everything (a new document). */
  clear(): void {
    this.done = [];
    this.undone = [];
  }
}
