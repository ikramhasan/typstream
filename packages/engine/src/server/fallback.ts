// Layer 4 in the worker: the fallback ladder (PLAN §5.6). When a text still
// fails after the fixers (Layer 3), the server can still publish an artifact
// if the client asked for one (`CompileParams.fallback`):
//
// - Block isolation (level 3). The text is split into top-level blocks at
//   heal's root checkpoints, where source anchors go (anchors.ts). State flows
//   forward through a document (a `#let` in one block is used in the next), so
//   the first failing block is found by compiling prefixes, bisecting: a
//   prefix of `k` blocks compiles, one of `k + 1` doesn't. That block becomes
//   `#typstream.error-block(source, message)` and the search goes on from
//   there: ⌈log₂ n⌉ check compiles per failing block, plus one compile of the
//   whole text with it replaced. Blocks with syntax errors need no compile:
//   heal's recognizer (Typst's parser) finds them. While streaming, only
//   settled blocks are isolated; the block still being written is the tail.
// - Stable prefix (level 2, streaming): when the settled blocks compile and the
//   tail doesn't, the settled text compiles with the tail as plain text below
//   (`#typstream.pending-text`). The client asks for it once its last good
//   render is stale.
// - Skipped ranges: parts the client found hang or crash the compiler (its
//   watchdog, PLAN §6.3) are error blocks from the start, never compiled.
// - Last resort (final): the whole document as one error block, showing its
//   source (level 4).
//
// References to labels are the one thing that flows backwards: a prefix that
// cites a label defined later fails. Probes ignore those errors; the compile of
// the whole text runs the fixers, whose `pending-ref` handles them.
//
// Level 1, the last good render, is mostly the client's: a failed compile
// publishes nothing. The server adds one case (#65): a streaming compile that
// succeeds but shows less of the tail than the last artifact did (`showsLess`)
// publishes nothing either. Heal and tail cut keep a text compiling by cutting
// what is still being typed, and a cut can take what already rendered with it:
// `..xs.map(x => (a, b` fails as an array of arrays until its `.flatten()`
// arrives, and tail cut drops the whole spread, rows that rendered included.

import {
  type CompileMode,
  type Diagnostic,
  isError,
  mapDiagnostic,
  type Range,
  type SkippedRange,
  type SourceMap,
  type TextEdit,
} from "@typstream/core";
import { recognize } from "@typstream/heal";
import { blockStarts } from "./anchors";
import { applyEdits } from "./fixers";
import { typstString } from "./runtime";

/** The longest source an error block shows, in UTF-16 units. */
const MAX_SOURCE = 2000;

/** `source` cut to {@link MAX_SOURCE}, not inside a surrogate pair. */
const clip = (source: string): string => {
  if (source.length <= MAX_SOURCE) return source;
  const code = source.charCodeAt(MAX_SOURCE - 1);
  return `${source.slice(0, code >= 0xd800 && code <= 0xdbff ? MAX_SOURCE - 1 : MAX_SOURCE)}…`;
};

/** End of `[from, to)` without its trailing whitespace: the blank lines after a block stay. */
const trimmedEnd = (text: string, from: number, to: number): number => {
  let end = to;
  while (end > from && /\s/.test(text[end - 1] as string)) end--;
  return end;
};

/** Replaces `[from, to)` of `text` (whitespace at its end kept) with an error block. */
const errorBlock = (text: string, { from, to }: Range, message: string): TextEdit => {
  const end = trimmedEnd(text, from, to);
  return {
    from,
    to: end,
    insert: `#typstream.error-block(${typstString(clip(text.slice(from, end)))}, ${typstString(message)})`,
  };
};

const LABEL = /^label `<.+>` does not exist in the document$/;

/** An error a prefix can't blame on itself: a reference to a label that may come later. */
const failing = (d: Diagnostic): boolean => isError(d) && !LABEL.test(d.message);

/**
 * An error that tells the text is at fault: one in it, or a compile the
 * engine stopped (`@typstream/node`'s watchdog). Errors without a place, such
 * as a broken preamble, fail every prefix alike.
 */
const blameable = (d: Diagnostic): boolean =>
  failing(d) && (d.span !== null || d.code === "timeout" || d.code === "engine-crashed");

