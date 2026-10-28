/// <reference lib="dom" />
// What every suite shares: the corpus (read by the Node side of vitest), the
// real engine worker, and documents mounted the way an app mounts them:
// mountTypstream with html-compat (its preamble, sanitizer allowances and CSS)
// and the engine's math font, as the `typstream` package's <Typstream> does.

import type { Artifact, PagedArtifact } from "@typstream/core";
import { type MountedTypstream, registerMathFont, type TypstreamOptions } from "@typstream/dom";
import { createEngine, type DocumentState, type Engine, type EngineOptions, fromWorker } from "@typstream/engine";
import { htmlCompat } from "@typstream/html-compat";
import { commands } from "vitest/browser";

export interface CorpusDocument {
  /** `<set>/<name>`. */
  id: string;
  set: "edu" | "adversarial";
  name: string;
  /** What native typst does with it (corpus/README.md): `ok`, `error`, or `limit` (runaway). */
  expect: "ok" | "error" | "limit";
  tags: string[];
  source: string;
  /** Its recorded stream, or one synthesized from the source (token-sized, seeded). */
  chunks: string[];
  /** Its assets, at paths relative to the document. */
  files: Record<string, string>;
}

declare module "vitest/browser" {
  interface BrowserCommands {
    corpusEntries(): Promise<CorpusDocument[]>;
  }
}

export const loadCorpus = (): Promise<CorpusDocument[]> => commands.corpusEntries();

/**
 * The edu corpus by name, for suites that list a test per document: tests are
 * listed before the corpus loads. They check it against the corpus on disk.
 */
export const EDU_DOCUMENTS: readonly string[] = [
  "chemistry-balancing-equations",
  "exam-algebra-final",
  "exam-calculus-midterm",
  "exam-history-short-answer",
  "exam-physics-mechanics",
  "flashcards-capitals",
  "geometry-shapes-area",
  "handout-cornell-notes",
  "lab-report-pendulum",
  "lesson-plan-persuasive-writing",
  "lesson-plan-water-cycle",
  "math-linear-algebra",
  "math-statistics-probability",
  "math-trigonometry-identities",
  "multilingual-arabic-rtl-quiz",
  "multilingual-bengali-math",
  "multilingual-chinese-vocabulary",
  "multilingual-hindi-science",
  "multilingual-spanish-french-vocab",
  "programming-python-loops",
  "quiz-mcq-chemistry",
  "quiz-mcq-geography",
  "quiz-true-false-cells",
  "quiz-vocabulary-matching",
  "reading-comprehension-lighthouse",
  "report-climate-change",
  "rubric-argumentative-essay",
  "rubric-science-fair",
  "table-gradebook",
  "table-periodic-elements",
  "worksheet-fractions",
  "worksheet-linear-equations",
  "worksheet-photosynthesis",
  "worksheet-times-tables",
  "worksheet-verb-tenses",
];

// URLs are written out as `new URL("literal", import.meta.url)`: Vite rewrites only that form, to files
// outside this package's root (and bundles the worker).

/** The real engine worker, spawned from source as the packages' own browser tests do. */
export const startEngine = (options: Partial<EngineOptions> = {}): Engine =>
  createEngine({
    spawn: fromWorker(
      () => new Worker(new URL("../../../../packages/engine/src/worker.ts", import.meta.url), { type: "module" }),
    ),
    spare: false,
    ...options,
  });

/**
 * Resolves with the state once its artifact has stopped changing for `ms`. A
 * finished document still changes when a lazy font it lacked arrives (#11): the
 * engine compiles it again on its own, with the status left `done`.
 */
export const steady = async (get: () => DocumentState | null, ms = 150): Promise<DocumentState> => {
  for (;;) {
    const before = get()?.artifact;
    await sleep(ms);
    const s = get();
    if (s && s.artifact === before && s.status !== "compiling") return s;
  }
};

/**
 * Loads the script fonts the corpus needs (Arabic, Bengali, Devanagari; regular and bold) into
 * the engine, so later documents compile with them from their first compile and
 * never change after finishing. Fonts belong to the worker's wasm instance.
 */
export const warmFonts = async (engine: Engine) => {
  const doc = engine.open({ target: "paged", text: "العربية বাংলা हिन्दी *العربية বাংলা हिन्दी*" });
  doc.finish();
  await new Promise<void>((resolve) => {
    const check = (s: DocumentState) => {
      if (s.status !== "done" && s.status !== "error") return;
      stop();
      resolve();
    };
    const stop = doc.subscribe(check);
    check(doc.getState());
  });
  await steady(() => doc.getState(), 1000);
  doc.dispose();
};

/** New Computer Modern Math for MathML, from the engine's fonts (what `typstream` registers). */
export const loadMathFont = () =>
  registerMathFont(new URL("../../../../packages/engine-wasm/dist/fonts/NewCMMath-Regular.ttf", import.meta.url));

export type Target = "html" | "paged";

export interface MountOptions {
  target: Target;
  /** Paged: default `fit-width`, the document panel's view. */
  layout?: "fixed" | "fit-width";
  theme?: "light" | "dark";
  caret?: boolean;
  /** Default: the entry's whole source, complete. */
  source?: string;
  isStreaming?: boolean;
}

/** mountTypstream's options for `entry`, as an app passes them. */
export const appOptions = (engine: Engine, entry: CorpusDocument, o: MountOptions): TypstreamOptions => ({
  engine,
  source: o.source ?? entry.source,
  isStreaming: o.isStreaming ?? false,
  target: o.target,
  ...(o.target === "paged" ? { layout: o.layout ?? "fit-width" } : {}),
  ...(o.theme ? { theme: o.theme } : {}),
  caret: o.caret ?? false,
  plugins: [htmlCompat],
  files: entry.files,
  lazy: false,
});

