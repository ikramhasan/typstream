/// <reference lib="dom" />
// The paged preview equals the PDF (#118, #119): every edu corpus document's pages, as the document panel paints them,
// against the same pages of the mount's `exportPdf()` rasterized by pdf.js, in the same browser. How they are compared
// is the plugin conformance suite's (tools/conformance's paged.ts, #135), which plugins run on their own examples.

import { comparePaged, hiDpi, MAX_CLUSTER } from "@typstream/conformance/paged";
import type { Engine } from "@typstream/engine";
import { htmlCompat } from "@typstream/html-compat";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { server } from "vitest/browser";
import {
  type CorpusDocument,
  EDU_DOCUMENTS as DOCUMENTS,
  loadCorpus,
  loadMathFont,
  startEngine,
  warmFonts,
} from "./support/mount";

const browser = server.browser;

let engine: Engine;
let corpus: CorpusDocument[];
let restore: () => void;
beforeAll(async () => {
  restore = hiDpi();
  engine = startEngine();
  await engine.ready;
  await warmFonts(engine);
  await loadMathFont();
  corpus = (await loadCorpus()).filter((e) => e.set === "edu");
}, 60_000);
afterAll(() => {
  engine.dispose();
  restore();
});

/** As apps mount a document: with html-compat. */
const PLUGINS = [htmlCompat];

describe(`paged preview vs PDF in ${browser}`, () => {
  it("lists the edu corpus", () => {
    expect(corpus.map((e) => e.name).sort()).toEqual([...DOCUMENTS].sort());
  });

  it("catches a missing full stop", async () => {
    // An A4 page, as the corpus's, so the full stop is as large as one in their text: 7–8 pixels touching.
    const [page] = await comparePaged(engine, { name: "control", source: "Hello." }, PLUGINS, "Hello");
    expect(page?.cluster).toBeGreaterThan(MAX_CLUSTER);
  });

  it.for(DOCUMENTS)("%s", { timeout: 120_000 }, async (name) => {
    const entry = corpus.find((e) => e.name === name) as CorpusDocument;
    const pages = await comparePaged(engine, { name, source: entry.source, files: entry.files }, PLUGINS);
    expect(pages.filter((p) => p.cluster > MAX_CLUSTER)).toEqual([]);
  });
});
