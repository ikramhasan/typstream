/// <reference lib="dom" />
// The HTML renderer on real engine output, in each browser: corpus documents
// compiled by the engine worker with html-compat and source anchors.
// - Splitting into blocks and parsing them one by one gives the DOM a parse of
//   the whole document gives.
// - Anchors resolve blocks to the source they came from.
// - While a document streams, a block whose HTML didn't change keeps its DOM
//   node, and the final DOM equals a fresh render of the final HTML.
// - Main-thread time per update at 20 pages (PLAN §11.5).
// - Pages: the document breaks across sheets where Typst breaks its pages.

import type { DocumentState, Engine } from "@typstream/engine";
import { htmlCompat, htmlCompatCss } from "@typstream/html-compat";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commands, server } from "vitest/browser";
import { registerTypstFonts } from "../../src/html/fonts";
import { compactGlyphs, createHtmlRenderer, type HtmlRenderer } from "../../src/html/renderer";
import { collapseSpaces, rowRuns, styleSpaces } from "../../src/html/runs";
import { createSanitizer, hideStyles } from "../../src/html/sanitize";
import { splitHtml } from "../../src/html/split";
import { TYPST_MATH_CSS } from "../../src/html/styles";
import {
  type CorpusDocument,
  compileHtml,
  FONTS,
  openHtml,
  startEngine,
  stream,
  TWENTY_PAGES,
  tokens,
  until,
} from "../support/html";

const browser = server.browser;

let engine: Engine;
let corpus: CorpusDocument[];
beforeAll(async () => {
  engine = startEngine();
  await engine.ready;
  corpus = await commands.corpusEntries();
}, 60_000);
afterAll(() => engine.dispose());

const mount = (options: Parameters<typeof createHtmlRenderer>[1] = {}): HtmlRenderer => {
  const root = document.createElement("div");
  document.body.append(root);
  return createHtmlRenderer(root, { plugins: [htmlCompat], stylesheets: [htmlCompatCss], ...options });
};

const unmount = (renderer: HtmlRenderer) => {
  renderer.dispose();
  renderer.root.remove();
};

/** The whole body parsed at once, without anchors, sanitized as the renderer does. */
const parseWhole = (html: string, idPrefix: string): string => {
  // As the renderer parses: inline styles applied through the CSSOM (sanitize.ts).
  const body = new DOMParser().parseFromString(hideStyles(compactGlyphs(html)), "text/html").body;
  for (const anchor of Array.from(body.querySelectorAll("typstream-anchor"))) anchor.remove();
  createSanitizer({ idPrefix, plugins: [htmlCompat] })(body);
  collapseSpaces(body, document);
  styleSpaces(body, document);
  rowRuns(body, document);
  // Glyph outlines go to the renderer's root, once each (checked below).
  for (const symbol of Array.from(body.querySelectorAll("symbol"))) if (GLYPH_ID.test(symbol.id)) symbol.remove();
  return body.innerHTML;
};

/** typst-svg's glyph ids, prefixed by the renderer. */
const GLYPH_ID = /^[a-z]+-g[0-9A-F]{1,32}$/;

/** Every `<use>` in the flow finds its glyph in the root's outlines, which hold each once. */
const glyphProblems = (root: HTMLElement): string[] => {
  const sheet = root.querySelector(":scope > .typstream-glyphs");
  const ids = Array.from(sheet?.children ?? []).map((el) => el.id);
  const problems = ids.filter((id, i) => ids.indexOf(id) !== i).map((id) => `twice: ${id}`);
  const flow = root.querySelector(".typstream-flow") as HTMLElement;
  for (const use of Array.from(flow.querySelectorAll("use"))) {
    const target = (use.getAttribute("xlink:href") ?? use.getAttribute("href") ?? "").slice(1);
    if (GLYPH_ID.test(target) && !ids.includes(target)) problems.push(`missing: ${target}`);
  }
  for (const symbol of Array.from(flow.querySelectorAll("symbol")))
    if (GLYPH_ID.test(symbol.id)) problems.push(`in the flow: ${symbol.id}`);
  return problems;
};

