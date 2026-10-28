// An answer's edits applied to a document as they stream (#34, PLAN §5.2). The
// session holds the document the model saw (the snapshot) and the text with the
// answer's edits in it so far, which the app shows:
//
//   <Typstream source={state.text} streamingRange={state.streamingRange} isStreaming={state.streaming} />
//
// - While a quote streams, the text it matches is reported (`range`), for the app
//   to highlight what is about to change.
// - Once it is complete it must match one place, or the edit fails (`not-found`,
//   `ambiguous`) and the others still apply. A quote is looked up in the snapshot
//   and mapped through every edit since, so an edit made by the teacher while the
//   answer streams moves it, and one that touched it is a `conflict`.
// - A quote that runs to the end of a block's text, give or take closing
//   delimiters, streams its new text in: the block becomes a streaming range
//   (heal and the engine heal it as text being typed, the rest stays as it was).
//   The old text stays until the new text differs from it. A quote inside a block
//   is replaced once its new text is complete: written chunk by chunk, the rest of
//   its block would go missing meanwhile.
// - A stream that stops halfway rolls back the edit being written; complete ones
//   stay. Then the teacher keeps the answer or undoes it.

import { applyEdit, diffEdit, mapPosition, type Range, type TextEdit } from "@typstream/core";
import { blockStarts } from "@typstream/heal";
import { findQuote } from "./match";
import { type EditOp, parseEdits, stripFence } from "./parse";

/**
 * Where an edit is: {@link EditResult}'s `status`.
 * @public
 */
export type EditStatus = "quoting" | "writing" | "applied" | "failed" | "undone";

/**
 * Why an edit failed. `not-found`: its quote matches no place in the document;
 * `ambiguous`: several; `overlap`: it touches what an earlier edit of the answer
 * changed; `conflict`: the teacher edited that text while the answer streamed;
 * `malformed`: not written as `<edit><old>…</old><new>…</new></edit>`;
 * `incomplete`: the answer ended or was stopped before the edit did.
 * @public
 */
export type EditError = "not-found" | "ambiguous" | "overlap" | "conflict" | "malformed" | "incomplete";

/**
 * One edit of an answer, as the session applied it.
 * @public
 */
export interface EditResult {
  /** `quoting`, `writing`, `applied`, `failed` or `undone`. */
  status: EditStatus;
  /** Why it failed, with `status: "failed"`. */
  error?: EditError;
  /** The quote, as the model wrote it. */
  quote: string;
  /**
   * Where it is in the session's current text: while quoting, the text the
   * quote matches so far (when it matches one place); while writing and once
   * applied, the new text. `null` when there is none.
   */
  range: Range | null;
  /** Whether the quote matched only with whitespace evened out. */
  loose: boolean;
}

/**
 * An edit session's state: {@link EditSession.getState}.
 * @public
 */
export interface EditSessionState {
  /** The document with the answer's edits so far: `<Typstream source>`. */
  text: string;
  /** The block being written, if one is: `<Typstream streamingRange>`. */
  streamingRange: Range | null;
  /** Whether the block in `streamingRange` is still being written: `<Typstream isStreaming>`. */
  streaming: boolean;
  /** The answer's text outside its edits, for the teacher. */
  message: string;
  /** One result per edit of the answer, in its order. */
  edits: readonly EditResult[];
  /**
   * `streaming` while the answer arrives; `review` once it has ended (show Keep / Undo);
   * `kept` or `undone` after {@link EditSession.keep} or {@link EditSession.undo}.
   */
  phase: "streaming" | "review" | "kept" | "undone";
}

/**
 * Applies one answer's edits to a document as the answer streams:
 * {@link createEditSession}.
 * @public
 */
