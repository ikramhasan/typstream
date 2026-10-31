/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// The HTML target against the paged view: switching a document between the targets shouldn't change how it looks.
// Each example is mounted both ways in the document panel (`fit-width`), the HTML target with html-compat and Typst's
// fonts, as `<Typstream>` mounts it; then every line of the pages' text (the paged artifact's runs, in points) is
// looked for in the HTML target's pages (each character's box, in points from its sheet's top left) and must be on the
// same page, within {@link TOLERANCE} of where Typst set it.
//
// What isn't compared: text the HTML draws as pictures (equations, drawings: their text is in an SVG) and lines whose
// text differs between the two (a line Typst's equation runs split differently). A line starting with spaces (code's
// indentation) is compared by its height only: Typst's run starts at the spaces, the DOM's characters after them.

import type { PagedArtifact, TypstreamPlugin } from "@typstream/core";
import { mountTypstream, type TypstFont } from "@typstream/dom";
import type { Engine } from "@typstream/engine";
import { baseFonts, extraFonts, scriptFonts } from "@typstream/engine-wasm/fonts";
import { htmlCompat } from "@typstream/html-compat";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { server } from "vitest/browser";
import { finished, host, shown, steady, until, warmFonts } from "./mount";
import { startEngine } from "./paged";
import type { ConformanceExample, ConformanceSuite } from "./suite";

/** How far (pt) a line of the HTML target may be from where the pages have it. */
export const TOLERANCE = 1;

/** CSS width of the panel, as the paged half's. */
const WIDTH = 800;

const BASE_FAMILIES: Record<string, string> = {
  LibertinusSerif: "Libertinus Serif",
  NewCMMath: "New Computer Modern Math",
  DejaVuSansMono: "DejaVu Sans Mono",
};
const variant = (file: string): Pick<TypstFont, "weight" | "style"> => ({
  weight: /Semibold/.test(file) ? 600 : /Bold/.test(file) ? 700 : 400,
  style: /Italic|Oblique/.test(file) ? "italic" : "normal",
});

/** The engine's fonts, as the `typstream` package gives them to `<Typstream>`. */
export const typstFonts: readonly TypstFont[] = [
  ...baseFonts.map((url) => {
    const file = url.pathname.split("/").pop() ?? "";
    const family = Object.entries(BASE_FAMILIES).find(([name]) => file.startsWith(name))?.[1] ?? "Libertinus Serif";
    return { url, family, ...variant(file) };
  }),
  ...[...extraFonts, ...scriptFonts].map(({ url, file, family }) => ({ url, family, ...variant(file) })),
];

/** A line of text on a page, in points from its top left. */
export interface Line {
  text: string;
  x: number;
  y: number;
  page: number;
  /** It starts with spaces (Typst's run does): its `x` isn't its first letter's. */
  indented?: boolean;
}

const squash = (s: string) => s.replace(/\s+/g, "").replace(/[­​⁠]/g, "");

/** Runs or characters on the same baseline (within 0.8 pt) of a page joined into lines, top to bottom. */
const toLines = (items: Line[]): Line[] => {
  const lines: Line[] = [];
  for (const it of items) {
    const line = lines.find((l) => l.page === it.page && Math.abs(l.y - it.y) < 0.8);
    if (!line) lines.push({ ...it });
    else if (it.x < line.x) Object.assign(line, { text: it.text + line.text, x: it.x, indented: it.indented });
    else line.text += it.text;
  }
  for (const l of lines) l.text = squash(l.text).replace(/\.{3,}/g, "…");
  return lines.filter((l) => l.text).sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
};

