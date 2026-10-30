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

  it("streams into a range of a finished document: the rest stays on screen, and it finishes again", async () => {
    const el = host();
    const before = "= Quiz\n\nAnswer every question.\n\n";
    const after = "\n\n== Last part\n\nThe end.";
    const old = "First, *old* question.";
    const replacement = "First, a *new* question with $x^2$.";
    const options = (source: string, isStreaming: boolean, streamingRange?: { from: number; to: number }) => ({
      engine,
      source,
      isStreaming,
      ...(streamingRange ? { streamingRange } : {}),
      lazy: false,
    });
    const view = mountTypstream(el, options(before + old + after, false));
    await until(view, settled);
    const opened = view.document;
    const seen: string[] = [];
    const stop = view.subscribe(() => seen.push(el.textContent ?? ""));

    const from = before.length;
    for (let n = 1; n <= replacement.length; n += 3) {
      const written = replacement.slice(0, n);
      view.update(options(before + written + after, true, { from, to: from + written.length }));
      await sleep(15);
    }
    view.update(options(before + replacement + after, true, { from, to: from + replacement.length }));
    expect(view.getState()?.streamingRange).toEqual({ from, to: from + replacement.length });
    view.update(options(before + replacement + after, false));
    const final = await until(view, settled);
    stop();

    // The same document, never started over, and the text around the range on screen throughout.
    expect(view.document).toBe(opened);
    expect(final.status).toBe("done");
    expect(final.streamingRange).toBeNull();
    expect(final.heal.source).toBe(before + replacement + after);
    expect(seen.length).toBeGreaterThan(3);
    for (const text of seen) {
      expect(text).toContain("Answer every question.");
      expect(text).toContain("The end.");
    }
    expect(el.textContent).toContain("First, a new question with");
    expect(el.textContent).not.toContain("old");
    view.destroy();
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

  it("shows a placeholder for an image it has no file for, then the one resolveImage gives", async () => {
    const svg = (fill: string) =>
      new TextEncoder().encode(
        `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="${fill}"/></svg>`,
      );
    const decode = (url: string | null) => (url?.startsWith("data:image/svg+xml;base64,") ? atob(url.slice(26)) : "");
    for (const target of ["html", "paged"] as const) {
      const el = host();
      let give: (bytes: Uint8Array) => void = () => {};
      const asked: string[] = [];
      const options = (): TypstreamOptions => ({
        engine,
        target,
        // SVG pages, whose <image>s show which image the page has.
        renderer: "svg",
        source: '#figure(image("https://x.org/cell.svg", width: 3cm, alt: "A cell"), caption: [A cell])',
        // A new function on every update, as an inline prop would be: the latest is called, the document stays.
        resolveImage: (path) => {
          asked.push(path);
          return new Promise((resolve) => {
            give = resolve;
          });
        },
        lazy: false,
      });
      const view = mountTypstream(el, options());
      const images = () =>
        target === "html"
          ? [...el.querySelectorAll("img")].map((i) => decode(i.getAttribute("src")))
          : [...el.querySelectorAll("div")].flatMap((d) =>
              [...(d.shadowRoot?.querySelectorAll("image") ?? [])].map((i) =>
                decode(i.getAttribute("href") ?? i.getAttributeNS("http://www.w3.org/1999/xlink", "href")),
              ),
            );
      await until(view, (s) => s.status === "done");
      const doc = view.document;
      view.update(options());
      expect(view.document).toBe(doc);
      // Through the renderer's sanitizer, a data: URL: the placeholder, with the file's name.
      await expect.poll(images).toEqual([expect.stringContaining("cell.svg</text>")]);
      // Pages build their text layer in idle time, after the page itself.
      await expect.poll(() => el.textContent).toContain("A cell");
      give(svg("#123456"));
      await expect.poll(images, { timeout: 15_000 }).toEqual([expect.stringContaining("#123456")]);
      expect(asked).toEqual(["https://x.org/cell.svg"]);
      view.destroy();
      el.remove();
    }
  });

  it("keeps an image's proportions when it is shrunk to fit or set to the full width", async () => {
    const el = host();
    el.style.width = "300px";
    // 400 × 100 pt: wider than the element.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100"/>';
    const options = (preamble?: string): TypstreamOptions => ({
      engine,
      source: '#image("wide.svg")\n\n#image("wide.svg", width: 50%)',
      files: { "wide.svg": svg },
      ...(preamble ? { preamble } : {}),
      lazy: false,
    });
    const sizes = () => [...el.querySelectorAll("img")].map((i) => [i.offsetWidth, i.offsetHeight]);
    const view = mountTypstream(el, options());
    await until(view, (s) => s.status === "done");
    await expect.poll(sizes).toEqual([
      [300, 75],
      [150, 38],
    ]);
    // Every image as wide as the page: a set rule in the preamble; a width the call gives still wins.
    view.update(options("#set image(width: 100%)"));
    await until(view, (s) => s.status === "done");
    await expect.poll(sizes).toEqual([
      [300, 75],
      [150, 38],
    ]);
    view.update({
      ...options("#set image(width: 100%)"),
      source: '#image("wide.svg")',
      files: { "wide.svg": svg.replace('width="400" height="100"', 'width="100" height="25"') },
    });
    // A small image grows to the width, in proportion.
    await expect.poll(sizes).toEqual([[300, 75]]);
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

  it("fit-width shows the document's own pages at the element's width, and only scales them on resize", async () => {
    const el = host();
    el.style.width = "300px";
    const view = mountTypstream(el, {
      engine,
      source: "= Worksheet\nSolve $x^2 = 4$.",
      target: "paged",
      layout: "fit-width",
      lazy: false,
    });
    const shown = await until(view, (s) => s.status === "done" && s.artifact?.target === "paged");
    // A4, as the PDF has it (#118), shown 300 px wide…
    const page = shown.artifact?.target === "paged" ? shown.artifact.pages[0] : undefined;
    expect(page?.width).toBeCloseTo(595.28, 1);
    const pageEl = () => el.querySelector(".typstream-page") as HTMLElement;
    await sleep(50);
    expect(pageEl().getBoundingClientRect().width).toBeCloseTo(300, 0);
    // …then 900 px wide, larger than its own size, without compiling again.
    el.style.width = "900px";
    await sleep(400);
    expect(pageEl().getBoundingClientRect().width).toBeCloseTo(900, 0);
    expect(view.getState()?.artifact).toBe(shown.artifact);
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
      layout: "reflow",
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

  it("exports with an export's own inputs over the template's and the mount's", async () => {
    const el = host();
    const source = [
      '#let at(key) = sys.inputs.at(key, default: "none")',
      '#set page(width: float(at("width")) * 1pt, height: float(at("height")) * 1pt)',
      'Copy: #at("copy"), kind: #at("kind")',
    ].join("\n");
    const memo = definePlugin({
      key: "acme/memo",
      templates: [{ name: "memo", preamble: "", inputs: { kind: "memo", height: "100" } }],
    });
    const view = mountTypstream(el, {
      engine,
      source,
      plugins: [memo],
      template: "memo",
      inputs: { width: "300", height: "200", copy: "student" },
      lazy: false,
    });
    await until(view, (s) => s.status === "done");
    const size = async (inputs?: Record<string, string>) => {
      const pdf = new TextDecoder("latin1").decode(await view.exportPdf(inputs ? { inputs } : undefined));
      return (/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)/.exec(pdf) ?? []).slice(1).map(Number);
    };
    // The mount's inputs over the template's…
    expect(await size()).toEqual([300, 200]);
    // …and an export's over both, for that export only.
    expect(await size({ width: "400" })).toEqual([400, 200]);
    expect(await size()).toEqual([300, 200]);
    const file = await view.exportHtml({ inputs: { copy: "teacher" }, title: "Memo" });
    expect(file).toContain("Copy: teacher, kind: memo");
    expect(file).toContain("<title>Memo</title>");
    expect(await view.exportHtml()).toContain("Copy: student, kind: memo");
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
      editor: { slashItems: [{ key: "note", label: "Note", insert: "#note[]" }] },
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
