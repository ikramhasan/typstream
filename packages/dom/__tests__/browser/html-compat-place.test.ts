/// <reference lib="dom" />
// html-compat's `place` in each browser, measured against Typst's own layout
// (#94): the same document compiled by the engine worker to HTML (with
// html-compat, through the renderer) and to pages (text runs, in points), each
// placed label's offset from a reference word that starts its container's
// content area must match. Typst places inside a container's inset; CSS
// positions against the padding box, which is what html-compat must undo.

import type { DocumentState, Engine, EngineDocument } from "@typstream/engine";
import { htmlCompat, htmlCompatCss } from "@typstream/html-compat";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { server } from "vitest/browser";
import { createHtmlRenderer } from "../../src/html/renderer";
import { compileHtml, openHtml, startEngine, until } from "../support/html";

const browser = server.browser;

/** A placed label, by its (unique) text, and the word starting the content area it is placed in. */
interface Label {
  text: string;
  ref: string;
  /** Which of its edges the alignment puts on the container's: start, center or end. */
  x: "start" | "center" | "end";
  /** Its vertical alignment; unset when it has none (it stays where the flow is), and its baseline isn't checked. */
  y?: "top" | "horizon" | "bottom";
}

interface Case {
  name: string;
  source: string;
  labels: Label[];
}

const GRID: [string, Label["x"], Label["y"]][] = [
  ["top + left", "start", "top"],
  ["top + center", "center", "top"],
  ["top + right", "end", "top"],
  ["horizon + left", "start", "horizon"],
  ["horizon + center", "center", "horizon"],
  ["horizon + right", "end", "horizon"],
  ["bottom + left", "start", "bottom"],
  ["bottom + center", "center", "bottom"],
  ["bottom + right", "end", "bottom"],
];
const gridLabel = (i: number) => `Pl${String.fromCharCode(97 + i)}`;

const CASES: Case[] = [
  {
    name: "every alignment, a different inset on each side",
    source: `#block(width: 8cm, height: 4cm, inset: (left: 1cm, top: 0.5cm, right: 2cm, bottom: 1.5cm), fill: luma(235))[
Ref

${GRID.map(([a], i) => `#place(${a})[${gridLabel(i)}]`).join("\n\n")}
]`,
    labels: GRID.map(([, x, y], i) => ({ text: gridLabel(i), ref: "Ref", x, y })),
  },
  {
    name: "dx and dy, inward and outward",
    source: `#block(width: 8cm, height: 3cm, inset: (x: 1.2cm, y: 0.6cm), fill: luma(235))[
Ref

#place(top + left, dx: 0.5cm, dy: 0.3cm)[Dxa]

#place(bottom + right, dx: -0.4cm, dy: -0.2cm)[Dxb]

#place(top + right, dx: 0.8cm)[Dxc]

#place(bottom + center, dy: 0.7cm)[Dxd]
]`,
    labels: [
      { text: "Dxa", ref: "Ref", x: "start", y: "top" },
      { text: "Dxb", ref: "Ref", x: "end", y: "bottom" },
      { text: "Dxc", ref: "Ref", x: "end", y: "top" },
      { text: "Dxd", ref: "Ref", x: "center", y: "bottom" },
    ],
  },
  {
    // reading-comprehension-lighthouse's ¶ labels: back over the inset, to the block's edge.
    name: "a label in the left inset (em)",
    source: `#block(inset: (left: 2.2em))[
Ref

#place(dx: -2.2em)[Pqa]
Body text of the paragraph.
]`,
    labels: [{ text: "Pqa", ref: "Ref", x: "start" }],
  },
  {
    name: "nested containers: each places inside its own inset",
    source: `#block(width: 10cm, height: 7.5cm, inset: 1cm, fill: luma(235))[
Ref

#block(width: 6cm, height: 2cm, fill: luma(210))[Rin

#place(bottom + right)[Nsa]]

#rect(width: 6cm, height: 2.4cm, inset: (x: 0.6cm, top: 0.3cm, bottom: 0.9cm), stroke: none, fill: luma(210))[Rre

#place(top + right)[Nsb]

#place(bottom + center)[Nsc]]

#place(bottom + left)[Nsd]
]`,
    labels: [
      { text: "Nsa", ref: "Rin", x: "end", y: "bottom" },
      { text: "Nsb", ref: "Rre", x: "end", y: "top" },
      { text: "Nsc", ref: "Rre", x: "center", y: "bottom" },
      { text: "Nsd", ref: "Ref", x: "start", y: "bottom" },
    ],
  },
  {
    // geometry-shapes-area's dimension labels: outside the shape, by an offset sized for Typst's text box.
    name: "labels pushed outside a shape",
    source: `#rect(width: 3.5cm, height: 2cm, stroke: none, fill: luma(235))[Rgs

#place(bottom + center, dy: 1.2em)[Lga]

#place(right + horizon, dx: 3.4em)[Lgb]]`,
    labels: [
      { text: "Lga", ref: "Rgs", x: "center", y: "bottom" },
      { text: "Lgb", ref: "Rgs", x: "end", y: "horizon" },
    ],
  },
  {
    name: "a box",
    source: `Text #box(width: 4cm, height: 1.6cm, inset: (left: 0.8cm, right: 0.4cm, y: 0.3cm), fill: luma(235))[Rbx #place(bottom + right)[Bxa] #place(top + center)[Bxb]] after`,
    labels: [
      { text: "Bxa", ref: "Rbx", x: "end", y: "bottom" },
      { text: "Bxb", ref: "Rbx", x: "center", y: "top" },
    ],
  },
];

