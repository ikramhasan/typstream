// Layer 0: cleans the raw model output before any parsing. Only touches the
// very start and end of the text, so it is O(1) per streamed chunk.

import { isHighSurrogate, type Patch } from "@typstream/core";

export interface NormalizeOptions {
  /** Strip a Markdown code fence (typst or typ) wrapped around the whole document. */
  unwrapFences?: "auto" | "never";
  /** The text may still grow: hold back a trailing half surrogate pair or partial fence. */
  streaming?: boolean;
}

export interface Normalized {
  text: string;
  /** Changes from the raw input to `text`, sorted. */
  patches: Patch[];
}

const FENCE_OPEN = /^[ \t]*(?:\r?\n)*[ \t]*```(?:typst|typ)[ \t]*(?:\r?\n|$)/;
const FENCE_CLOSE = /\r?\n[ \t]*```[ \t]*(?:\r?\n[ \t]*)*$/;
const FENCE_CLOSE_PARTIAL = /\r?\n[ \t]*`{1,2}$/;

export const normalize = (raw: string, opts: NormalizeOptions = {}): Normalized => {
  let start = 0;
  let end = raw.length;
  let endReason = "";
  const patches: Patch[] = [];
  const cutStart = (to: number, reason: string): void => {
    patches.push({ original: { from: start, to }, result: { from: 0, to: 0 }, reason });
    start = to;
  };

  if (raw.charCodeAt(0) === 0xfeff) cutStart(1, "normalize:bom");

  if (opts.unwrapFences !== "never") {
    const open = FENCE_OPEN.exec(raw.slice(start));
    if (open) {
      cutStart(start + open[0].length, "normalize:fence-open");
      // Only the tail can hold the closing fence; don't scan the whole document.
      const tailStart = Math.max(start, end - 64);
      const tail = raw.slice(tailStart, end);
      const close = FENCE_CLOSE.exec(tail) ?? (opts.streaming ? FENCE_CLOSE_PARTIAL.exec(tail) : null);
      if (close) {
        end = tailStart + close.index;
        endReason = "normalize:fence-close";
      }
    }
  }

  if (opts.streaming && end > start && isHighSurrogate(raw.charCodeAt(end - 1))) {
    end--;
    endReason ||= "normalize:hold-back";
  }

  if (end < raw.length) {
    const from = end - start;
    patches.push({
      original: { from: end, to: raw.length },
      result: { from, to: from },
      reason: endReason,
    });
  }
  return { text: raw.slice(start, end), patches };
};
