// Word fade-in for streamed text (PLAN §2, §6.5). The timeline is streamdown's
// (`packages/streamdown/lib/animate.ts`, Apache-2.0, Copyright 2023 Vercel,
// Inc.): one wall-clock schedule across blocks and updates, whose stagger
// compresses so a fast stream never runs more than a backlog budget ahead.
//
// streamdown wraps every word in a span on every render, giving words already
// shown a zero duration, because React re-renders the whole block. Here the
// renderer only touches blocks whose HTML changed, so only their new text is
// wrapped. A changed block is compared with the block it replaced: their common
// visible text was on screen already. Words of that old block that were still
// fading in continue where they were (a negative delay) instead of popping in.

/**
 * Soft budget for how far ahead of wall-clock word animations may be scheduled:
 * a fast stream compresses its stagger to fit (streamdown's value).
 */
export const MAX_ANIMATION_BACKLOG_MS = 320;

/** Floor for the stagger under compression, so words still cascade. */
export const MIN_STAGGER_STEP_MS = 4;

/** Word fade-in settings. @public */
export interface AnimateOptions {
  /**
   * Keyframes: `fadeIn` (default), `blurIn`, `slideUp`, or your own `@keyframes`, whose name must be
   * `typstream-` followed by this value: `"pop"` plays `@keyframes typstream-pop` (add it with `stylesheets`).
   */
  animation?: "fadeIn" | "blurIn" | "slideUp" | (string & {});
  /** Per word, in ms. Default 150. */
  duration?: number;
  /** CSS easing. Default `ease`. */
  easing?: string;
  /** Delay between consecutive words, in ms. Default 40. */
  stagger?: number;
  /** Animate by `word` (default; CJK characters count as words) or by `char`. */
  sep?: "word" | "char";
  /**
   * How far ahead of wall-clock words may be scheduled, in ms; a fast stream
   * compresses its stagger to fit, down to 4 ms per word. Default 320.
   */
  maxBacklogMs?: number;
}

export interface AnimateConfig {
  animation: string;
  duration: number;
  easing: string;
  stagger: number;
  sep: "word" | "char";
  maxBacklogMs: number;
}

export const animateConfig = (options: AnimateOptions = {}): AnimateConfig => ({
  animation: options.animation ?? "fadeIn",
  duration: options.duration ?? 150,
  easing: options.easing ?? "ease",
  stagger: options.stagger ?? 40,
  sep: options.sep ?? "word",
  maxBacklogMs: options.maxBacklogMs ?? MAX_ANIMATION_BACKLOG_MS,
});

interface Slot {
  /** Delay (ms) of the first new word. */
  baseDelay: number;
  /** Delay between words; less than asked for when the backlog is full. */
  step: number;
}

/** streamdown's `createAnimateTimeline`, minus its React re-render bookkeeping. */
export class AnimateTimeline {
  /** Absolute time the next word may start, as of the last update. */
  private committed = 0;
  /** The same, within the update being rendered. */
  private next = 0;

  constructor(private readonly maxBacklog: number) {}

  begin(now: number): void {
    // Resume from the last update, but never more than the budget ahead of now.
    this.next = Math.min(Math.max(this.committed, now), now + this.maxBacklog);
  }

  take(words: number, stagger: number, now: number): Slot {
    const ideal = Math.max(0, stagger);
    if (words <= 0) return { baseDelay: 0, step: ideal };
    const min = ideal === 0 ? 0 : Math.min(ideal, MIN_STAGGER_STEP_MS);
    const startAt = Math.max(this.next, now);
    const budgetEnd = now + this.maxBacklog;
    let step = ideal;
    if (startAt + (words - 1) * ideal > budgetEnd && words > 1) {
      step = startAt < budgetEnd ? Math.max(min, (budgetEnd - startAt) / (words - 1)) : min;
    }
    this.next = startAt + words * step;
    return { baseDelay: Math.max(0, Math.round(startAt - now)), step };
  }

  commit(): void {
    this.committed = this.next;
  }
}

/** Start times (absolute ms) of a block's words still animating, by their offset in its visible text. */
export type Timings = Map<number, number>;