/**
 * Where a word is, in points: its advance's left and right edges, and its baseline. For a reference
 * word, `top` is the top of its container's content area, where its line starts.
 */
interface Box {
  left: number;
  right: number;
  baseline: number;
  top: number;
}

// The engine's layout profile (#129) makes a text box run from 1.054em above the baseline to 0.246em
// below it, so a container's first line starts 1.054em above its baseline.
const TOP_EDGE = 1.054;
const PX_TO_PT = 0.75;

/** Every word on Typst's first page, from its text runs. */
const pagedBoxes = async (engine: Engine, source: string): Promise<Map<string, Box>> => {
  const doc = engine.open({ target: "paged", text: source });
  doc.finish();
  const s: DocumentState = await until(doc, (st) => st.status === "done" || st.status === "error");
  doc.dispose();
  if (s.artifact?.target !== "paged") throw new Error(`no pages: ${JSON.stringify(s.diagnostics.slice(0, 3))}`);
  const boxes = new Map<string, Box>();
  for (const run of s.artifact.pages[0]?.text ?? []) {
    boxes.set(run.text.trim(), {
      left: run.x,
      right: run.x + run.width,
      baseline: run.y,
      top: run.y - TOP_EDGE * run.size,
    });
  }
  return boxes;
};

/** The text node holding a word of the rendered document. */
const textNode = (root: HTMLElement, word: string): Text => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (new RegExp(`\\b${word}\\b`).test(node.textContent ?? "")) return node as Text;
  }
  throw new Error(`${word} not rendered`);
};

/** The baseline of a text node's line: an empty inline-block's bottom sits on it, taking no room. */
const baseline = (node: Text): number => {
  const probe = document.createElement("span");
  probe.style.display = "inline-block";
  node.before(probe);
  const y = probe.getBoundingClientRect().bottom;
  probe.remove();
  return y;
};

/** The same words as the HTML renderer lays them out: each label's placed box, each reference's container. */
const htmlBoxes = (root: HTMLElement, labels: Label[]): Map<string, Box> => {
  const boxes = new Map<string, Box>();
  for (const label of labels) {
    const node = textNode(root, label.text);
    const placed = (node.parentElement?.closest(".ts-place") as Element).getBoundingClientRect();
    boxes.set(label.text, {
      left: placed.left * PX_TO_PT,
      right: placed.right * PX_TO_PT,
      baseline: baseline(node) * PX_TO_PT,
      top: placed.top * PX_TO_PT,
    });
    const container = textNode(root, label.ref).parentElement?.closest(".ts-block, .ts-shape, .ts-box") as Element;
    const r = container.getBoundingClientRect();
    const css = getComputedStyle(container);
    const inside = (side: string) =>
      Number.parseFloat(css.getPropertyValue(`border-${side}-width`)) +
      Number.parseFloat(css.getPropertyValue(`padding-${side}`));
    const left = (r.left + inside("left")) * PX_TO_PT;
    const top = (r.top + inside("top")) * PX_TO_PT;
    boxes.set(label.ref, { left, right: left, baseline: top, top });
  }
  return boxes;
};

/**
 * Where a label sits in its container: the edge its alignment puts on the container's, from the
 * content area's left; its baseline, from the content area's top.
 */
const offset = (boxes: Map<string, Box>, label: Label): { dx: number; dy: number } => {
  const b = boxes.get(label.text);
  const ref = boxes.get(label.ref);
  if (!b || !ref) throw new Error(`${label.text} or ${label.ref} not laid out: ${[...boxes.keys()].join(" ")}`);
  const x = { start: b.left, center: (b.left + b.right) / 2, end: b.right }[label.x];
  return { dx: x - ref.left, dy: b.baseline - ref.top };
};

let engine: Engine;
let html: EngineDocument;
beforeAll(async () => {
  engine = startEngine();
  await engine.ready;
  html = openHtml(engine);
}, 60_000);
afterAll(() => engine.dispose());

describe(`html-compat's place against Typst's layout in ${browser}`, () => {
  it.each(CASES)("$name", async ({ source, labels }) => {
    const root = document.createElement("div");
    // Typst's default text size, so em lengths match. Fonts differ (the browser's serif): a label's
    // own width and cap height, hence the tolerances.
    root.style.cssText = "width: 600px; font-size: 11pt";
    document.body.append(root);
    const renderer = createHtmlRenderer(root, { plugins: [htmlCompat], stylesheets: [htmlCompatCss] });
    try {
      renderer.update(await compileHtml(html, source));
      const got = htmlBoxes(root, labels);
      const want = await pagedBoxes(engine, source);
      for (const label of labels) {
        const g = offset(got, label);
        const w = offset(want, label);
        // Horizontal edges are advance widths in both.
        expect(Math.abs(g.dx - w.dx), `${label.text} dx: HTML ${g.dx}pt, paged ${w.dx}pt`).toBeLessThan(1.5);
        // Baselines: a placed text's box is cap height to baseline in both (`ts-place-text`), and the
        // browser's serif has its own cap height. Untrimmed, a label at the bottom sits a descent
        // higher, one at the top an ascent lower. The insets tested are at least 0.5 cm (14pt).
        if (label.y) {
          expect(Math.abs(g.dy - w.dy), `${label.text} dy: HTML ${g.dy}pt, paged ${w.dy}pt`).toBeLessThan(1.5);
        }
      }
    } finally {
      renderer.dispose();
      root.remove();
    }
  });
});
