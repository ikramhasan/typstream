/// <reference lib="dom" />
// Source spans taken off as the renderer parses (spans.ts through dom's `onParse`): the document is laid out in the
// DOM it has without them, and each text gives the source of its pieces.

import { createHtmlRenderer, type HtmlRenderer } from "@typstream/dom";
import type { DocumentState, Engine, EngineDocument } from "@typstream/engine";
import { htmlCompat } from "typstream";
import { afterAll, beforeAll, expect, it } from "vitest";
import { commands } from "vitest/browser";
import { createSpans } from "../../src/spans";
import { startEngine } from "../support/engine";

let engine: Engine;
beforeAll(async () => {
  engine = startEngine();
  await engine.ready;
}, 60_000);
afterAll(() => engine.dispose());

const compiled = (doc: EngineDocument): Promise<DocumentState> =>
  new Promise((resolve) => {
    const check = (s: DocumentState) => {
      if (s.status === "done" || s.status === "error") resolve(s);
    };
    doc.subscribe(check);
    check(doc.getState());
  });

const mount = (onParse?: (content: DocumentFragment) => void): HtmlRenderer => {
  const root = document.createElement("div");
  root.style.width = "700px";
  document.body.append(root);
  return createHtmlRenderer(root, { plugins: [htmlCompat], idPrefix: "t-", ...(onParse ? { onParse } : {}) });
};

/** The flow's markup, without the ids of headers and footers (made from their markup, which the spans are in). */
const flowOf = (renderer: HtmlRenderer) =>
  (renderer.root.querySelector(".typstream-flow:not(.typstream-marginals)") as Element).innerHTML.replace(
    /data-typstream-parts="[^"]*"/g,
    "",
  );

it("lays every edu document out in the same DOM, each text with the source of its pieces", async () => {
  let exact = 0;
  let all = 0;
  for (const entry of await commands.corpusEntries()) {
    const open = (spans: boolean) =>
      engine.open({ target: "html", text: entry.source, plugins: [htmlCompat], files: entry.files ?? {}, spans });
    const plainDoc = open(false);
    const spansDoc = open(true);
    plainDoc.finish();
    spansDoc.finish();
    const [plain, marked] = await Promise.all([compiled(plainDoc), compiled(spansDoc)]);
    const healed = marked.heal.source;
    const spans = createSpans();
    const a = mount();
    const b = mount(spans.take);
    if (plain.artifact?.target === "html") a.update(plain.artifact.html);
    if (marked.artifact?.target === "html") b.update(marked.artifact.html);
    expect(flowOf(b), entry.name).toBe(flowOf(a));
    const walker = document.createTreeWalker(b.root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const span = spans.of(n);
      for (const p of span?.parts ?? []) {
        all++;
        if (healed.slice(p.from, p.to) === span?.text?.slice(p.at, p.at + p.length)) exact++;
        expect(p.to, entry.name).toBeLessThanOrEqual(healed.length);
      }
    }
    for (const r of [a, b]) {
      r.dispose();
      r.root.remove();
    }
    plainDoc.dispose();
    spansDoc.dispose();
  }
  // Most pieces are markup shown as written; not math, nor what code computes (a table's cells from an array).
  expect(exact / all).toBeGreaterThan(0.6);
}, 600_000);