/** The document as the renderer shows it: its flow, without its own spans around text, page breaks and source offsets. */
const withoutSrc = (root: HTMLElement): string => {
  const clone = (root.querySelector(".typstream-flow") as HTMLElement).cloneNode(true) as HTMLElement;
  for (const el of Array.from(clone.querySelectorAll("[data-typstream-src]"))) el.removeAttribute("data-typstream-src");
  for (const el of Array.from(clone.querySelectorAll("[data-typstream-start]")))
    el.removeAttribute("data-typstream-start");
  for (const el of Array.from(clone.querySelectorAll(".typstream-break"))) el.remove();
  // The pages' own: each block's page settings, and the corrections they make (spacings around `v`, the baseline
  // of smaller text on a line).
  for (const name of ["page", "numbering", "parts", "counter"])
    for (const el of Array.from(clone.querySelectorAll(`[data-typstream-${name}]`)))
      el.removeAttribute(`data-typstream-${name}`);
  for (const v of Array.from(clone.querySelectorAll<HTMLElement>(".ts-v-both"))) {
    v.classList.remove("ts-v-both");
    v.style.removeProperty("margin-block-end");
  }
  for (const el of Array.from(clone.querySelectorAll<HTMLElement>(".typstream-t"))) el.style.removeProperty("--ts-x");
  // What the pages size: fractional spacing, columns.
  for (const el of Array.from(clone.querySelectorAll<HTMLElement>(".typstream-fill > .ts-hfill"))) el.style.width = "";
  for (const el of Array.from(clone.querySelectorAll<HTMLElement>(".ts-vfill"))) el.style.height = "";
  for (const el of Array.from(clone.querySelectorAll<HTMLElement>(".ts-columns"))) {
    el.style.height = "";
    el.style.columnFill = "";
  }
  for (const el of Array.from(clone.querySelectorAll("[style='']"))) el.removeAttribute("style");
  for (const el of Array.from(clone.querySelectorAll(".typstream-t"))) el.replaceWith(...el.childNodes);
  clone.normalize();
  return clone.innerHTML;
};

/** The document's top-level blocks. */
const blocksOf = (renderer: HtmlRenderer) =>
  Array.from((renderer.root.querySelector(".typstream-flow") as HTMLElement).children).filter(
    (el) => !el.classList.contains("typstream-break"),
  );