export interface EditSession {
  /**
   * The model's answer so far, with its `<edit>` tags (an AI SDK message's
   * {@link textOf}); `done` once it is complete. Call it as the answer grows.
   */
  update(answer: string, done?: boolean): void;
  /**
   * A selection edit: the model's replacement so far for `range`, which the app
   * picked (the teacher's highlight), widened to whole blocks ({@link blockRange}).
   * The replacement is plain Typst with no tags; `done` once it is complete.
   */
  write(range: Range, replacement: string, done?: boolean): void;
  /** The stream stopped (the teacher pressed stop, a network error): rolls back the edit being written. */
  abort(): void;
  /** An edit the teacher made to {@link EditSessionState.text} while the session is open. */
  userEdit(edit: TextEdit): void;
  /** Keeps the answer's edits: the session closes, the text stays. */
  keep(): void;
  /**
   * Undoes the answer's edits: the document goes back to the snapshot. After
   * edits of the teacher's, each of the answer's edits goes back to the text it
   * replaced, and one the teacher has edited since stays as it is.
   */
  undo(): void;
  /** The current state; the same object until it changes. */
  getState(): EditSessionState;
  /** Calls `listener` after every change; returns the unsubscribe function. */
  subscribe(listener: (state: EditSessionState) => void): () => void;
}

const isSpace = (c: string | undefined): boolean => c === " " || c === "\t" || c === "\n" || c === "\r";

/** The offset after `text[from, to)` with its trailing whitespace dropped. */
const trimEndAt = (text: string, from: number, to: number): number => {
  while (to > from && isSpace(text[to - 1])) to--;
  return to;
};

/**
 * `range` widened to the top-level blocks it touches: from the start of the
 * first to the end of the last one's text, without the blank line after it. A
 * selection edit rewrites this range; give its text to the model.
 * @public
 */
export const blockRange = (text: string, range: Range): Range => {
  const starts = blockStarts(text);
  let first = 0;
  let last = 0;
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i] as number;
    if (start <= range.from) first = i;
    if (start < Math.max(range.to, range.from + 1)) last = i;
  }
  const end = starts[last + 1] ?? text.length;
  return { from: starts[first] as number, to: Math.max(trimEndAt(text, starts[last] as number, end), range.to) };
};

// Closing delimiters and whitespace: what may follow a quote in its block for its new text
// to stream in. While it does, they are left out, and healing closes what they would.
const CLOSERS = /^[\s\])}$*_"`]*$/;

interface Op {
  result: EditResult;
  /** Where the quote matched in the snapshot. */
  target: Range | null;
  /** Whether a quote is given (an answer's edit) or the range is (a selection edit). */
  selection: Range | null;
  /** What the edit owns in the current text: the old text until it's replaced, then the new. */
  span: Range | null;
  /** The text `span` held before the edit replaced it, for a rollback or undo. */
  original: string;
  /** `stream`: written into a streaming range; `atomic`: replaced once complete. */
  mode: "stream" | "atomic" | null;
  /** In `stream` mode, the block text before and after the quote, which the edit keeps. */
  before: string;
  after: string;
  /** Whether the new text has replaced the old in the current text. */
  written: boolean;
  /** A teacher's edit touched the span after it was written. */
  touched: boolean;
}

/**
 * A session that applies one answer's edits to `text`, the document the model
 * was given, as the answer streams. Open one per answer, and feed it with
 * {@link EditSession.update} (or {@link EditSession.write} for a selection edit).
 * @public
 */
