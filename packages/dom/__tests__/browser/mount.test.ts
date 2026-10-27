/// <reference lib="dom" />
// mountTypstream without a framework, in each browser, on the real engine
// worker: options applied with update(), files changed in place, a failing
// stream, exports, telemetry hooks, and destroy(). @typstream/react's browser tests cover the rest
// through <Typstream>.

import { definePlugin, type FallbackEvent, type RenderedEvent, type WatchdogEvent } from "@typstream/core";
import { edu } from "@typstream/edu";
import { createEngine, type DocumentState, type Engine, fromWorker } from "@typstream/engine";
import { htmlCompat } from "@typstream/html-compat";
import { universe } from "@typstream/universe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { server } from "vitest/browser";
import { type MountedTypstream, mountTypstream, type TypstreamOptions } from "../../src/mount";
import { startEngine } from "../support/html";

const browser = server.browser;

let engine: Engine;
beforeAll(async () => {
  engine = startEngine();
  await engine.ready;
}, 60_000);
afterAll(() => engine.dispose());

const host = () => {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
};

/** Resolves with the first state that satisfies `done`. */
const until = (view: MountedTypstream, done: (s: DocumentState) => boolean, ms = 30_000) =>
  new Promise<DocumentState>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out; status ${view.getState()?.status}`)), ms);
    const check = () => {
      const s = view.getState();
      if (!s || !done(s)) return;
      clearTimeout(timer);
      stop();
      resolve(s);
    };
    const stop = view.subscribe(check);
    check();
  });

const settled = (s: DocumentState) => s.status === "done" || s.status === "error";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe(`mountTypstream in ${browser}`, () => {
  it("follows a growing source, finishes it, and cleans up on destroy", async () => {
    const el = host();
    const options = (source: string, isStreaming: boolean): TypstreamOptions => ({
      engine,
      source,
      isStreaming,
      lazy: false,
      caret: true,
    });
    const view = mountTypstream(el, options("= Title\n", true));
    view.update(options("= Title\nFirst *para", true));
    await until(view, (s) => !!s.artifact && s.status === "idle");
    expect(el.querySelector(".typstream-caret")).not.toBeNull();
    view.update(options("= Title\nFirst *paragraph*.", false));
    const final = await until(view, settled);
    expect(final.status).toBe("done");
    expect(el.textContent).toContain("First paragraph.");
    expect(el.querySelector(".typstream-caret")).toBeNull();
    view.destroy();
    expect(el.childElementCount).toBe(0);
    expect(view.document).toBeNull();
    el.remove();
  });

  it("changes files in place, without reopening the document", async () => {
    const el = host();
    const options = (data: string): TypstreamOptions => ({
      engine,
      source: '#read("data.txt")',
      files: { "data.txt": data },
      lazy: false,
    });
    const view = mountTypstream(el, options("one"));
    await until(view, (s) => s.status === "done");
    const doc = view.document;
    expect(el.textContent).toContain("one");
    view.update(options("two"));
    await until(view, (s) => s.status === "done" && s.artifact?.target === "html" && s.artifact.html.includes("two"));
    expect(el.textContent).toContain("two");
    expect(view.document).toBe(doc);
    view.destroy();
    el.remove();
  });

  it("reopens the document when the preamble changes", async () => {
    const el = host();
    const view = mountTypstream(el, { engine, source: "#x", preamble: "#let x = [alpha]", lazy: false });
    await until(view, (s) => s.status === "done");
    const doc = view.document;
    view.update({ engine, source: "#x", preamble: "#let x = [beta]", lazy: false });
    expect(view.document).not.toBe(doc);
    await until(view, (s) => s.status === "done");
    expect(el.textContent).toContain("beta");
    view.destroy();
    el.remove();
  });

  it("exports at the document's own page size, a standalone HTML file, and the source", async () => {
    const el = host();
    el.style.width = "300px";
    const source = "= Worksheet\nSolve $x^2 = 4$.";
    const view = mountTypstream(el, {
      engine,
      source,
      target: "paged",
      layout: "fit-width",
      inputs: { answers: "true" },
      stylesheets: [".marker { color: red }"],
      lazy: false,
    });
    const shown = await until(view, (s) => s.status === "done" && s.artifact?.target === "paged");
    // The preview is as wide as the element (300 px = 225 pt)…
    expect(shown.artifact?.target === "paged" && shown.artifact.pages[0]?.width).toBeCloseTo(225, 0);
    // …and the PDF is A4, Typst's default.
    const pdf = new TextDecoder("latin1").decode(await view.exportPdf());
    const [width, height] = (/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)/.exec(pdf) ?? []).slice(1).map(Number);
    expect(width).toBeCloseTo(595.28, 1);
    expect(height).toBeCloseTo(841.89, 1);
    const file = await view.exportHtml({ title: "Worksheet" });
    expect(file).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(file).toContain(".marker { color: red }");
    expect(file).toContain("<h2>Worksheet</h2>");
    expect(view.exportSource()).toBe(source);
    view.destroy();
    el.remove();
  });

  it("loads plugins: preambles in dependency order, files, templates, sanitizer allowances and stylesheets", async () => {
    const el = host();
    const base = definePlugin({
      key: "acme/base",
      engine: { files: { "/acme/note.typ": '#let note(body) = html.elem("acme-note", body)' } },
      sanitize: { allowTags: ["acme-note"] },
      stylesheets: [".typstream acme-note { outline: 3px solid rgb(1, 2, 3) }"],
    });
    const notes = definePlugin({
      key: "acme/notes",
      dependencies: ["acme/base"],
      engine: { preamble: '#import "/acme/note.typ": note' },
      templates: [{ name: "memo", preamble: "#let kind = sys.inputs.kind", inputs: { kind: "memo" } }],
      // A facet this version doesn't read.
      editor: { slashItems: [{ title: "Note" }] },
    });
    const view = mountTypstream(el, {
      engine,
      source: "#note[Kind: #kind]",
      plugins: [notes, base],
      template: "memo",
      lazy: false,
    });
    await until(view, (s) => s.status === "done");
    const note = el.querySelector("acme-note");
    expect(note?.textContent).toBe("Kind: memo");
    expect(getComputedStyle(note as Element).outlineColor).toBe("rgb(1, 2, 3)");
    const file = await view.exportHtml();
    expect(file).toContain("acme-note { outline");
    view.destroy();
    el.remove();
  });

  it("loads edu, html-compat and universe through the plugin system", async () => {
    const el = host();
    const view = mountTypstream(el, {
      engine,
      source: "#question(points: 2)[Half of 1 is #blank(answer: [1/2]).]\n#grid(columns: 2)[Left][Right]",
      plugins: [universe, edu, htmlCompat],
      template: "worksheet",
      inputs: { showAnswers: "true" },
      lazy: false,
    });
    const state = await until(view, settled);
    expect(state.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    // edu's files, preamble, template and stylesheet…
    const question = el.querySelector(".edu-question");
    expect(question?.textContent).toContain("1/2");
    expect(getComputedStyle(question as Element).display).toBe("grid");
    // …and html-compat's preamble, sanitizer allowances and stylesheet.
    expect(getComputedStyle(el.querySelector(".ts-grid") as Element).display).toBe("grid");
    view.destroy();
    el.remove();
  });

  it("opens a lazy document that hasn't opened yet to export it", async () => {
    const el = host();
    el.style.cssText = "position: absolute; top: 100000px";
    const view = mountTypstream(el, { engine, source: "Far below." });
    expect(view.document).toBeNull();
    const pdf = await view.exportPdf();
    expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe("%PDF-");
    expect(view.document).not.toBeNull();
    view.destroy();
    el.remove();
  });

  it("shows what a failed stream delivered, finishes, and reports the error", async () => {
    const el = host();
    const reported: unknown[] = [];
    const report = globalThis.reportError;
    globalThis.reportError = (error) => reported.push(error);
    async function* failing() {
      yield "= Partial\n";
      yield "Some text";
      throw new Error("connection lost");
    }
    try {
      const view = mountTypstream(el, { engine, stream: failing(), lazy: false });
      const final = await until(view, settled);
      expect(final.final).toBe(true);
      expect(el.textContent).toContain("Some text");
      expect(reported).toHaveLength(1);
      view.destroy();
    } finally {
      globalThis.reportError = report;
      el.remove();
    }
  });

  it("keeps every chunk of a stream when a mount is replaced while it reads it", async () => {
    const chunks = ["= Shared\n", "First ", "paragraph.\n\n", "Second ", "paragraph ", "ends here."];
    async function* slow() {
      for (const chunk of chunks) {
        await sleep(20);
        yield chunk;
      }
    }
    const stream = slow();
    const el = host();
    const first = mountTypstream(el, { engine, stream, lazy: false });
    // The first mount reads a chunk, then is destroyed while it waits for the next one.
    await sleep(30);
    first.destroy();
    const second = mountTypstream(el, { engine, stream, lazy: false });
    // A mount alongside, on the same stream from part way through, sees it all too.
    await sleep(50);
    const other = host();
    const third = mountTypstream(other, { engine, stream, lazy: false });
    for (const view of [second, third]) {
      const final = await until(view, settled);
      expect(final.final).toBe(true);
      expect(view.exportSource()).toBe(chunks.join(""));
    }
    expect(el.textContent).toContain("ends here.");
    second.destroy();
    third.destroy();
    el.remove();
    other.remove();
  });

  it("reports renders with their compile's report, and fallbacks with the source to replay", async () => {
    const el = host();
    const rendered: RenderedEvent[] = [];
    const fallbacks: FallbackEvent[] = [];
    const options = (source: string, isStreaming: boolean, target: "html" | "paged" = "html"): TypstreamOptions => ({
      engine,
      source,
      isStreaming,
      target,
      lazy: false,
      onRendered: (e) => rendered.push(e),
      onFallback: (e) => fallbacks.push(e),
    });
    // A citation before its bibliography: Layer 3's pending-ref makes it compile.
    const view = mountTypstream(el, options("See @ipcc2021 and more", true));
    const first = await until(view, (s) => !!s.artifact && s.status === "idle");
    expect(rendered.at(-1)).toMatchObject({
      type: "rendered",
      uri: view.document?.uri,
      rev: first.artifactRev,
      target: "html",
      mode: "streaming",
      fixersApplied: [{ fixer: "pending-ref", message: "label `<ipcc2021>` does not exist in the document" }],
      fallbackLevel: 0,
      blocks: 1,
    });
    const report = rendered.at(-1) as RenderedEvent;
    // A number, but possibly 0: browsers coarsen `performance.now()` where the page isn't cross-origin isolated, and
    // this one-line document can compile within one tick (Firefox reported 0).
    expect(report.compileMs).toBeGreaterThanOrEqual(0);
    expect(report.timings.totalMs).toBeGreaterThanOrEqual(report.compileMs);
    expect(report.healMs).toBeGreaterThanOrEqual(0);
    expect(report.renderMs).toBeGreaterThanOrEqual(0);
    expect(fallbacks).toEqual([]);

    // Finished with a block that can't compile: it shows as an error box (level 3).
    const source = "= Quiz\n\nGood.\n\n#nope\n\nMore.\n";
    view.update(options(source, false));
    const done = await until(view, settled);
    expect(done.status).toBe("done");
    expect(fallbacks.at(-1)).toMatchObject({ level: 3, mode: "final", input: source, source, consecutive: 1 });
    const box = fallbacks.at(-1)?.isolated[0];
    expect(box && source.slice(box.from, box.to)).toContain("#nope");
    expect(rendered.at(-1)).toMatchObject({ mode: "final", rev: done.artifactRev, fallbackLevel: 3, errors: 1 });

    // Paged: the page count.
    view.update(options("= One\n\nText.", false, "paged"));
    await until(view, (s) => s.artifact?.target === "paged" && settled(s));
    expect(rendered.at(-1)).toMatchObject({ target: "paged", pages: 1, fallbackLevel: 0 });
    view.destroy();
    el.remove();
  });

  it("reports a compile the watchdog stopped", async () => {
    const strict = createEngine({
      spawn: fromWorker(
        () => new Worker(new URL("../../../engine/src/worker.ts", import.meta.url), { type: "module" }),
      ),
      spare: false,
      watchdog: { streamingMs: 1000 },
    });
    const el = host();
    const stops: WatchdogEvent[] = [];
    try {
      const source = "Before.\n#let a = range(100000000).map(x => x)\nAfter.";
      const view = mountTypstream(el, {
        engine: strict,
        source,
        isStreaming: true,
        lazy: false,
        onWatchdog: (e) => stops.push(e),
      });
      await until(view, (s) => s.failure !== null);
      // A timeout, or the worker running out of memory first.
      expect(stops).toEqual([
        expect.objectContaining({
          uri: view.document?.uri,
          mode: "streaming",
          strikes: 1,
          live: true,
          searching: false,
        }),
      ]);
      expect(["timeout", "crash"]).toContain(stops[0]?.reason);
      view.destroy();
    } finally {
      strict.dispose();
      el.remove();
    }
  }, 60_000);
});