// Subtrees whose text isn't animated word by word. Code keeps its layout; math
// and drawings fade in as one unit (below).
const SKIP = new Set(["pre", "annotation"]);
/** Elements that fade in whole: they have no text of their own, or text that mustn't be split. */
const UNITS = new Set(["img", "hr", "svg", "math"]);
/** What a whole unit counts as in visible text. */
const UNIT_CHAR = "\uFFFC";

const WHITESPACE = /\s/;
const WHITESPACE_ONLY = /^\s+$/;
// Scripts written without spaces between words: each character is a word (streamdown #669).
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303F\uFF00-\uFFEF]/u;

/** streamdown's `splitByWord`: trailing whitespace stays with its word, so an underline never leads it in. */
const splitByWord = (text: string): string[] => {
  const parts: string[] = [];
  let current = "";
  let inWhitespace = false;
  let prevCjk = false;
  for (const char of text) {
    const isWs = WHITESPACE.test(char);
    const isCjk = !isWs && CJK.test(char);
    if (!isWs && current !== "" && (isCjk || prevCjk)) {
      parts.push(current);
      current = "";
      inWhitespace = false;
    } else if (isWs !== inWhitespace && current) {
      if (isWs) {
        current += char;
        inWhitespace = true;
        continue;
      }
      parts.push(current);
      current = "";
    }
    current += char;
    inWhitespace = isWs;
    prevCjk = isCjk;
  }
  if (current) parts.push(current);
  return parts;
};

/** streamdown's `splitByChar`. */
const splitByChar = (text: string): string[] => {
  const parts: string[] = [];
  let ws = "";
  for (const char of text) {
    if (WHITESPACE.test(char)) {
      if (parts.length > 0 && !WHITESPACE_ONLY.test(parts[parts.length - 1] as string)) {
        parts[parts.length - 1] += char;
      } else ws += char;
    } else {
      if (ws) {
        parts.push(ws);
        ws = "";
      }
      parts.push(char);
    }
  }
  if (ws) {
    if (parts.length > 0) parts[parts.length - 1] += ws;
    else parts.push(ws);
  }
  return parts;
};

type Entry = { node: Text; start: number } | { node: Element; start: number; unit: true };

const ELEMENT = 1;
const TEXT = 3;

/** Text nodes and whole units of `nodes`, in order, with their offsets in the visible text. */
const entries = (nodes: readonly Node[]): { entries: Entry[]; text: string } => {
  const out: Entry[] = [];
  const text: string[] = [];
  let pos = 0;
  const stack: Node[] = [...nodes].reverse();
  while (stack.length > 0) {
    const node = stack.pop() as Node;
    if (node.nodeType === TEXT) {
      const data = (node as Text).data;
      out.push({ node: node as Text, start: pos });
      text.push(data);
      pos += data.length;
    } else if (node.nodeType === ELEMENT) {
      const name = (node as Element).localName;
      if (SKIP.has(name)) continue;
      if (UNITS.has(name)) {
        out.push({ node: node as Element, start: pos, unit: true });
        text.push(UNIT_CHAR);
        pos += 1;
        continue;
      }
      for (let c = node.lastChild; c; c = c.previousSibling) stack.push(c);
    }
  }
  return { entries: out, text: text.join("") };
};

/** The visible text of a block as the animation counts it. */
export const visibleText = (nodes: readonly Node[]): string => entries(nodes).text;

const commonPrefix = (a: string, b: string): number => {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
};

const stamp = (el: Element & ElementCSSInlineStyle, delay: number): void => {
  el.setAttribute("data-typstream-animate", "");
  el.style.setProperty("--typstream-delay", `${Math.round(delay)}ms`);
};

/**
 * Wraps the new words of a block that is about to be shown (`nodes`, not yet in
 * the page) in animated spans. `previous` is the visible text and timings of
 * the block it replaces, if any. Returns the timings of words still animating.
 */
