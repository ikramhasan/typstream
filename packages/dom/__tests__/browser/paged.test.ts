/// <reference lib="dom" />
// The paged renderer against the real engine worker (src/worker.ts of
// @typstream/engine, bundled by Vite) in Chromium, Firefox and WebKit. Run with
// `pnpm test:browser`.

import type { PagedArtifact, PageFormat } from "@typstream/core";
import { createEngine, type DocumentState, type Engine, type EngineDocument, fromWorker } from "@typstream/engine";
import { afterEach, describe, expect, it } from "vitest";
import { commands, server } from "vitest/browser";
import { createPagedView, type DrawInfo, mountPaged, type PagedView, REFLOW_PREAMBLE } from "../../src";
import { pages } from "../support/documents";

const browser = server.browser;
const spawn = () =>
  fromWorker(() => new Worker(new URL("../../../engine/src/worker.ts", import.meta.url), { type: "module" }));

const engines: Engine[] = [];
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
  for (const e of engines.splice(0)) e.dispose();
});

const newEngine = () => {
  const engine = createEngine({ spawn: spawn() });
  engines.push(engine);
  return engine;
};

const container = (width: number, height?: number) => {
  const el = document.createElement("div");
  el.style.width = `${width}px`;
  if (height !== undefined) {
    el.style.height = `${height}px`;
    el.style.overflow = "auto";
  }
  document.body.append(el);
  cleanups.push(() => el.remove());
  return el;
};

