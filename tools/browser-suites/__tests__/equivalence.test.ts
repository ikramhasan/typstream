/// <reference lib="dom" />
// Final-render equivalence (PLAN §11.3, #19): for every corpus document, in both
// targets, streaming the document into mountTypstream and finishing it ends where
// a one-shot render of the whole source does:
// - the same status and failure (adversarial documents may end in errors or the watchdog);
// - the same artifact: the HTML string, or every page's size, SVG and text runs (not
//   the page hashes: Typst's frame hashes include source spans, which differ between an
//   incrementally reparsed source and a fresh parse);
// - the same DOM: rendered blocks, or each page's SVG and text layer.
//
// The adversarial set (runaways, memory bombs, a 479-page document) runs in
// Chromium only. It tests the engine and its watchdog, the same wasm in every
// browser, and it is most of the suite's time (a final compile that runs out of
// time starts the hang search, #21, up to 16 more compiles under the 10 s budget).
// What browsers do differently is render, which the edu set checks in all three.

import type { Artifact } from "@typstream/core";
import { type MountedTypstream, mountTypstream } from "@typstream/dom";
import type { DocumentState, Engine } from "@typstream/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { server } from "vitest/browser";
import {
  appOptions,
  type CorpusDocument,
  canvasOf,
  finished,
  host,
  loadCorpus,
  loadMathFont,
  pageEls,
  shown,
  startEngine,
  steady,
  streamInto,
  svgOf,
  type Target,
  textLayerOf,
  until,
  warmFonts,
} from "./support/mount";

const browser = server.browser;

let engine: Engine;
let corpus: CorpusDocument[];
beforeAll(async () => {
  // No live page limit (the security suite tests it): past 100 pages a stream stops compiling until it ends, so its
  // worker keeps warm caches the one-shot side doesn't have, and a final compile near the budget (the 479-page
  // document) times out on one side only.
  engine = startEngine({ limits: { livePages: Number.POSITIVE_INFINITY } });
  await engine.ready;
  await warmFonts(engine);
  await loadMathFont();
  // The hostile runaways are security.test.ts's, under shorter budgets.
  corpus = (await loadCorpus()).filter(
    (e) => (browser === "chromium" || e.set === "edu") && !(e.name.startsWith("hostile-") && e.expect === "limit"),
  );
}, 60_000);
afterAll(() => engine.dispose());

/** What a reader sees of an artifact: everything but page hashes. */
const visible = (a: Artifact | null) =>
  a?.target === "paged" ? { ...a, pages: a.pages.map(({ hash: _, ...page }) => page) } : a;

/** Blocks the fallback showed as error boxes (#21): failed ones, and those the hang search skipped. */
const isolated = (s: DocumentState) => JSON.stringify(s.lastCompile?.fallback?.isolated ?? []);

/** How a document ended: its status and why it failed, if it did. */
const outcome = (s: DocumentState) => ({ status: s.status, failure: s.failure?.reason ?? null });

/**
 * The rendered DOM, as markup. Renderers prefix ids per instance (`typstream-3-`),
 * so prefixes are normalized; paged pages keep their SVG in a shadow root, or
 * their pixels in a canvas (as a data URL, when painted). The root's own
 * attributes compare as a set: their order isn't fixed (WebKit has listed
 * `style` before `lang` for one mount and after it for another).
 */
const rendered = (el: HTMLElement): string => {
  const pages = pageEls(el);
  const root = el.firstElementChild;
  const graphics = (p: HTMLElement) => {
    const canvas = canvasOf(p);
    if (!canvas) return svgOf(p)?.outerHTML ?? "";
    return `<canvas ${canvas.width}×${canvas.height}> ${canvas.width ? canvas.toDataURL() : ""}`;
  };
  const markup = pages.length
    ? pages
        .map(
          (p) =>
            `${graphics(p)}\n${p.querySelector(".typstream-links")?.outerHTML ?? ""}\n${textLayerOf(p)?.outerHTML ?? ""}`,
        )
        .join("\n")
    : `${[...(root?.attributes ?? [])].map((a) => `${a.name}=${a.value}`).sort()}\n${root?.innerHTML}`;
  return markup.replace(/typstream-\d+-/g, "typstream-N-");
};

