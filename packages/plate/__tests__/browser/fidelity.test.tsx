/// <reference lib="dom" />
// The editor shows a document as the HTML target does: each document in `<Typstream>`'s renderer (dom's
// `mountTypstream`, HTML target on pages) and in <TypstPlateEditor>, side by side at the same width, every word at
// the same place on the same page.

import { cleanup, render } from "@testing-library/react";
import { mountTypstream } from "@typstream/dom";
import { edu } from "@typstream/edu";
import type { Engine } from "@typstream/engine";
import { htmlCompat, typstFonts, universe } from "typstream";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { commands } from "vitest/browser";
import { TypstPlateEditor } from "../../src/index";
import { type Entry, startEngine } from "../support/engine";

const WIDTH = 700;
/** How far a word may be from where the HTML target has it, px. */
const TOLERANCE = 0.5;

let engine: Engine;
beforeAll(async () => {
  engine = startEngine();
  await engine.ready;
}, 60_000);
afterAll(() => engine.dispose());
afterEach(cleanup);

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = (left: number) => (left ? requestAnimationFrame(() => step(left - 1)) : resolve());
    step(n);
  });

const until = async (what: string, ok: () => boolean, ms = 30_000) => {
  const end = performance.now() + ms;
  while (!ok()) {
    if (performance.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
};

/** Every word in `flow`, in order, with its box relative to `origin` (Slate's zero-width spacers left out). */
const words = (flow: Element, origin: Element) => {
  const o = origin.getBoundingClientRect();
  const out: { word: string; x: number; y: number }[] = [];
  const walker = flow.ownerDocument.createTreeWalker(flow, NodeFilter.SHOW_TEXT);
  const range = flow.ownerDocument.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n as Text;
    if (text.parentElement?.closest("[data-slate-spacer], [data-slate-zero-width], svg, math")) continue;
    for (const m of text.data.matchAll(/\S+/g)) {
      range.setStart(text, m.index);
      range.setEnd(text, m.index + m[0].length);
      const r = range.getClientRects()[0];
      if (!r) continue;
      out.push({ word: m[0], x: r.left - o.left, y: r.top - o.top });
    }
  }
  return out;
};

const compare = async (entry: Entry, plugins: Parameters<typeof mountTypstream>[1]["plugins"]) => {
  const box = document.createElement("div");
  // Side by side, each as wide as asked whatever the viewport.
  box.style.cssText = `display: flex; align-items: flex-start; width: ${2 * WIDTH}px`;
  document.body.append(box);
  const ref = document.createElement("div");
  ref.style.cssText = `width: ${WIDTH}px; flex: none`;
  const mine = document.createElement("div");
  mine.style.cssText = `width: ${WIDTH}px; flex: none`;
  box.append(ref, mine);
  const mount = mountTypstream(ref, {
    engine,
    source: entry.source,
    target: "html",
    layout: "fit-width",
    plugins: [htmlCompat, universe, ...(plugins ?? [])],
    fonts: typstFonts,
    files: entry.files ?? {},
    lazy: false,
  });
  render(
    <TypstPlateEditor
      value={entry.source}
      engine={engine}
      plugins={plugins ?? []}
      files={entry.files ?? {}}
      toolbar={false}
      floatingToolbar={false}
    />,
    { container: mine },
  );
  try {
    await until("the HTML target", () => mount.getState()?.status === "done");
    await until("the editor", () => !!mine.querySelector(".typstream-plate-flow > *"));
    await document.fonts.ready;
    const refRoot = ref.querySelector(".typstream-pages") as Element;
    const editorRoot = mine.querySelector(".typstream-pages") as Element;
    const measure = () => ({
      expected: words(refRoot.querySelector(".typstream-flow:not(.typstream-marginals)") as Element, refRoot),
      actual: words(editorRoot.querySelector(".typstream-plate-flow") as Element, editorRoot),
    });
    // The pages correct lines after fonts load and as they settle: both sides as they stay.
    let last = "";
    let same = 0;
    let measured = measure();
    for (let i = 0; i < 50 && same < 3; i++) {
      await frames(2);
      await new Promise((r) => setTimeout(r, 50));
      measured = measure();
      const key = JSON.stringify(measured);
      same = key === last ? same + 1 : 0;
      last = key;
    }
    const { expected, actual } = measured;
    const off = actual.flatMap((a, i) => {
      const e = expected[i];
      if (!e || e.word !== a.word || Math.abs(e.x - a.x) > TOLERANCE || Math.abs(e.y - a.y) > TOLERANCE)
        return [{ i, expected: e, actual: a }];
      return [];
    });
    return { words: expected.length, actual: actual.length, off };
  } finally {
    mount.destroy();
    cleanup();
    box.remove();
  }
};

describe("pages as the HTML target's", () => {
  it("edu corpus documents", async () => {
    for (const entry of await commands.corpusEntries()) {
      const r = await compare(entry, []);
      expect.soft(r.actual, entry.name).toBe(r.words);
      expect.soft(r.off.length, `${entry.name}: first word off ${JSON.stringify(r.off[0])}`).toBe(0);
    }
  }, 600_000);

  it("edu's examples, with the edu plugin", async () => {
    for (const entry of await commands.eduExamples()) {
      const r = await compare(entry, [edu]);
      expect.soft(r.actual, entry.name).toBe(r.words);
      expect.soft(r.off.length, `${entry.name}: first word off ${JSON.stringify(r.off[0])}`).toBe(0);
    }
  }, 300_000);
});
