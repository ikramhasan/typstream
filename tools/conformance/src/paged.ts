/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/// <reference path="./pdfjs-worker.d.ts" />
// The paged half of the conformance suite (#135), and tools/browser-suites' preview vs PDF check (#119): every page the
// document panel paints is compared, pixel by pixel, with the same page of the mount's `exportPdf()` rasterized by
// pdf.js at the same size, in the same browser.
//
// Both draw the same laid-out document (engine-wasm's `compile_svg_changed` with drawings and `compile_pdf` compile
// the same source), so what this catches is the two drawers disagreeing: an item the canvas drawing leaves out or
// places differently, a colour, a stroke, an image, a page size. What it tolerates is rasterization: pdf.js draws
// glyphs from the PDF's embedded fonts and our painter from Typst's outlines, so edges antialias differently and may
// land a device pixel apart. A pixel counts as different only when neither image has a matching pixel within one
// device pixel of it.
//
// Pages are shown in the `fit-width` layout, as apps show a document panel: the document's own pages scaled to the
// panel's width (`fixed` shows the same pages at their own size). The `reflow` layout lays the document out again at
// the panel's width (REFLOW_PREAMBLE), so its lines and pages are not the PDF's, by design, and it isn't compared.
//
// It runs on any machine: neither side uses system fonts, and both rasterize in the browser under test, so there are
// no baselines.

import type { TypstreamPlugin } from "@typstream/core";
import { type MountedTypstream, mountTypstream } from "@typstream/dom";
import { createEngine, type Engine, fromWorker } from "@typstream/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { server } from "vitest/browser";
import { canvasOf, finished, frame, host, pageEls, shown, steady, svgOf, until, warmFonts } from "./mount";
import type { ConformanceExample, ConformanceSuite } from "./suite";

/** CSS width of the panel: about an A4 page's own width (595 pt × 4/3 px). */
const WIDTH = 800;

/**
 * Device pixels per CSS pixel the canvases are painted at, as on a HiDPI screen: about 2.7 per point. At 1 a 0.4 pt
 * rule is half a device pixel, which pdf.js (like most PDF viewers) widens to a whole one while the canvas antialiases
 * it, and a page-wide tolerance for that would hide a missing glyph.
 */
export const PIXEL_RATIO = 2;

/**
 * Largest cluster of differing pixels a page may have. Chromium and Firefox have none on the edu corpus; WebKit has a
 * few scattered pixels (1–7 on a page, at most 2 touching) where its canvas and pdf.js antialias an edge on different
 * sides. A missing full stop is a cluster of 7–8.
 */
export const MAX_CLUSTER = 3;

/** The real engine worker, spawned from source as the packages' own browser tests do. */
export const startEngine = (): Engine =>
  createEngine({
    spawn: fromWorker(
      () => new Worker(new URL("../../../packages/engine/src/worker.ts", import.meta.url), { type: "module" }),
    ),
    spare: false,
  });

let pdfjs: typeof import("pdfjs-dist") | undefined;
const loadPdfjs = async () => {
  // pdf.js on this thread: with its worker module on `globalThis.pdfjsWorker` it needs no worker URL.
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = await import("pdfjs-dist/build/pdf.worker.mjs");
  pdfjs = await import("pdfjs-dist");
  return pdfjs;
};

/** Paints canvases at {@link PIXEL_RATIO} until the returned function puts `devicePixelRatio` back. */
export const hiDpi = (): (() => void) => {
  // `devicePixelRatio` is replaceable: the paged view reads this window's.
  const before = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, get: () => PIXEL_RATIO });
  return () => {
    if (before) Object.defineProperty(window, "devicePixelRatio", before);
    else delete (window as { devicePixelRatio?: number }).devicePixelRatio;
  };
};

/** A canvas's pixels on white (the page's background), as RGBA. */
const pixelsOf = (source: HTMLCanvasElement): Uint8ClampedArray => {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
};

/** Page `index` (0-based) of `pdf` rasterized by pdf.js at `width` × `height` device pixels, on white. */
const pdfPage = async (
  pdf: import("pdfjs-dist").PDFDocumentProxy,
  index: number,
  width: number,
  height: number,
): Promise<Uint8ClampedArray> => {
  const page = await pdf.getPage(index + 1);
  const base = page.getViewport({ scale: 1 });
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const viewport = page.getViewport({ scale: width / base.width });
  await page.render({ canvas, viewport, background: "#fff" }).promise;
  return pixelsOf(canvas);
};