/** Resolves with the first state that satisfies `done` (now or later). */
const until = (doc: EngineDocument, done: (s: DocumentState) => boolean, ms = 90_000): Promise<DocumentState> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out: ${JSON.stringify(doc.getState().failure)}`)), ms);
    const check = (s: DocumentState) => {
      if (!done(s)) return;
      clearTimeout(timer);
      stop();
      resolve(s);
    };
    const stop = doc.subscribe(check);
    check(doc.getState());
  });

const finished = (doc: EngineDocument) =>
  until(doc, (s) => s.status === "done" || s.status === "error").then((s) => {
    // The failure says whether Typst reported errors or the watchdog stopped the compile (timeout, crash).
    if (s.status === "error")
      throw new Error(`compile failed: ${JSON.stringify(s.failure)} ${JSON.stringify(s.diagnostics.slice(0, 3))}`);
    return s;
  });

/** A finished paged compile of `text`, its pages as SVG or as drawings. */
const compile = async (
  text: string,
  pageFormat: PageFormat = "svg",
  files?: Record<string, Uint8Array>,
): Promise<PagedArtifact> => {
  const doc = newEngine().open({ target: "paged", text, pageFormat, ...(files ? { files } : {}) });
  doc.finish();
  const s = await finished(doc);
  return s.artifact as PagedArtifact;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

/** Waits until the view has drawn everything. */
const settled = async (view: PagedView, ms = 60_000) => {
  const end = performance.now() + ms;
  while (view.pending > 0) {
    if (performance.now() > end) throw new Error(`still ${view.pending} pending`);
    await sleep(20);
  }
};

const pageEls = (view: PagedView) => [...view.element.querySelectorAll<HTMLElement>(".typstream-page")];
const svgOf = (page: HTMLElement) => page.firstElementChild?.shadowRoot?.firstElementChild as SVGSVGElement | null;
const canvasOf = (page: HTMLElement) => page.querySelector("canvas");

/** Share of a canvas's pixels that aren't white. */
const ink = (canvas: HTMLCanvasElement) => {
  const { data } = (canvas.getContext("2d") as CanvasRenderingContext2D).getImageData(
    0,
    0,
    canvas.width,
    canvas.height,
  );
  let n = 0;
  for (let i = 0; i < data.length; i += 4) if ((data[i] as number) < 200) n++;
  return n / (data.length / 4);
};

/** Pixels of `svg` drawn as an image at `width` × `height`, on white. */
const rasterize = async (svg: string, width: number, height: number) => {
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.drawImage(img, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
};

// Vite exposes VITE_* variables to the browser. VITE_REPORT=1 writes the streaming test's numbers to stream-*.json.
const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const textOf = (page: HTMLElement) => page.querySelector(".typstream-text-layer") as HTMLElement | null;

const selectedText = (el: Element) => {
  const selection = getSelection() as Selection;
  selection.selectAllChildren(el);
  const text = selection.toString();
  selection.removeAllRanges();
  return text;
};

describe(`paged renderer in ${browser}`, () => {
  it("renders a 20-page document on canvases: visible pages painted, every text layer selectable and searchable", async () => {
    const engine = newEngine();
    const doc = engine.open({ target: "paged", text: pages(20) });
    doc.finish();
    // Shows about one page, so most pages are far from the viewport.
    const host = container(700, 900);
    const view = mountPaged(host, doc).view;
    const s = await finished(doc);
    await settled(view);
    const artifact = s.artifact as PagedArtifact;
    expect(artifact.pageCount).toBeGreaterThanOrEqual(18);
    // mountPaged asks for drawings, which the engine sends instead of SVG.
    expect(artifact.pages.every((p) => p.drawing && p.svg === "")).toBe(true);

    const els = pageEls(view);
    expect(els).toHaveLength(artifact.pageCount);
    for (const el of els) {
      expect(canvasOf(el)?.getAttribute("aria-hidden")).toBe("true");
      expect(textOf(el)?.childElementCount).toBeGreaterThan(0);
    }
    // The first page is painted at device pixels; pages far away hold no pixels.
    const first = canvasOf(els[0] as HTMLElement) as HTMLCanvasElement;
    expect(first.width).toBe(Math.round((els[0] as HTMLElement).clientWidth * devicePixelRatio));
    expect(ink(first)).toBeGreaterThan(0.01);
    const last = els.at(-1) as HTMLElement;
    expect(canvasOf(last)?.width).toBe(0);
    // Pages keep A4's proportions.
    const box = (els[3] as HTMLElement).getBoundingClientRect();
    expect(box.height / box.width).toBeCloseTo(297 / 210, 2);

    // Scrolled into view, the last page is painted; the first gives its pixels up (a second later).
    last.scrollIntoView();
    await expect.poll(() => canvasOf(last)?.width ?? 0).toBeGreaterThan(0);
    expect(ink(canvasOf(last) as HTMLCanvasElement)).toBeGreaterThan(0.001);
    await expect.poll(() => first.width, { timeout: 5000 }).toBe(0);

    // Copying a page gives its text, lines separated, words spaced.
    const text = selectedText(textOf(els[0] as HTMLElement) as HTMLElement);
    expect(text).toContain("1.1. Section 1: roots of polynomials\n");
    expect(text).toContain("uses only the triangle inequality.");
    // Find in page reaches text on later pages.
    getSelection()?.removeAllRanges();
    // biome-ignore lint/suspicious/noExplicitAny: window.find is non-standard, but all three browsers have it.
    expect((window as any).find("Section 30: roots of polynomials")).toBe(true);
    getSelection()?.removeAllRanges();
  }, 120_000);

  it("renders SVG pages with renderer: svg", async () => {
    const engine = newEngine();
    const doc = engine.open({ target: "paged", text: pages(20) });
    doc.finish();
    const view = mountPaged(container(700), doc, { renderer: "svg" }).view;
    const s = await finished(doc);
    await settled(view);
    const artifact = s.artifact as PagedArtifact;
    const els = pageEls(view);
    expect(els).toHaveLength(artifact.pageCount);
    els.forEach((el, i) => {
      const page = artifact.pages[i];
      const svg = svgOf(el);
      expect(page?.drawing).toBeUndefined();
      expect(svg?.querySelectorAll("use").length).toBe(page?.svg.match(/<use /g)?.length);
      expect(svg?.getAttribute("aria-hidden")).toBe("true");
      expect(textOf(el)?.childElementCount).toBeGreaterThan(0);
    });
    // Glyph ids resolve inside each page's shadow root: a <use> on a late page has a box.
    const use = svgOf(els[10] as HTMLElement)?.querySelector("use") as SVGGraphicsElement;
    expect(use.getBBox().width).toBeGreaterThan(0);
  }, 120_000);

  it("paints what the SVG draws: shapes, strokes, dashes, clips, transforms, images, fill rules, links", async () => {
    // A PNG for the document: a 2×2 checkerboard, drawn pixelated and smooth.
    const png = document.createElement("canvas");
    png.width = png.height = 2;
    const pctx = png.getContext("2d") as CanvasRenderingContext2D;
    pctx.fillStyle = "#c03";
    pctx.fillRect(0, 0, 1, 1);
    pctx.fillRect(1, 1, 1, 1);
    const blob = await new Promise<Blob>((r) => png.toBlob((b) => r(b as Blob)));
    const files = { "check.png": new Uint8Array(await blob.arrayBuffer()) };
    const text = `#set page(width: 300pt, height: 420pt, margin: 12pt, fill: rgb("#fffbe6"))
