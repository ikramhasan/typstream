/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// Waiting on a mounted document in a browser: what the conformance suite's paged half and tools/browser-suites share.

import type { Artifact, PagedArtifact } from "@typstream/core";
import type { MountedTypstream } from "@typstream/dom";
import type { DocumentState, Engine } from "@typstream/engine";

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

/** The finished document compiled (`done`) or failed for good (`error`). */
export const finished = (s: DocumentState) => s.status === "done" || s.status === "error";

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
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