/** Messages of the error blocks the client's skipped ranges become. */
export const SKIP_MESSAGES: Readonly<Record<SkippedRange["reason"], string>> = {
  timeout: "Compiling this part took too long.",
  crash: "Compiling this part crashed the engine.",
};

/** Diagnostics of skipped ranges, as `@typstream/node` reports a stopped compile. */
const skipDiagnostic = ({ from, to, reason }: SkippedRange): Diagnostic => ({
  severity: "error",
  span: { from, to },
  message: SKIP_MESSAGES[reason],
  hints: [],
  trace: [],
  source: "typstream",
  code: reason === "timeout" ? "timeout" : "engine-crashed",
});

/** A text made from the document, and how its positions map back. */
export interface Variant {
  text: string;
  toOriginal(pos: number, assoc?: 1 | -1): number;
}

/** What one compile of a variant told. */
export interface Attempt {
  ok: boolean;
  /** In the document's coordinates. */
  diagnostics: Diagnostic[];
  /** The text compiled last (the variant, or the fixers' text of it) and its positions in the document. */
  compiled: Variant;
}

/** What healing closes a construct with, and whitespace: text that shows nothing of its own. */
const CLOSERS = /^[\s)\]}"$*_`:\u200b]*$/;

/**
 * Level 1 (#65): whether a compile of `text` shows less of the unsettled tail
 * than the last artifact's compile of `shown` did. Past where the two texts
 * part, `shown` has more than closers, and they part at or after `settled`
 * (text positions map to the client's with `toOriginal`). A stream only
 * appends, so the text `shown` had there is still in the client's, cut by heal
 * or the fixers this time, or shown as plain text (the stable prefix); it
 * usually comes back within a few tokens. Before `settled` the client's text
 * changed (an edit), or a settled reference resolved: that shows.
 */
export const showsLess = (
  shown: string,
  text: string,
  toOriginal: (pos: number) => number,
  settled: number,
): boolean => {
  const max = Math.min(shown.length, text.length);
  let at = 0;
  while (at < max && shown.charCodeAt(at) === text.charCodeAt(at)) at++;
  return toOriginal(at) >= settled && !CLOSERS.test(shown.slice(at));
};

/**
 * What a document's earlier recoveries learnt: a prefix of its text that
 * compiles with the blocks isolated in it. A streamed document's settled text
 * only grows, so the next compile starts the search after it. The server drops
 * it when the document's files or inputs change.
 */
export interface RecoverMemo {
  /** Target and mode it was learnt for. */
  key: string;
  /** Text that compiles with `isolated` replaced. */
  prefix: string;
  isolated: Isolated[];
}

/** A block shown as an error block, and why. */
interface Isolated extends Range {
  diagnostics: Diagnostic[];
}

/** What the fallback needs from the server. */
export interface RecoverRun {
  /** The client's text. */
  text: string;
  /** Streaming: text before this offset is settled. Final: the text's length. */
  settled: number;
  mode: CompileMode;
  /** {@link FallbackParams}. */
  isolate: boolean;
  stablePrefix: boolean;
  /** Validated: ascending, not overlapping, inside the text. */
  skip: readonly SkippedRange[];
  /**
   * Errors of the text as it is, after the fixers (document coordinates), or
   * `null` when it wasn't compiled (with `skip`, the first compile is the fallback's).
   */
  errors: Diagnostic[] | null;
  /** Compiles a variant whole, with the fixers (Layer 3), for an artifact. `settled` is in the variant. */
  attempt(variant: Variant, settled: number): Promise<Attempt>;
  /** Compiles a variant only to check it; its errors in the document's coordinates. */
  check(variant: Variant): Promise<Diagnostic[]>;
  /** No compile starts after this `performance.now()`. */
  deadline: number;
  /** In and out: see {@link RecoverMemo}. */
  memo: RecoverMemo | null;
  memoKey: string;
}

/** A recovered artifact's provenance. */
export interface Recovered {
  /** `CompileFallback.level`. */
  level: 2 | 3 | 4;
  /** The successful attempt's diagnostics, the isolated errors, and skipped ranges; document coordinates. */
  diagnostics: Diagnostic[];
  /** Blocks and skipped ranges shown as error blocks, ascending. */
  isolated: Range[];
  plainFrom: number | null;
  /** The memo to keep for the next compile. */
  memo: RecoverMemo | null;
}