#set text(size: 13pt)
Hello *world*, $x^2 + sqrt(y) = integral_0^1 f(t) dif t$ and #text(fill: rgb("#2a7"))[green].
#rect(width: 90pt, height: 26pt, radius: 4pt, fill: rgb("#3366cc80"), stroke: (paint: red, thickness: 2pt, dash: "dashed"))
#box(width: 70pt, height: 14pt, clip: true)[#text(size: 26pt)[Clipped text]]
#h(10pt) #box(rotate(25deg)[Rotated]) #h(16pt) #box(scale(x: 160%, y: 80%, origin: left)[Scaled])
#circle(radius: 14pt, stroke: (paint: green, thickness: 3pt, dash: "dotted"))
#text(stroke: 0.6pt + blue, fill: yellow, size: 26pt, weight: "bold")[Outlined]
#polygon(fill: black, fill-rule: "even-odd", (0pt, 20pt), (40pt, 20pt), (8pt, 45pt), (20pt, 5pt), (32pt, 45pt))
#line(length: 120pt, stroke: (thickness: 5pt, cap: "round", paint: rgb(80, 0, 120, 160)))
#box(image("check.png", width: 30pt, scaling: "pixelated")) #box(image("check.png", width: 30pt)) #link("https://typst.app")[a link] and #link("javascript:alert(1)")[a bad one]
#table(columns: 3, stroke: (x, y) => if y == 0 { (bottom: 1pt) }, [a], [b], [c], [1], [2], [3])`;
    const [drawn, svg] = await Promise.all([compile(text, "drawing", files), compile(text, "svg", files)]);
    const page = drawn.pages[0];
    expect(drawn.pageCount).toBe(1);
    expect(page?.drawing).toBeDefined();
    expect(page?.svg).toBe("");
    const view = createPagedView(container(600));
    cleanups.push(() => view.destroy());
    view.render(drawn);
    await settled(view);
    const canvas = canvasOf(pageEls(view)[0] as HTMLElement) as HTMLCanvasElement;
    // Images paint once decoded, with the page painted again.
    await expect.poll(() => view.pending, { timeout: 10_000 }).toBe(0);
    await frame();
    await frame();
    const { width, height } = canvas;
    const painted = (canvas.getContext("2d") as CanvasRenderingContext2D).getImageData(0, 0, width, height).data;
    const reference = await rasterize(svg.pages[0]?.svg as string, width, height);
    let off = 0;
    for (let i = 0; i < painted.length; i += 4) {
      const d = Math.max(
        Math.abs((painted[i] as number) - (reference[i] as number)),
        Math.abs((painted[i + 1] as number) - (reference[i + 1] as number)),
        Math.abs((painted[i + 2] as number) - (reference[i + 2] as number)),
      );
      if (d > 64) off++;
    }
    // Antialiasing differs along edges; anything missing or misplaced would be far more.
    expect(off / (painted.length / 4)).toBeLessThan(0.005);

    // Links: the safe one is an <a> over its text, the other has none.
    const links = [...(pageEls(view)[0] as HTMLElement).querySelectorAll<HTMLAnchorElement>(".typstream-links a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["https://typst.app"]);
    expect(links[0]?.target).toBe("_blank");
    expect(links[0]?.rel).toBe("noopener noreferrer");
    const box = links[0]?.getBoundingClientRect() as DOMRect;
    expect(box.width).toBeGreaterThan(10);
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    expect(hit).toBe(links[0]);
  }, 120_000);

  it("draws pages it can't paint as SVG: gradients", async () => {
    const artifact = await compile(
      "First page.\n#pagebreak()\n#rect(width: 100pt, height: 40pt, fill: gradient.linear(red, blue))",
      "drawing",
    );
    expect(artifact.pages.map((p) => !!p.drawing)).toEqual([true, false]);
    const view = createPagedView(container(500));
    cleanups.push(() => view.destroy());
    view.render(artifact);
    view.flush();
    const [one, two] = pageEls(view) as [HTMLElement, HTMLElement];
    expect(canvasOf(one)).not.toBeNull();
    expect(svgOf(two)?.querySelector("linearGradient")).not.toBeNull();
  }, 120_000);

  for (const renderer of ["canvas", "svg"] as const)
    it(`streams with only changed pages redrawn (${renderer}), and reports draw times and long tasks`, async () => {
      const source = pages(20);
      const engine = newEngine();
      const doc = engine.open({ target: "paged" });
      const draws: (DrawInfo & { end: number })[] = [];
      const view = mountPaged(container(700, 900), doc, {
        renderer,
        onDraw: (info) => {
          draws.push({ ...info, end: performance.now() });
          if (env.VITE_DEBUG)
            debug.push({
              ...info,
              widths: info.pages.map((p) => pageEls(view)[p]?.clientWidth),
              hashes: info.pages.map((p) =>
                doc.getState().artifact?.target === "paged"
                  ? (doc.getState().artifact as PagedArtifact).pages[p]?.hash.slice(0, 6)
                  : "",
              ),
            });
        },
      }).view;
      const debug: unknown[] = [];
      // Follow the stream at the bottom, as a chat or side panel does.
      const scroller = view.element.parentElement as HTMLElement;

      const hashes = new Map<number, string[]>();
      doc.subscribe((s) => {
        if (s.artifact?.target !== "paged") return;
        for (const page of s.artifact.pages) {
          const seen = hashes.get(page.index) ?? [];
          if (seen.at(-1) !== page.hash) seen.push(page.hash);
          hashes.set(page.index, seen);
        }
      });

      // Chromium only: other browsers don't report long tasks.
      const longTasks: PerformanceEntry[] = [];
      const observer =
        typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes?.includes("longtask")
          ? new PerformanceObserver((list) => {
              longTasks.push(...list.getEntries());
            })
          : null;
      observer?.observe({ type: "longtask" });

      // ~57,000 characters in 40-character chunks, 100 chunks a second.
      const chunks = source.match(/[\s\S]{1,40}/g) ?? [];
      const start = performance.now();
      let i = 0;
      while (i < chunks.length) {
        await sleep(10);
        const due = Math.min(chunks.length, Math.ceil(((performance.now() - start) / 1000) * 100));
        for (; i < due; i++) doc.push(chunks[i] as string);
        scroller.scrollTop = scroller.scrollHeight;
      }
      doc.finish();
      const final = await finished(doc);
      await settled(view);
      observer?.disconnect();

      const artifact = final.artifact as PagedArtifact;
      expect(pageEls(view)).toHaveLength(artifact.pageCount);
      // No page was drawn more often than its content changed: the stream only scrolls down,
      // so no page comes back into view to be painted again.
      const drawsOf = new Map<number, number>();
      for (const d of draws) for (const p of d.pages) drawsOf.set(p, (drawsOf.get(p) ?? 0) + 1);
      if (env.VITE_DEBUG)
        await commands.writeFile(`./debug-${renderer}.json`, JSON.stringify({ debug, hashes: [...hashes] }));
      for (const [index, n] of drawsOf)
        expect(n, `page ${index + 1}`).toBeLessThanOrEqual(hashes.get(index)?.length ?? 0);
      // What's on screen is the final artifact.
      const last = pageEls(view).at(-1) as HTMLElement;
      if (renderer === "svg")
        for (const [index, el] of pageEls(view).entries())
          expect(svgOf(el)?.querySelectorAll("use").length).toBe(artifact.pages[index]?.svg.match(/<use /g)?.length);
      else expect(ink(canvasOf(last) as HTMLCanvasElement)).toBeGreaterThan(0.001);

      const frames = draws.filter((d) => d.when === "frame");
      const perStep = frames.map((d) => d.pages.length);
      const ms = frames.map((d) => d.ms);
      const report = {
        browser,
        renderer,
        dpr: devicePixelRatio,
        pages: artifact.pageCount,
        frameDraws: frames.length,
        pagesPerFrameDraw: median(perStep),
        frameDrawMs: { p50: median(ms).toFixed(1), max: Math.max(...ms).toFixed(1) },
        idleDraws: draws.filter((d) => d.when === "idle").length,
        // Long tasks (> 50 ms) by what drew in them: visible pages (with the style, layout and
        // paint that follow in the same frame), idle work (offscreen pages, text layers), or neither.
        longTasks: observer
          ? longTasks.reduce<Record<string, number>>(
              (by, t) => {
                const d = draws.find((d) => d.end - d.ms >= t.startTime - 1 && d.end <= t.startTime + t.duration + 1);
                const key = d ? d.when : "other";
                by[key] = (by[key] ?? 0) + 1;
                return by;
              },
              { total: longTasks.length },
            )
          : "n/a",
      };
      console.log(`STREAM ${JSON.stringify(report)}`);
      if (env.VITE_REPORT) await commands.writeFile(`./stream-${browser}-${renderer}.json`, JSON.stringify(report));
      // Streaming touches the last page or two.
      expect(median(perStep)).toBeLessThanOrEqual(2);
    }, 240_000);

  it("draws visible pages first and the rest in idle time", async () => {
    const artifact = await compile(pages(20));
    const draws: DrawInfo[] = [];
    // Shows about one page.
    const view = createPagedView(container(500, 700), { onDraw: (info) => draws.push(info) });
    cleanups.push(() => view.destroy());
    view.render(artifact);
    expect(view.pending).toBeGreaterThan(artifact.pageCount);
    await settled(view);
    const first = draws[0] as DrawInfo;
    expect(first.when).toBe("frame");
    expect(first.pages).toEqual([0, 1]);
    const later = draws.slice(1);
    expect(later.every((d) => d.when === "idle")).toBe(true);
    expect(later.flatMap((d) => d.pages).sort((a, b) => a - b)).toEqual(
      Array.from({ length: artifact.pageCount - 2 }, (_, i) => i + 2),
    );
    // Text layers come after the SVGs they belong to, visible pages first.
    expect(draws.flatMap((d) => d.textLayers).slice(0, 2)).toEqual([0, 1]);
  }, 120_000);

  it("paints only pages near the viewport, every text layer in idle time, and every page before printing", async () => {
    const artifact = await compile(pages(20), "drawing");
    const draws: DrawInfo[] = [];
    const view = createPagedView(container(500, 700), { onDraw: (info) => draws.push(info) });
    cleanups.push(() => view.destroy());
    view.render(artifact);
    await settled(view);
    expect(draws[0]).toMatchObject({ when: "frame", pages: [0, 1] });
    // No page far from the viewport was painted, but all have text layers.
    expect(draws.flatMap((d) => d.pages).every((p) => p < 3)).toBe(true);
    expect(draws.flatMap((d) => d.textLayers).sort((a, b) => a - b)).toEqual(
      Array.from({ length: artifact.pageCount }, (_, i) => i),
    );
    const canvases = pageEls(view).map((el) => canvasOf(el) as HTMLCanvasElement);
    expect(canvases.filter((c) => c.width > 0).length).toBeLessThanOrEqual(3);

    // Printing paints every page, at least at twice the CSS resolution; afterwards, only the visible keep theirs.
    window.dispatchEvent(new Event("beforeprint"));
    for (const [i, canvas] of canvases.entries())
      expect(canvas.width, `page ${i + 1}`).toBe(
        Math.round((pageEls(view)[i] as HTMLElement).clientWidth * Math.max(2, devicePixelRatio)),
      );
    expect(ink(canvases.at(-1) as HTMLCanvasElement)).toBeGreaterThan(0.001);
    window.dispatchEvent(new Event("afterprint"));
    expect(canvases.at(-1)?.width).toBe(0);
    await settled(view);
    expect(canvases[0]?.width).toBe(Math.round((pageEls(view)[0] as HTMLElement).clientWidth * devicePixelRatio));
  }, 120_000);

  it("draws a page that scrolls into view before the idle queue reaches it", async () => {
    const artifact = await compile(pages(20));
    const draws: DrawInfo[] = [];
    const host = container(500, 700);
    const view = createPagedView(host, { onDraw: (info) => draws.push(info) });
    cleanups.push(() => view.destroy());
    view.render(artifact);
    const last = pageEls(view).at(-1) as HTMLElement;
    last.scrollIntoView();
    const index = artifact.pageCount - 1;
    const drawn = () => draws.findIndex((d) => d.pages.includes(index));
    for (let i = 0; i < 100 && drawn() < 0; i++) await frame();
    // It jumped the queue: pages before it were still waiting. (At the next
    // frame, or in WebKit, whose idle fallback is a timer, often in idle time
    // first, since visible pages lead the idle queue too.)
    expect(drawn()).toBeGreaterThanOrEqual(0);
    expect(draws.slice(0, drawn() + 1).flatMap((d) => d.pages)).not.toContain(index - 3);
    view.flush();
    expect(view.pending).toBe(0);
  }, 120_000);

  it("keeps safe links and makes the others inert", async () => {
    const artifact = await compile(
      `#link("https://typst.app")[safe] and #link("mailto:a@b.c")[mail] and #link("javascript:alert(1)")[bad] and #link("JAVA\tSCRIPT:alert(1)")[bad]`,
    );
    const view = createPagedView(container(500));
    cleanups.push(() => view.destroy());
    view.render(artifact);
    view.flush();
    const links = [...((svgOf(pageEls(view)[0] as HTMLElement) as SVGSVGElement).querySelectorAll("a") ?? [])];
    expect(links).toHaveLength(4);
    const XLINK = "http://www.w3.org/1999/xlink";
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["https://typst.app", "mailto:a@b.c", null, null]);
    expect(links.map((a) => a.getAttributeNS(XLINK, "href"))).toEqual([
      "https://typst.app",
      "mailto:a@b.c",
      null,
      null,
    ]);
    expect(links[0]?.getAttribute("target")).toBe("_blank");
    expect(links[0]?.getAttribute("rel")).toBe("noopener noreferrer");

    // On a drawn page, only the safe ones become links over the canvas.
    const drawn = await compile(
      `#link("https://typst.app")[safe] and #link("mailto:a@b.c")[mail] and #link("javascript:alert(1)")[bad] and #link("JAVA\tSCRIPT:alert(1)")[bad]`,
      "drawing",
    );
    const canvasView = createPagedView(container(500), { linkTarget: null });
    cleanups.push(() => canvasView.destroy());
    canvasView.render(drawn);
    canvasView.flush();
    const overlay = [...(pageEls(canvasView)[0] as HTMLElement).querySelectorAll(".typstream-links a")];
    expect(overlay.map((a) => a.getAttribute("href"))).toEqual(["https://typst.app", "mailto:a@b.c"]);
    expect(overlay.map((a) => a.getAttribute("target"))).toEqual([null, null]);
  }, 120_000);

  it("switches between SVG and drawn pages when the renderer changes", async () => {
    const engine = newEngine();
    const doc = engine.open({ target: "paged", text: pages(2) });
    doc.finish();
    let mounted = mountPaged(container(500), doc, { renderer: "svg" });
    await finished(doc);
    await settled(mounted.view);
    expect(svgOf(pageEls(mounted.view)[0] as HTMLElement)).not.toBeNull();
    mounted.destroy();
    mounted = mountPaged(container(500), doc);
    cleanups.push(() => mounted.destroy());
    // Every page comes again, as a drawing.
    await until(doc, (s) => s.artifact?.target === "paged" && s.artifact.pages.every((p) => !!p.drawing));
    await settled(mounted.view);
    expect(canvasOf(pageEls(mounted.view)[0] as HTMLElement)?.width).toBeGreaterThan(0);
  }, 120_000);
  it("reflow compiles pages as wide as the container and recompiles after a resize", async () => {
    const engine = newEngine();
    const doc = engine.open({ target: "paged", preamble: REFLOW_PREAMBLE, text: pages(2, false) });
    const host = container(600);
    const view = mountPaged(host, doc, { layout: "reflow", resizeDebounce: 50 }).view;
    doc.finish();
    let s = await until(doc, (st) => st.status === "done" && st.artifact?.target === "paged");
    let page = (s.artifact as PagedArtifact).pages[0];
    expect(page?.width).toBe(450);
    expect(page?.height).toBeCloseTo(450 * Math.SQRT2, 1);
    await settled(view);
    expect((pageEls(view)[0] as HTMLElement).getBoundingClientRect().width).toBeCloseTo(600, 0);

    host.style.width = "400px";
    s = await until(
      doc,
      (st) => st.status === "done" && (st.artifact as PagedArtifact | null)?.pages[0]?.width === 300,
    );
    page = (s.artifact as PagedArtifact).pages[0];
    expect(page?.width).toBe(300);
    await settled(view);
    expect((pageEls(view)[0] as HTMLElement).getBoundingClientRect().width).toBeCloseTo(400, 0);
  }, 120_000);

  it("fixed layout shows pages at their authored size, scaled down to fit", async () => {
    const artifact = await compile(`#set page(width: 300pt, height: 200pt)\nSmall page`);
    const wide = createPagedView(container(800));
    const narrow = createPagedView(container(200));
    cleanups.push(
      () => wide.destroy(),
      () => narrow.destroy(),
    );
    for (const view of [wide, narrow]) {
      view.render(artifact);
      view.flush();
    }
    expect((pageEls(wide)[0] as HTMLElement).getBoundingClientRect().width).toBeCloseTo(400, 0);
    expect((pageEls(narrow)[0] as HTMLElement).getBoundingClientRect().width).toBeCloseTo(200, 0);
  }, 120_000);

  it("fit-width scales the authored pages up or down to the container's width", async () => {
    const artifact = await compile(`#set page(width: 300pt, height: 200pt)\nSmall page`);
    const wide = createPagedView(container(800), { layout: "fit-width" });
    const narrow = createPagedView(container(200), { layout: "fit-width" });
    cleanups.push(
      () => wide.destroy(),
      () => narrow.destroy(),
    );
    for (const view of [wide, narrow]) {
      view.render(artifact);
      view.flush();
    }
    // The same 300 × 200 pt page, at the container's width and its own proportions.
    for (const [view, width] of [
      [wide, 800],
      [narrow, 200],
    ] as const) {
      const box = (pageEls(view)[0] as HTMLElement).getBoundingClientRect();
      expect(box.width).toBeCloseTo(width, 0);
      expect(box.height).toBeCloseTo((width * 200) / 300, 0);
    }
  }, 120_000);

  it("gives the text layer the document's structure, language and direction", async () => {
    const artifact = await compile(`#set text(lang: "ar")
#title[Quiz]
= Section
- first
- second
#table(columns: 2, table.header([A], [B]), [1], [])`);
    const view = createPagedView(container(500));
    cleanups.push(() => view.destroy());
    view.render(artifact);
    view.flush();
    const layer = textOf(pageEls(view)[0] as HTMLElement) as HTMLElement;
    // Latin text in an Arabic document: the layer is right to left, the runs left to right.
    expect([layer.lang, layer.dir]).toEqual(["ar", "rtl"]);
    expect(layer.querySelectorAll('span[dir="ltr"]:not([role])').length).toBeGreaterThan(0);
    const headings = [...layer.querySelectorAll('[role="heading"]')].map((h) => [
      h.getAttribute("aria-level"),
      h.textContent,
    ]);
    expect(headings).toEqual([
      ["1", "Quiz"],
      ["2", "Section"],
    ]);
    const roles = (el: Element): unknown[] =>
      [...el.children].flatMap((c) => (c.getAttribute("role") ? [[c.getAttribute("role"), ...roles(c)]] : []));
    const [list, table] = [...layer.querySelectorAll('[role="list"], [role="table"]')] as Element[];
    expect(roles(list as Element)).toEqual([["listitem"], ["listitem"]]);
    expect(roles(table as Element)).toEqual([
      ["row", ["columnheader"], ["columnheader"]],
      ["row", ["cell"], ["cell"]],
    ]);
    // Offscreen pages skip their SVG but not their text layer: skipped content leaves the accessibility tree.
    const page = pageEls(view)[0] as HTMLElement;
    expect(getComputedStyle(page.firstElementChild as Element).contentVisibility).toBe("auto");
    expect(getComputedStyle(page).contentVisibility).toBe("visible");
    // Runs are positioned against the layer, wrapped or not; the wrappers take no space.
    for (const wrapper of layer.querySelectorAll("[role]")) expect(getComputedStyle(wrapper).position).toBe("static");
    // The wrappers don't change what copying gives.
    const copied = selectedText(layer);
    view.render({ ...artifact, pages: artifact.pages.map((p) => ({ ...p, hash: `${p.hash}-flat`, structure: [] })) });
    view.flush();
    expect(layer.querySelector("[role]")).toBeNull();
    expect(selectedText(layer)).toBe(copied);
  }, 120_000);

  it("removes pages when the document gets shorter", async () => {
    const engine = newEngine();
    const doc = engine.open({ target: "paged", text: pages(4) });
    doc.finish();
    const view = mountPaged(container(500), doc).view;
    await finished(doc);
    await settled(view);
    expect(pageEls(view).length).toBeGreaterThanOrEqual(3);
    doc.set("Just one page.");
    await until(doc, (s) => s.status === "done" && (s.artifact as PagedArtifact | null)?.pageCount === 1);
    await settled(view);
    expect(pageEls(view)).toHaveLength(1);
    expect(selectedText(textOf(pageEls(view)[0] as HTMLElement) as HTMLElement)).toBe("Just one page.");
  }, 120_000);
});
