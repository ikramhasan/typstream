// @typstream/mindmap: mind maps for typstream (#28), the first render island (PLAN §8.4). The
// Typst side (typst/) draws a map written as a list, in plain Typst, inside an island marker:
// that drawing is what prints, exports and shows wherever nothing mounts. This module packages it
// as a typstream plugin, with the prompt catalogue from the package's doc comments and the
// island's spec, which checks the marker's data. The interactive map is `@typstream/mindmap/react`.
import type { FunctionDoc, IslandSpec, PromptExample, TypstreamPlugin } from "@typstream/core";
import { CATALOGUE, EXAMPLES, FILES } from "./assets.generated";

/** The Typst package's version, as in its `typst.toml`. */
export const MINDMAP_VERSION = "0.1.0";

/**
 * The package spec the mind map's files are mounted under: `${MINDMAP_ROOT}/lib.typ` and so on,
 * a local package the engine reads from the files the plugin mounts (as `@typstream/edu`'s).
 */
export const MINDMAP_ROOT = "@typstream/mindmap:0.1.0";

/** The Typst sources and `typst.toml`, keyed by their path in the engine (under {@link MINDMAP_ROOT}). */
export const mindmapFiles: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(FILES).map(([name, source]) => [`${MINDMAP_ROOT}/${name}`, source]),
);

/** Typst to put before a document: imports `mindmap` and `topic`. */
export const mindmapPreamble: string = `#import "${MINDMAP_ROOT}": mindmap, topic\n`;

/** One entry per public function, from the doc comments in `typst/`. */
export const mindmapCatalogue: FunctionDoc[] = CATALOGUE;

/** Whole documents with mind maps, for few-shot prompts. */
export const mindmapExamples: PromptExample[] = EXAMPLES;

/**
 * How to write mind maps, for the system prompt. They follow what models get wrong about lists
 * in Typst, and the content rules of teachers' mind maps: short labels, a logical order,
 * colours and images only where they mean something.
 */
export const mindmapPromptRules: string[] = [
  "Draw a mind map only when one is asked for (a mind map, concept map or topic overview), with `#mindmap[...]`: the centre topic on the first line, then the branches as a list. Indent sub-branches by two spaces under their branch, one `-` item per node. Overview maps have 2 levels, standard ones 3, detailed ones 4 or more.",
  "Mind map labels are keywords or short phrases, never sentences, in the language of the request. Order branches logically (general to specific, chronological, or by importance), and never repeat a label among siblings.",
  'Set a node\'s options by wrapping its label in `#topic(...)`: `- #topic(color: "#dc2626")[Risks]`, `#topic(collapsed: true)[Details]` (its branches start hidden), `size:` and `weight:`. Give colours a reason (one per theme, red for risks), never at random. Pass `style: "text-focused"` to `mindmap` for maps meant for printing or revision.',
  'Add an image to a node only when it shows the idea, on two to four key nodes at most and never in a text-focused map: `#topic(image: image("https://…", alt: "caption"))[Leaf]`, with a URL you were given; never invent one.',
];

/** A node of a mind map, as the marker carries it: every value resolved by the Typst side. */
export interface MindMapNode {
  /** Its label as plain text (math's sub- and superscripts as Unicode). */
  label: string;
  /** Its colour, `#rrggbb` or `#rrggbbaa`: border, tint, and the lines to its children. */
  color: string;
  /** Text size, in points. */
  size: number;
  /** Font weight: `bold`, `regular`, or a number from 100 to 900. */
  weight: "bold" | "regular" | number;
  /** On a main branch: the side of the centre it is drawn on. */
  side?: "left" | "right";
  /** An image above the label: the path the document named (a URL, a file) and its caption. */
  image?: { src: string; alt: string };
  /** Its branches start hidden. */
  collapsed?: boolean;
  /** Its branches, in order; a collapsed node's too, which the interactive map can open. */
  children?: MindMapNode[];
}

/** A mind map island's data. */
export interface MindMapData {
  /** The format's version. */
  v: 1;
  /** `visual` (colours, images) or `text-focused` (neutral, no images, wider labels). */
  style: "visual" | "text-focused";
  /** Branches on both sides of the centre, or all on one. */
  layout: "both" | "right";
  /** The text direction; a one-sided map grows in it. */
  dir: "ltr" | "rtl";
  /** The text size of the main branches, in points; other sizes are relative to it. */
  size: number;
  /** The centre topic. */
  root: MindMapNode;
}

/** The most nodes a map may have; a larger one keeps its fallback drawing. */
export const MAX_NODES = 2000;
const MAX_DEPTH = 16;
const MAX_LABEL = 500;
const COLOR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isSize = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 200;

/**
 * Checks a mind map marker's data, which the document wrote and is untrusted: the shape the Typst
 * side writes, with sizes, colours and lengths in range. `undefined` for anything else, which
 * keeps the fallback drawing.
 */
export const parseMindMap = (data: unknown): MindMapData | undefined => {
  if (!isRecord(data) || data.v !== 1 || !isSize(data.size)) return undefined;
  let count = 0;
  const node = (n: unknown, depth: number): MindMapNode | undefined => {
    if (!isRecord(n) || depth > MAX_DEPTH || ++count > MAX_NODES) return undefined;
    const { label, color, size, weight, side, image, collapsed, children } = n;
    if (typeof label !== "string" || label.length > MAX_LABEL) return undefined;
    if (typeof color !== "string" || !COLOR.test(color) || !isSize(size)) return undefined;
    if (!(weight === "bold" || weight === "regular" || (typeof weight === "number" && weight >= 100 && weight <= 900)))
      return undefined;
    const out: MindMapNode = { label, color, size, weight };
    if (side === "left" || side === "right") out.side = side;
    if (isRecord(image) && typeof image.src === "string" && image.src.length <= 4096)
      out.image = { src: image.src, alt: typeof image.alt === "string" ? image.alt.slice(0, MAX_LABEL) : "" };
    if (collapsed === true) out.collapsed = true;
    if (children !== undefined) {
      if (!Array.isArray(children)) return undefined;
      const kids: MindMapNode[] = [];
      for (const c of children) {
        const k = node(c, depth + 1);
        if (!k) return undefined;
        kids.push(k);
      }
      if (kids.length) out.children = kids;
    }
    return out;
  };
  const root = node(data.root, 0);
  if (!root) return undefined;
  return {
    v: 1,
    style: data.style === "text-focused" ? "text-focused" : "visual",
    layout: data.layout === "right" ? "right" : "both",
    dir: data.dir === "rtl" ? "rtl" : "ltr",
    size: data.size,
    root,
  };
};

/** The island's spec: what the plugin declares under `islands.mindmap`. @beta */
export const mindmapIsland: IslandSpec<MindMapData> = {
  description: "An interactive mind map: pan, zoom, and open and close branches.",
  parse: parseMindMap,
};

/**
 * Mind maps as a typstream plugin: the Typst package and its preamble for the engine, the prompt
 * kit, and the `mindmap` island. Pair it with `@typstream/mindmap/react`'s `MindMapIsland` for
 * the interactive map; without it, documents show the drawing.
 */
export const mindmap: TypstreamPlugin = {
  key: "mindmap",
  version: MINDMAP_VERSION,
  engine: { files: mindmapFiles, preamble: mindmapPreamble },
  prompt: { catalogue: mindmapCatalogue, rules: mindmapPromptRules, examples: mindmapExamples },
  islands: { mindmap: mindmapIsland as IslandSpec },
};
