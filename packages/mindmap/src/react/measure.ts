// A node's box for the layout, measured in the font it is shown in: its label wrapped as the
// drawing wraps it (at 10 times the map's text size, 14 when text-focused), the count of hidden
// branches beside it, an image above it. The box is what the node draws (flow.tsx), so lines
// are rendered as measured.

import type { MindMapData, MindMapNode } from "../index";
import { PX } from "./layout";

export interface NodeMetrics {
  /** Border box, CSS pixels. */
  w: number;
  h: number;
  /** The label's lines. */
  lines: string[];
  /** The image's box, if the node shows one. */
  image: { h: number } | null;
}

let context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
const canvas = () => {
  context ??=
    typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(1, 1).getContext("2d")
      : document.createElement("canvas").getContext("2d");
  return context;
};

const weightOf = (n: MindMapNode): number => (n.weight === "bold" ? 700 : n.weight === "regular" ? 400 : n.weight);

/** `label` broken at spaces into lines no wider than `max` (a longer word keeps a line of its own). */
const wrap = (label: string, max: number, width: (s: string) => number): string[] => {
  const lines: string[] = [];
  let line = "";
  for (const word of label.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && width(next) > max) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  lines.push(line);
  return lines;
};

export const measureNode = (
  n: MindMapNode,
  depth: number,
  hidden: number,
  data: MindMapData,
  family: string,
): NodeMetrics => {
  const ctx = canvas();
  const size = n.size * PX;
  const base = data.size * PX;
  const width = (s: string) => (ctx ? ctx.measureText(s).width : s.length * size * 0.55);
  if (ctx) ctx.font = `${weightOf(n)} ${size}px ${family}`;
  const lines = wrap(n.label, base * (data.style === "text-focused" ? 14 : 10), width);
  let w = Math.max(...lines.map(width));
  if (hidden > 0) {
    if (ctx) ctx.font = `700 ${0.7 * size}px ${family}`;
    w += 4 * PX + width(`+${hidden}`) + 8;
  }
  let h = lines.length * size * 1.25;
  let image: NodeMetrics["image"] = null;
  if (n.image && data.style === "visual") {
    image = { h: base * 3.2 };
    w = Math.max(w, base * 4.5);
    h += image.h + 4;
  }
  const border = depth === 0 ? 0 : depth === 1 ? 1.6 : 1.0667;
  // Rounded up, so a label never wraps again in the box measured for it.
  return { w: Math.ceil(w + size + 2 * border) + 1, h: Math.ceil(h + 0.6 * size + 2 * border), lines, image };
};
