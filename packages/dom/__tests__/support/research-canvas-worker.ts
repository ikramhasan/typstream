/// <reference lib="webworker" />
// #14 canvas research: paints pages off the main thread, into canvases the page
// transferred (`canvas`), or into a bitmap it sends back (`bitmap`).

import { GlyphCache, type PageOps, paint } from "./research-canvas";

const glyphs = new GlyphCache();
const canvases = new Map<number, OffscreenCanvas>();

type Message =
  | { type: "canvas"; index: number; canvas: OffscreenCanvas }
  | { type: "paint"; index: number; page: PageOps; scale: number }
  | { type: "bitmap"; index: number; page: PageOps; scale: number; width: number; height: number };

self.onmessage = (e: MessageEvent<Message>) => {
  const m = e.data;
  if (m.type === "canvas") {
    canvases.set(m.index, m.canvas);
    return;
  }
  const t0 = performance.now();
  glyphs.add(m.page.glyphs);
  if (m.type === "paint") {
    const ctx = canvases.get(m.index)?.getContext("2d") as OffscreenCanvasRenderingContext2D;
    paint(ctx, m.page, glyphs, m.scale);
    self.postMessage({ type: "painted", index: m.index, ms: performance.now() - t0 });
  } else {
    const canvas = new OffscreenCanvas(m.width, m.height);
    paint(canvas.getContext("2d") as OffscreenCanvasRenderingContext2D, m.page, glyphs, m.scale);
    const bitmap = canvas.transferToImageBitmap();
    self.postMessage({ type: "bitmap", index: m.index, bitmap, ms: performance.now() - t0 }, [bitmap]);
  }
};
