/// <reference lib="dom" />
// The real stack in each browser: the main-thread client, the engine worker
// (src/worker.ts, bundled by Vite the way an app's bundler would), engine-wasm
// fetched and compiled while it streams in, and the base fonts. Run with
// `pnpm test:browser` (Chromium, Firefox, WebKit).

import type { Artifact, CompileResult } from "@typstream/core";
import { describe, expect, it } from "vitest";
import { commands, server } from "vitest/browser";
import { fromWorker } from "../../src/connection";
import { type DocumentState, type EngineDocument, ExportError } from "../../src/document";
import { createEngine, type Engine, type EngineEvent, type EngineOptions } from "../../src/engine";
import { conformance } from "../conformance";
import { FIVE_PAGES } from "../support/documents";

declare module "vitest/browser" {
  interface BrowserCommands {
    corpusStream(name: string): Promise<{ source: string; chunks: string[] }>;
    synthesizeStream(source: string): Promise<string[]>;
  }
}

const browser = server.browser;

const spawn = () => fromWorker(() => new Worker(new URL("../../src/worker.ts", import.meta.url), { type: "module" }));

conformance(`engine-wasm worker in ${browser}`, spawn, 60_000);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves with the first state that satisfies `done` (now or later). */
const until = (doc: EngineDocument, done: (s: DocumentState) => boolean, ms = 60_000): Promise<DocumentState> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out; last state: ${JSON.stringify(doc.getState().failure)}`)),
      ms,
    );
    const check = (s: DocumentState) => {
      if (!done(s)) return;
      clearTimeout(timer);
      stop();
      resolve(s);
    };
    const stop = doc.subscribe(check);
    check(doc.getState());
  });

/** Every finished compile of a document, as the client saw it. */
interface Frame {
  compile: CompileResult;
  errors: number;
  healErrors: number;
}

const record = (doc: EngineDocument): Frame[] => {
  const frames: Frame[] = [];
  let last: CompileResult | null = null;
  doc.subscribe((s) => {
    if (!s.lastCompile || s.lastCompile === last) return;
    last = s.lastCompile;
    frames.push({
      compile: s.lastCompile,
      errors: s.diagnostics.filter((d) => d.severity === "error").length,
      healErrors: s.heal.errors.length,
    });
  });
  return frames;
};

/** Pushes `chunks` as an LLM would, `tokensPerSecond` of them per second, then finishes. */
const replay = async (doc: EngineDocument, chunks: readonly string[], tokensPerSecond: number) => {
  const start = performance.now();
  let i = 0;
  while (i < chunks.length) {
    await sleep(4);
    const due = Math.min(chunks.length, Math.ceil(((performance.now() - start) / 1000) * tokensPerSecond));
    for (; i < due; i++) doc.push(chunks[i] as string);
  }
  doc.finish();
  return until(doc, (s) => s.status === "done" || s.status === "error");
};

/**
 * What a reader sees. Page hashes are left out: Typst's frame hashes include
 * source spans, which differ between an incrementally reparsed source and a
 * fresh parse of the same text.
 */
const visible = (a: Artifact | null) =>
  a?.target === "paged" ? { ...a, pages: a.pages.map(({ hash: _, ...page }) => page) } : a;

/** Compiles `source` in one go, as a document opened with it and finished at once. */
const oneShot = async (engine: Engine, source: string, target: "html" | "paged"): Promise<Artifact | null> => {
  const doc = engine.open({ text: source, target });
  doc.finish();
  const s = await until(doc, (s) => s.status === "done" || s.status === "error");
  doc.dispose();
  return s.artifact;
};

const start = async (options: Partial<EngineOptions> = {}) => {
  const engine = createEngine({ spawn: spawn(), ...options });
  const events: EngineEvent[] = [];
  engine.onEvent((e) => events.push(e));
  await engine.ready;
  return { engine, events };
};

const percentile = (xs: number[], p: number) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? Number.NaN;
};

const trouble = (events: EngineEvent[]) => events.filter((e) => e.type !== "ready" && e.type !== "log");

describe(`streaming in ${browser}`, { timeout: 120_000 }, () => {
  // Documents every token-sized prefix of which heals to a compiling source
  // (FIVE_PAGES is checked in server.test.ts), streamed at LLM-like speeds.
  const clean: {
    name: string;
    target: "html" | "paged";
    tokensPerSecond: number;
    load: () => Promise<{ source: string; chunks: string[] }>;
  }[] = [
    {
      name: "five pages (html)",
      target: "html",
      tokensPerSecond: 400,
      load: async () => ({ source: FIVE_PAGES, chunks: await commands.synthesizeStream(FIVE_PAGES) }),
    },
    {
      name: "edu/programming-python-loops (html)",
      target: "html",
      tokensPerSecond: 150,
      load: () => commands.corpusStream("programming-python-loops"),
    },
    {
      name: "edu/programming-python-loops (paged)",
      target: "paged",
      tokensPerSecond: 150,
      load: () => commands.corpusStream("programming-python-loops"),
    },
  ];

  it.each(clean)("$name: no error frames, and the result equals a one-shot compile", async ({
    target,
    tokensPerSecond,
    load,
  }) => {
    const { source, chunks } = await load();
    const { engine, events } = await start();
    // Compiled first, it also warms the worker (wasm tier-up, syntax
    // highlighting), as a page's long-lived worker would be.
    const expected = visible(await oneShot(engine, source, target));
    const doc = engine.open({ target });
    const frames = record(doc);
    const failures: unknown[] = [];
    doc.subscribe((s) => s.failure && failures.push(s.failure));

    const final = await replay(doc, chunks, tokensPerSecond);

    expect(final.status).toBe("done");
    expect(final.heal.source).toBe(source);
    // Compiled mid-stream, not just at the end.
    expect(frames.length).toBeGreaterThan(2);
    expect(frames.filter((f) => f.compile.status !== "ok" || f.errors > 0 || f.healErrors > 0)).toEqual([]);
    expect(failures).toEqual([]);
    expect(trouble(events)).toEqual([]);
    expect(visible(final.artifact)).toEqual(expected);

    const compileMs = frames.map((f) => f.compile.timings.compileMs ?? Number.NaN);
    console.log(
      `${browser} ${target}: ${chunks.length} tokens, ${frames.length} compiles, compile p50 ${percentile(compileMs, 50).toFixed(1)} ms, p95 ${percentile(compileMs, 95).toFixed(1)} ms`,
    );
    engine.dispose();
  });

  it("five pages: streaming compile latency", async () => {
    // Phase 0 measured 5-page HTML streaming compiles at p50 ≲ 10 ms in
    // Chromium on an idle machine. Shared or busy machines are several times
    // slower, so this only catches gross regressions (10× that); the numbers
    // are printed for every browser.
    const { engine } = await start();
    await oneShot(engine, FIVE_PAGES, "html"); // warm-up
    const doc = engine.open();
    const frames = record(doc);
    await replay(doc, await commands.synthesizeStream(FIVE_PAGES), 400);
    const compileMs = frames.map((f) => f.compile.timings.compileMs ?? Number.NaN);
    const p50 = percentile(compileMs, 50);
    console.log(`${browser} five pages html: compile p50 ${p50.toFixed(1)} ms over ${compileMs.length} compiles`);
    if (browser === "chromium") expect(p50).toBeLessThan(100);
    engine.dispose();
  });

  it("keeps the last good artifact through error frames, and still ends equal to a one-shot compile", async () => {
    // A cut `#question(` heals to `#question()`, which misses its body: an
    // error frame until the body streams in (Layer 3 fixers, #20).
    const { source, chunks } = await commands.corpusStream("worksheet-fractions");
    const { engine, events } = await start();
    const doc = engine.open();
    const frames = record(doc);
    let lostArtifact = false;
    let sawArtifact = false;
    doc.subscribe((s) => {
      sawArtifact ||= s.artifact !== null;
      lostArtifact ||= sawArtifact && s.artifact === null;
    });
    const final = await replay(doc, chunks, 400);
    expect(final.status).toBe("done");
    expect(lostArtifact).toBe(false);
    expect(frames.every((f) => f.compile.status === "ok" || f.errors > 0)).toBe(true);
    expect(trouble(events)).toEqual([]);
    expect(final.artifact).toEqual(await oneShot(engine, source, "html"));
    engine.dispose();
  });
});

