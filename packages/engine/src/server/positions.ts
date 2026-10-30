// Where the source was laid out on the pages (#36), as the adapter reports it
// in `/main.typ`, moved into the text the client sent: past the preamble, and
// back through what the fixers changed. Glyphs are floats in bytes (core's
// `PagePositions`), so they are read and written in place of a copy per glyph.

import type { PagePositions } from "@typstream/core";

/** Floats per glyph in `PagePositions.glyphs`. */
const STRIDE = 8;

/** `positions` with every offset mapped by `map`, which returns -1 for one outside the client's text. */
export const mapPositions = (positions: PagePositions, map: (at: number) => number): PagePositions => {
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
    const from = map(e.from);
    const to = map(e.to);
    return from < 0 || to < 0 ? [] : [{ ...e, from, to }];
  });
  return { glyphs: bytes, elements };
};
