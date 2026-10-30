// Undo and redo over the source. An entry holds the text and selection before and after a change;
// typing within a second of the last keystroke joins its entry, as word processors group words.

import type { Selection } from "./state";

interface Entry {
  before: string;
  after: string;
  selectionBefore: Selection;
  selectionAfter: Selection;
  time: number;
  merge: boolean;
}

/** How long typing keeps joining one entry (ms). */
const MERGE_MS = 1000;
/** Entries kept. */
const LIMIT = 300;

/**
 * The editor's undo history.
 * @beta
 */
export class History {
  private done: Entry[] = [];
  private undone: Entry[] = [];

  /** Records a change from `before` to `after`. `merge` joins typing into the entry before. */
  record(before: string, after: string, selectionBefore: Selection, selectionAfter: Selection, merge = false, now = Date.now()): void {
    if (before === after) return;
    const last = this.done[this.done.length - 1];
    if (merge && last?.merge && last.after === before && now - last.time < MERGE_MS) {
      last.after = after;
      last.selectionAfter = selectionAfter;
      last.time = now;
    } else {
      this.done.push({ before, after, selectionBefore, selectionAfter, time: now, merge });
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
