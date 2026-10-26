/// <reference lib="dom" />
// #14 research, run by hand: VITE_RESEARCH=1 pnpm test:browser research
// Measures glyph <defs> sharing and text-layer candidates in each browser and
// prints JSON. Not part of the regular suite.

import type { PagedArtifact, PageUpdate } from "@typstream/core";
import { createEngine, fromWorker } from "@typstream/engine";
import { expect, it } from "vitest";
import { server } from "vitest/browser";
import { pages as documentOfPages } from "../support/documents";

// Vite exposes VITE_* variables to the browser.
const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const run = !!env.VITE_RESEARCH;
const spawn = () =>
  fromWorker(() => new Worker(new URL("../../../engine/src/worker.ts", import.meta.url), { type: "module" }));

const compile = async (text: string): Promise<PagedArtifact> => {
  const engine = createEngine({ spawn: spawn() });
  const doc = engine.open({ target: "paged", text });
  doc.finish();
  const artifact = await new Promise<PagedArtifact>((resolve, reject) => {
    const stop = doc.subscribe((s) => {
      if (s.status === "error") reject(new Error(s.failure?.message));
      if (s.status === "done" && s.artifact?.target === "paged") {
        stop();
        resolve(s.artifact);
      }
    });
  });
  engine.dispose();
  return artifact;
};

const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

const SYMBOLS = /<symbol[\s\S]*?<\/symbol>/g;
const strip = (svg: string) => svg.replace(SYMBOLS, "");