/** Colour distance at which two pixels differ: the largest channel difference. */
const THRESHOLD = 96;

const near = (a: Uint8ClampedArray, i: number, b: Uint8ClampedArray, j: number) =>
  Math.abs((a[i] as number) - (b[j] as number)) <= THRESHOLD &&
  Math.abs((a[i + 1] as number) - (b[j + 1] as number)) <= THRESHOLD &&
  Math.abs((a[i + 2] as number) - (b[j + 2] as number)) <= THRESHOLD;

/** Whether some pixel of `b` within one pixel of (x, y) matches `a`'s at (x, y). */
const matchesAround = (a: Uint8ClampedArray, b: Uint8ClampedArray, w: number, h: number, x: number, y: number) => {
  const i = (y * w + x) * 4;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const u = x + dx;
      const v = y + dy;
      if (u >= 0 && v >= 0 && u < w && v < h && near(a, i, b, (v * w + u) * 4)) return true;
    }
  return false;
};

/** How a page differs from the PDF's. */
export interface PageDiff {
  /** Pixels that differ. */
  pixels: number;
  /** The most of them that touch (8-connected): what is drawn differently, not antialiasing noise. */
  cluster: number;
  /** The largest cluster's bounding box, in points, for finding what differs; null when no pixel does. */
  box: [number, number, number, number] | null;
}

const compare = (a: Uint8ClampedArray, b: Uint8ClampedArray, w: number, h: number, k: number): PageDiff => {
  const differ = new Uint8Array(w * h);
  const found: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (near(a, i, b, i)) continue;
      if (matchesAround(a, b, w, h, x, y) && matchesAround(b, a, w, h, x, y)) continue;
      differ[y * w + x] = 1;
      found.push(y * w + x);
    }
  // Connected clusters, by flood fill: rasterizers disagree on scattered pixels at edges, a missing mark is a blob.
  let cluster = 0;
  let box: PageDiff["box"] = null;
  for (const start of found) {
    if (differ[start] !== 1) continue;
    differ[start] = 2;
    const stack = [start];
    let size = 0;
    let [x0, y0, x1, y1] = [w, h, -1, -1];
    while (stack.length) {
      const at = stack.pop() as number;
      const x = at % w;
      const y = (at - x) / w;
      size++;
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const u = x + dx;
          const v = y + dy;
          if (u < 0 || v < 0 || u >= w || v >= h || differ[v * w + u] !== 1) continue;
          differ[v * w + u] = 2;
          stack.push(v * w + u);
        }
    }
    if (size > cluster) {
      cluster = size;
      const pt = (v: number) => Math.round(v / k);
      box = [pt(x0), pt(y0), pt(x1 + 1), pt(y1 + 1)];
    }
  }
  return { pixels: found.length, cluster, box };
};

/** Brings `page` into view and resolves with its canvas once it has pixels; null for an SVG page. */
const painted = async (page: HTMLElement): Promise<HTMLCanvasElement | null> => {
  page.scrollIntoView({ block: "start" });
  const end = performance.now() + 10_000;
  for (;;) {
    await frame();
    const canvas = canvasOf(page);
    if (!canvas) return null;
    if (canvas.width > 0) return canvas;
    if (performance.now() > end) throw new Error("page not painted");
  }
};

/**
 * An SVG page (one the drawing can't express: gradients, tilings, colour glyphs) rasterized by the browser at the size
 * its canvas would have.
 */
