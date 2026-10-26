/// <reference lib="dom" />
// Flicker (PLAN §11.4, #19): every edu corpus document is replayed into
// mountTypstream in steps, waiting at each step until the document has caught
// up, while MutationObservers record what the renderers remove and add.
//
// Paged target:
// - pages are never removed while the document grows;
// - a page is redrawn only when its SVG changed, and swapped in one step (an SVG
//   is never taken out without the next one going in: no blank page);
// - a page before the last two never goes back to an SVG it showed before (no
//   A→B→A). The last page is where the stream is: the fixers may cut a call being
//   typed back to its start (#20, #65), hiding it until it compiles again, and what is
//   being typed at the top of a page can move back to the page before.
//
// HTML target. Blocks carry the source offset of the anchor before them
// (`data-typstream-src`); the blocks sharing one are a group, and a group is
// settled once the next group starts before heal's stable offset. Then:
// - a block whose markup didn't change is never re-created;
// - a settled group never disappears, and changes only where later text may
//   legitimately change it: ids Typst writes once a reference targets an element
//   (and the introspection ids numbered after them), references and citations (a
//   `pending-ref` placeholder until its target streams in, #20), and outlines
//   (`nav[role=doc-toc]`), which list headings and figures still to come.

import { type MountedTypstream, mountTypstream } from "@typstream/dom";
import type { DocumentState, Engine } from "@typstream/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { server } from "vitest/browser";
import {
  appOptions,
  type CorpusDocument,
  caughtUp,
  host,
  loadCorpus,
  loadMathFont,
  pageEls,
  pagesDrawn,
  startEngine,
  steady,
  svgOf,
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
  corpus = (await loadCorpus()).filter((e) => e.set === "edu");
}, 60_000);
afterAll(() => engine.dispose());

/** Steps a document's stream is replayed in: every chunk for short streams. */
const STEPS = 60;

/**
 * Replays `entry` in steps, calling `check` once the document caught up with
 * each step's text. Steps whose compile failed keep the last good render (the
 * engine's `stale`), so they show nothing new and are skipped.
 */
const replay = async (
  entry: CorpusDocument,
  view: MountedTypstream,
  opts: ReturnType<typeof appOptions>,
  check: (s: DocumentState, step: number) => Promise<void> | void,
) => {
  const steps = Math.min(entry.chunks.length, STEPS);
  for (let k = 1; k <= steps; k++) {
    const n = Math.round((entry.chunks.length * k) / steps);
    view.update({ ...opts, source: entry.chunks.slice(0, n).join(""), isStreaming: true });
    await until(view, caughtUp);
    // Fonts are warm, so nothing should change after this; a short wait catches it if it does.
    const s = await steady(() => view.getState(), 30);
    if (s.status === "idle") await check(s, k);
  }
};

// --- paged ----------------------------------------------------------------------------

const pagedFlicker = async (entry: CorpusDocument) => {
  const el = host(600);
  const opts = appOptions(engine, entry, { target: "paged", source: "", isStreaming: true });
  const view = mountTypstream(el, opts);
  const problems: string[] = [];
  /** Per page: the SVGs it showed, in order. */
  const history: string[][] = [];
  /** Per page: the SVG element on screen at the last step. */
  const nodes: (Element | null)[] = [];
  // Each page's shadow root is observed: a batch that takes an SVG out must put one in.
  const watched = new WeakSet<ShadowRoot>();
  let blank = 0;
  const watch = () => {
    for (const page of pageEls(el)) {
      const root = page.firstElementChild?.shadowRoot;
      if (!root || watched.has(root)) continue;
      watched.add(root);
      new MutationObserver((records) => {
        const out = records.some((r) => [...r.removedNodes].some((n) => n.nodeName === "svg"));
        if (out && !root.querySelector("svg")) blank++;
      }).observe(root, { childList: true });
    }
  };
  let pages = 0;
  let redrawn = 0;

  await replay(entry, view, opts, async (s, step) => {
    const artifact = s.artifact;
    if (artifact?.target !== "paged") return;
    await pagesDrawn(el, artifact);
    watch();
    const at = `${entry.name} step ${step}`;
    if (artifact.pageCount < pages) problems.push(`${at}: pages went from ${pages} to ${artifact.pageCount}`);
    pages = artifact.pageCount;
    pageEls(el).forEach((page, i) => {
      const svg = artifact.pages[i]?.svg ?? "";
      history[i] ??= [];
      const seen = history[i];
      const node = svgOf(page) ?? null;
      if (seen.at(-1) === svg) {
        if (nodes[i] && node !== nodes[i]) problems.push(`${at}: page ${i + 1} redrawn with the same SVG`);
      } else {
        if (seen.includes(svg) && i < pages - 2)
          problems.push(`${at}: page ${i + 1} went back to an SVG it showed before`);
        if (seen.length > 0) redrawn++;
        seen.push(svg);
      }
      nodes[i] = node;
    });
  });
  if (blank > 0) problems.push(`${entry.name}: ${blank} page swaps left a page blank`);
  view.destroy();
  el.remove();
  return { problems, redrawn };
};

// --- HTML -----------------------------------------------------------------------------

const SRC = "data-typstream-src";

