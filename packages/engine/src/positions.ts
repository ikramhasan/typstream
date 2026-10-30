// Where the source was laid out on the pages (#36), as the adapter reports it
// in `/main.typ`, moved into the text the client sent (the server: past the
// preamble, back through what the fixers changed), then into the input (the
// client: back through healing). Glyphs are floats in bytes (core's
// `PagePositions`), read and written in place of a copy per glyph.

import type { PagePositions } from "@typstream/core";

/** Floats per glyph in `PagePositions.glyphs`. */
const STRIDE = 8;

/**
 * `positions` with every offset mapped by `map`, which returns -1 for one outside the client's text. What an
 * element covers starts at `start` at the earliest: a template's element covers the preamble's text too.
 */
export const mapPositions = (positions: PagePositions, map: (at: number) => number, start = 0): PagePositions => {
  const { glyphs } = positions;
  const bytes = new Uint8Array(glyphs);
  const floats = new Float32Array(bytes.buffer, 0, bytes.byteLength >> 2);
  for (let i = 0; i + STRIDE <= floats.length; i += STRIDE) {
    const from = floats[i + 5] as number;
    if (from < 0) continue;
    const a = map(from);
    const b = map(floats[i + 6] as number);
    floats[i + 5] = a < 0 || b < 0 ? -1 : a;
    floats[i + 6] = a < 0 || b < 0 ? -1 : b;
  }
  const elements = positions.elements.flatMap((e) => {
    if (e.to <= start) return [];
    const from = map(Math.max(e.from, start));
    const to = map(e.to);
    if (from < 0 || to < 0) return [];
    const { node: own, ...rest } = e;
    const node = own && ([map(own[0]), map(own[1])] as [number, number]);
    return [{ ...rest, from, to, ...(node && node[0] >= 0 && node[1] >= 0 && { node }) }];
  });
  return { glyphs: bytes, elements };
};
