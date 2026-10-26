/// <reference lib="dom" />
// Final-render equivalence (PLAN §11.3, #19): for every corpus document, in both
// targets, streaming the document into mountTypstream and finishing it ends where
// a one-shot render of the whole source does:
// - the same status and failure (adversarial documents may end in errors or the watchdog);
// - the same artifact: the HTML string, or every page's size, SVG and text runs (not
//   the page hashes: Typst's frame hashes include source spans, which differ between an
//   incrementally reparsed source and a fresh parse);
// - the same DOM: rendered blocks, or each page's SVG and text layer.

import type { Artifact } from "@typstream/core";
import { type MountedTypstream, mountTypstream } from "@typstream/dom";
import type { DocumentState, Engine } from "@typstream/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { server } from "vitest/browser";
import {
  appOptions,
  type CorpusDocument,
  finished,
  host,
  loadCorpus,
  loadMathFont,
  pageEls,
  shown,
  startEngine,
  steady,
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
  engine = startEngine();
  await engine.ready;
  await warmFonts(engine);
  await loadMathFont();
  corpus = await loadCorpus();
}, 60_000);
afterAll(() => engine.dispose());

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** What a reader sees of an artifact: everything but page hashes. */
const visible = (a: Artifact | null) =>
  a?.target === "paged" ? { ...a, pages: a.pages.map(({ hash: _, ...page }) => page) } : a;

/** How a document ended: its status and why it failed, if it did. */
const outcome = (s: DocumentState) => ({ status: s.status, failure: s.failure?.reason ?? null });

/**
 * The rendered DOM, as markup. Renderers prefix ids per instance (`typstream-3-`),
 * so prefixes are normalized; paged pages keep their SVG in a shadow root. The
 * root's own attributes compare as a set: their order isn't fixed (WebKit has
 * listed `style` before `lang` for one mount and after it for another).
 */
const rendered = (el: HTMLElement): string => {
  const pages = pageEls(el);
  const root = el.firstElementChild;
  const markup = pages.length
    ? pages.map((p) => `${svgOf(p)?.outerHTML ?? ""}\n${textLayerOf(p)?.outerHTML ?? ""}`).join("\n")
    : `${[...(root?.attributes ?? [])].map((a) => `${a.name}=${a.value}`).sort()}\n${root?.innerHTML}`;
  return markup.replace(/typstream-\d+-/g, "typstream-N-");
};

/**
 * Streams `entry` into a mount as an app feeds an LLM's answer: the growing text
 * with `isStreaming`, then the complete text. Paced so that the stream takes
 * about `seconds` whatever its length, and compiles happen along the way.
 */
const streamInto = async (view: MountedTypstream, opts: ReturnType<typeof appOptions>, entry: CorpusDocument) => {
  const seconds = 2;
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
  const oneShot = host(600);
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
    if (JSON.stringify(outcome(sa)) !== JSON.stringify(outcome(sb))) {
      const timedOut = (sa.failure?.reason === "timeout") !== (sb.failure?.reason === "timeout");
      return {
        timedOut,
        problem: `${id}: streamed ${JSON.stringify(outcome(sa))}, one-shot ${JSON.stringify(outcome(sb))}`,
      };
    }
    if (sb.status !== "done") return { timedOut: false, problem: null };
    if (JSON.stringify(visible(sa.artifact)) !== JSON.stringify(visible(sb.artifact)))
      return { timedOut: false, problem: `${id}: artifacts differ` };
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
        // A timeout on one side only is the machine being busy (the watchdog's final budget is 10 s): once more.
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
