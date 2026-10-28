/// <reference lib="dom" />
// Visual regression (PLAN §11.4, #19): screenshots of corpus documents rendered
// by mountTypstream, compared with the baselines in __screenshots__/<browser>/.
// Run inside Playwright's Docker image only (`pnpm test:visual`; `pnpm
// visual:update` to accept changes), so pixels don't depend on the machine.
//
// What is shot (README.md has the reasons):
// - every edu document, finished, paged and HTML (light) at 600 px: the whole
//   document in Chromium, the first screen (600 × 800) in Firefox and WebKit;
// - a feature set of documents: HTML in the dark theme, and mid-stream frames at
//   50% of the stream in both targets, in every browser; frames at 25% and 75%,
//   and widths 360 and 960 px, in Chromium. A mid-stream frame is the 800 px
//   panel scrolled to the end, where the stream is, with the caret.
//
// The page is laid out as an app would: the HTML target in the engine's own
// text fonts (Libertinus Serif, DejaVu Sans Mono) and its math font, the paged
// target as a document panel (fit-width) on a grey background.

import { type MountedTypstream, mountTypstream } from "@typstream/dom";
import type { DocumentState, Engine } from "@typstream/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { page, server } from "vitest/browser";
import {
  appOptions,
  type CorpusDocument,
  caughtUp,
  EDU_DOCUMENTS as DOCUMENTS,
  finished,
  host,
  loadCorpus,
  loadMathFont,
  prefixAt,
  shown,
  startEngine,
  steady,
  type Target,
  until,
  warmFonts,
} from "./support/mount";

const browser = server.browser;
/** The browser that shoots whole documents and every axis; the others shoot first screens. */
const reference = browser === "chromium";

/** Documents that cover what the corpus renders: math, tables, shapes, scripts, code, fills, a recorded stream. */
const FEATURES = [
  "worksheet-fractions",
  "exam-physics-mechanics",
  "exam-algebra-final",
  "math-linear-algebra",
  "geometry-shapes-area",
  "handout-cornell-notes",
  "lesson-plan-persuasive-writing",
  "multilingual-arabic-rtl-quiz",
  "multilingual-chinese-vocabulary",
  "programming-python-loops",
  "quiz-mcq-geography",
  "table-gradebook",
];

const PANEL_HEIGHT = 800;

// The HTML target's text in the fonts the engine lays out paged output with.
const FONTS: [string, URL, FontFaceDescriptors][] = [
  [
    "Libertinus Serif",
    new URL("../../../packages/engine-wasm/dist/fonts/LibertinusSerif-Regular.ttf", import.meta.url),
    {},
  ],
  [
    "Libertinus Serif",
    new URL("../../../packages/engine-wasm/dist/fonts/LibertinusSerif-Bold.ttf", import.meta.url),
    { weight: "bold" },
  ],
  [
    "Libertinus Serif",
    new URL("../../../packages/engine-wasm/dist/fonts/LibertinusSerif-Italic.ttf", import.meta.url),
    { style: "italic" },
  ],
  ["DejaVu Sans Mono", new URL("../../../packages/engine-wasm/dist/fonts/DejaVuSansMono.ttf", import.meta.url), {}],
];

const PAGE_CSS = `
body { margin: 0; }
.suite-host { font-family: "Libertinus Serif", serif; font-size: 16px; line-height: 1.4; }
.suite-host code, .suite-host pre { font-family: "DejaVu Sans Mono", monospace; font-size: 0.85em; }
.suite-host[data-target="paged"] { background: #e4e4e7; }
.suite-host[data-panel] { overflow: hidden; }
`;

let engine: Engine;
let corpus: CorpusDocument[];
beforeAll(async () => {
  engine = startEngine();
  await engine.ready;
  await warmFonts(engine);
  await loadMathFont();
  for (const [family, url, descriptors] of FONTS) {
    const face = new FontFace(family, `url(${url})`, descriptors);
    document.fonts.add(face);
    await face.load();
  }
  const style = document.createElement("style");
  style.textContent = PAGE_CSS;
  document.head.append(style);
  corpus = (await loadCorpus()).filter((e) => e.set === "edu");
}, 60_000);
afterAll(() => engine.dispose());

