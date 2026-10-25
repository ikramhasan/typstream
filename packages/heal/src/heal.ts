// Healing pipeline: normalize → recognize (incrementally) → repair the tail
// (cut incomplete constructs, close open ones, verify) → lint settled text.

import {
  applyEdit,
  diffEdit,
  type HealHandler,
  mapPosition,
  type Patch,
  type Range,
  SourceMap,
  type TextEdit,
} from "@typstream/core";
import {
  fixChanges,
  type LintFinding,
  type LintRuleId,
  type LintSeverity,
  lint,
  modeAt,
  type TextChange,
} from "./lint";
import { normalize } from "./normalize";
import {
  type Checkpoint,
  effectiveRequirements,
  type FrameKind,
  type LintEvent,
  type ModeSpan,
  type Recognition,
  type Requirement,
  recognize,
  type SyntaxIssue,
} from "./recognizer";

// The handler contract is part of the plugin contract, so it lives in core.
export type { HealHandler, HealHandlerContext } from "@typstream/core";

export interface HealOptions {
  /** The document is complete: no tail repair; lint everything. */
  final?: boolean;
  /** Drop a set/show/import/include rule entirely while it is incomplete (default true). */
  dropIncompleteRules?: boolean;
  lint?: Partial<Record<LintRuleId, LintSeverity | boolean>>;
  /** Strip a Markdown code fence (typst or typ) around the whole output (default "auto"). */
  unwrapFences?: "auto" | "never";
  /** Heal only text written into `[from, to)` of an existing document (AI edits). */
  streamingRange?: Range | null;
  handlers?: HealHandler[];
}

export interface OpenFrame {
  frame: FrameKind;
  /** Input offset of the opening delimiter. */
  open: number;
}

export interface HealResult {
  /** Source to compile. */
  source: string;
  /** Text before this source offset is settled: appending can't change how it parses. */
  stableOffset: number;
  /** Maps positions between the input and `source`. */
  map: {
    toSource(inputPos: number): number;
    /** `assoc` -1 maps a position at removed input text to before it (default: after). */
    toInput(sourcePos: number, assoc?: 1 | -1): number;
  };
  /** Changes from the normalized input to `source` (lint fixes, tail repair, output handlers). */
  patches: Patch[];
  /** Constructs still open at the end of the input, innermost first (e.g. "writing a table…"). */
  openFrames: OpenFrame[];
  findings: LintFinding[];
  /** Syntax errors healing could not fix (input offsets). */
  errors: SyntaxIssue[];
}

/** Mutable recognition of a whole text, updated in place on edits. */
interface State {
  checkpoints: Checkpoint[];
  errors: SyntaxIssue[];
  events: LintEvent[];
  modes: ModeSpan[];
  requirements: Requirement[];
  lastTokenStart: number;
}

const recognizeOpts = (opts: HealOptions) => ({ dropIncompleteRules: opts.dropIncompleteRules !== false });