interface Box {
  page: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Lines of the pages' text, leaving out runs inside `skip` (what the HTML draws as pictures). */
export const pagedLines = (a: PagedArtifact, skip: Box[] = []): Line[] =>
  toLines(
    a.pages.flatMap((p, page) =>
      (p.text ?? [])
        .filter(
          (r) =>
            !skip.some((b) => b.page === page && r.x >= b.x0 - 1 && r.x <= b.x1 + 1 && r.y >= b.y0 - 1 && r.y <= b.y1 + 1),
        )
        .map((r) => ({ text: r.text, x: r.x, y: r.y, page, ...(/^\s/.test(r.text) ? { indented: true } : {}) })),
    ),
  );

/** The HTML target's sheets, and points per CSS pixel of them. */
const sheetsOf = (el: HTMLElement, pageWidth: number) => {
  const sheets = [...el.querySelectorAll<HTMLElement>(".typstream-pages .typstream-page")].map((s) =>
    s.getBoundingClientRect(),
  );
  const pt = sheets[0] ? pageWidth / sheets[0].width : 0.75;
  const at = (r: DOMRect) => {
    const page = Math.max(
      0,
      sheets.findIndex((b) => r.top >= b.top - 1 && r.top < b.bottom),
    );
    return { page, sheet: sheets[page] as DOMRect };
  };
  return { pt, at };
};

/** Where the HTML target draws pictures (equations, drawings), in points on its pages. */
export const htmlPictures = (el: HTMLElement, pageWidth: number): Box[] => {
  const { pt, at } = sheetsOf(el, pageWidth);
  return [...el.querySelectorAll(".typstream-flow svg:not(svg svg)")].map((svg) => {
    const r = svg.getBoundingClientRect();
    const { page, sheet } = at(r);
    return {
      page,
      x0: (r.left - sheet.left) * pt,
      y0: (r.top - sheet.top) * pt,
      x1: (r.right - sheet.left) * pt,
      y1: (r.bottom - sheet.top) * pt,
    };
  });
};

/** Lines of the HTML target's text: each character's box, its baseline where the profile's line box puts it. */
export const htmlLines = (el: HTMLElement, pageWidth: number): Line[] => {
  const { pt, at } = sheetsOf(el, pageWidth);
  const items: Line[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    const parent = t.parentElement;
    if (!parent || parent.closest(".typstream-caret, .ts-sr, math, svg")) continue;
    if (getComputedStyle(parent).visibility === "hidden") continue;
    const size = Number.parseFloat(getComputedStyle(parent).fontSize);
    const words = /\S+/g;
    for (let m = words.exec(t.data); m; m = words.exec(t.data)) {
      // Each character, so a word broken across lines lands on both.
      for (let k = 0; k < m[0].length; k++) {
        range.setStart(t, m.index + k);
        range.setEnd(t, m.index + k + 1);
        const r = [...range.getClientRects()].find((q) => q.width > 0);
        if (!r) continue;
        const { page, sheet } = at(r);
        const x = (r.left - sheet.left) * pt;
        // The baseline: 0.246em above the bottom of the character's box, which is the profile's line box.
        items.push({ text: m[0][k] as string, x, y: (r.bottom - sheet.top) * pt - 0.246 * size * 0.75, page });
      }
    }
  }
  return toLines(items);
};

/** A line's letters in any order: right-to-left text comes out of the DOM in visual order. */
const key = (t: string) => [...t].sort().join("");

/** What differs between the pages' lines and the HTML target's. */
export interface LineComparison {
  /** Lines of the pages found in the HTML target. */
  matched: number;
  /** Lines of the pages. */
  lines: number;
  /** Lines found on another page. */
  offPage: string[];
  /** Lines further than {@link TOLERANCE} from where the pages have them. */
  moved: string[];
}

/** Pairs each line of `paged` with the next of `html` with its letters, in order, and reports what differs. */
export const compareLines = (paged: Line[], html: Line[]): LineComparison => {
  const out: LineComparison = { matched: 0, lines: paged.length, offPage: [], moved: [] };
  let j = 0;
  for (const want of paged) {
    let k = j;
    while (k < html.length && k < j + 6 && key((html[k] as Line).text) !== key(want.text)) k++;
    const got = html[k];
    if (!got || key(got.text) !== key(want.text)) continue;
    j = k + 1;
    out.matched++;
    const where = `"${want.text.slice(0, 40)}" (page ${want.page + 1}, y ${want.y.toFixed(1)} pt)`;
    if (got.page !== want.page) {
      out.offPage.push(`${where} on page ${got.page + 1}`);
      continue;
    }
    const dy = got.y - want.y;
    const dx = want.indented ? 0 : got.x - want.x;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > TOLERANCE)
      out.moved.push(`${where} moved ${dx.toFixed(1)}, ${dy.toFixed(1)} pt`);
  }
  return out;
};

/** Mounts `example` both ways in the document panel and compares the HTML target's lines with the pages'. */
export const compareHtml = async (
  engine: Engine,
  example: ConformanceExample,
  plugins: readonly TypstreamPlugin[],
): Promise<LineComparison> => {
  const withCompat = plugins.some((p) => p.key === htmlCompat.key) ? plugins : [htmlCompat, ...plugins];
  const mounted = [];
  try {
    const states = [];
    for (const target of ["paged", "html"] as const) {
      const el = host(WIDTH);
      const view = mountTypstream(el, {
        engine,
        source: example.source,
        isStreaming: false,
        target,
        layout: "fit-width",
        caret: false,
        animated: false,
        plugins: withCompat,
        fonts: typstFonts,
        files: example.files ?? {},
        ...(example.inputs ? { inputs: example.inputs } : {}),
        lazy: false,
      });
      mounted.push({ el, view });
      await until(view, finished);
      const s = await steady(() => view.getState());
      await shown(el, s.artifact);
      states.push({ el, s });
    }
    await document.fonts.ready;
    const [paged, html] = states as [(typeof states)[0], (typeof states)[0]];
    if (paged.s.artifact?.target !== "paged") throw new Error(`${example.name}: not paged`);
    const width = paged.s.artifact.pages[0]?.width ?? 595.28;
    return compareLines(pagedLines(paged.s.artifact, htmlPictures(html.el, width)), htmlLines(html.el, width));
  } finally {
    for (const { el, view } of mounted) {
      view.destroy();
      el.remove();
    }
  }
};

/**
 * Defines the suite's HTML tests (vitest browser mode, with its paged ones): each example's lines in the HTML target
 * are where its pages have them, to {@link TOLERANCE}, and on the same page.
 */
export const htmlConformance = (suite: ConformanceSuite): void => {
  describe(`${suite.name}: HTML target = paged view in ${server.browser}`, () => {
    let engine: Engine;
    beforeAll(async () => {
      engine = startEngine();
      await engine.ready;
      await warmFonts(engine);
    }, 60_000);
    afterAll(() => engine.dispose());

    it.for(suite.examples)("$name", { timeout: 120_000 }, async (example, { skip }) => {
      if (example.htmlGap) skip(example.htmlGap);
      const result = await compareHtml(engine, example, suite.plugins);
      expect([...result.offPage, ...result.moved]).toEqual([]);
      // Most lines are found: the HTML target shows the text the pages do.
      expect(result.matched, `${result.matched} of ${result.lines} lines found`).toBeGreaterThanOrEqual(
        Math.floor(result.lines * 0.6),
      );
    });
  });
};
