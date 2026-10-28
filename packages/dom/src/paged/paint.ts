// Paints a page's drawing (core's PageDrawing, written by engine-wasm's
// src/draw.rs, which describes the format) on a canvas. Measured in #14: a
// dense A4 page (~1,700 glyphs) paints in ~1 ms in Chromium and WebKit and
// 10–15 ms in Firefox, where its SVG cost 12–31 ms of style and layout.
//
// Glyph outlines are `Path2D`s built once per key (font and glyph) and shared
// by every page and view: a page redrawn while streaming reuses all of them.
// Items carry absolute transforms, so the canvas state is saved only around
// clips.

import type { PageDrawing } from "@typstream/core";

/** Images a view has decoded, by URL: `null` while decoding. */
export type Images = Map<string, HTMLImageElement | null>;

interface Prepared {
  ops: Float32Array;
  glyphs: Path2D[];
  paths: Path2D[];
}

const outlines = new Map<string, Path2D>();
const prepared = new WeakMap<PageDrawing, Prepared>();

const prepare = (drawing: PageDrawing): Prepared => {
  let p = prepared.get(drawing);
  if (!p) {
    // A Float32Array needs a 4-byte aligned offset; the engine's arrays have one.
    const bytes = drawing.ops.byteOffset % 4 ? drawing.ops.slice() : drawing.ops;
    p = {
      ops: new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2),
      glyphs: drawing.glyphs.map(([key, d]) => {
        let path = outlines.get(key);
        if (!path) {
          path = new Path2D(d);
          outlines.set(key, path);
        }
        return path;
      }),
      paths: [],
    };
    prepared.set(drawing, p);
  }
  return p;
};

const CAPS: CanvasLineCap[] = ["butt", "round", "square"];
const JOINS: CanvasLineJoin[] = ["miter", "round", "bevel"];

/**
 * Paints `drawing` on `ctx`'s whole canvas at `k` device pixels per point.
 * Images not decoded yet are skipped: `onImage` is called once one is, and
 * the page should be painted again.
 */
export const paint = (
  ctx: CanvasRenderingContext2D,
  drawing: PageDrawing,
  k: number,
  images: Images,
  onImage: () => void,
): void => {
  const { ops, glyphs, paths } = prepare(drawing);
  const str = drawing.strings;
  const path = (i: number) => {
    let p = paths[i];
    if (!p) paths[i] = p = new Path2D(str[i]);
    return p;
  };
  let i = 0;
  const next = () => ops[i++] as number;
  // The item's transform, in device pixels.
  let a = 0;
  let b = 0;
  let c = 0;
  let d = 0;
  let e = 0;
  let f = 0;
  const transform = () => {
    a = k * next();
    b = k * next();
    c = k * next();
    d = k * next();
    e = k * next();
    f = k * next();
    ctx.setTransform(a, b, c, d, e, f);
  };
  /** Reads a stroke and sets it up; false for none. */
  const stroke = () => {
    const color = next();
    if (color < 0) return false;
    ctx.strokeStyle = str[color] as string;
    ctx.lineWidth = next();
    ctx.lineCap = CAPS[next()] as CanvasLineCap;
    ctx.lineJoin = JOINS[next()] as CanvasLineJoin;
    ctx.miterLimit = next();
    const n = next();
    ctx.setLineDash([...ops.subarray(i, i + n)]);
    i += n;
    ctx.lineDashOffset = next();
    return true;
  };

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  while (i < ops.length) {
    const op = next();
    if (op === 1) {
      ctx.save();
      transform();
      ctx.clip(path(next()));
    } else if (op === 2) {
      ctx.restore();
    } else if (op === 3) {
      transform();
      ctx.fillStyle = str[next()] as string;
      const stroked = stroke();
      for (let n = next(); n > 0; n--) {
        const glyph = glyphs[next()] as Path2D;
        const x = next();
        const y = next();
        ctx.setTransform(a, b, c, d, a * x + c * y + e, b * x + d * y + f);
        ctx.fill(glyph);
        if (stroked) ctx.stroke(glyph);
      }
    } else if (op === 4) {
      transform();
      const p = path(next());
      const fill = next();
      const rule = next() ? "evenodd" : "nonzero";
      if (fill >= 0) {
        ctx.fillStyle = str[fill] as string;
        ctx.fill(p, rule);
      }
      if (stroke()) ctx.stroke(p);
    } else if (op === 5) {
      transform();
      const url = str[next()] as string;
      const width = next();
      const height = next();
      const scaling = next();
      const image = images.get(url);
      if (image) {
        ctx.imageSmoothingEnabled = scaling !== 2;
        ctx.drawImage(image, 0, 0, width, height);
      } else if (image === undefined && url.startsWith("data:")) {
        // Pages embed their images; nothing may load from elsewhere (as `sanitizeLinks` keeps SVG's).
        const img = new Image();
        images.set(url, null);
        img.src = url;
        img.decode().then(
          () => {
            images.set(url, img);
            onImage();
          },
          () => {},
        );
      }
    } else break;
  }
};

/** Whether two pages draw the same: frame hashes change with source spans while the drawing doesn't (#19). */
export const sameDrawing = (x: PageDrawing | undefined, y: PageDrawing | undefined): boolean =>
  x === y ||
  (!!x &&
    !!y &&
    x.ops.length === y.ops.length &&
    x.ops.every((v, i) => v === y.ops[i]) &&
    JSON.stringify([x.strings, x.links, x.glyphs.map((g) => g[0])]) ===
      JSON.stringify([y.strings, y.links, y.glyphs.map((g) => g[0])]));