/** Last checkpoint strictly before `pos`. */
const checkpointBefore = (cps: readonly Checkpoint[], pos: number): Checkpoint | undefined => {
  let lo = 0;
  let hi = cps.length - 1;
  let found: Checkpoint | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cp = cps[mid] as Checkpoint;
    if (cp.offset < pos) {
      found = cp;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
};

const fullState = (text: string, opts: HealOptions): State => {
  const r = recognize(text, undefined, recognizeOpts(opts));
  return { ...r };
};

/** Re-recognizes `text` after `edit`, resuming at the last checkpoint before it. */
const updateState = (state: State, text: string, edit: TextEdit, opts: HealOptions): number => {
  const cp = checkpointBefore(state.checkpoints, edit.from);
  if (!cp) {
    Object.assign(state, fullState(text, opts));
    return 0;
  }
  const r = recognize(text, cp, recognizeOpts(opts));
  const keep = <T>(xs: T[], pos: (x: T) => number): void => {
    let n = xs.length;
    while (n > 0 && pos(xs[n - 1] as T) >= cp.offset) n--;
    xs.length = n;
  };
  keep(state.checkpoints, (c) => c.offset);
  keep(state.errors, (e) => e.start);
  keep(state.events, (e) => ("at" in e ? e.at : e.start));
  keep(state.modes, (m) => m.at);
  state.checkpoints.push(...r.checkpoints);
  state.errors.push(...r.errors);
  state.events.push(...r.events);
  for (const m of r.modes) {
    const last = state.modes[state.modes.length - 1];
    if (!last || last.mode !== m.mode) state.modes.push(m);
  }
  state.requirements = r.requirements;
  state.lastTokenStart = r.lastTokenStart;
  return cp.offset;
};

/**
 * Text before a root checkpoint is settled once the checkpoint itself is
 * permanent: its first character is followed by another one, so appending can
 * no longer turn it into trivia (a line-start `/` into `//`) and undo it. The
 * checkpoint's own token may still change kind (`https:` → a link); text before
 * it can't. This only ever moves forward as text is appended.
 */
const settledCheckpoint = (text: string, cps: readonly Checkpoint[]): number => {
  for (let i = cps.length - 1; i >= 0; i--) {
    const at = (cps[i] as Checkpoint).offset;
    const code = text.charCodeAt(at);
    const width = code >= 0xd800 && code <= 0xdbff ? 2 : 1;
    if (at + width < text.length) return at;
  }
  return 0;
};

interface TailRepair {
  /** Text in `[cut, end)` is dropped. */
  cut: number;
  /** Inserted at `cut`. */
  closers: string;
  frames: OpenFrame[];
}

const MAX_REPAIR_ROUNDS = 64;

/**
 * Makes `text[0..end)` parse cleanly by cutting incomplete constructs and
 * appending closers. Only constructs opened at or after `regionStart` are
 * touched. Every candidate is re-recognized before it's accepted.
 */
const repairTail = (text: string, end: number, regionStart: number, state: State, opts: HealOptions): TailRepair => {
  const ropts = recognizeOpts(opts);
  const inRegion = (r: Requirement): boolean => (r.type === "cut" ? r.at >= regionStart : r.open >= regionStart);
  // Fast path: nothing at the end needs repair.
  if (end === text.length && !effectiveRequirements(state.requirements).some(inRegion)) {
    return { cut: end, closers: "", frames: [] };
  }

  let cur = text.slice(0, end);
  const recognizeCur = (s: string) => {
    const cp = checkpointBefore(state.checkpoints, s.length);
    return { cp, rec: recognize(s, cp, ropts) };
  };
  let { cp, rec } = recognizeCur(cur);
  let failures = 0;

  for (let round = 0; round < MAX_REPAIR_ROUNDS; round++) {
    const reqs = effectiveRequirements(rec.requirements).filter(inRegion);
    let cutAt = Number.POSITIVE_INFINITY;
    for (const r of reqs) if (r.type === "cut" && r.at < cur.length) cutAt = Math.min(cutAt, r.at);
    if (cutAt !== Number.POSITIVE_INFINITY) {
      cur = cur.slice(0, Math.max(cutAt, regionStart));
      ({ cp, rec } = recognizeCur(cur));
      continue;
    }

    const closes = reqs.filter((r): r is Extract<Requirement, { type: "close" }> => r.type === "close");
    if (closes.length === 0) return { cut: cur.length, closers: "", frames: [] };
    const closers = closes.map((r) => r.text).join("");
    for (const sep of ["", " "]) {
      const candidate = cur + sep + closers;
      const check = recognize(candidate, cp, ropts);
      if (!effectiveRequirements(check.requirements).some(inRegion) && check.errors.length <= rec.errors.length) {
        return {
          cut: cur.length,
          closers: sep + closers,
          frames: closes.map((r) => ({ frame: r.frame, open: r.open })),
        };
      }
    }
    // The closers merged with the last token (e.g. `\` + `*`): drop that token.
    // After a few tries, drop the whole outermost open construct instead, so
    // pathological input (thousands of nested blocks) stays linear.
    failures++;
    let at: number;
    if (failures <= 2 && rec.lastTokenStart > regionStart && rec.lastTokenStart < cur.length) {
      at = rec.lastTokenStart;
    } else {
      at = Math.min(...closes.map((r) => r.open));
      if (failures > 3 || at <= regionStart || at >= cur.length) at = Math.max(regionStart, cp?.offset ?? 0);
    }
    if (at >= cur.length) break;
    cur = cur.slice(0, at);
    ({ cp, rec } = recognizeCur(cur));
  }
  return { cut: Math.max(regionStart, cp?.offset ?? 0), closers: "", frames: [] };
};

/**
 * Streaming into the middle of a document: the healed region's last characters
 * can change how the untouched suffix lexes (`p` + `*bold*` makes `*` a
 * word-internal star). Pick the first separator that keeps the suffix parsing
 * as it did without the region.
 */
const SEPARATORS = ["", "\u200b", " ", "\n"];
const separateRegion = (
  text: string,
  regionStart: number,
  regionEnd: number,
  tail: TailRepair,
  state: State,
  opts: HealOptions,
): TailRepair => {
  const ropts = recognizeOpts(opts);
  const cp = checkpointBefore(state.checkpoints, regionStart + 1);
  const suffix = text.slice(regionEnd);
  const base = recognize(text.slice(0, regionStart) + suffix, cp, ropts);
  const hard = (r: Recognition) =>
    effectiveRequirements(r.requirements).filter((q) => !(q.type === "cut" && q.soft)).length;
  for (const sep of SEPARATORS) {
    const candidate = text.slice(0, tail.cut) + tail.closers + sep + suffix;
    const r = recognize(candidate, cp, ropts);
    if (r.errors.length <= base.errors.length && hard(r) <= hard(base)) return { ...tail, closers: tail.closers + sep };
  }
  return tail;
};

/** Applies sorted, non-overlapping changes; returns the result and its patches. */
const applyChanges = (text: string, changes: readonly TextChange[], reason: (c: TextChange) => string) => {
  const parts: string[] = [];
  const patches: Patch[] = [];
  let pos = 0;
  let outLen = 0;
  for (const c of changes) {
    parts.push(text.slice(pos, c.from));
    outLen += c.from - pos;
    patches.push({
      original: { from: c.from, to: c.to },
      result: { from: outLen, to: outLen + c.insert.length },
      reason: reason(c),
    });
    parts.push(c.insert);
    outLen += c.insert.length;
    pos = c.to;
  }
  parts.push(text.slice(pos));
  return { output: parts.join(""), patches };
};

interface Core {
  source: string;
  patches: Patch[];
  stable: number;
  frames: OpenFrame[];
  findings: LintFinding[];
  errors: SyntaxIssue[];
}

/** Lint findings cached for the settled prefix `[0, upTo)` of the normalized text. */
interface LintCache {
  upTo: number;
  findings: LintFinding[];
}

const runLint = (
  text: string,
  state: State,
  from: number,
  to: number,
  opts: HealOptions,
  final: boolean,
): LintFinding[] => {
  if (to <= from) return [];
  const findings = lint(text, state, from, to, { rules: opts.lint });
  const handlers = (opts.handlers ?? []).filter((h) => h.phase === "settled");
  for (const h of handlers.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))) {
    for (const c of h.run({ text, from, to, final, modeAt: (p) => modeAt(state.modes, p) })) {
      if (c.from >= from && c.to <= to) {
        findings.push({ rule: h.name, severity: "fix", start: c.from, end: c.to, message: h.name, changes: [c] });
      }
    }
  }
  return findings;
};