/**
 * Finds an artifact for a text that doesn't compile: isolated blocks, the
 * stable prefix, or (final) the source. `null` when nothing worked in time;
 * the client keeps its last good render.
 */
export const recover = async (run: RecoverRun): Promise<Recovered | null> => {
  const { text, mode, skip } = run;
  const streaming = mode === "streaming";
  const late = () => performance.now() >= run.deadline;
  const { checkpoints, errors: syntax, requirements } = recognize(text);
  const starts = blockStarts(text, checkpoints);
  // While streaming, the block holding the settled offset is still being written: it starts the tail.
  let settledEnd = text.length;
  if (streaming) for (const at of starts) if (at <= run.settled) settledEnd = at;
  // Blocks [0, n) are settled; block i is [starts[i], end(i)).
  const n = starts.filter((at) => at < settledEnd).length;
  const end = (i: number): number => Math.min(starts[i + 1] ?? text.length, settledEnd);
  const blockAt = (pos: number): number => {
    let i = 0;
    while (i + 1 < n && (starts[i + 1] as number) <= pos) i++;
    return i;
  };
  const skipped = (i: number) => skip.some((s) => s.from < end(i) && s.to > (starts[i] as number));

  const isolated = new Map<number, Isolated>();
  const isolateBlock = (i: number, diagnostics: Diagnostic[]) =>
    isolated.set(i, { from: starts[i] as number, to: end(i), diagnostics });
  /** The errors `ds` has inside block `i`, or else the first failing ones. */
  const blame = (i: number, ds: Diagnostic[]): Diagnostic[] => {
    const inside = ds.filter(
      (d) => failing(d) && d.span && d.span.from >= (starts[i] as number) && d.span.from < end(i),
    );
    if (inside.length > 0) return inside;
    // Elsewhere, or nowhere (a stopped compile): reported on the block.
    return ds
      .filter(failing)
      .slice(0, 1)
      .map((d) => ({ ...d, span: { from: starts[i] as number, to: end(i) } }));
  };

  // Prefix [0, lo) of the settled blocks compiles with the blocks isolated in it.
  let lo = 0;
  if (run.isolate) {
    // Remembered from an earlier compile of the same settled text.
    const memo = run.memo;
    if (memo && memo.key === run.memoKey && text.startsWith(memo.prefix)) {
      while (lo < n && end(lo) <= memo.prefix.length) lo++;
      for (const iso of memo.isolated) {
        const i = blockAt(iso.from);
        if (i < lo && starts[i] === iso.from && end(i) === iso.to && !skipped(i)) isolated.set(i, iso);
      }
    }
    // A block's parse doesn't depend on other blocks, so one the parser rejects (heal's recognizer,
    // Typst's parser ported) is isolated without checking prefixes, if Typst reports an error in it too.
    const unparsed = [...syntax.map((e) => e.start), ...requirements.map((q) => (q.type === "close" ? q.open : q.at))];
    for (const pos of unparsed) {
      const i = blockAt(pos);
      if (i >= n || isolated.has(i) || skipped(i)) continue;
      const typst = (run.errors ?? []).filter(
        (d) => isError(d) && d.span && d.span.from >= (starts[i] as number) && d.span.from < end(i),
      );
      if (typst.length > 0) isolateBlock(i, typst);
    }
  }

  /** The text with skipped ranges and isolated blocks replaced, up to `upTo`; past it, `tail`. */
  const variant = (upTo: number, tail: "keep" | "drop" | "plain"): { variant: Variant; map: SourceMap } => {
    const edits: TextEdit[] = skip.map((s) => errorBlock(text, s, SKIP_MESSAGES[s.reason]));
    for (const iso of isolated.values()) {
      if (iso.to <= upTo) edits.push(errorBlock(text, iso, iso.diagnostics[0]?.message ?? "This part has errors."));
    }
    if (tail !== "keep" && upTo < text.length) {
      edits.push({
        from: upTo,
        to: text.length,
        insert: tail === "plain" ? `#typstream.pending-text(${typstString(text.slice(upTo))})\n` : "",
      });
    }
    const applied = applyEdits(text, edits, "fallback");
    return { variant: { text: applied.text, toOriginal: (p, a) => applied.map.toOriginal(p, a) }, map: applied.map };
  };
  const check = async (upTo: number): Promise<boolean> => {
    return !(await run.check(variant(upTo, "drop").variant)).some(failing);
  };
  const attempt = async (upTo: number, tail: "keep" | "plain"): Promise<Attempt> => {
    const { variant: v, map } = variant(upTo, tail);
    return run.attempt(v, streaming && tail === "keep" ? map.toResult(run.settled) : v.text.length);
  };
  const isolatedRanges = (): Range[] =>
    [
      ...skip.map(({ from, to }) => ({ from, to })),
      ...[...isolated.values()].map(({ from, to }) => ({ from, to })),
    ].sort((a, b) => a.from - b.from);
  const done = (a: Attempt, plainFrom: number | null, memoTo: number): Recovered => {
    const blocks = [...isolated.values()].sort((a, b) => a.from - b.from);
    const tail =
      plainFrom === null
        ? []
        : (run.errors ?? [])
            .filter((d) => isError(d) && d.span && d.span.from >= plainFrom)
            .map((d): Diagnostic => ({ ...d, severity: "info", source: "stable-prefix" }));
    return {
      level: plainFrom === null ? 3 : 2,
      diagnostics: [...a.diagnostics, ...blocks.flatMap((b) => b.diagnostics), ...skip.map(skipDiagnostic), ...tail],
      isolated: isolatedRanges(),
      plainFrom,
      // Not with skipped ranges: what compiled then may hang without them.
      memo:
        run.isolate && skip.length === 0
          ? { key: run.memoKey, prefix: text.slice(0, memoTo), isolated: blocks.filter((b) => b.to <= memoTo) }
          : run.memo,
    };
  };

  // The document as it is failed (or wasn't compiled, with skipped ranges).
  let errors = run.errors;
  let changed = errors === null || isolated.size > 0;
  for (;;) {
    if (changed) {
      if (late()) return null;
      const a = await attempt(text.length, "keep");
      if (a.ok) return done(a, null, settledEnd);
      errors = a.diagnostics;
      changed = false;
    }
    if (!run.isolate || !(errors ?? []).some(blameable)) break;
    // Find the first failing settled block after `lo`: prefix `hi` fails.
    let hi = n;
    if (streaming) {
      // The settled text alone (the stable prefix): if it compiles, the tail is what fails.
      if (lo < n) {
        if (late()) return null;
        if (await check(settledEnd)) lo = n;
      }
    }
    if (lo >= n) break;
    while (hi - lo > 1) {
      if (late()) return null;
      const mid = (lo + hi) >> 1;
      if (await check(starts[mid] as number)) lo = mid;
      else hi = mid;
    }
    const bad = hi - 1;
    if (isolated.has(bad) || skipped(bad)) break;
    // The errors of the prefix ending with it, which the checks threw away: the attempt's, or this block's own.
    isolateBlock(bad, blame(bad, errors ?? []));
    lo = hi;
    changed = true;
  }

  if (streaming && run.stablePrefix) {
    // Level 2: the settled blocks (as isolated) with the tail as plain text.
    const upTo = settledEnd;
    if (lo < n && !(await check(upTo))) return null;
    if (late()) return null;
    const a = await attempt(upTo, "plain");
    if (a.ok) return done(a, upTo, upTo);
  }
  if (!streaming && run.isolate && !late()) {
    // Level 4: the whole document as its source.
    isolated.clear();
    if (text.trim() !== "") {
      const whole: Isolated = { from: 0, to: text.length, diagnostics: (errors ?? []).filter(isError) };
      isolated.set(0, whole);
      const a = await attempt(text.length, "keep");
      if (a.ok) return { ...done(a, null, 0), level: 4, isolated: [{ from: 0, to: text.length }], memo: null };
    }
  }
  return null;
};

/** Maps diagnostics of a variant back to the document. */
export const toDocument = (ds: Diagnostic[], v: Variant): Diagnostic[] =>
  ds.map((d) => mapDiagnostic(d, (p, a) => v.toOriginal(p, a)));