const rasterizeSvg = async (page: HTMLElement): Promise<HTMLCanvasElement> => {
  const svg = svgOf(page);
  if (!svg) throw new Error("page has neither a canvas nor an SVG");
  const width = Math.round(page.clientWidth * PIXEL_RATIO);
  const height = Math.round((width * svg.viewBox.baseVal.height) / svg.viewBox.baseVal.width);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
  try {
    const img = new Image(width, height);
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    (canvas.getContext("2d") as CanvasRenderingContext2D).drawImage(img, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
};

/** A copy of a canvas's pixels, which the view may clear once its page leaves the screen. */
const copy = (source: HTMLCanvasElement): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  (canvas.getContext("2d") as CanvasRenderingContext2D).drawImage(source, 0, 0);
  return canvas;
};

/** One page of {@link comparePaged}. */
export interface PageResult extends PageDiff {
  page: number;
  /** The page came as SVG. */
  svg: boolean;
}

/**
 * Mounts `example` in the document panel (paged, `fit-width`) with `plugins`, then compares each page shown with the
 * same page of the mount's PDF export, and checks the PDF has as many pages, as big. `exported`, when given, replaces
 * the source before exporting (a suite's own check that a difference is caught). Call it between {@link hiDpi}'s and
 * its undoing.
 */
export const comparePaged = async (
  engine: Engine,
  example: ConformanceExample,
  plugins: readonly TypstreamPlugin[] = [],
  exported?: string,
): Promise<PageResult[]> => {
  const { name } = example;
  const el = host(WIDTH);
  const opts = {
    engine,
    source: example.source,
    isStreaming: false,
    target: "paged" as const,
    layout: "fit-width" as const,
    caret: false,
    plugins,
    files: example.files ?? {},
    ...(example.inputs ? { inputs: example.inputs } : {}),
    lazy: false,
  };
  const view: MountedTypstream = mountTypstream(el, opts);
  try {
    await until(view, finished);
    const s = await steady(() => view.getState());
    expect(s.status, `${name}: ${JSON.stringify(s.diagnostics?.filter((d) => d.severity === "error"))}`).toBe("done");
    await shown(el, s.artifact);
    const artifact = s.artifact;
    if (artifact?.target !== "paged") throw new Error(`${name}: not paged`);

    // The pages as the reader sees them, before anything changes.
    const shownPages: { canvas: HTMLCanvasElement; svg: boolean }[] = [];
    for (const page of pageEls(el)) {
      const canvas = await painted(page);
      shownPages.push(canvas ? { canvas: copy(canvas), svg: false } : { canvas: await rasterizeSvg(page), svg: true });
    }

    if (exported !== undefined) {
      view.update({ ...opts, source: exported });
      await until(view, finished);
    }
    const lib = pdfjs ?? (await loadPdfjs());
    const task = lib.getDocument({ data: await view.exportPdf(), disableFontFace: true, verbosity: 0 });
    const pdf = await task.promise;
    try {
      expect(pdf.numPages, `${name}: page count`).toBe(artifact.pageCount);
      const results: PageResult[] = [];
      for (const [index, { canvas, svg }] of shownPages.entries()) {
        const want = artifact.pages[index];
        if (!want) throw new Error(`${name}: no page ${index}`);
        const [, , pw = 0, ph = 0] = (await pdf.getPage(index + 1)).view;
        expect([pw, ph].map(Math.round), `${name}: page ${index + 1} size`).toEqual(
          [want.width, want.height].map(Math.round),
        );
        const { width, height } = canvas;
        const theirs = await pdfPage(pdf, index, width, height);
        results.push({ page: index + 1, svg, ...compare(pixelsOf(canvas), theirs, width, height, width / want.width) });
      }
      return results;
    } finally {
      await task.destroy();
    }
  } finally {
    view.destroy();
    el.remove();
  }
};

/**
 * Defines the suite's paged tests (vitest browser mode): each example's pages, as the document panel paints them,
 * equal its PDF export's, to {@link MAX_CLUSTER} differing pixels touching.
 */
export const pagedConformance = (suite: ConformanceSuite): void => {
  describe(`${suite.name}: paged view = PDF in ${server.browser}`, () => {
    let engine: Engine;
    let restore: () => void;
    beforeAll(async () => {
      restore = hiDpi();
      engine = startEngine();
      await engine.ready;
      await warmFonts(engine);
    }, 60_000);
    afterAll(() => {
      engine.dispose();
      restore();
    });

    it.for(suite.examples)("$name", { timeout: 120_000 }, async (example) => {
      const pages = await comparePaged(engine, example, suite.plugins);
      expect(pages.filter((p) => p.cluster > MAX_CLUSTER)).toEqual([]);
    });
  });
};
