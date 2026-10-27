/// <reference lib="dom" />
// The paged renderer against the real engine worker (src/worker.ts of
// @typstream/engine, bundled by Vite) in Chromium, Firefox and WebKit. Run with
// `pnpm test:browser`.

import type { PagedArtifact } from "@typstream/core";
import { createEngine, type DocumentState, type Engine, type EngineDocument, fromWorker } from "@typstream/engine";
import { afterEach, describe, expect, it } from "vitest";
import { server } from "vitest/browser";
import { createPagedView, type DrawInfo, FIT_WIDTH_PREAMBLE, mountPaged, type PagedView } from "../../src";
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

/** A finished paged compile of `text`. */
const compile = async (text: string): Promise<PagedArtifact> => {
  const doc = newEngine().open({ target: "paged", text });
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
const textOf = (page: HTMLElement) => page.querySelector(".typstream-text-layer") as HTMLElement | null;

const selectedText = (el: Element) => {
  const selection = getSelection() as Selection;
  selection.selectAllChildren(el);
  const text = selection.toString();
  selection.removeAllRanges();
  return text;
};

describe(`paged renderer in ${browser}`, () => {
  it("renders a 20-page document: every page, glyphs, a selectable and searchable text layer", async () => {
    const engine = newEngine();
    const doc = engine.open({ target: "paged", text: pages(20) });
    doc.finish();
    const view = mountPaged(container(700), doc).view;
    const s = await finished(doc);
    await settled(view);
    const artifact = s.artifact as PagedArtifact;
    expect(artifact.pageCount).toBeGreaterThanOrEqual(18);

    const els = pageEls(view);
    expect(els).toHaveLength(artifact.pageCount);
    els.forEach((el, i) => {
      const page = artifact.pages[i];
      const svg = svgOf(el);
      expect(svg?.querySelectorAll("use").length).toBe(page?.svg.match(/<use /g)?.length);
      expect(svg?.getAttribute("aria-hidden")).toBe("true");
      expect(textOf(el)?.childElementCount).toBeGreaterThan(0);
    });
    // Glyph ids resolve inside each page's shadow root: a <use> on a late page has a box.
    const use = svgOf(els[10] as HTMLElement)?.querySelector("use") as SVGGraphicsElement;
    expect(use.getBBox().width).toBeGreaterThan(0);
    // Pages keep A4's proportions.
    const box = (els[3] as HTMLElement).getBoundingClientRect();
    expect(box.height / box.width).toBeCloseTo(297 / 210, 2);

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

  it("streams with only changed pages redrawn, and reports draw times and long tasks", async () => {
    const source = pages(20);
    const engine = newEngine();
    const doc = engine.open({ target: "paged" });
    const draws: (DrawInfo & { end: number })[] = [];
    const view = mountPaged(container(700, 900), doc, {
      onDraw: (info) => draws.push({ ...info, end: performance.now() }),
    }).view;
    // Follow the stream at the bottom, as a chat or side panel does.
    const scroller = view.element.parentElement as HTMLElement;

    // Each page's shadow root is observed: it may change only when that page's hash does.
    const hashes = new Map<number, string[]>();
    const mutations = new Map<number, number>();
    const observed = new WeakSet<Node>();
    doc.subscribe((s) => {
      if (s.artifact?.target !== "paged") return;
      for (const page of s.artifact.pages) {
        const seen = hashes.get(page.index) ?? [];
        if (seen.at(-1) !== page.hash) seen.push(page.hash);
        hashes.set(page.index, seen);
      }
    });
    const watch = () => {
      pageEls(view).forEach((el, i) => {
        const root = el.firstElementChild?.shadowRoot;
        if (!root || observed.has(root)) return;
        observed.add(root);
        new MutationObserver(() => mutations.set(i, (mutations.get(i) ?? 0) + 1)).observe(root, { childList: true });
      });
    };

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
      watch();
      scroller.scrollTop = scroller.scrollHeight;
    }
    doc.finish();
    const final = await finished(doc);
    await settled(view);
    observer?.disconnect();
    watch();

    const artifact = final.artifact as PagedArtifact;
    expect(pageEls(view)).toHaveLength(artifact.pageCount);
    // No page was redrawn more often than its content changed (the first draw of a page is a mutation too).
    for (const [index, n] of mutations)
      expect(n, `page ${index + 1}`).toBeLessThanOrEqual(hashes.get(index)?.length ?? 0);
    // What's on screen is the final artifact.
    for (const [index, el] of pageEls(view).entries())
      expect(svgOf(el)?.querySelectorAll("use").length).toBe(artifact.pages[index]?.svg.match(/<use /g)?.length);

    const frames = draws.filter((d) => d.when === "frame");
    const perStep = frames.map((d) => d.pages.length);
    const ms = frames.map((d) => d.ms);
    const report = {
      browser,
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
  }, 120_000);

  it("fit-width compiles pages as wide as the container and recompiles after a resize", async () => {
    const engine = newEngine();
    const doc = engine.open({ target: "paged", preamble: FIT_WIDTH_PREAMBLE, text: pages(2, false) });
    const host = container(600);
    const view = mountPaged(host, doc, { layout: "fit-width", resizeDebounce: 50 }).view;
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