/** A block's markup without its source offset. */
const keyOf = (el: Element) => el.outerHTML.replace(/ data-typstream-src="\d+"/g, "");

/**
 * Settled markup with what later text may change taken out (see the top of the
 * file): id values and the references to them, reference texts, and outlines.
 */
const settledForm = (html: string) =>
  html
    .replace(/<nav role="doc-toc">[\s\S]*?<\/nav>/g, "<nav/>")
    // A citation's brackets sit outside its link: `(<a role="doc-biblioref">IPCC, 2021</a>)`.
    .replace(/[([]?<a href="#[^"]*" role="doc-biblioref">[\s\S]*?<\/a>[)\]]?/g, "<a/>")
    .replace(/<a href="#[^"]*"[^>]*>[\s\S]*?<\/a>/g, "<a/>")
    .replace(/<span class="typstream-pending-ref"[^>]*>[\s\S]*?<\/span>/g, "<a/>")
    .replace(/ id="[^"]*"/g, "")
    .replace(/="#[^"]*"/g, '="#"');

interface Group {
  src: number;
  nodes: Element[];
  settled: boolean;
}

/** The renderer's top-level blocks, grouped by anchor, settled or not at `stable` (a source offset). */
const groupsOf = (root: Element, stable: number): Group[] => {
  const groups: Group[] = [];
  for (const el of root.children) {
    const src = Number(el.getAttribute(SRC) ?? Number.NaN);
    const last = groups.at(-1);
    if (last && (Number.isNaN(src) || src === last.src)) last.nodes.push(el);
    else groups.push({ src, nodes: [el], settled: false });
  }
  // A group ends where the next one starts.
  for (let i = 0; i + 1 < groups.length; i++) (groups[i] as Group).settled = (groups[i + 1] as Group).src <= stable;
  return groups;
};

const htmlFlicker = async (entry: CorpusDocument) => {
  const el = host(600);
  const opts = appOptions(engine, entry, { target: "html", source: "", isStreaming: true, caret: true });
  const view = mountTypstream(el, opts);
  const problems: string[] = [];
  // Top-level blocks removed and added since the last step.
  const removed: Element[] = [];
  const added: Element[] = [];
  const collect = (records: MutationRecord[]) => {
    for (const r of records) {
      if (!(r.target as Element).classList?.contains("typstream")) continue;
      for (const n of r.removedNodes) if (n.nodeType === 1) removed.push(n as Element);
      for (const n of r.addedNodes) if (n.nodeType === 1) added.push(n as Element);
    }
  };
  const observer = new MutationObserver(collect);
  observer.observe(el, { childList: true, subtree: true });
  let previous: Group[] = [];
  let rewrites = 0;

  await replay(entry, view, opts, (s, step) => {
    const root = el.querySelector(".typstream");
    if (!root) return;
    collect(observer.takeRecords());
    const at = `${entry.name} step ${step}`;
    // Nothing removed comes back with the same markup: unchanged blocks keep their node.
    const back = new Map<string, number>();
    for (const n of added) back.set(keyOf(n), (back.get(keyOf(n)) ?? 0) + 1);
    for (const n of removed) {
      const left = back.get(keyOf(n)) ?? 0;
      if (left === 0 || n.classList.contains("typstream-caret")) continue;
      back.set(keyOf(n), left - 1);
      problems.push(`${at}: re-created an unchanged block: ${keyOf(n).slice(0, 120)}`);
    }
    removed.length = 0;
    added.length = 0;

    const now = groupsOf(root, s.heal.map.toSource(s.heal.stableOffset));
    for (const g of previous) {
      if (!g.settled) continue;
      const before = g.nodes.map(keyOf).join("");
      const same = now.find((n) => n.src === g.src);
      if (!same) {
        problems.push(`${at}: settled block at ${g.src} disappeared: ${before.slice(0, 120)}`);
        continue;
      }
      const after = same.nodes.map(keyOf).join("");
      if (after === before) continue;
      rewrites++;
      if (settledForm(after) !== settledForm(before))
        problems.push(
          `${at}: settled block at ${g.src} changed:\n  - ${before.slice(0, 300)}\n  + ${after.slice(0, 300)}`,
        );
    }
    previous = now;
  });
  observer.disconnect();
  view.destroy();
  el.remove();
  return { problems, rewrites };
};

describe(`flicker in ${browser}`, () => {
  it("paged: pages are kept, redrawn only when they change, never blank and never back", async () => {
    const problems: string[] = [];
    let redrawn = 0;
    for (const entry of corpus) {
      const r = await pagedFlicker(entry);
      problems.push(...r.problems);
      redrawn += r.redrawn;
    }
    console.log(`${browser} paged: ${corpus.length} documents, ${redrawn} redraws of changed pages`);
    expect(problems).toEqual([]);
  }, 1_800_000);

  it("html: unchanged blocks are kept, settled blocks stay", async () => {
    const problems: string[] = [];
    let rewrites = 0;
    for (const entry of corpus) {
      const r = await htmlFlicker(entry);
      problems.push(...r.problems);
      rewrites += r.rewrites;
    }
    console.log(`${browser} html: ${corpus.length} documents, ${rewrites} settled blocks updated by later text`);
    expect(problems).toEqual([]);
  }, 1_800_000);
});
