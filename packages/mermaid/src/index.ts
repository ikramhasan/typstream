// @typstream/mermaid: Mermaid diagrams for typstream, drawn by pele (https://pele.run). A document
// writes a ```mermaid raw block; the worker draws it with pele before each compile (the file
// generator, generator/mermaid.js, PLAN §8.2), and the Typst package (typst/) shows the drawing:
// the shapes as an SVG image, the labels as Typst text. So a diagram looks the same on pages, in
// the HTML target, the PDF and a DOCX export. This module is the plugin: the package's files, the
// preamble that turns the blocks into diagrams, the generator's URL and the prompt kit.
import type { PromptExample, TypstreamPlugin } from "@typstream/core";
import { EXAMPLES, FILES } from "./assets.generated";
import { INDEX_FILE, MERMAID_ROOT, MERMAID_VERSION } from "./paths";

export { MERMAID_ROOT, MERMAID_VERSION };

/**
 * The Typst sources and `typst.toml`, keyed by their path in the engine (under
 * {@link MERMAID_ROOT}), and an empty index of drawings, which the generator replaces: a
 * document compiled without it (a server that runs no client modules) shows its blocks as code.
 */
export const mermaidFiles: Readonly<Record<string, string>> = {
  ...Object.fromEntries(Object.entries(FILES).map(([name, source]) => [`${MERMAID_ROOT}/${name}`, source])),
  [INDEX_FILE]: "{}",
};

/** Typst to put before a document: shows every raw block whose language is `mermaid` as its diagram. */
export const mermaidPreamble: string = `#import "${MERMAID_ROOT}": mermaid-diagram
#show raw.where(lang: "mermaid", block: true): mermaid-diagram
`;

/**
 * The URL of the file generator module, which the worker imports: pele and the code that draws
 * with it, one self-contained ES module (about 276 KB gzipped) that bundlers emit as an asset.
 * The worker loads it when a document with this plugin opens, never on the main thread.
 */
export const MERMAID_GENERATOR: string = new URL("../generator/mermaid.js", import.meta.url).href;

/** Whole documents with diagrams, for few-shot prompts. */
export const mermaidExamples: PromptExample[] = EXAMPLES;

/**
 * How to write diagrams, for the system prompt: Mermaid in a raw block, a figure of kind `image`
 * for a caption (a raw block's figure would be a listing), and no styling of its own.
 */
export const mermaidPromptRules: string[] = [
  "Draw diagrams Mermaid can draw (flowcharts, sequence, class, state and entity relationship diagrams, timelines, Gantt charts, pie, quadrant and XY charts, user journeys) as a raw block with the language `mermaid`, in Mermaid 12 syntax: ```` ```mermaid ```` on its own line, the diagram, then ```` ``` ````. Use one where it shows a process, cycle, sequence, structure or comparison better than prose; draw geometry and precise figures with CeTZ instead.",
  "To number and caption a diagram, put the block in a figure of kind image: `#figure(kind: image, caption: [The water cycle.])[```mermaid ... ```]`. Without `kind: image` it would be numbered as a code listing.",
  'Keep diagram labels short, in the language of the request. Quote a label holding punctuation or brackets: `A["Water (H2O)"]`. No HTML, Markdown, math or icons in labels, and no styling (`style`, `classDef`, `%%{init}%%`, themes): the document draws diagrams in its own style.',
];

/**
 * Mermaid diagrams as a typstream plugin: the Typst package and its preamble, the generator that
 * draws diagrams in the worker, and the prompt kit. Needs `@typstream/html-compat`'s plugin
 * (`htmlCompat`), which shows a diagram in the HTML target as the pages draw it. The worker imports the generator by URL, so a
 * strict Content-Security-Policy must allow it as a script (it is same-origin unless the app's
 * bundler puts assets elsewhere).
 */
export const mermaid: TypstreamPlugin = {
  key: "mermaid",
  version: MERMAID_VERSION,
  // Its HTML target is html-compat's picture of the drawing, as on pages.
  dependencies: ["html-compat"],
  engine: { files: mermaidFiles, preamble: mermaidPreamble, generatorModules: [MERMAID_GENERATOR] },
  prompt: { rules: mermaidPromptRules, examples: mermaidExamples },
};