describe(`HTML renderer on corpus documents in ${browser}`, () => {
  it("renders every block as a parse of the whole document would", async () => {
    for (const entry of corpus) {
      const doc = openHtml(engine, entry.files);
      const html = await compileHtml(doc, entry.source);
      doc.dispose();
      const renderer = mount({ idPrefix: "t-" });
      const result = renderer.update(html);
      expect(result.blocks, entry.name).toBeGreaterThan(1);
      expect(withoutSrc(renderer.root), entry.name).toBe(parseWhole(html, "t-"));
      expect(glyphProblems(renderer.root), entry.name).toEqual([]);
      unmount(renderer);
    }
  }, 300_000);

  it("keeps one outline of each glyph the equations draw, and leaves a document's own symbols where they are", async () => {
    const doc = openHtml(engine);
    const html = await compileHtml(doc, "Let $x^2 + y^2$ be.\n\n$ x^2 + y^2 = z^2 $\n\nAnd $x + y$.");
    doc.dispose();
    const renderer = mount({ idPrefix: "t-" });
    renderer.update(html);
    expect(glyphProblems(renderer.root)).toEqual([]);
    const sheet = renderer.root.querySelector(".typstream-glyphs") as SVGSVGElement;
    const ids = Array.from(sheet.children).map((el) => el.id);
    // One of each glyph the three equations draw (x, y, z, 2, +, =).
    expect(ids.length).toBe(6);
    const flow = renderer.root.querySelector(".typstream-flow") as HTMLElement;
    // Drawn where they're used, and not where they're kept.
    const use = flow.querySelector("use") as SVGUseElement;
    expect(use.getBoundingClientRect().width).toBeGreaterThan(0);
    expect(sheet.getBoundingClientRect().width).toBe(0);
    // Markup with a glyph's id but other content isn't an outline the root has: it stays in its block.
    const id = (ids[0] as string).slice(2);
    const own = `<symbol id="${id}" overflow="visible"><path d="M 0 0h 9v 9h -9Z"/></symbol>`;
    renderer.update(html.replace("</body>", `<svg><defs>${own}</defs><use xlink:href="#${id}"/></svg></body>`));
    expect(flow.querySelectorAll(`symbol[id="t-${id}"]`).length).toBe(1);
    expect(sheet.children.length).toBe(6);
    // typst-svg's ids drop leading zeros: shorter ones are outlines too.
    const short = '<symbol id="gA1" overflow="visible"><path d="M 0 0h 9v 9h -9Z"/></symbol>';
    renderer.update(html.replace("</body>", `<p><svg><defs>${short}</defs><use xlink:href="#gA1"/></svg></p></body>`));
    expect(sheet.querySelector('[id="t-gA1"]')).not.toBeNull();
    expect(glyphProblems(renderer.root)).toEqual([]);
    unmount(renderer);
    expect(document.querySelector(".typstream-glyphs")).toBeNull();
  });

  it("keeps the outlines a header brings, which the engine sends there first, for the equations below", async () => {
    // A page as tall as its content draws no header, so the anchor that holds it is never parsed for a page.
    const doc = openHtml(engine);
    const html = await compileHtml(doc, "#set page(height: auto, header: [$x + y$])\n\nFirst.\n\nThen $y + x$.");
    doc.dispose();
    const body = html.slice(html.indexOf("<p>Then"));
    expect(body).toContain("<use");
    // The engine sent the outlines with the header, before the body.
    expect(body).not.toContain("<symbol");
    const renderer = mount({ idPrefix: "t-" });
    renderer.update(html);
    expect(glyphProblems(renderer.root)).toEqual([]);
    unmount(renderer);
  });

  it("ships the MathML rules Typst writes into <head>", async () => {
    const doc = openHtml(engine);
    const html = await compileHtml(doc, "$ a/b + vec(1, 2) $");
    doc.dispose();
    const head = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";
    // Comments aside: the renderer's CSS ships without them.
    const normalize = (css: string) =>
      css
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\s+/g, " ")
        .trim();
    expect(normalize(TYPST_MATH_CSS.replaceAll(":where(.typstream) ", ""))).toBe(normalize(head));
  });

  it("sets right-to-left paragraphs from their text, which Typst's HTML doesn't mark", async () => {
    const doc = openHtml(engine);
    const html = await compileHtml(doc, "= Arabic\n\nمرحبا بالعالم. هذا اختبار.\n\nEnglish, then العربية.");
    doc.dispose();
    const renderer = mount();
    renderer.root.style.width = "600px";
    renderer.update(html);
    const [arabic, english] = Array.from(renderer.root.querySelectorAll("p")).map((p) => {
      const range = document.createRange();
      range.selectNodeContents(p);
      const text = range.getBoundingClientRect();
      const box = p.getBoundingClientRect();
      return { left: text.left - box.left, right: box.right - text.right };
    });
    // Arabic hugs the right edge, a paragraph starting in English the left.
    expect(arabic?.right).toBeLessThan(1);
    expect(arabic?.left).toBeGreaterThan(100);
    expect(english?.left).toBeLessThan(1);
    unmount(renderer);
  });

  it("resolves blocks to the source that produced them", async () => {
    let checked = 0;
    const misses: string[] = [];
    for (const entry of corpus) {
      const doc = openHtml(engine, entry.files);
      const html = await compileHtml(doc, entry.source);
      // Anchors are offsets into the source the engine compiled: the input healed, its lint fixes in.
      const compiled = doc.getState().heal.source;
      doc.dispose();
      const renderer = mount();
      renderer.update(html);
      const anchored = Array.from(renderer.root.querySelectorAll("[data-typstream-src]"));
      expect(anchored.length, entry.name).toBeGreaterThan(0);
      for (const el of anchored) {
        const range = renderer.sourceRange(el);
        expect(range?.from, entry.name).toBe(Number(el.getAttribute("data-typstream-src")));
        if (!range) continue;
        expect(renderer.blockAt(range.from), entry.name).not.toBeNull();
        expect(renderer.sourceRange(el.firstChild ?? el), entry.name).toEqual(range);
        // Text blocks: their words come from their range (generated text, like numbering, aside).
        if (!/^(p|h[1-6])$/.test(el.localName)) continue;
        const words = el.textContent?.match(/\p{L}{5,}/gu) ?? [];
        if (words.length === 0) continue;
        checked++;
        const source = compiled.slice(range.from, range.to ?? compiled.length);
        if (!words.some((w) => source.includes(w))) misses.push(`${entry.name}: ${el.textContent?.slice(0, 60)}`);
      }
      unmount(renderer);
    }
    expect(checked).toBeGreaterThan(200);
    expect(misses).toEqual([]);
  }, 300_000);
});