/** An element `width` px wide at the top of the page. */
export const host = (width: number): HTMLElement => {
  const el = document.createElement("div");
  el.className = "suite-host";
  el.style.width = `${width}px`;
  document.body.append(el);
  return el;
};

/** Resolves with the first state that satisfies `done` (now or later). */
export const until = (view: MountedTypstream, done: (s: DocumentState) => boolean, ms = 60_000) =>
  new Promise<DocumentState>((resolve, reject) => {
    const timer = setTimeout(() => {
      stop();
      reject(new Error(`timed out; status ${view.getState()?.status}: ${JSON.stringify(view.getState()?.failure)}`));
    }, ms);
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

/**
 * Streams `entry` into a mount as an app feeds an LLM's answer: the growing text
 * with `isStreaming`, then the complete text. Paced so that the stream takes
 * about `seconds` whatever its length, and compiles happen along the way.
 */
export const streamInto = async (
  view: MountedTypstream,
  opts: TypstreamOptions,
  entry: CorpusDocument,
  seconds = 2,
): Promise<void> => {
  const perSecond = Math.max(200, entry.chunks.length / seconds);
  const start = performance.now();
  let text = "";
  let i = 0;
  while (i < entry.chunks.length) {
    await sleep(8);
    const due = Math.min(entry.chunks.length, Math.ceil(((performance.now() - start) / 1000) * perSecond));
    for (; i < due; i++) text += entry.chunks[i];
    view.update({ ...opts, source: text, isStreaming: true });
  }
  view.update({ ...opts, source: text, isStreaming: false });
};

/** The finished document compiled (`done`) or failed for good (`error`). */
export const finished = (s: DocumentState) => s.status === "done" || s.status === "error";

/**
 * Nothing left to compile for the current input: the artifact shows it
 * (`idle`, `done`) or its compile failed and the last good one stays (`stale`,
 * `error`).
 */
export const caughtUp = (s: DocumentState) => s.status !== "compiling";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export const frame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

export const pageEls = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>(".typstream-page")];
/** A page's SVG, when it came as SVG (in a shadow root). */
export const svgOf = (page: HTMLElement) =>
  page.firstElementChild?.shadowRoot?.firstElementChild as SVGSVGElement | null | undefined;
/** A page's canvas, when it came as a drawing (mountTypstream's default renderer). */
export const canvasOf = (page: HTMLElement) => page.querySelector<HTMLCanvasElement>(":scope > canvas");
/** What draws a page: its SVG or its canvas. */
export const graphicsOf = (page: HTMLElement): Element | null => canvasOf(page) ?? svgOf(page) ?? null;
export const textLayerOf = (page: HTMLElement) => page.querySelector<HTMLElement>(".typstream-text-layer");

const uses = (svg: string) => svg.match(/<use /g)?.length ?? 0;

/** Resolves once nothing in `el` (or its pages' shadow roots) has changed for `ms`. */
const quiet = (el: HTMLElement, ms = 40) =>
  new Promise<void>((resolve) => {
    let timer = setTimeout(done, ms);
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(done, ms);
    });
    const options = { childList: true, subtree: true, attributes: true, characterData: true };
    observer.observe(el, options);
    for (const page of pageEls(el)) {
      const root = page.firstElementChild?.shadowRoot;
      if (root) observer.observe(root, options);
    }
    function done() {
      observer.disconnect();
      resolve();
    }
  });

const letters = (text: string) => text.replace(/\s+/g, "");

/** Whether `page` shows in the viewport and in `el` (a panel clips what is below it), where its canvas has pixels. */
const onScreen = (page: HTMLElement, el: HTMLElement) => {
  const box = page.getBoundingClientRect();
  const clip = el.getBoundingClientRect();
  return box.bottom > Math.max(0, clip.top) && box.top < Math.min(innerHeight, clip.bottom);
};

/**
 * Waits until the paged view has drawn `artifact` whole: every page's SVG or
 * canvas (the paged view draws visible pages at the next frame, the others in
 * idle time; canvases on screen are painted) and its text layer. Glyph counts
 * tell an old SVG page from a new one, and a text layer's letters an old drawn
 * page, mostly: two versions of a page can have as many, so it also waits for
 * the view to settle.
 */
export const pagesDrawn = async (el: HTMLElement, artifact: PagedArtifact, ms = 30_000) => {
  const end = performance.now() + ms;
  for (;;) {
    const els = pageEls(el);
    const done =
      els.length === artifact.pageCount &&
      els.every((page, i) => {
        const want = artifact.pages[i];
        const layer = textLayerOf(page);
        if (!want || !layer) return false;
        if (want.drawing) {
          const canvas = canvasOf(page);
          return (
            !!canvas &&
            (canvas.width > 0 || !onScreen(page, el)) &&
            letters(layer.textContent ?? "") === letters((want.text ?? []).map((r) => r.text).join(""))
          );
        }
        const svg = svgOf(page);
        return !!svg && svg.querySelectorAll("use").length === uses(want.svg);
      });
    if (done) break;
    if (performance.now() > end) throw new Error(`pages not drawn: ${els.length} of ${artifact.pageCount}`);
    await sleep(20);
  }
  await frame();
  await quiet(el);
};

/** Waits until `artifact` is on screen, whatever its target. */
export const shown = async (el: HTMLElement, artifact: Artifact | null) => {
  if (artifact?.target === "paged") await pagesDrawn(el, artifact);
  await frame();
};

/** The stream's text up to `fraction` of its chunks. */
export const prefixAt = (entry: CorpusDocument, fraction: number): { text: string; chunks: number } => {
  const n = Math.round(entry.chunks.length * fraction);
  return { text: entry.chunks.slice(0, n).join(""), chunks: n };
};