const healCore = (text: string, state: State, opts: HealOptions, cache: LintCache): Core => {
  const final = opts.final === true;
  const region = opts.streamingRange ?? null;
  const regionStart = region ? Math.min(region.from, text.length) : 0;
  const regionEnd = region ? Math.min(Math.max(region.to, regionStart), text.length) : text.length;

  let tail: TailRepair = { cut: regionEnd, closers: "", frames: [] };
  if (!final) tail = repairTail(text, regionEnd, regionStart, state, opts);
  if (region && !final && regionEnd < text.length)
    tail = separateRegion(text, regionStart, regionEnd, tail, state, opts);

  const lastCp = settledCheckpoint(text, state.checkpoints);
  let stable = final ? text.length : Math.min(lastCp, tail.cut);
  if (region) stable = Math.min(stable, regionStart);

  // Lint the settled prefix; findings before `cache.upTo` are reused.
  if (cache.upTo > stable) {
    cache.findings = cache.findings.filter((f) => f.end <= stable);
    cache.upTo = Math.min(cache.upTo, stable);
  }
  cache.findings.push(...runLint(text, state, cache.upTo, stable, opts, final));
  cache.upTo = stable;
  const findings = cache.findings;

  const changes = fixChanges(findings);
  if (tail.cut < regionEnd || tail.closers !== "") {
    changes.push({ from: tail.cut, to: regionEnd, insert: tail.closers });
  }
  const reasons = new Map<TextChange, string>();
  for (const f of findings) for (const c of f.changes) reasons.set(c, `lint:${f.rule}`);
  let { output, patches } = applyChanges(
    text,
    changes,
    (c) => reasons.get(c) ?? (c.insert ? "heal:close" : "heal:cut"),
  );

  const outputHandlers = (opts.handlers ?? []).filter((h) => h.phase === "output");
  if (outputHandlers.length > 0) {
    const map1 = new SourceMap(patches);
    const extra: TextChange[] = [];
    for (const h of outputHandlers.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))) {
      extra.push(...h.run({ text: output, from: 0, to: output.length, final, modeAt: () => "markup" }));
    }
    if (extra.length > 0) {
      const sorted = extra.sort((a, b) => a.from - b.from);
      const second = applyChanges(output, sorted, () => "handler");
      output = second.output;
      // Express the second stage in normalized-text coordinates for a single patch list.
      patches = [
        ...patches,
        ...second.patches.map((p) => ({
          original: { from: map1.toOriginal(p.original.from), to: map1.toOriginal(p.original.to) },
          result: p.result,
          reason: p.reason,
        })),
      ].sort((a, b) => a.original.from - b.original.from);
    }
  }

  const fixed = findings.filter((f) => f.severity === "fix");
  const errors = state.errors.filter(
    (e) => e.start < stable && !fixed.some((f) => e.start >= f.start && e.start <= f.end),
  );
  // A complete document is not repaired: whatever is still open at its end is an error.
  if (final) {
    for (const r of effectiveRequirements(state.requirements)) {
      if (r.type === "close") errors.push({ start: r.open, end: r.open + 1, message: "unclosed delimiter" });
      else if (!r.soft) errors.push({ start: r.at, end: text.length, message: r.reason });
    }
  }

  return { source: output, patches, stable, frames: tail.frames, findings, errors };
};

