/// <reference lib="dom" />
// #18 research, run by hand: VITE_RESEARCH=1 pnpm test:browser research-pdf --reporter=verbose
//
// What a PDF-capable engine loaded on the first export (option b) would cost
// after its download: compiling the wasm module, instantiating it, adding the
// base fonts, and the first compile of a document, next to the warm exports
// the preview's engine does once PDF is in its build (option a, chosen). On the
// page's thread; a worker does the same work. Network time follows from the
// brotli size (engine-wasm's `pnpm size`). The numbers, with the comparison
// against a build without PDF (`cargo build --no-default-features`), are in
// the #18 findings and PLAN §6.4.

// Vite's `?url`: where it serves the wasm.
// @ts-expect-error no declarations for Vite's ?url imports in this package
import wasmUrl from "@typstream/engine-wasm/engine_bg.wasm?url";
import { baseFonts } from "@typstream/engine-wasm/fonts";
import { describe, expect, it } from "vitest";
import { commands, server } from "vitest/browser";
import { FIVE_PAGES } from "../support/documents";

declare module "vitest/browser" {
  interface BrowserCommands {
    corpusStream(name: string): Promise<{ source: string; chunks: string[] }>;
  }
}

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const run = !!env.VITE_RESEARCH;

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? Number.NaN;
const round = (x: number): number => Math.round(x * 10) / 10;

const time = <T>(f: () => T): [T, number] => {
  const t = performance.now();
  const r = f();
  return [r, performance.now() - t];
};

const warm = (f: () => unknown): number => round(median(Array.from({ length: 5 }, () => time(f)[1])));

describe.runIf(run)(`PDF engine cost in ${server.browser}`, () => {
  it("measures", { timeout: 600_000 }, async () => {
    const exam = (await commands.corpusStream("exam-algebra-final")).source;
    // FIVE_PAGES four times, without repeating its set rules and title.
    const more = FIVE_PAGES.split("\n").slice(3).join("\n");
    const docs = { exam, "5 pages": FIVE_PAGES, "20 pages": [FIVE_PAGES, more, more, more].join("\n") };
    const fonts = await Promise.all(baseFonts.map(async (u) => new Uint8Array(await (await fetch(u)).arrayBuffer())));

    const bytes = new Uint8Array(await (await fetch(wasmUrl as string)).arrayBuffer());
    const t0 = performance.now();
    const module = await WebAssembly.compile(bytes);
    const compileMs = performance.now() - t0;
    const glue = await import("@typstream/engine-wasm");
    // Async: Chromium refuses to instantiate big modules synchronously on the page's thread.
    const t1 = performance.now();
    await glue.default({ module_or_path: module });
    const instantiateMs = performance.now() - t1;
    const engine = new glue.Engine();
    const [, fontsMs] = time(() => {
      for (const font of fonts) engine.add_font(font);
    });
    engine.free();

    const perDoc: Record<string, unknown> = {};
    for (const [name, source] of Object.entries(docs)) {
      // A fresh Engine per document: its first compile is cold for its source,
      // though Typst's cache is shared by the instance (as in a worker that
      // exports several documents).
      const e = new glue.Engine();
      for (const font of fonts) e.add_font(font);
      e.set_source("/main.typ", source);
      const [first, pdfFirstMs] = time(() => e.compile_pdf());
      expect(first.ok).toBe(true);
      perDoc[name] = {
        pages: first.pageCount ?? 0,
        pdfKB: Math.round((first.pdf?.length ?? 0) / 1024),
        pdfFirstMs: round(pdfFirstMs),
        pdfWarmMs: warm(() => e.compile_pdf()),
        svgAllPagesWarmMs: warm(() => {
          e.reset_pages();
          e.compile_svg_changed();
        }),
        htmlWarmMs: warm(() => e.compile_html()),
      };
      e.free();
    }
    const result = {
      browser: server.browser,
      wasmMB: round(bytes.length / 1e5) / 10,
      compileMs: round(compileMs),
      instantiateMs: round(instantiateMs),
      fontsMs: round(fontsMs),
      memoryMB: round(glue.Engine.memory_bytes() / 1e5) / 10,
      docs: perDoc,
    };
    console.log(`RESEARCH ${JSON.stringify(result)}`);
  });
});