/** Two frames: the renderer lays its pages out at the next frame after an update. */
const laidOut = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

describe(`HTML renderer's pages in ${browser}`, () => {
  it("keeps headers, footers and footnotes inside the pages, however far they reach (#69)", async () => {
    const doc = openHtml(engine);
    const html = await compileHtml(
      doc,
      "#set page(height: 200pt, header: box(width: 3000pt, height: 3000pt, fill: red)," +
        " footer: move(dx: -1500pt, dy: 1500pt, box(width: 3000pt, height: 300pt, fill: blue)))\n" +
        "Text#footnote[#place(dx: -1000pt, dy: 1000pt, box(width: 3000pt, height: 3000pt, fill: green))]",
    );
    doc.dispose();
    const renderer = mount();
    renderer.root.style.cssText += "width: 300px; margin: 100px";
    renderer.update(html);
    await laidOut();
    await laidOut();
    const box = renderer.root.getBoundingClientRect();
    const escaped: string[] = [];
    for (let x = 2; x < innerWidth; x += 10)
      for (let y = 2; y < innerHeight; y += 10) {
        if (x >= box.left - 1 && x <= box.right + 1 && y >= box.top - 1 && y <= box.bottom + 1) continue;
        const hit = document.elementFromPoint(x, y);
        if (hit && renderer.root.contains(hit)) escaped.push(`${x},${y} ${hit.className}`);
      }
    expect(escaped.slice(0, 5)).toEqual([]);
    // They are there, on the page.
    expect(renderer.root.querySelector(".ts-page-header")).not.toBeNull();
    expect(renderer.root.querySelector(".typstream-footnotes")).not.toBeNull();
    unmount(renderer);
  });

  it("repeats a table's header on each page it goes on to, as Typst does", async () => {
    registerTypstFonts(FONTS);
    await document.fonts.load("11pt typstream-libertinus-serif");
    await document.fonts.load("bold 11pt typstream-libertinus-serif");
    const rows = Array.from({ length: 60 }, (_, i) => `[${i + 1}], [Row ${i + 1}],`).join("\n");
    const source = `#table(columns: (auto, 1fr), table.header([*No.*], [*Name*]),\n${rows}\n)`;
    const doc = openHtml(engine);
    const html = await compileHtml(doc, source);
    doc.dispose();
    const renderer = mount();
    renderer.root.style.width = "800px";
    renderer.update(html);
    await laidOut();
    const sheets = Array.from(renderer.root.querySelectorAll<HTMLElement>(".typstream-page"));
    expect(sheets.length).toBe(2);
    // The copies (hidden from screen readers) start the second page, at its text's top; the row after them follows.
    const copies = Array.from(renderer.root.querySelectorAll<HTMLElement>(".ts-head[aria-hidden]"));
    expect(copies.map((c) => c.textContent)).toEqual(["No.", "Name"]);
    const second = (sheets[1] as HTMLElement).getBoundingClientRect();
    const top = (copies[0] as HTMLElement).getBoundingClientRect().top;
    expect(top).toBeGreaterThan(second.top);
    expect(top).toBeLessThan(second.top + 100);
    const next = Array.from(renderer.root.querySelectorAll(".ts-cell")).find(
      (c) => !c.matches(".ts-head") && c.getBoundingClientRect().top > second.top,
    );
    expect(next?.getBoundingClientRect().top).toBeCloseTo((copies[0] as HTMLElement).getBoundingClientRect().bottom, 0);
    unmount(renderer);
  });

  it("sets footnotes at the foot of their page, as Typst does", async () => {
    registerTypstFonts(FONTS);
    await document.fonts.load("11pt typstream-libertinus-serif");
    const source = "Body text#footnote[A note here.] and more.\n\nSecond#footnote[Another note.]";
    const doc = openHtml(engine);
    const html = await compileHtml(doc, source);
    doc.dispose();
    const renderer = mount();
    renderer.root.style.width = "800px";
    renderer.update(html);
    await laidOut();
    const sheet = (renderer.root.querySelector(".typstream-page") as HTMLElement).getBoundingClientRect();
    const notes = renderer.root.querySelector<HTMLElement>(".typstream-footnotes");
    expect([...(notes?.querySelectorAll(".typstream-footnote") ?? [])].map((n) => n.textContent)).toEqual([
      "1A note here.",
      "2Another note.",
    ]);
    // The last entry ends at the foot of the page's text (Typst's default margin, 2.5/21 of A4's width).
    const px = sheet.width / 595.28;
    const bottom = (notes as HTMLElement).getBoundingClientRect().bottom;
    expect(Math.abs(bottom - (sheet.bottom - ((595.28 * 2.5) / 21) * px))).toBeLessThan(2 * px);
    // The endnotes stay in the document, for screen readers, out of sight.
    expect(renderer.root.querySelector('section[role="doc-endnotes"]')?.classList.contains("typstream-endnotes")).toBe(
      true,
    );
    unmount(renderer);
  });

  it("breaks a document across pages where Typst breaks it", async () => {
    registerTypstFonts(FONTS);
    await document.fonts.load("11pt typstream-libertinus-serif");
    await document.fonts.load("bold 11pt typstream-libertinus-serif");
    const source = TWENTY_PAGES.slice(0, 6000);
    const doc = openHtml(engine);
    const html = await compileHtml(doc, source);
    doc.dispose();
    const paged = engine.open({ target: "paged", text: source });
    paged.finish();
    const state = await until(paged, (st) => st.status === "done");
    paged.dispose();
    if (state.artifact?.target !== "paged") throw new Error("no pages");
    const renderer = mount();
    renderer.root.style.width = "800px";
    renderer.update(html);
    await laidOut();
    const sheets = Array.from(renderer.root.querySelectorAll<HTMLElement>(".typstream-page"));
    expect(sheets.length).toBe(state.artifact.pageCount);
    expect(sheets.length).toBeGreaterThan(1);
    // Each page's first words open the same sheet in HTML.
    for (const [i, pageUpdate] of state.artifact.pages.entries()) {
      // Its first word of text (math is drawn, not text, in HTML).
      const word = (pageUpdate.text ?? []).map((run) => /^[A-Za-z]{4,}/.exec(run.text.trim())?.[0]).find((w) => w);
      if (!word) continue;
      const sheet = (sheets[i] as HTMLElement).getBoundingClientRect();
      const found = Array.from(renderer.root.querySelectorAll(".typstream-flow .typstream-t")).find((t) => {
        const r = t.getBoundingClientRect();
        return t.textContent?.includes(word) && r.top >= sheet.top && r.top < sheet.top + 140;
      });
      expect(found, `page ${i + 1} starts with ${word}`).toBeDefined();
    }
    unmount(renderer);
  });
});