const toResult = (input: string, norm: ReturnType<typeof normalize>, core: Core): HealResult => {
  const normMap = new SourceMap(norm.patches);
  const healMap = new SourceMap(core.patches);
  const toInput = (pos: number, assoc: 1 | -1 = 1): number => normMap.toOriginal(healMap.toOriginal(pos, assoc), assoc);
  const toSource = (pos: number): number => healMap.toResult(normMap.toResult(Math.min(pos, input.length)));
  const toInputRange = <T extends { start: number; end: number }>(x: T): T => ({
    ...x,
    start: normMap.toOriginal(x.start),
    end: normMap.toOriginal(x.end),
  });
  return {
    source: core.source,
    stableOffset: healMap.toResult(core.stable),
    map: { toSource, toInput },
    patches: core.patches,
    openFrames: core.frames.map((f) => ({ ...f, open: normMap.toOriginal(f.open) })),
    findings: core.findings.map(toInputRange),
    errors: core.errors.map(toInputRange),
  };
};

/** `streamingRange` is given in input offsets; healing works on normalized text. */
const normalizedOpts = (opts: HealOptions, norm: ReturnType<typeof normalize>): HealOptions => {
  const range = opts.streamingRange;
  if (!range || norm.patches.length === 0) return opts;
  const map = new SourceMap(norm.patches);
  return { ...opts, streamingRange: { from: map.toResult(range.from), to: map.toResult(range.to) } };
};