export const animateBlock = (
  nodes: readonly Node[],
  previous: { text: string; timings: Timings | null } | null,
  timeline: AnimateTimeline,
  config: AnimateConfig,
  now: number,
): Timings | null => {
  const { entries: list, text } = entries(nodes);
  const shown = previous ? commonPrefix(previous.text, text) : 0;
  const running = previous?.timings ?? null;
  const split = config.sep === "char" ? splitByChar : splitByWord;

  // Each word: new (gets a slot), still running from the old block, or shown.
  type Word = { entry: Entry; part: string; start: number; at: number | null };
  const words: Word[] = [];
  let fresh = 0;
  const isRunning = (start: number): number | null => {
    const at = running?.get(start);
    return at !== undefined && at + config.duration > now ? at : null;
  };
  // List items with text on screen already: their marker mustn't fade in again.
  const markers = new Set<Element>();
  for (const entry of list) {
    if (entry.start >= shown) break;
    const li = ("unit" in entry ? entry.node : entry.node.parentElement)?.closest("li");
    if (li) markers.add(li);
  }
  for (const entry of list) {
    if ("unit" in entry) {
      if (entry.start >= shown) fresh++;
      words.push({
        entry,
        part: UNIT_CHAR,
        start: entry.start,
        at: entry.start >= shown ? Number.NaN : isRunning(entry.start),
      });
      continue;
    }
    const data = entry.node.data;
    if (entry.start + data.length <= shown && !running) continue;
    let pos = entry.start;
    for (const part of split(data)) {
      const start = pos;
      pos += part.length;
      if (WHITESPACE_ONLY.test(part)) {
        words.push({ entry, part, start, at: null });
        continue;
      }
      if (start >= shown) {
        fresh++;
        words.push({ entry, part, start, at: Number.NaN });
      } else words.push({ entry, part, start, at: isRunning(start) });
    }
  }

  const slot = timeline.take(fresh, config.stagger, now);
  let index = 0;
  for (const word of words) {
    if (word.at !== null && Number.isNaN(word.at)) word.at = now + slot.baseDelay + index++ * slot.step;
  }

  // Rebuild each text node that has a word to animate.
  const timings: Timings = new Map();
  let i = 0;
  while (i < words.length) {
    const entry = (words[i] as Word).entry;
    let j = i;
    let animated = false;
    while (j < words.length && (words[j] as Word).entry === entry) {
      if ((words[j] as Word).at !== null) animated = true;
      j++;
    }
    if (animated) {
      const doc = entry.node.ownerDocument as Document;
      if ("unit" in entry) {
        const at = (words[i] as Word).at as number;
        stamp(entry.node as Element & ElementCSSInlineStyle, at - now);
        timings.set(entry.start, at);
        marker(entry.node, at - now, markers);
      } else {
        const fragment = doc.createDocumentFragment();
        const data = entry.node.data;
        // Text before the first word in this run (shown before, and not running).
        const first = (words[i] as Word).start - entry.start;
        if (first > 0) fragment.append(data.slice(0, first));
        let plain = "";
        for (let k = i; k < j; k++) {
          const word = words[k] as Word;
          if (word.at === null) {
            plain += word.part;
            continue;
          }
          if (plain) fragment.append(plain);
          plain = "";
          const span = doc.createElement("span");
          span.textContent = word.part;
          stamp(span, word.at - now);
          fragment.append(span);
          timings.set(word.start, word.at);
          marker(entry.node, word.at - now, markers);
        }
        if (plain) fragment.append(plain);
        entry.node.replaceWith(fragment);
      }
    }
    i = j;
  }
  for (const [start, at] of timings) if (at + config.duration <= now) timings.delete(start);
  return timings.size > 0 ? timings : null;
};

/**
 * A list item's marker (`::marker`, which can't be wrapped) fades in with the
 * item's first word, if that word is new.
 */
const marker = (node: Node, delay: number, seen: Set<Element>): void => {
  const li = (node.nodeType === ELEMENT ? (node as Element) : node.parentElement)?.closest("li");
  if (!li || seen.has(li)) return;
  seen.add(li);
  li.setAttribute("data-typstream-animate-marker", "");
  (li as HTMLElement).style.setProperty("--typstream-marker-delay", `${Math.round(delay)}ms`);
};
