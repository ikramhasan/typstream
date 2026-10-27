// The interactive map's layout (react/layout.ts) follows the drawing's: branches split between
// the sides as the data says, children to the outside of their parent and stacked without
// overlapping, the centre in the middle; closed branches hide their nodes.
import { describe, expect, it } from "vitest";
import type { MindMapData, MindMapNode } from "../src/index";
import { descendants, type LaidNode, layoutMindMap } from "../src/react/layout";

const n = (label: string, children?: MindMapNode[], extra: Partial<MindMapNode> = {}): MindMapNode => ({
  label,
  color: "#2563eb",
  size: 11,
  weight: "regular",
  ...(children ? { children } : {}),
  ...extra,
});

const data = (root: MindMapNode): MindMapData => ({
  v: 1,
  style: "visual",
  layout: "both",
  dir: "ltr",
  size: 11,
  root,
});

const map = data(
  n("Centre", [
    n("A", [n("A1"), n("A2", [n("A2a")])], { side: "right" }),
    n("B", [n("B1")], { side: "right" }),
    n("C", [n("C1"), n("C2")], { side: "left" }),
  ]),
);

const size = (node: MindMapNode) => ({ w: 20 + node.label.length * 8, h: 20 });
const overlap = (a: LaidNode, b: LaidNode) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("layoutMindMap", () => {
  it("places every node once, without overlaps, outward from its parent", () => {
    const { nodes, edges } = layoutMindMap(map, () => false, size);
    expect(nodes.map((m) => m.node.label).sort()).toEqual(
      ["Centre", "A", "A1", "A2", "A2a", "B", "B1", "C", "C1", "C2"].sort(),
    );
    for (const a of nodes) for (const b of nodes) if (a !== b) expect(overlap(a, b), `${a.id} ${b.id}`).toBe(false);
    const byId = new Map(nodes.map((m) => [m.id, m]));
    expect(edges).toHaveLength(nodes.length - 1);
    for (const e of edges) {
      const [from, to] = [byId.get(e.source) as LaidNode, byId.get(e.target) as LaidNode];
      if (e.side === "right") expect(to.x).toBeGreaterThan(from.x + from.w);
      else expect(to.x + to.w).toBeLessThan(from.x);
    }
    expect(byId.get("0.2")?.side).toBe("left");
  });

  it("centres a parent on its children", () => {
    const { nodes } = layoutMindMap(map, () => false, size);
    const at = (id: string) => nodes.find((m) => m.id === id) as LaidNode;
    const mid = (m: LaidNode) => m.y + m.h / 2;
    expect(mid(at("0.2"))).toBeCloseTo((mid(at("0.2.0")) + mid(at("0.2.1"))) / 2);
  });

  it("hides closed branches and counts what they hide", () => {
    const { nodes } = layoutMindMap(map, (id) => id === "0.0", size);
    expect(nodes.some((m) => m.id.startsWith("0.0."))).toBe(false);
    expect(nodes.find((m) => m.id === "0.0")?.hidden).toBe(3);
    expect(descendants(map.root)).toBe(9);
  });
});
