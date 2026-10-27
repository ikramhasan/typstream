// The interactive map's layout: the algorithm of typst/mindmap.typ (`_place`, `_side` and
// `mindmap`), so the map looks like its printed drawing, laid out again when branches open and
// close. Sizes are CSS pixels (a point is 4/3 of one); node sizes come from the caller, which
// measures labels in the page's font.

import type { MindMapData, MindMapNode } from "../index";

/** CSS pixels per point. */
export const PX = 4 / 3;
// The drawing's gaps between levels, between siblings and between main branches.
const GAP_X = 22 * PX;
const GAP_Y = 6 * PX;
const GAP_BRANCH = 12 * PX;

/** A node's box. */
export interface Size {
  w: number;
  h: number;
}

/** A node laid out: its top left in the map. */
export interface LaidNode {
  /** Its path from the centre: `0`, `0.2`, `0.2.1`. */
  id: string;
  node: MindMapNode;
  depth: number;
  /** The side of the centre it is on; `null` for the centre. */
  side: "left" | "right" | null;
  /** How many nodes its closed branches hide (0 when open, or without branches). */
  hidden: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A line from a node to one of its children. */
export interface LaidEdge {
  id: string;
  source: string;
  target: string;
  /** The side the child is on: lines leave the parent and enter the child on facing sides. */
  side: "left" | "right";
  color: string;
  /** From the parent's outer side to the child's inner side, at their middles: `[x1, y1, x2, y2]`. */
  points: [number, number, number, number];
}

export interface Layout {
  nodes: LaidNode[];
  edges: LaidEdge[];
}

/** How many nodes are below `n`. */
export const descendants = (n: MindMapNode): number =>
  (n.children ?? []).reduce((sum, c) => sum + 1 + descendants(c), 0);

interface Placed {
  nodes: LaidNode[];
  edges: LaidEdge[];
  height: number;
  /** The subtree root's centre line. */
  cy: number;
}

/**
 * Lays out `data`: `closed` tells whether a node's branches are hidden, `size` gives a node's box
 * (with `hidden` nodes behind it, for the count it shows).
 */
export const layoutMindMap = (
  data: MindMapData,
  closed: (id: string, node: MindMapNode) => boolean,
  size: (node: MindMapNode, depth: number, hidden: number) => Size,
): Layout => {
  /** The visible children of a node, with their ids. */
  const open = (id: string, n: MindMapNode): [string, MindMapNode][] =>
    n.children?.length && !closed(id, n) ? n.children.map((c, i) => [`${id}.${i}`, c]) : [];

  const box = (id: string, n: MindMapNode, depth: number) => {
    const hidden = n.children?.length && closed(id, n) ? descendants(n) : 0;
    return { hidden, ...size(n, depth, hidden) };
  };

  /** `n`'s subtree growing to the right, `n` at x = 0, the subtree's top at y = 0. */
  const place = (id: string, n: MindMapNode, depth: number, side: "left" | "right"): Placed => {
    const { w, h, hidden } = box(id, n, depth);
    const me: LaidNode = { id, node: n, depth, side, hidden, x: 0, y: 0, w, h };
    const kids = open(id, n);
    if (kids.length === 0) return { nodes: [me], edges: [], height: h, cy: h / 2 };
    const nodes: LaidNode[] = [];
    const edges: LaidEdge[] = [];
    const centres: number[] = [];
    let y = 0;
    for (const [cid, c] of kids) {
      const sub = place(cid, c, depth + 1, side);
      for (const m of sub.nodes) nodes.push({ ...m, x: m.x + w + GAP_X, y: m.y + y });
      edges.push(...sub.edges, {
        id: `${id}-${cid}`,
        source: id,
        target: cid,
        side,
        color: n.color,
        points: [0, 0, 0, 0],
      });
      centres.push(y + sub.cy);
      y += sub.height + GAP_Y;
    }
    const height = y - GAP_Y;
    let cy = ((centres[0] as number) + (centres[centres.length - 1] as number)) / 2;
    // A node taller than its children's span pushes them down.
    const shift = Math.max(0, h / 2 - cy);
    for (const m of nodes) m.y += shift;
    cy += shift;
    nodes.push({ ...me, y: cy - h / 2 });
    return { nodes, edges, height: Math.max(height + shift, cy + h / 2), cy };
  };

  /** One side's branches, stacked. */
  const stack = (branches: [string, MindMapNode][], side: "left" | "right") => {
    const nodes: LaidNode[] = [];
    const edges: LaidEdge[] = [];
    let y = 0;
    for (const [id, b] of branches) {
      const sub = place(id, b, 1, side);
      for (const m of sub.nodes) nodes.push({ ...m, y: m.y + y });
      edges.push(...sub.edges, { id: `0-${id}`, source: "0", target: id, side, color: b.color, points: [0, 0, 0, 0] });
      y += sub.height + GAP_BRANCH;
    }
    return {
      nodes,
      edges,
      width: Math.max(0, ...nodes.map((m) => m.x + m.w)),
      height: Math.max(0, y - GAP_BRANCH),
    };
  };

  const root = data.root;
  const centre = box("0", root, 0);
  const branches = open("0", root);
  // The Typst side decided each main branch's side; a branch without one goes right.
  const right = stack(
    branches.filter(([, b]) => b.side !== "left"),
    "right",
  );
  const left = stack(
    branches.filter(([, b]) => b.side === "left"),
    "left",
  );
  const gap = 2 * GAP_X;
  const height = Math.max(right.height, left.height, centre.h);
  const cx = left.nodes.length ? left.width + gap : 0;
  const ry = (height - right.height) / 2;
  const ly = (height - left.height) / 2;
  const nodes: LaidNode[] = [
    { id: "0", node: root, depth: 0, side: null, x: cx, y: (height - centre.h) / 2, ...centre },
  ];
  const ox = cx + centre.w + gap;
  for (const m of right.nodes) nodes.push({ ...m, x: ox + m.x, y: ry + m.y });
  // The left side is the right one mirrored about the centre's left edge.
  for (const m of left.nodes) nodes.push({ ...m, x: cx - gap - m.x - m.w, y: ly + m.y });
  const byId = new Map(nodes.map((m) => [m.id, m]));
  const edges = [...right.edges, ...left.edges];
  for (const e of edges) {
    const [from, to] = [byId.get(e.source) as LaidNode, byId.get(e.target) as LaidNode];
    const right = e.side === "right";
    e.points = [right ? from.x + from.w : from.x, from.y + from.h / 2, right ? to.x : to.x + to.w, to.y + to.h / 2];
  }
  return { nodes, edges };
};