/** Long documents and runaways: the watchdog's final budget is 10 s per compile. */
const timeoutFor = (entry: CorpusDocument) => (entry.set === "adversarial" ? 180_000 : 60_000);

const targets: Target[] = ["paged", "html"];

/** Streams `entry` into one mount, renders it whole in another, and says how they differ, if they do. */
const compare = async (entry: CorpusDocument, target: Target) => {
  const streamed = host(600);
  const opts = appOptions(engine, entry, { target, source: "", isStreaming: true });
  const a = mountTypstream(streamed, opts);
  // Compiled mid-stream, not just at the end.
  let compiles = 0;
  let last: unknown = null;
  a.subscribe(() => {
    const c = a.getState()?.lastCompile;
    if (c && c !== last) {
      last = c;
      compiles++;
    }
  });
  // Over the streamed mount: page n of both is as near the viewport, so both canvases are painted or neither is.
  const oneShot = host(600);
  Object.assign(oneShot.style, {
    position: "absolute",
    top: `${streamed.offsetTop}px`,
    left: `${streamed.offsetLeft}px`,
  });
  let b: MountedTypstream | null = null;
  try {
    await streamInto(a, opts, entry);
    await until(a, (s) => s.final && finished(s), timeoutFor(entry));
    const sa = await steady(() => a.getState());
    b = mountTypstream(oneShot, appOptions(engine, entry, { target }));
    await until(b, finished, timeoutFor(entry));
    const sb = await steady(() => (b as MountedTypstream).getState());

    const id = `${entry.id} (${target})`;
    expect(sa.heal.source, id).toBe(sb.heal.source);
    // Runaways and bombs stop live compiling at once.
    if (entry.set === "edu") expect(compiles, id).toBeGreaterThan(1);
    // The watchdog acted on one side only: a final compile ran out of time there, or the
    // hang search skipped blocks there (isolation for errors happens on both sides alike).
    const timedOut =
      (sa.failure?.reason === "timeout") !== (sb.failure?.reason === "timeout") || isolated(sa) !== isolated(sb);
    if (JSON.stringify(outcome(sa)) !== JSON.stringify(outcome(sb))) {
      return {
        timedOut,
        problem: `${id}: streamed ${JSON.stringify(outcome(sa))}, one-shot ${JSON.stringify(outcome(sb))}`,
      };
    }
    if (sb.status !== "done") return { timedOut: false, problem: null };
    if (JSON.stringify(visible(sa.artifact)) !== JSON.stringify(visible(sb.artifact)))
      return { timedOut, problem: `${id}: artifacts differ${timedOut ? " (the watchdog acted on one side)" : ""}` };
    await shown(streamed, sa.artifact);
    await shown(oneShot, sb.artifact);
    if (rendered(streamed) !== rendered(oneShot)) return { timedOut: false, problem: `${id}: rendered DOM differs` };
    return { timedOut: false, problem: null };
  } finally {
    a.destroy();
    b?.destroy();
    streamed.remove();
    oneShot.remove();
  }
};

describe(`final-render equivalence in ${browser}`, () => {
  for (const target of targets) {
    it(`every corpus document, ${target}: streamed and finished equals one-shot`, async () => {
      const mismatches: string[] = [];
      let compared = 0;
      for (const entry of corpus) {
        // The watchdog acting on one side only is the machine being busy (its final budget is 10 s): once more.
        let result = await compare(entry, target);
        if (result.timedOut) result = await compare(entry, target);
        if (result.problem) mismatches.push(result.problem);
        else compared++;
      }
      console.log(`${browser} ${target}: ${compared} of ${corpus.length} documents equal`);
      expect(mismatches).toEqual([]);
      expect(compared).toBe(corpus.length);
    }, 1_800_000);
  }
});
