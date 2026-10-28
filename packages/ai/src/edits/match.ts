// Finding a model's quote in the document (#34). A quote must match one place:
// exactly first, then with whitespace evened out (models re-indent, drop a
// trailing space, or turn a line break into a space). A quote that matches no
// place or several is an error the app sends back to the model, as coding
// agents' `str_replace` does; guessing would edit the wrong part.

import type { Range } from "@typstream/core";

/**
 * Where a quote matches a text: {@link findQuote}'s result.
 * @public
 */
export interface QuoteMatch {
  /** The matched ranges, at most two (two say the quote is ambiguous). */
  ranges: Range[];
  /** Whether they match exactly; `false` when only whitespace-insensitive matching found them. */
  exact: boolean;
}

const SPACE = /\s/;

/** A text with each whitespace run as one space, and where each of its characters came from. */
interface Folded {
  text: string;
  /** For each character of `text`, the source offset it starts at. */
  from: number[];
  /** For each character of `text`, the source offset it ends at. */
  to: number[];
}

const fold = (source: string): Folded => {
  let text = "";
  const from: number[] = [];
  const to: number[] = [];
  for (let i = 0; i < source.length; ) {
    const c = source[i] as string;
    let j = i + 1;
    if (SPACE.test(c)) {
      while (j < source.length && SPACE.test(source[j] as string)) j++;
      text += " ";
    } else text += c;
    from.push(i);
    to.push(j);
    i = j;
  }
  return { text, from, to };
};

const occurrences = (text: string, quote: string, limit: number): number[] => {
  const found: number[] = [];
  for (let at = text.indexOf(quote); at >= 0 && found.length < limit; at = text.indexOf(quote, at + 1)) found.push(at);
  return found;
};

// The last document folded: a streaming quote is matched against the same text at every chunk.
let cache: { source: string; folded: Folded } | null = null;

const folded = (source: string): Folded => {
  if (cache?.source !== source) cache = { source, folded: fold(source) };
  return cache.folded;
};

/**
 * Where `quote` occurs in `text`: exactly, or else with every whitespace run
 * matching any other. The quote's own leading and trailing whitespace is
 * ignored, so a range starts and ends at text. An empty quote matches nothing.
 * At most two ranges are returned: one is a match, two an ambiguous quote.
 * @public
 */
export const findQuote = (text: string, quote: string): QuoteMatch => {
  const trimmed = quote.trim();
  if (!trimmed) return { ranges: [], exact: true };
  const exact = occurrences(text, trimmed, 2);
  if (exact.length) return { ranges: exact.map((from) => ({ from, to: from + trimmed.length })), exact: true };
  const f = folded(text);
  const q = fold(trimmed).text;
  const ranges = occurrences(f.text, q, 2).map((at) => ({
    from: f.from[at] as number,
    to: f.to[at + q.length - 1] as number,
  }));
  return { ranges, exact: false };
};