interface Shot {
  doc: string;
  target: Target;
  width: number;
  theme: "light" | "dark";
  /** Fraction of the stream, for a mid-stream frame. */
  at?: number;
  /** An 800 px panel: the first screen of a finished document, the last of a streaming one. */
  panel: boolean;
}

const shotsOf = (doc: string): Shot[] => {
  const shots: Shot[] = [];
  const light = { doc, theme: "light", width: 600 } as const;
  for (const target of ["paged", "html"] as const) shots.push({ ...light, target, panel: !reference });
  if (!FEATURES.includes(doc)) return shots;
  shots.push({ ...light, target: "html", theme: "dark", panel: true });
  for (const at of reference ? [0.25, 0.5, 0.75] : [0.5])
    for (const target of ["paged", "html"] as const) shots.push({ ...light, target, at, panel: true });
  if (reference)
    for (const width of [360, 960])
      for (const target of ["paged", "html"] as const) shots.push({ ...light, target, width, panel: true });
  return shots;
};

/** `<doc>/<final|stream-NN>-<target>[-theme]-<width>[-top]`, under __screenshots__/<browser>/. */
const fileName = (s: Shot) =>
  `${s.doc}/${s.at === undefined ? "final" : `stream-${Math.round(s.at * 100)}`}-${s.target}` +
  `${s.target === "html" ? `-${s.theme}` : ""}-${s.width}${s.panel && s.at === undefined ? "-top" : ""}`;

/**
 * A mid-stream frame: the stream's text up to `at`, streaming. A prefix whose
 * compile fails shows nothing in a fresh mount, so the frame moves on chunk by
 * chunk to the first prefix that compiles.
 */
const streamTo = async (
  view: MountedTypstream,
  opts: ReturnType<typeof appOptions>,
  entry: CorpusDocument,
  at: number,
): Promise<DocumentState> => {
  for (let { chunks } = prefixAt(entry, at); chunks <= entry.chunks.length; chunks++) {
    view.update({ ...opts, source: entry.chunks.slice(0, chunks).join(""), isStreaming: true });
    await until(view, caughtUp);
    const s = await steady(() => view.getState());
    if (s.status === "idle" && s.artifact) return s;
  }
  throw new Error(`${entry.name}: no prefix from ${at} on compiles`);
};

const shoot = async (shot: Shot) => {
  const entry = corpus.find((e) => e.name === shot.doc) as CorpusDocument;
  document.documentElement.style.cssText = `color-scheme: ${shot.theme}; background: Canvas`;
  const el = host(shot.width);
  el.dataset.target = shot.target;
  if (shot.panel) {
    el.dataset.panel = "";
    el.style.height = `${PANEL_HEIGHT}px`;
  }
  const streaming = shot.at !== undefined;
  const opts = appOptions(engine, entry, {
    target: shot.target,
    theme: shot.theme,
    caret: streaming,
    source: "",
    isStreaming: true,
  });
  const view = mountTypstream(el, opts);
  try {
    let s: DocumentState;
    if (streaming) s = await streamTo(view, opts, entry, shot.at as number);
    else {
      view.update({ ...opts, source: entry.source, isStreaming: false });
      await until(view, finished);
      s = await steady(() => view.getState());
    }
    expect(s.status, entry.name).not.toBe("error");
    await shown(el, s.artifact);
    await document.fonts.ready;
    // A panel follows the stream to its end, where canvases that came into view are painted.
    if (streaming) {
      el.scrollTop = el.scrollHeight;
      await shown(el, s.artifact);
    }
    await expect.element(page.elementLocator(el)).toMatchScreenshot(fileName(shot));
  } finally {
    view.destroy();
    el.remove();
  }
};

describe(`visual in ${browser}`, () => {
  it("shoots the whole edu corpus", () => {
    expect(corpus.map((e) => e.name).sort()).toEqual([...DOCUMENTS].sort());
    for (const doc of FEATURES) expect(DOCUMENTS).toContain(doc);
  });

  it.for(DOCUMENTS.flatMap(shotsOf).map((s): [string, Shot] => [fileName(s), s]))("%s", { timeout: 120_000 }, async ([
    ,
    shot,
  ]) => {
    await shoot(shot);
  });
});
