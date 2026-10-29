/// <reference lib="dom" />
// What every suite shares: the corpus (read by the Node side of vitest), the
// real engine worker, and documents mounted the way an app mounts them:
// mountTypstream with html-compat (its preamble, sanitizer allowances and CSS)
// and the engine's math font, as the `typstream` package's <Typstream> does.

import { sleep } from "@typstream/conformance/mount";
import { type MountedTypstream, registerMathFont, type TypstreamOptions } from "@typstream/dom";
import { createEngine, type DocumentState, type Engine, type EngineOptions, fromWorker } from "@typstream/engine";
import { htmlCompat } from "@typstream/html-compat";
import { commands } from "vitest/browser";

// Waiting on a mount, and finding its pages: shared with the plugin conformance suite (#135).
export {
  canvasOf,
  finished,
  frame,
  graphicsOf,
  host,
  pageEls,
  pagesDrawn,
  shown,
  steady,
  svgOf,
  textLayerOf,
  until,
  warmFonts,
} from "@typstream/conformance/mount";

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

/**
 * Nothing left to compile for the current input: the artifact shows it
 * (`idle`, `done`) or its compile failed and the last good one stays (`stale`,
 * `error`).
 */
export const caughtUp = (s: DocumentState) => s.status !== "compiling";

/** The stream's text up to `fraction` of its chunks. */
export const prefixAt = (entry: CorpusDocument, fraction: number): { text: string; chunks: number } => {
  const n = Math.round(entry.chunks.length * fraction);
  return { text: entry.chunks.slice(0, n).join(""), chunks: n };
};
