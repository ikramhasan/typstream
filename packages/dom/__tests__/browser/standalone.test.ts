/// <reference lib="dom" />
// Standalone HTML exports (#18) in each browser: a corpus document exported by
// the real engine worker with html-compat, made a file by standaloneHtml and
// opened from a blob URL, as a download would be. Its theme, html-compat's CSS
// and the embedded math font apply; what a document writes to run scripts or
// redirect doesn't.

import type { Engine } from "@typstream/engine";
import { htmlCompat, htmlCompatCss } from "@typstream/html-compat";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commands, server } from "vitest/browser";
import { standalonePages } from "../../src/export/pages";
import { standaloneHtml } from "../../src/export/standalone";
import { registerTypstFonts } from "../../src/html/fonts";
import { createHtmlRenderer } from "../../src/html/renderer";
import { type CorpusDocument, compileHtml, FONTS, openHtml, startEngine } from "../support/html";

let engine: Engine;
let corpus: CorpusDocument[];
let mathFont: Uint8Array;
beforeAll(async () => {
  engine = startEngine();
  await engine.ready;
  corpus = await commands.corpusEntries();
  const font = await fetch(new URL("../../../engine-wasm/dist/fonts/NewCMMath-Regular.ttf", import.meta.url));
  mathFont = new Uint8Array(await font.arrayBuffer());
}, 60_000);
afterAll(() => engine.dispose());

declare global {
  interface Window {
    __typstreamRan?: string[];
  }
}

/** Exports `source` as HTML with html-compat, as the bindings will. */
const exportHtml = async (source: string, files: Record<string, string> = {}): Promise<string> => {
  const doc = openHtml(engine, files);
  // The preview compile first, so a failing document reports its diagnostics.
  await compileHtml(doc, source);
  const html = await doc.exportHtml();
  doc.dispose();
  return html;
};

/** Opens `file` in an iframe from a blob URL and resolves once it has loaded. */
const open = async (file: string): Promise<HTMLIFrameElement> => {
  const frame = document.createElement("iframe");
  frame.style.width = "800px";
  frame.style.height = "600px";
  const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
  frame.src = URL.createObjectURL(new Blob([file], { type: "text/html" }));
  document.body.append(frame);
  await loaded;
  return frame;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Each text's page, its top and left on it in px, and the text. */
const lines = (root: ParentNode): [number, number, number, string][] => {
  const pages = [...root.querySelectorAll(".typstream-page")].map((p) => p.getBoundingClientRect());
  return [...root.querySelectorAll(".typstream-flow .typstream-t")].map((t) => {
    const r = t.getBoundingClientRect();
    const page = Math.max(0, pages.filter((p) => p.top <= r.top + 1).length - 1);
    const p = pages[page] as DOMRect;
    return [page, r.top - p.top, r.left - p.left, t.textContent ?? ""];
  });
};

describe(`standalone HTML export in ${server.browser}`, () => {
  it("opens on its own with the theme, html-compat's CSS and the math font", async () => {
    const entry = corpus.find((e) => e.name === "exam-algebra-final");
    if (!entry) throw new Error("no corpus entry exam-algebra-final");
    const html = await exportHtml(entry.source, entry.files);
    expect(html).not.toContain("typstream-anchor");
    const frame = await open(standaloneHtml(html, { stylesheets: [htmlCompatCss], mathFont, title: "Untitled" }));
    const doc = frame.contentDocument as Document;
    const win = frame.contentWindow as Window;
    // The document's own title wins over `title`.
    expect(doc.title).toBe("Algebra I — Final Examination");
    expect(doc.body.classList.contains("typstream")).toBe(true);
    expect(doc.body.textContent).toContain("Algebra");
    // The theme's light foreground, and html-compat's math font.
    expect(win.getComputedStyle(doc.body).color).toBe("rgb(28, 28, 30)");
    const math = doc.querySelector("math");
    expect(math).not.toBeNull();
    expect(win.getComputedStyle(math as Element).fontFamily).toContain("New Computer Modern Math");
    await doc.fonts.load('16px "New Computer Modern Math"');
    expect(doc.fonts.check('16px "New Computer Modern Math"')).toBe(true);
    frame.remove();
  }, 120_000);

  it("lays the export out as the pages, as the HTML renderer shows them, with their fonts", async () => {
    const entry = corpus.find((e) => e.name === "exam-algebra-final");
    if (!entry) throw new Error("no corpus entry exam-algebra-final");
    const html = await exportHtml(entry.source, entry.files);
    const file = await standalonePages(html, { plugins: [htmlCompat], typstFonts: FONTS });
    expect(file).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(file).toMatch(/font-family: typstream-libertinus-serif;\n {2}src: url\("data:font\/(ttf|otf);base64,/);
    expect(file).not.toContain('class="typstream-underlay"');
    // The renderer, laid out here as the file was.
    registerTypstFonts(FONTS);
    const root = document.createElement("div");
    root.style.cssText = "position: absolute; top: 0; left: 0; width: 2000px";
    document.body.append(root);
    const renderer = createHtmlRenderer(root, { plugins: [htmlCompat], layout: "fixed" });
    (root.querySelector(".typstream-paged") as HTMLElement).style.gap = "0";
    renderer.update(html);
    for (let i = 0; i < 3; i++) {
      await document.fonts.ready;
      await sleep(100);
    }
    const frame = await open(file);
    frame.style.width = "1000px";
    const doc = frame.contentDocument as Document;
    await doc.fonts.ready;
    await sleep(100);
    const shown = lines(root);
    expect(shown.length).toBeGreaterThan(20);
    expect(doc.querySelectorAll(".typstream-page").length).toBe(root.querySelectorAll(".typstream-page").length);
    // Where the renderer put them, to a pixel (positions in another document round apart).
    const filed = lines(doc);
    expect(filed.map(([page, , , text]) => `${page} ${text}`)).toEqual(
      shown.map(([page, , , text]) => `${page} ${text}`),
    );
    for (const [i, [, top, left]] of filed.entries()) {
      const [, wantTop, wantLeft] = shown[i] as [number, number, number, string];
      expect(Math.abs(top - wantTop) + Math.abs(left - wantLeft), `text ${i}`).toBeLessThan(1);
    }
    renderer.dispose();
    root.remove();
    frame.remove();
  }, 120_000);

  it("runs none of the document's scripts or handlers, and doesn't redirect", async () => {
    window.__typstreamRan = [];
    const html = await exportHtml(
      [
        "= Hostile",
        '#html.elem("script", "parent.__typstreamRan.push(\'script\')")',
        '#html.elem("img", attrs: (src: "data:,", onerror: "parent.__typstreamRan.push(\'onerror\')"))',
        '#html.elem("meta", attrs: ("http-equiv": "refresh", content: "0; url=about:blank"))',
        "#link(\"javascript:parent.__typstreamRan.push('link')\")[click]",
      ].join("\n"),
    );
    expect(html).toContain("<script>");
    for (const file of [standaloneHtml(html), await standalonePages(html, { plugins: [htmlCompat] })]) {
      const frame = await open(file);
      const doc = frame.contentDocument as Document;
      doc.querySelector<HTMLAnchorElement>("a")?.click();
      await sleep(300);
      expect(window.__typstreamRan).toEqual([]);
      // Still the export, not about:blank.
      expect(frame.contentDocument?.body.textContent).toContain("Hostile");
      frame.remove();
    }
  }, 120_000);
});