/** Checks every update of a stream: blocks with unchanged HTML keep their DOM node. */
const watch = (renderer: HtmlRenderer) => {
  let previous: string[] = [];
  const stats = { updates: 0, created: 0, kept: 0, ms: [] as number[], violations: [] as string[] };
  const update = (html: string, s: DocumentState) => {
    const before = new Set<Node>(blocksOf(renderer));
    const result = renderer.update(html, { animate: false, stable: s.final ? null : s.heal.stableOffset });
    stats.updates++;
    stats.created += result.created;
    stats.ms.push(result.ms);
    const blocks = splitHtml(html);
    const next = blocks.blocks.map((b) => b.html);
    const shown = blocksOf(renderer);
    if (blocks.shell === "" && shown.length === next.length) {
      // One element per block (true for these documents): map them by position.
      const available = new Map<string, number>();
      for (const key of previous) available.set(key, (available.get(key) ?? 0) + 1);
      next.forEach((key, i) => {
        const n = available.get(key) ?? 0;
        if (n === 0) return;
        available.set(key, n - 1);
        stats.kept++;
        if (!before.has(shown[i] as Element)) {
          stats.violations.push(`re-created unchanged block ${i} at rev ${s.artifactRev}: ${key.slice(0, 60)}`);
        }
      });
    }
    previous = next;
  };
  return { stats, update };
};