describe(`watchdog in ${browser}`, { timeout: 120_000 }, () => {
  it("recovers from a runaway compile", async () => {
    const { engine, events } = await start({ watchdog: { streamingMs: 2000 } });
    const doc = engine.open({ text: "Before.\n#let a = range(100000000).map(x => x)\nAfter." });
    const failed = await until(doc, (s) => s.failure !== null);
    // A timeout, or the worker running out of memory first: either way a strike.
    expect(["timeout", "crash"]).toContain(failed.failure?.reason);
    expect(events.map((e) => e.type)).toContainEqual(expect.stringMatching(/^(watchdog|crash)$/));

    doc.set("Recovered.");
    const recovered = await until(doc, (s) => s.status === "idle" && s.failure === null);
    expect(recovered.artifact?.target === "html" && recovered.artifact.html).toContain("Recovered.");
    expect(events.filter((e) => e.type === "failed")).toEqual([]);
    engine.dispose();
  });
});

describe(`exports in ${browser}`, { timeout: 120_000 }, () => {
  /** Pages in a PDF: its page objects (typst-pdf writes them uncompressed). */
  const pdfPages = (pdf: Uint8Array): number =>
    (new TextDecoder("latin1").decode(pdf).match(/\/Type\s*\/Page\b/g) ?? []).length;

  it("exports a PDF with the paged preview's pages, and HTML without source anchors", async () => {
    const { engine, events } = await start();
    expect((await engine.ready).capabilities.exports).toEqual(["html", "pdf"]);
    const doc = engine.open({ target: "paged", text: FIVE_PAGES });
    doc.finish();
    const done = await until(doc, (s) => s.status === "done");
    const preview = done.artifact?.target === "paged" ? done.artifact : null;
    expect(preview?.pageCount).toBeGreaterThan(4);

    const pdf = await doc.exportPdf();
    expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe("%PDF-");
    expect(pdfPages(pdf)).toBe(preview?.pageCount);

    const html = await doc.exportHtml();
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain("A five page handout");
    expect(html).not.toContain("typstream-anchor");
    expect(doc.exportSource()).toBe(FIVE_PAGES);
    expect(trouble(events)).toEqual([]);
    engine.dispose();
  });

  it("rejects the export of a document with errors, with its diagnostics", async () => {
    const { engine } = await start();
    const doc = engine.open({ text: "Fine.\n#nope" });
    doc.finish();
    const error = await doc.exportPdf().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExportError);
    expect(error).toMatchObject({ reason: "diagnostics", message: "unknown variable: nope" });
    expect((error as ExportError).diagnostics.map((d) => d.span)).toEqual([{ from: 7, to: 11 }]);
    engine.dispose();
  });
});
