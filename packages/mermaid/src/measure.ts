// pele's text measurer, in the fonts Typst sets a diagram's labels in: Libertinus Serif's advance
// widths (widths.generated.ts), and DejaVu Sans Mono's for monospace labels. Without kerning:
// pele pads its boxes, and a label a little narrower than measured looks the same. A character
// Libertinus doesn't have falls back in Typst to another font; it is guessed here (a full em for
// East Asian scripts, half for the rest).
import { WIDTHS } from "./widths.generated";

/** pele's style bits. */
const BOLD = 1;
const ITALIC = 2;
const MONO = 4;

/** DejaVu Sans Mono's advance, in em. */
const MONO_ADVANCE = 1233 / 2048;

const faces: Map<number, number>[] = WIDTHS.map((runs) => {
  const widths = new Map<number, number>();
  for (const [first, ws] of runs) {
    for (let i = 0; i < ws.length; i++) widths.set(first + i, (ws[i] as number) / 1000);
  }
  return widths;
});

/** A guess for a character the face lacks, in em. */
const fallback = (c: number): number => (c >= 0x2e80 && c <= 0xffdc ? 1 : 0.55);

/** Width of `text` set at `size` (any unit; the result is in it), as pele's `TextMeasurer` asks. */
export const measureText = (text: string, size: number, style: number): number => {
  let em = 0;
  if (style & MONO) {
    for (const ch of text) em += (ch.codePointAt(0) as number) >= 0x2e80 ? 1 : MONO_ADVANCE;
    return em * size;
  }
  const face = faces[style & (BOLD | ITALIC)] as Map<number, number>;
  for (const ch of text) {
    const c = ch.codePointAt(0) as number;
    em += face.get(c) ?? fallback(c);
  }
  return em * size;
};
