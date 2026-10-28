/// <reference lib="dom" />
// Standalone HTML exports (#18) in each browser: a corpus document exported by
// the real engine worker with html-compat, made a file by standaloneHtml and
// opened from a blob URL, as a download would be. Its theme, html-compat's CSS
// and the embedded math font apply; what a document writes to run scripts or
// redirect doesn't.

import type { Engine } from "@typstream/engine";
import { htmlCompatCss } from "@typstream/html-compat";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commands, server } from "vitest/browser";
import { standaloneHtml } from "../../src/export/standalone";
import { type CorpusDocument, compileHtml, openHtml, startEngine } from "../support/html";

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
    const frame = await open(standaloneHtml(html));
    const doc = frame.contentDocument as Document;
    (doc.querySelector("a") as HTMLAnchorElement).click();
    await sleep(300);
    expect(window.__typstreamRan).toEqual([]);
    // Still the export, not about:blank.
    expect(frame.contentDocument?.body.textContent).toContain("Hostile");
    frame.remove();
  }, 120_000);
});
