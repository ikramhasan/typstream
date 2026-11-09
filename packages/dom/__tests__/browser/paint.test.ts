/// <reference lib="dom" />
// The canvas painter's images (src/paged/paint.ts), in Chromium, Firefox and WebKit. An SVG image at a fractional
// place and size must land where a vector drawing of its shapes does: Firefox rasterizes SVG images at whole pixels
// and resamples them, which put a Mermaid diagram's edges up to a pixel off the PDF's until the painter drew such
// images through a version of their exact size at a whole pixel.

import type { PageDrawing } from "@typstream/core";
import { expect, it } from "vitest";
import { type Images, paint } from "../../src/paged/paint";

/** A 423 × 296 SVG with one black square, its left edge at x = 280. */
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 423 296" width="423" height="296"><rect x="280" y="175" width="12" height="12" fill="#000"/></svg>';

/** One image item: op 5, its transform (points), the URL's index, its size (points) and scaling (0: auto). */
const drawing = (x: number, width: number, height: number): PageDrawing => ({
  ops: new Uint8Array(Float32Array.of(5, 1, 0, 0, 1, x, 0, 0, width, height, 0).buffer),
  strings: [`data:image/svg+xml;base64,${btoa(SVG)}`],
  glyphs: [],
  links: [],
});

/** Alpha along row `y` from `x0`, five pixels. */
const row = (ctx: CanvasRenderingContext2D, x0: number, y: number) =>
  [...ctx.getImageData(x0, y, 5, 1).data].filter((_, i) => i % 4 === 3);

const context = () => {
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 600;
  return canvas.getContext("2d") as CanvasRenderingContext2D;
};

it("draws an SVG image at a fractional place and size where a vector drawing puts its edges", async () => {
  // 2 device pixels per point: the image is 782.55 × 547.6 device pixels at x = 20.4.
  const k = 2;
  const [x, w, h] = [10.2, 391.275, 273.8];
  const ctx = context();
  const images: Images = new Map();
  const page = drawing(x, w, h);
  // Painted again whenever an image (the SVG, then its whole-pixel version) is decoded, until nothing is pending.
  await new Promise<void>((resolve) => {
    let timer = setTimeout(resolve, 500);
    const repaint = () => {
      clearTimeout(timer);
      paint(ctx, page, k, images, repaint);
      timer = setTimeout(resolve, 200);
    };
    repaint();
  });

  const scale = (k * w) / 423;
  const edge = k * x + 280 * scale;
  const y = Math.round(181 * ((k * h) / 296));
  const reference = context();
  reference.fillRect(edge, 175 * scale, 12 * scale, 12 * scale);
  const x0 = Math.floor(edge) - 2;
  const got = row(ctx, x0, y);
  const want = row(reference, x0, y);
  // Antialiasing differs a little between a browser's image and path drawing; a resampled edge is off by far more.
  for (const [i, a] of got.entries()) expect(Math.abs(a - (want[i] as number)), `${got} vs ${want}`).toBeLessThan(24);
});
