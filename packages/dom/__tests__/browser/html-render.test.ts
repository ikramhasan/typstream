/// <reference lib="dom" />
// The HTML renderer on real engine output, in each browser: corpus documents
// compiled by the engine worker with html-compat and source anchors.
// - Splitting into blocks and parsing them one by one gives the DOM a parse of
//   the whole document gives.
// - Anchors resolve blocks to the source they came from.
// - While a document streams, a block whose HTML didn't change keeps its DOM
//   node, and the final DOM equals a fresh render of the final HTML.
// - Main-thread time per update at 20 pages (PLAN §11.5).

import type { DocumentState, Engine } from "@typstream/engine";
import { htmlCompat, htmlCompatCss } from "@typstream/html-compat";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commands, server } from "vitest/browser";
import { createHtmlRenderer, type HtmlRenderer } from "../../src/html/renderer";
import { createSanitizer } from "../../src/html/sanitize";
import { splitHtml } from "../../src/html/split";
import { TYPST_MATH_CSS } from "../../src/html/styles";
import { type CorpusDocument, compileHtml, openHtml, startEngine, stream, TWENTY_PAGES, tokens } from "../support/html";

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
  const body = new DOMParser().parseFromString(html, "text/html").body;
  for (const anchor of Array.from(body.querySelectorAll("typstream-anchor"))) anchor.remove();
  createSanitizer({ idPrefix, plugins: [htmlCompat] })(body);
  return body.innerHTML;
};

const withoutSrc = (root: HTMLElement): string => {
  const clone = root.cloneNode(true) as HTMLElement;
  for (const el of Array.from(clone.querySelectorAll("[data-typstream-src]"))) el.removeAttribute("data-typstream-src");
  return clone.innerHTML;
};

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
      unmount(renderer);
    }
  }, 300_000);

  it("ships the MathML rules Typst writes into <head>", async () => {
    const doc = openHtml(engine);
    const html = await compileHtml(doc, "$ a/b + vec(1, 2) $");
    doc.dispose();
    const head = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";
    const normalize = (css: string) => css.replace(/\s+/g, " ").trim();
    expect(normalize(TYPST_MATH_CSS.replaceAll(":where(.typstream) ", ""))).toBe(normalize(head));
  });

  it("resolves blocks to the source that produced them", async () => {
    let checked = 0;
    const misses: string[] = [];
    for (const entry of corpus) {
      const doc = openHtml(engine, entry.files);
      const html = await compileHtml(doc, entry.source);
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
        const source = entry.source.slice(range.from, range.to ?? entry.source.length);
        if (!words.some((w) => source.includes(w))) misses.push(`${entry.name}: ${el.textContent?.slice(0, 60)}`);
      }
      unmount(renderer);
    }
    expect(checked).toBeGreaterThan(200);
    expect(misses).toEqual([]);
  }, 300_000);
});

/** Checks every update of a stream: blocks with unchanged HTML keep their DOM node. */
const watch = (renderer: HtmlRenderer) => {
  let previous: string[] = [];
  const stats = { updates: 0, created: 0, kept: 0, ms: [] as number[], violations: [] as string[] };
  const update = (html: string, s: DocumentState) => {
    const before = new Set<Node>(Array.from(renderer.root.children));
    const result = renderer.update(html, { animate: false });
    stats.updates++;
    stats.created += result.created;
    stats.ms.push(result.ms);
    const blocks = splitHtml(html);
    const next = blocks.blocks.map((b) => b.html);
    if (blocks.shell === "" && renderer.root.children.length === next.length) {
      // One element per block (true for these documents): map them by position.
      const available = new Map<string, number>();
      for (const key of previous) available.set(key, (available.get(key) ?? 0) + 1);
      next.forEach((key, i) => {
        const n = available.get(key) ?? 0;
        if (n === 0) return;
        available.set(key, n - 1);
        stats.kept++;
        if (!before.has(renderer.root.children[i] as Element)) {
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
      expect(renderer.root.innerHTML, name).toBe(fresh.root.innerHTML);
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
      `${browser}: ${stats.updates} updates, ${renderer.root.children.length} blocks; update p50 ${at(0.5).toFixed(2)} ms, ` +
        `p90 ${at(0.9).toFixed(2)} ms, max ${at(1).toFixed(2)} ms; ${stats.created} blocks created, ${stats.kept} kept`,
    );
    // PLAN §11.5: main-thread update ≤ 4 ms at 20 pages (Phase 0 level).
    expect(at(0.5)).toBeLessThanOrEqual(4);
    unmount(renderer);
  }, 300_000);
});