/** Heals a complete or partial Typst source in one call. */
export const heal = (input: string, opts: HealOptions = {}): HealResult => {
  const norm = normalize(input, { unwrapFences: opts.unwrapFences, streaming: !opts.final });
  const state = fullState(norm.text, opts);
  return toResult(input, norm, healCore(norm.text, state, normalizedOpts(opts, norm), { upTo: 0, findings: [] }));
};

export interface Healer {
  /** Appends streamed text. */
  push(chunk: string): HealResult;
  /** Replaces the whole input (e.g. a `source` prop that grows); diffs it against the previous one. */
  set(input: string): HealResult;
  /** Applies an edit to the input (editors, collaboration, AI rewrites). */
  applyEdit(edit: TextEdit): HealResult;
  /** Marks `[from, to)` of the input as being written by a model; `null` heals the whole tail again. */
  setStreamingRange(range: Range | null): HealResult;
  /** The stream ended: heal the complete document (no tail repair). */
  finish(): HealResult;
  /** The latest result. */
  result(): HealResult;
  reset(input?: string): void;
  readonly input: string;
}

/** Incremental healer: re-parses only from the last checkpoint before each change. */
export const createHealer = (options: HealOptions = {}): Healer => {
  let opts: HealOptions = { ...options };
  let input = "";
  let norm = normalize("", { unwrapFences: opts.unwrapFences, streaming: true });
  let text = norm.text;
  let state = fullState(text, opts);
  let cache: LintCache = { upTo: 0, findings: [] };
  let last: HealResult = toResult(input, norm, healCore(text, state, opts, cache));

  /** Moves the streaming range with an edit to the input: text typed at its end extends it. */
  const trackRange = (edit: TextEdit | null): void => {
    const range = opts.streamingRange;
    if (!range || !edit) return;
    opts = { ...opts, streamingRange: { from: mapPosition(range.from, edit, -1), to: mapPosition(range.to, edit, 1) } };
  };

  const update = (nextInput: string): HealResult => {
    input = nextInput;
    norm = normalize(input, { unwrapFences: opts.unwrapFences, streaming: !opts.final });
    const next = norm.text;
    if (next !== text) {
      const edit: TextEdit | null =
        next.length >= text.length && next.startsWith(text)
          ? { from: text.length, to: text.length, insert: next.slice(text.length) }
          : diffEdit(text, next);
      text = next;
      if (edit) {
        const resumedAt = updateState(state, text, edit, opts);
        if (cache.upTo > resumedAt) {
          cache.findings = cache.findings.filter((f) => f.end <= resumedAt && f.start < resumedAt);
          cache.upTo = resumedAt;
        }
      }
    }
    last = toResult(input, norm, healCore(text, state, normalizedOpts(opts, norm), cache));
    return last;
  };

  return {
    push: (chunk) => {
      trackRange({ from: input.length, to: input.length, insert: chunk });
      return update(input + chunk);
    },
    set: (nextInput) => {
      trackRange(diffEdit(input, nextInput));
      return update(nextInput);
    },
    applyEdit: (edit) => {
      trackRange(edit);
      return update(applyEdit(input, edit));
    },
    setStreamingRange: (range) => {
      opts = { ...opts, streamingRange: range };
      cache = { upTo: 0, findings: [] };
      return update(input);
    },
    finish: () => {
      opts = { ...opts, final: true, streamingRange: null };
      cache = { upTo: 0, findings: [] };
      return update(input);
    },
    result: () => last,
    reset: (nextInput = "") => {
      opts = { ...options };
      input = "";
      norm = normalize("", { unwrapFences: opts.unwrapFences, streaming: true });
      text = norm.text;
      state = fullState(text, opts);
      cache = { upTo: 0, findings: [] };
      last = update(nextInput);
    },
    get input() {
      return input;
    },
  };
};
