// A diagram's source drawn as the Typst side reads it: pele's layout, measured in the label
// fonts, split into shapes and labels (svg.ts). Kept apart from the generator so tests can draw
// without a worker.
import { PeleError, type RenderOptions, render } from "pele";
import { measureText } from "./measure";
import { type Label, splitText, type Theme } from "./svg";

/** One diagram in the index: drawn, or why it couldn't be. */
export type Drawing =
  | {
      /** Its size, in pele's pixels; Typst scales it so 16 of them are the text size. */
      w: number;
      h: number;
      /** The shapes' SVG, which the index names by its hash. */
      svg: string;
      /** `[x, y, rotate, anchor, size, weight, italic, mono, fill, text]`, as `lib.typ` destructures them. */
      labels: (string | number | boolean)[][];
    }
  | {
      /** pele's message, which quotes the source: Typst shows it as text. */
      error: string;
      /** 1-based, or 0 when pele doesn't say. */
      line: number;
    };

const row = (l: Label): (string | number | boolean)[] => [
  l.x,
  l.y,
  l.rotate,
  l.anchor,
  l.size,
  l.weight,
  l.italic,
  l.mono,
  l.fill,
  l.text,
];

/**
 * The width a diagram is laid out for, in pele's pixels: the text width of Typst's default page
 * (A4, 2.5/21 of it as margins: 453.5 pt) at 11 pt text, where 16 pixels are the text size.
 */
export const PAGE_WIDTH = 660;

const OPTIONS: RenderOptions = {
  measurer: { width: measureText },
  fontFamily: "Libertinus Serif",
  fontFamilyMono: "DejaVu Sans Mono",
  // A fixed size, which Typst scales.
  responsive: false,
  autoDirection: false,
  // The document can't fetch, link out or run anything from an image (PLAN §9); a fixed "now"
  // keeps a Gantt chart the same on every compile.
  links: false,
  images: false,
  now: 0,
};

/**
 * Draws `source`; `id` keeps the SVG's own ids (gradients, markers) apart from other diagrams'.
 * A diagram wider than {@link PAGE_WIDTH} is laid out again for it, as pele lays diagrams out
 * for a narrow screen (a left-to-right flowchart turns top to bottom, labels wrap): shrunk to
 * fit instead, its text would be too small to read on paper. The narrower drawing wins.
 */
export const draw = (source: string, id: string, theme: Theme = {}): Drawing => {
  try {
    let r = render(source, { ...OPTIONS, idPrefix: id });
    if (r.width > PAGE_WIDTH) {
      const narrow = render(source, {
        ...OPTIONS,
        idPrefix: id,
        maxWidth: PAGE_WIDTH,
        autoDirection: true,
        directionBreakpoint: PAGE_WIDTH + 1,
      });
      if (narrow.width < r.width) r = narrow;
    }
    const { svg, labels } = splitText(r.svg, theme);
    return { w: r.width, h: r.height, svg, labels: labels.map(row) };
  } catch (e) {
    if (e instanceof PeleError) return { error: e.message, line: e.line || 0 };
    return { error: e instanceof Error ? e.message : String(e), line: 0 };
  }
};