describe(`HTML renderer while streaming in ${browser}`, () => {
  it("never re-creates a block whose HTML didn't change, and ends where a fresh render does", async () => {
    const names = [
      "worksheet-fractions",
      "exam-physics-mechanics",
      "lab-report-pendulum",
      "multilingual-chinese-vocabulary",
      "quiz-mcq-geography",
      "report-climate-change",
    ];
    let kept = 0;
    let created = 0;
    for (const name of names) {
      const entry = corpus.find((e) => e.name === name) as CorpusDocument;
      const renderer = mount({ idPrefix: "s-" });
      const { stats, update } = watch(renderer);
      const doc = openHtml(engine, entry.files);
      const final = await stream(doc, entry.chunks, 300, update);
      doc.dispose();
      expect(final.status, name).toBe("done");
      expect(stats.updates, name).toBeGreaterThan(3);
      expect(stats.violations, name).toEqual([]);
      kept += stats.kept;
      created += stats.created;

      const fresh = mount({ idPrefix: "s-" });
      fresh.update(final.artifact?.target === "html" ? final.artifact.html : "");
      // Both laid out on their pages (an outline's page numbers are written then), with the fonts they use.
      await document.fonts.ready;
      await laidOut();
      const [got, want] = [withoutSrc(renderer.root), withoutSrc(fresh.root)];
      let at = 0;
      while (at < got.length && got[at] === want[at]) at++;
      const pages = (r: HtmlRenderer) => r.root.querySelectorAll(".typstream-page").length;
      // Where the breaks are, and how much room each takes, to half a pixel (layouts from another block round apart).
      const breaks = (r: HtmlRenderer) =>
        Array.from(r.root.querySelectorAll<HTMLElement>(".typstream-break")).map(
          (b) => [b.parentElement?.localName, Number.parseFloat(b.style.height)] as const,
        );
      const [shown, whole] = [breaks(renderer), breaks(fresh)];
      expect(`${pages(renderer)} ${shown.map(([where]) => where)}`, name).toBe(
        `${pages(fresh)} ${whole.map(([where]) => where)}`,
      );
      for (const [i, [, height]] of shown.entries())
        expect(Math.abs(height - (whole[i]?.[1] ?? 0)), `${name}: break ${i}`).toBeLessThan(0.5);
      expect(got.slice(Math.max(0, at - 150), at + 150), name).toBe(want.slice(Math.max(0, at - 150), at + 150));
      expect(glyphProblems(renderer.root), name).toEqual([]);
      unmount(fresh);
      unmount(renderer);
    }
    // Most blocks are kept: a stream changes its tail. (Documents with error frames
    // until the end, like report-climate-change citing a bibliography, change all at once.)
    expect(kept).toBeGreaterThan(created * 3);
  }, 600_000);

  it("updates a 20-page document within the main-thread budget", async () => {
    const renderer = mount();
    const { stats, update } = watch(renderer);
    const doc = openHtml(engine);
    const final = await stream(doc, tokens(TWENTY_PAGES), 600, update);
    doc.dispose();
    expect(final.status).toBe("done");
    expect(stats.violations).toEqual([]);
    const sorted = [...stats.ms].sort((a, b) => a - b);
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] as number;
    console.log(
      `${browser}: ${stats.updates} updates, ${blocksOf(renderer).length} blocks; update p50 ${at(0.5).toFixed(2)} ms, ` +
        `p90 ${at(0.9).toFixed(2)} ms, max ${at(1).toFixed(2)} ms; ${stats.created} blocks created, ${stats.kept} kept`,
    );
    // PLAN §11.5: main-thread update ≤ 4 ms at 20 pages (Phase 0 level).
    expect(at(0.5)).toBeLessThanOrEqual(4);
    unmount(renderer);
  }, 300_000);
});
