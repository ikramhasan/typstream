/// <reference lib="dom" />
// Lazy fonts (#11, PLAN §6.4) in each browser, through the default worker:
// script fonts are registered at start, downloaded by the worker the first
// time a document uses them, kept in Cache Storage, and the document is
// rendered again once they arrive.

import type { PagedArtifact } from "@typstream/core";
import { describe, expect, it } from "vitest";
import { server } from "vitest/browser";
import { fromWorker } from "../../src/connection";
import type { DocumentState, EngineDocument } from "../../src/document";
import { createEngine } from "../../src/engine";

const spawn = fromWorker(() => new Worker(new URL("../../src/worker.ts", import.meta.url), { type: "module" }));

const CACHE = "typstream-fonts";

const DOC = `#set page(width: 12cm, height: auto)
= প্রশ্ন ১ (Question 1)
আমি বাংলায় গান গাই। English with বাংলা mixed in.

#set text(lang: "ar")
مرحبا بالعالم. هذا اختبار للنص العربي ١٢٣ and 123.
`;

/** Renders `source` as pages; every distinct first page it showed, once it is done and `settled` holds. */
const render = async (doc: EngineDocument, source: string): Promise<string[]> => {
  const pages: string[] = [];
  doc.subscribe((s: DocumentState) => {
    const svg = (s.artifact as PagedArtifact | null)?.pages[0]?.svg;
    if (svg && svg !== pages.at(-1)) pages.push(svg);
  });
  doc.set(source);
  doc.finish();
  await new Promise<void>((resolve) => doc.subscribe((s) => s.status === "done" && resolve()));
  return pages;
};

/** The script fonts in Cache Storage (the base fonts are there too). */
const cachedScriptFonts = async (): Promise<string[]> => {
  const cache = await caches.open(CACHE);
  const files = (await cache.keys()).map((r) => decodeURIComponent(r.url).replace(/\?.*/, "").replace(/.*\//, ""));
  return files.filter((file) => file.startsWith("Noto")).sort();
};

describe(`lazy fonts in ${server.browser}`, { timeout: 120_000 }, () => {
  /** The finished first page of DOC. */
  let rendered: string | undefined;

  it("renders Bengali and Arabic with their fonts once the worker has them", async () => {
    await caches.delete(CACHE);
    const engine = createEngine({ spawn, spare: false });

    // Text the base fonts cover downloads nothing.
    const english = await render(engine.open({ target: "paged" }), "= Question 1\nGreek Ελληνικά, Cyrillic русский.");
    expect(english).toHaveLength(1);
    expect(await cachedScriptFonts()).toEqual([]);

    const doc = engine.open({ target: "paged" });
    const pages = await render(doc, DOC);
    // The first render had tofu where the fonts were missing; the server's recompile replaced it.
    await expect.poll(() => pages.length, { timeout: 30_000 }).toBe(2);
    expect(await cachedScriptFonts()).toEqual([
      "NotoNaskhArabic-Regular.ttf",
      "NotoSerifBengali-Bold.ttf",
      "NotoSerifBengali-Regular.ttf",
    ]);
    // The worker fetched them: the page itself never did.
    expect(performance.getEntriesByType("resource").filter((e) => e.name.includes("Noto"))).toEqual([]);

    // A document opened now has the fonts from its first compile: the same page.
    expect(await render(engine.open({ target: "paged" }), DOC)).toEqual([pages[1]]);
    rendered = pages[1];
    engine.dispose();
  });

  it("reads Cache Storage in a new worker, and replaces a stale copy", async () => {
    // Make the cached Bengali regular a different file: the worker has to notice and fetch it again.
    const cache = await caches.open(CACHE);
    const keys = await cache.keys();
    const regular = keys.find((k) => k.url.includes("NotoSerifBengali-Regular"));
    const bold = keys.find((k) => k.url.includes("NotoSerifBengali-Bold"));
    if (!regular || !bold) throw new Error("the previous test didn't cache the Bengali fonts");
    await cache.put(regular, (await cache.match(bold)) as Response);

    const engine = createEngine({ spawn, spare: false });
    const pages = await render(engine.open({ target: "paged" }), DOC);
    await expect.poll(() => pages.at(-1), { timeout: 30_000 }).toBe(rendered);
    const network = await (await fetch(regular.url)).arrayBuffer();
    const cached = await ((await cache.match(regular)) as Response).arrayBuffer();
    expect(cached.byteLength).toBe(network.byteLength);
    engine.dispose();
  });
});
