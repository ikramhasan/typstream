// The interactive mind map: React Flow over the island's host, laid out as the Typst drawing is
// (layout.ts), read-only. Pan by dragging, zoom with a pinch, Ctrl/⌘ + wheel or the buttons; the
// plain wheel scrolls the page, so a map never traps scrolling. A node with branches opens and
// closes them on a click, or Enter or Space once focused. Loaded lazily (react.ts): React Flow is
// most of the package's weight.

import type { IslandProps } from "@typstream/core";
import {
  BaseEdge,
  Controls,
  type Edge,
  type EdgeProps,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import { type KeyboardEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MindMapData, MindMapNode } from "../index";
import { adoptCss } from "./css";
import { type LaidNode, layoutMindMap, PX } from "./layout";
import { measureNode, type NodeMetrics } from "./measure";
import { MINDMAP_CSS } from "./styles";
import { XYFLOW_CSS } from "./xyflow-css.generated";

/** What a node draws, besides its laid-out box. */
interface TopicData extends Record<string, unknown> {
  laid: LaidNode;
  metrics: NodeMetrics;
  image: string | null;
  open: boolean;
}

type TopicNode = Node<TopicData, "topic">;

/** `color` mixed with white, as Typst's `lighten`. */
const lighten = (color: string, amount: number): string => {
  const c = [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16));
  return `rgb(${c.map((v) => Math.round(v + (255 - v) * amount)).join(" ")})`;
};

/** Light colours get dark text, as in the drawing. */
const light = (color: string): boolean => {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16) / 255) as [number, number, number];
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.6;
};

const Topic = ({ data }: NodeProps<TopicNode>) => {
  const { laid, metrics, image } = data;
  const { node, depth, side } = laid;
  const size = node.size * PX;
  const fill = depth === 0 ? node.color : depth === 1 ? lighten(node.color, 0.85) : "#fff";
  const ink = depth === 0 && !light(node.color) ? "#fff" : "#000";
  // Lines leave a node on its outer side and enter it on its inner one.
  const outer = side === "left" ? Position.Left : Position.Right;
  const inner = side === "left" ? Position.Right : Position.Left;
  return (
    <div
      className="ts-mindmap-node"
      data-depth={Math.min(depth, 2)}
      style={{
        ["--ts-mindmap-color" as string]: node.color,
        width: laid.w,
        height: laid.h,
        padding: `${0.3 * size}px ${0.5 * size}px`,
        background: fill,
        color: ink,
        borderColor: node.color,
        borderRadius: depth === 0 ? 0.4 * size + 0.3 * size : 4 * PX,
        fontSize: size,
        fontWeight: node.weight === "regular" ? 400 : node.weight === "bold" ? 700 : node.weight,
      }}
    >
      {metrics.image && (
        <div className="ts-mindmap-image" style={{ height: metrics.image.h }}>
          {image ? <img src={image} alt={node.image?.alt ?? ""} /> : <span>{node.image?.alt}</span>}
        </div>
      )}
      <div className="ts-mindmap-label">
        <span dir="auto">
          {metrics.lines.map((line, i) => (
            // Lines are the measured wrap, so the box fits them exactly; the same line can repeat.
            // biome-ignore lint/suspicious/noArrayIndexKey: lines have no identity of their own.
            <span key={i}>{line}</span>
          ))}
        </span>
        {laid.hidden > 0 && (
          <span className="ts-mindmap-badge" style={{ fontSize: size * 0.7 }}>
            +{laid.hidden}
          </span>
        )}
      </div>
      {depth > 0 && <Handle type="target" position={inner} isConnectable={false} />}
      {depth === 0 ? (
        <>
          <Handle id="right" type="source" position={Position.Right} isConnectable={false} />
          <Handle id="left" type="source" position={Position.Left} isConnectable={false} />
        </>
      ) : (
        <Handle type="source" position={outer} isConnectable={false} />
      )}
    </div>
  );
};

type BranchEdge = Edge<{ points: [number, number, number, number] }, "branch">;

/**
 * A line from a node to a child, drawn as the Typst drawing draws it (`_edge`): a cubic from the
 * parent's outer side to the child's inner side, from the layout's points. React Flow's handles
 * only anchor the edge; its own positions aren't used.
 */
const Branch = ({ data, style }: EdgeProps<BranchEdge>) => {
  const [x1, y1, x2, y2] = data?.points ?? [0, 0, 0, 0];
  const mx = (x1 + x2) / 2;
  return <BaseEdge path={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} {...(style ? { style } : {})} />;
};

const nodeTypes = { topic: Topic };
const edgeTypes = { branch: Branch };