export const createEditSession = (text: string): EditSession => {
  const snapshot = text;
  let current = text;
  const log: (TextEdit & { user: boolean })[] = [];
  const ops: Op[] = [];
  let message = "";
  let phase: EditSessionState["phase"] = "streaming";
  let streamingRange: Range | null = null;
  let streaming = false;
  let state: EditSessionState | null = null;
  const listeners = new Set<(state: EditSessionState) => void>();

  /** Applies an edit to the current text, moving every op's span (but `self`'s) with it. */
  const change = (edit: TextEdit, user: boolean, self?: Op) => {
    current = applyEdit(current, edit);
    log.push({ ...edit, user });
    for (const op of ops) {
      if (op === self || !op.span) continue;
      const { from, to } = op.span;
      if (user && edit.from < to && edit.to > from) op.touched = true;
      if (user && edit.from === edit.to && edit.from > from && edit.from < to) op.touched = true;
      const a = mapPosition(from, edit, from === to ? -1 : 1);
      op.span = { from: a, to: Math.max(a, mapPosition(to, edit, -1)) };
    }
  };

  /** A snapshot range in the current text, or what kept it from getting there. */
  const mapped = (range: Range): Range | "overlap" | "conflict" => {
    let { from, to } = range;
    for (const edit of log) {
      const inside = edit.from === edit.to ? edit.from > from && edit.from < to : edit.from < to && edit.to > from;
      if (inside) return edit.user ? "conflict" : "overlap";
      from = mapPosition(from, edit, 1);
      to = Math.max(from, mapPosition(to, edit, -1));
    }
    return { from, to };
  };

  const fail = (op: Op, error: EditError) => {
    op.result = { ...op.result, status: "failed", error, range: null };
  };

  /** Puts the old text back where the edit has written its new text. */
  const rollback = (op: Op) => {
    if (op.written && op.span) change({ from: op.span.from, to: op.span.to, insert: op.original }, false, op);
    op.written = false;
    op.span = null;
    if (op.mode === "stream") endStream();
  };

  const endStream = () => {
    streamingRange = null;
    streaming = false;
  };

  /** The quote's place in the current text, once it is complete. */
  const resolve = (op: Op): Range | null => {
    const found = findQuote(snapshot, op.result.quote);
    if (found.ranges.length !== 1) {
      fail(op, found.ranges.length ? "ambiguous" : "not-found");
      return null;
    }
    const target = found.ranges[0] as Range;
    for (const other of ops) {
      if (other !== op && other.target && other.target.from < target.to && other.target.to > target.from) {
        fail(op, "overlap");
        return null;
      }
    }
    const range = mapped(target);
    if (typeof range === "string") {
      fail(op, range);
      return null;
    }
    op.target = target;
    op.result = { ...op.result, loose: !found.exact };
    return range;
  };

  /** Chooses how the edit is written, and the span it owns: the quote, or its whole blocks. */
  const place = (op: Op, range: Range) => {
    const whole = op.selection !== null;
    const block = whole ? range : blockRange(current, range);
    const after = current.slice(range.to, block.to);
    if (whole || CLOSERS.test(after)) {
      op.mode = "stream";
      op.before = current.slice(block.from, range.from);
      op.after = after;
      op.span = block;
    } else {
      op.mode = "atomic";
      op.span = range;
    }
    op.original = current.slice(op.span.from, op.span.to);
    op.result = { ...op.result, status: "writing", range: range };
  };

  /** Writes the new text so far (`done`: all of it) into the edit's span. */
  const write = (op: Op, raw: string, done: boolean) => {
    const span = op.span as Range;
    // While it streams, trailing whitespace may be the line break before `</new>`.
    const text = done ? raw : raw.trimEnd();
    const old = op.original.slice(op.before.length, op.original.length - op.after.length);
    if (!done && !op.written && (op.mode === "atomic" || old.startsWith(text))) return;
    if (op.mode === "atomic" || done) {
      const insert = op.mode === "stream" ? op.before + text + op.after : text;
      // Deleting whole blocks also takes the blank line that separated them.
      const whole = op.mode === "stream" && !insert.trim();
      const range = whole ? deletion(span) : span;
      op.original = current.slice(range.from, span.from) + op.original + current.slice(span.to, range.to);
      change({ from: range.from, to: range.to, insert }, false, op);
      op.span = { from: range.from, to: range.from + insert.length };
      op.written = true;
      if (op.mode === "stream") endStream();
      const start = op.span.from + (op.mode === "stream" ? op.before.length : 0);
      op.result = { ...op.result, status: "applied", range: { from: start, to: start + text.length } };
      return;
    }
    // Streaming: the block so far, its kept text before the quote and the new text.
    const region = op.before + text;
    const shown = current.slice(span.from, span.to);
    if (op.written && region.startsWith(shown)) {
      change({ from: span.to, to: span.to, insert: region.slice(shown.length) }, false, op);
    } else if (region !== shown) {
      change({ from: span.from, to: span.to, insert: region }, false, op);
    }
    op.span = { from: span.from, to: span.from + region.length };
    op.written = true;
    streamingRange = op.span;
    streaming = true;
    const start = span.from + op.before.length;
    op.result = { ...op.result, range: { from: start, to: start + text.length } };
  };

  /** `span` with the whitespace after it, or before it at the end of the text. */
  const deletion = (span: Range): Range => {
    let to = span.to;
    while (isSpace(current[to])) to++;
    if (to < current.length) return { from: span.from, to };
    let from = span.from;
    while (from > 0 && isSpace(current[from - 1])) from--;
    return { from, to };
  };

  const newOp = (quote: string, selection: Range | null): Op => ({
    result: { status: "quoting", quote, range: null, loose: false },
    target: null,
    selection,
    span: null,
    original: "",
    mode: null,
    before: "",
    after: "",
    written: false,
    touched: false,
  });

  const settled = (op: Op) => op.result.status === "applied" || op.result.status === "failed";

  /** Moves one edit of the answer on with what has arrived of it. */
  const step = (op: Op, edit: EditOp, final: boolean) => {
    if (settled(op)) return;
    op.result = { ...op.result, quote: edit.quote };
    if (edit.malformed) return fail(op, "malformed");
    if (!edit.quoteDone) {
      if (final) return fail(op, "incomplete");
      const found = findQuote(snapshot, edit.quote);
      const range = found.ranges.length === 1 ? mapped(found.ranges[0] as Range) : null;
      op.result = { ...op.result, range: range && typeof range !== "string" ? range : null };
      return;
    }
    if (!op.span) {
      const range = resolve(op);
      if (!range) return;
      place(op, range);
    }
    if (final && !edit.done) {
      rollback(op);
      return fail(op, "incomplete");
    }
    write(op, edit.text, edit.done);
  };

  const notify = () => {
    state = null;
    const s = session.getState();
    for (const listener of listeners) listener(s);
  };

  /** Ends the answer: an edit still being written is rolled back. */
  const end = () => {
    for (const op of ops) {
      if (settled(op) || op.result.status === "undone") continue;
      rollback(op);
      fail(op, "incomplete");
    }
    endStream();
    phase = "review";
  };

  const session: EditSession = {
    update(answer, done = false) {
      if (phase !== "streaming") return;
      const parsed = parseEdits(answer, done);
      message = parsed.message;
      parsed.edits.forEach((edit, i) => {
        if (!ops[i]) ops[i] = newOp(edit.quote, null);
        step(ops[i] as Op, edit, done);
      });
      if (done) end();
      notify();
    },
    write(range, replacement, done = false) {
      if (phase !== "streaming") return;
      let op = ops[0];
      if (!op) {
        const target = blockRange(current, range);
        op = newOp(current.slice(target.from, target.to), target);
        op.target = target;
        ops.push(op);
        place(op, target);
      }
      if (!settled(op)) write(op, stripFence(replacement, done), done);
      if (done) end();
      notify();
    },
    abort() {
      if (phase !== "streaming") return;
      end();
      notify();
    },
    userEdit(edit) {
      change(edit, true);
      const writing = ops.find((op) => op.result.status === "writing");
      if (writing?.touched) {
        // The teacher is editing the block being written: it stays as it is, and the edit stops.
        writing.span = null;
        writing.written = false;
        fail(writing, "conflict");
        endStream();
      } else if (writing?.mode === "stream" && writing.written) streamingRange = writing.span;
      notify();
    },
    keep() {
      if (phase === "streaming") end();
      phase = "kept";
      notify();
    },
    undo() {
      if (phase === "streaming") end();
      if (phase !== "review") return;
      // Without the teacher's edits in between, the snapshot is exactly what was there.
      const back = log.some((edit) => edit.user) ? null : diffEdit(current, snapshot);
      if (back) change(back, false);
      for (const op of [...ops].reverse()) {
        if (op.result.status !== "applied" || op.touched) continue;
        if (back) op.written = false;
        rollback(op);
        op.result = { ...op.result, status: "undone", range: null };
      }
      phase = "undone";
      notify();
    },
    getState() {
      state ??= {
        text: current,
        streamingRange,
        streaming,
        message,
        edits: ops.map((op) => op.result),
        phase,
      };
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return session;
};