/** Time to put `html` into fresh page elements and lay them out, then to the next frame. */
const insert = async (root: HTMLElement, svgs: string[]) => {
  root.replaceChildren();
  await frame();
  const t0 = performance.now();
  for (const svg of svgs) {
    const el = document.createElement("div");
    el.className = "page";
    el.innerHTML = svg;
    root.append(el);
  }
  void root.offsetHeight;
  const sync = performance.now() - t0;
  await frame();
  return { sync, frame: performance.now() - t0 };
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Candidate A: transparent SVG <text> stretched with textLength, same viewBox as the page. */
const svgLayer = (p: PageUpdate) => {
  let out = `<svg class="tl" viewBox="0 0 ${p.width} ${p.height}" xmlns="http://www.w3.org/2000/svg">`;
  for (const r of p.text ?? [])
    out += `<text x="${r.x}" y="${r.y}" font-size="${r.size}" textLength="${r.width}" lengthAdjust="spacingAndGlyphs">${esc(r.text)}</text>`;
  return `${out}</svg>`;
};

/** Candidate B: absolutely positioned HTML spans in points, scaled with the page (pdf.js-like, no measuring). */
const htmlLayer = (p: PageUpdate) => {
  let out = `<div class="hl" style="width:${p.width}px;height:${p.height}px">`;
  let lastY: number | null = null;
  for (const r of p.text ?? []) {
    if (lastY !== null && Math.abs(r.y - lastY) > r.size * 0.5) out += "<br>";
    lastY = r.y;
    out += `<span style="left:${r.x}px;top:${r.y - r.size * 0.8}px;font-size:${r.size}px;width:${r.width}px">${esc(r.text)}</span>`;
  }
  return `${out}</div>`;
};

const style = `
.page { position: relative; width: 600px; margin: 8px; }
.page > svg { display: block; width: 100%; height: auto; }
.tl { position: absolute; inset: 0; width: 100%; height: 100%; }
.tl text { fill: transparent; white-space: pre; font-family: sans-serif; }
.hl { position: absolute; left: 0; top: 0; transform-origin: 0 0; color: transparent; }
.hl span { position: absolute; white-space: pre; line-height: 1; font-family: sans-serif; }
`;

/** How each strategy puts a page's SVG into its element; resolves once it can be painted. */
type Put = (el: HTMLElement, svg: string, index: number) => Promise<void> | void;
const strategies: Record<string, { prepare: (svg: string, index: number) => string; put: Put }> = {
  // typst-svg's output as is: every page repeats the glyph <symbol>s it uses, under the same ids.
  asIs: {
    prepare: (svg) => svg,
    put: (el, svg) => {
      el.innerHTML = svg;
    },
  },
  // Glyph <symbol>s moved to one shared sprite; pages keep only <use>s.
  sprite: {
    prepare: strip,
    put: (el, svg) => {
      el.innerHTML = svg;
    },
  },
  // One shadow root per page: ids resolve inside it, so pages can't see each other's.
  shadow: {
    prepare: (svg) => svg,
    put: (el, svg) => {
      const root = el.shadowRoot ?? el.attachShadow({ mode: "open" });
      root.innerHTML = svg;
    },
  },
  // Ids made unique per page (string rewrite before insertion, timed).
  prefix: {
    prepare: (svg) => svg,
    put: (el, svg, i) => {
      el.innerHTML = svg.replace(/(id="|#)g/g, `$1p${i}g`);
    },
  },
  // The page as an image: decoded off the document, swapped in once decoded.
  img: {
    prepare: (svg) => svg,
    put: async (el, svg) => {
      const img = new Image();
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      img.src = url;
      await img.decode();
      const old = el.firstElementChild as HTMLImageElement | null;
      if (old) URL.revokeObjectURL(old.src);
      el.replaceChildren(img);
    },
  },
};

/** Longest gap between animation frames while `f` runs (and one frame after): the jank a user sees. */
const jank = async (f: () => Promise<void> | void) => {
  let last = performance.now();
  let worst = 0;
  let on = true;
  const tick = () => {
    const now = performance.now();
    worst = Math.max(worst, now - last);
    last = now;
    if (on) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  await frame();
  worst = 0;
  const t0 = performance.now();
  await f();
  const done = performance.now() - t0;
  await frame();
  await frame();
  on = false;
  return { done, worst };
};

it.runIf(run)(
  "research: one streamed step with 20 pages on screen",
  async () => {
    const text = documentOfPages(20);
    const a = await compile(text);
    const b = await compile(`${text}\nOne more streamed sentence at the end.`);
    // Steps alternate the last page between two versions, so every step changes it.
    const lastA = a.pages.at(-1)?.svg ?? "";
    const lastB = b.pages[a.pageCount - 1]?.svg ?? "";
    const symbols = new Map<string, string>();
    for (const p of [...a.pages, ...b.pages])
      for (const m of p.svg.matchAll(/<symbol id="(\w+)"[\s\S]*?<\/symbol>/g)) symbols.set(m[1] as string, m[0]);
    const s = document.createElement("style");
    s.textContent = `${style} .page { content-visibility: auto; contain-intrinsic-size: auto 848px; } .page > img { display: block; width: 100%; }`;
    document.head.append(s);
    const result: Record<string, unknown> = { browser: server.browser, pages: a.pageCount };
    for (const [name, st] of Object.entries(strategies)) {
      const host = document.createElement("div");
      document.body.append(host);
      if (name === "sprite")
        host.innerHTML = `<svg width="0" height="0" style="position:absolute"><defs>${[...symbols.values()].join("")}</defs></svg>`;
      const els = a.pages.map(() => {
        const el = document.createElement("div");
        el.className = "page";
        host.append(el);
        return el;
      });
      // Scrolled to the end, where streaming happens.
      const prepared = a.pages.map((p, i) => st.prepare(p.svg, i));
      const first = await jank(async () => {
        await Promise.all(prepared.map((svg, i) => st.put(els[i] as HTMLElement, svg, i)));
        void host.offsetHeight;
      });
      (els.at(-1) as HTMLElement).scrollIntoView();
      const steps = [lastB, lastA].map((svg) => st.prepare(svg, a.pageCount - 1));
      const runs = [];
      for (let i = 0; i < 9; i++)
        runs.push(
          await jank(async () => {
            await st.put(els.at(-1) as HTMLElement, steps[i % 2] as string, a.pageCount - 1);
            void host.offsetHeight;
          }),
        );
      result[name] =
        `all: done ${first.done.toFixed(0)} jank ${first.worst.toFixed(0)} | step: done ${median(runs.map((r) => r.done)).toFixed(1)} jank ${median(runs.map((r) => r.worst)).toFixed(1)}`;
      host.remove();
      await frame();
    }
    console.log(`RESEARCH2 ${JSON.stringify(result)}`);
  },
  600_000,
);

it.runIf(run)(
  "research: glyph defs and text layers",
  async () => {
    const text = documentOfPages(20);
    const full = await compile(text);
    const step = await compile(`${text}\nOne more streamed sentence at the end.`);
    const svgs = full.pages.map((p) => p.svg);
    const stripped = svgs.map(strip);
    const symbols = new Map<string, string>();
    for (const svg of svgs)
      for (const m of svg.matchAll(/<symbol id="(\w+)"[\s\S]*?<\/symbol>/g)) symbols.set(m[1] as string, m[0]);
    const sprite = `<svg width="0" height="0" style="position:absolute"><defs>${[...symbols.values()].join("")}</defs></svg>`;

    const s = document.createElement("style");
    s.textContent = style;
    document.head.append(s);
    const root = document.createElement("div");
    document.body.append(root);
    const spriteHost = document.createElement("div");
    document.body.append(spriteHost);

    const result: Record<string, unknown> = {
      browser: server.browser,
      pages: full.pageCount,
      kb: Math.round(svgs.join("").length / 1024),
      kbStripped: Math.round(stripped.join("").length / 1024),
      kbSprite: Math.round(sprite.length / 1024),
      uses: svgs.join("").match(/<use /g)?.length,
      changedOnStep: step.pages.length,
    };

    const N = 5;
    const measure = async (label: string, f: () => Promise<{ sync: number; frame: number }>) => {
      const runs = [];
      for (let i = 0; i < N; i++) runs.push(await f());
      result[label] = `${median(runs.map((r) => r.sync)).toFixed(1)} / ${median(runs.map((r) => r.frame)).toFixed(1)}`;
    };

    // All pages (first paint of a finished document).
    await measure("allPages.full", () => insert(root, svgs));
    spriteHost.innerHTML = sprite;
    await measure("allPages.stripped", () => insert(root, stripped));
    // Shared defs must still draw: a <use> of a stripped page has a box.
    const use = root.querySelector("use") as SVGGraphicsElement;
    result.strippedUseWidth = use.getBBox().width;

    // One streamed step: replace the last page.
    const replaceLast = async (svg: string) => {
      const last = root.lastElementChild as HTMLElement;
      await frame();
      const t0 = performance.now();
      last.innerHTML = svg;
      void root.offsetHeight;
      const sync = performance.now() - t0;
      await frame();
      return { sync, frame: performance.now() - t0 };
    };
    const lastSvg = step.pages.at(-1)?.svg ?? "";
    await insert(root, svgs);
    await measure("onePage.full", () => replaceLast(lastSvg));
    await insert(root, stripped);
    await measure("onePage.stripped", () => replaceLast(strip(lastSvg)));
    spriteHost.replaceChildren();

    // Text layers over every page.
    await insert(root, svgs);
    const pageEls = [...root.children] as HTMLElement[];
    const layer = async (build: (p: PageUpdate) => string, scale: boolean) => {
      for (const el of pageEls) el.querySelector(".tl,.hl")?.remove();
      await frame();
      const t0 = performance.now();
      full.pages.forEach((p, i) => {
        const el = pageEls[i] as HTMLElement;
        el.insertAdjacentHTML("beforeend", build(p));
        if (scale) (el.lastElementChild as HTMLElement).style.transform = `scale(${600 / p.width})`;
      });
      void root.offsetHeight;
      const sync = performance.now() - t0;
      await frame();
      return { sync, frame: performance.now() - t0 };
    };
    result.runs = full.pages.reduce((n, p) => n + (p.text?.length ?? 0), 0);
    const selection = (sel: string) => {
      const el = root.querySelector(sel) as Element;
      getSelection()?.selectAllChildren(el);
      const t = getSelection()?.toString() ?? "";
      getSelection()?.removeAllRanges();
      return t;
    };
    const find = (q: string) => {
      getSelection()?.removeAllRanges();
      // biome-ignore lint/suspicious/noExplicitAny: window.find is non-standard.
      return (window as any).find?.(q) ?? "no window.find";
    };
    await measure("textLayer.svg", () => layer(svgLayer, false));
    result["svg.selection"] = selection(".tl").slice(0, 240);
    result["svg.find"] = find("triangle inequality");
    await measure("textLayer.html", () => layer(htmlLayer, true));
    result["html.selection"] = selection(".hl").slice(0, 240);
    result["html.find"] = find("triangle inequality");

    console.log(`RESEARCH ${JSON.stringify(result)}`);
    expect(result.strippedUseWidth).toBeGreaterThan(0);
  },
  300_000,
);

it.runIf(run)(
  "research: where a page swap's time goes",
  async () => {
    const a = await compile(documentOfPages(20));
    const original = a.pages[3]?.svg ?? "";
    // Variant: every <use> of a glyph replaced by its outline <path>, so no <use> shadow trees.
    const outlines = new Map<string, string>();
    for (const m of original.matchAll(/<symbol id="(\w+)" overflow="visible">(<path d="[^"]*"\/>)<\/symbol>/g))
      outlines.set(m[1] as string, m[2] as string);
    const inlined = original
      .replace(SYMBOLS, "")
      .replace(/<use xlink:href="#(\w+)" x="([^"]*)" y="([^"]*)"([^>]*)\/>/g, (all, id, x, y, rest) => {
        const path = outlines.get(id);
        return path ? path.replace("<path ", `<path transform="translate(${x} ${y})"${rest} `) : all;
      });
    // Variant: the same drawing in fewer bytes: SVG defaults dropped, SVG 2 href, short glyph ids.
    const ids = new Map<string, string>();
    const short = (id: string) => {
      if (!ids.has(id)) ids.set(id, `g${ids.size.toString(36)}`);
      return ids.get(id) as string;
    };
    const trimmed = original
      .replace(/ fill-rule="nonzero"/g, "")
      .replace(/ y="0"/g, "")
      .replace(/xlink:href="#(g\w+)"/g, (_, id) => `href="#${short(id)}"`)
      .replace(/<symbol id="(g\w+)"/g, (_, id) => `<symbol id="${short(id)}"`);
    const svg = env.VITE_INLINE ? inlined : env.VITE_TRIM ? trimmed : original;
    const result: Record<string, unknown> = {
      browser: server.browser,
      variant: env.VITE_INLINE ? "inlined paths" : env.VITE_TRIM ? "trimmed" : "as is",
      kb: Math.round(svg.length / 1024),
      uses: svg.match(/<use /g)?.length ?? 0,
    };
    const parse: number[] = [];
    const attach: number[] = [];
    const paint: number[] = [];
    const host = document.createElement("div");
    host.style.width = "600px";
    document.body.append(host);
    for (let i = 0; i < 9; i++) {
      await frame();
      const t0 = performance.now();
      const el = document.createElement("div");
      el.innerHTML = svg.replace("<svg ", '<svg style="width:100%;height:auto" ');
      const t1 = performance.now();
      host.replaceChildren(el);
      void host.offsetHeight;
      const t2 = performance.now();
      await frame();
      parse.push(t1 - t0);
      attach.push(t2 - t1);
      paint.push(performance.now() - t2);
    }
    result.parse = median(parse).toFixed(1);
    result.styleLayout = median(attach).toFixed(1);
    result.toNextFrame = median(paint).toFixed(1);
    // A trivial frame, for the machine's baseline.
    const idle: number[] = [];
    for (let i = 0; i < 9; i++) {
      const t0 = performance.now();
      await frame();
      idle.push(performance.now() - t0);
    }
    result.idleFrame = median(idle).toFixed(1);
    console.log(`RESEARCH3 ${JSON.stringify(result)}`);
  },
  300_000,
);