/** Blob URLs for images the document has, made once per file and revoked on unmount. */
const useImages = (file: IslandProps["file"]) => {
  const urls = useRef(new Map<string, string | null>());
  useEffect(() => {
    const map = urls.current;
    return () => {
      for (const url of map.values()) if (url) URL.revokeObjectURL(url);
      map.clear();
    };
  }, []);
  return useCallback(
    (src: string): string | null => {
      const map = urls.current;
      if (!map.has(src)) {
        const content = file(src);
        // Typst names images by path; islands show only what the document has, never fetching.
        map.set(src, content instanceof Uint8Array ? URL.createObjectURL(new Blob([content as BlobPart])) : null);
      }
      return map.get(src) ?? null;
    },
    [file],
  );
};

const MindMapView = ({ data, isIncomplete, file }: IslandProps<MindMapData>) => {
  const wrapper = useRef<HTMLElement>(null);
  const [font, setFont] = useState<string | null>(null);
  // Branches opened or closed by the reader, by node id; the others are as the document says.
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const image = useImages(file);
  const flow = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const moved = useRef(false);

  useLayoutEffect(() => {
    const el = wrapper.current;
    if (!el) return;
    adoptCss(el, XYFLOW_CSS);
    adoptCss(el, MINDMAP_CSS);
    // Labels are measured in the font they are shown in: the document's, inherited.
    setFont(getComputedStyle(el).fontFamily);
  }, []);

  const closed = useCallback((id: string, n: MindMapNode) => toggled.get(id) ?? n.collapsed === true, [toggled]);

  const { nodes, edges } = useMemo(() => {
    if (font === null) return { nodes: [] as TopicNode[], edges: [] as BranchEdge[] };
    const metrics = new WeakMap<MindMapNode, NodeMetrics>();
    const layout = layoutMindMap(data, closed, (n, depth, hidden) => {
      const m = measureNode(n, depth, hidden, data, font);
      metrics.set(n, m);
      return m;
    });
    const nodes: TopicNode[] = layout.nodes.map((laid) => {
      const kids = laid.node.children?.length ?? 0;
      const open = kids > 0 && !closed(laid.id, laid.node);
      return {
        id: laid.id,
        type: "topic",
        position: { x: laid.x, y: laid.y },
        width: laid.w,
        height: laid.h,
        data: {
          laid,
          metrics: metrics.get(laid.node) as NodeMetrics,
          image: laid.node.image && data.style === "visual" ? image(laid.node.image.src) : null,
          open,
        },
        draggable: false,
        selectable: false,
        connectable: false,
        ariaLabel:
          kids > 0
            ? `${laid.node.label} (${open ? "expanded" : `collapsed, ${laid.hidden} hidden`})`
            : laid.node.label || " ",
      };
    });
    const edges: BranchEdge[] = layout.edges.map((e) => ({
      id: e.id,
      type: "branch",
      data: { points: e.points },
      source: e.source,
      target: e.target,
      ...(e.source === "0" ? { sourceHandle: e.side } : {}),
      focusable: false,
      selectable: false,
      style: { stroke: e.color, strokeWidth: 1.2 * PX },
    }));
    return { nodes, edges };
  }, [data, font, closed, image]);

  // Fit the map while the reader hasn't moved it: as it streams in, and when the element resizes.
  const ids = nodes.map((n) => n.id).join(" ");
  useEffect(() => {
    if (!moved.current && ids && width && height) void flow.fitView({ padding: 0.05 });
  }, [flow, ids, width, height]);

  const toggle = (id: string) => {
    const n = nodes.find((m) => m.id === id);
    if (!n?.data.laid.node.children?.length) return;
    setToggled((t) => new Map(t).set(id, n.data.open));
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const id = (event.target as Element).closest?.(".react-flow__node")?.getAttribute("data-id");
    if (!id) return;
    event.preventDefault();
    toggle(id);
  };

  return (
    // A figure, as the drawing it covers; keys from its nodes bubble up to open and close them.
    <figure
      ref={wrapper}
      className="ts-mindmap"
      aria-label={data.root.label}
      aria-busy={isIncomplete}
      onKeyDown={onKeyDown}
    >
      {font !== null && (
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          colorMode="light"
          // No "React Flow" link in every map of a teacher's document (maintainer's call). MIT allows it; the
          // React Flow team asks commercial users who hide it to support the project (reactflow.dev/pro).
          proOptions={{ hideAttribution: true }}
          fitView
          fitViewOptions={{ padding: 0.05 }}
          minZoom={0.1}
          maxZoom={4}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          edgesFocusable={false}
          zoomOnScroll={false}
          panOnScroll={false}
          preventScrolling={false}
          zoomOnDoubleClick={false}
          onNodeClick={(_, n) => toggle(n.id)}
          onMoveStart={(event) => {
            // Programmatic moves (fitting) have no event.
            if (event) moved.current = true;
          }}
        >
          {height >= 140 && <Controls showInteractive={false} position="bottom-left" />}
        </ReactFlow>
      )}
    </figure>
  );
};

/** The interactive mind map, in its own React Flow store. */
const MindMapFlow = (props: IslandProps<MindMapData>) => (
  <ReactFlowProvider>
    <MindMapView {...props} />
  </ReactFlowProvider>
);

export default MindMapFlow;
