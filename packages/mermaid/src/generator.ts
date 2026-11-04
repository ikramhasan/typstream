// The worker half of @typstream/mermaid: a file generator (PLAN §8.2) that draws the document's
// ```mermaid blocks with pele before each compile. Built on its own, pele included, into
// generator/mermaid.js, the module the plugin names in `engine.generatorModules`: the worker
// imports it by URL, so it can import nothing itself.
//
// Its files: the index (`diagrams.json`, by key: size, labels and the shapes' file, or pele's
// error) and one SVG per drawing, named by its hash, so a token that changes one diagram leaves
// every other file as it was and Typst decodes only the new drawing.
//
// While streaming, a diagram's source is cut mid-line on most tokens and pele rejects it: the
// block keeps the last drawing it had (by its place among the document's diagrams), so the
// diagram grows instead of flickering between drawing and error. Before its first drawing the
// block shows its code. Final compiles and exports show the error.
import type { CompileMode, DocumentFileGenerator, FileGenerator } from "@typstream/core";
import { type Drawing, draw } from "./draw";
import { INDEX_FILE, MERMAID_ROOT, SVG_DIR } from "./paths";
import { findFences } from "./scan";

/** Drawings kept per document, by key: the diagrams it has, and the cut versions of the one streaming. */
const CACHE = 128;

/** FNV-1a, as eight hex digits: names a drawing's SVG file. */
const hash = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, "0");
};

interface Drawn {
  drawing: Drawing;
  /** The shapes' file inside the package, for a drawing. */
  file?: string;
}

class Session implements DocumentFileGenerator {
  private readonly cache = new Map<string, Drawn>();
  /** The last drawing of each diagram, by its place in the document: what a cut source keeps. */
  private readonly last: Drawn[] = [];
  private previous: Record<string, string> = { [INDEX_FILE]: "{}" };
  private index = "{}";
  private count = 0;

  private drawn(source: string, key: string): Drawn {
    const hit = this.cache.get(key);
    if (hit) {
      // Least recently used goes first.
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const drawing = draw(source, `m${(this.count++).toString(36)}-`);
    const out: Drawn = "error" in drawing ? { drawing } : { drawing, file: `${SVG_DIR}/${hash(drawing.svg)}.svg` };
    this.cache.set(key, out);
    if (this.cache.size > CACHE) this.cache.delete(this.cache.keys().next().value as string);
    return out;
  }

  files(source: string, { mode }: { mode: CompileMode }): Record<string, string> {
    const index: Record<string, unknown> = {};
    const svgs: Record<string, string> = {};
    const fences = findFences(source);
    this.last.length = Math.min(this.last.length, fences.length);
    fences.forEach(({ source: diagram, key }, i) => {
      if (Object.hasOwn(index, key)) return;
      let d = this.drawn(diagram, key);
      if ("error" in d.drawing) {
        const last = this.last[i];
        if (mode === "final" || !last) {
          if (mode === "final") index[key] = d.drawing;
          return;
        }
        d = last;
      } else this.last[i] = d;
      const { w, h, labels, svg } = d.drawing as Extract<Drawing, { svg: string }>;
      index[key] = { w, h, labels, svg: d.file };
      svgs[`${MERMAID_ROOT}/${d.file}`] = svg;
    });
    const text = JSON.stringify(index);
    // The same object when nothing changed: the worker then has nothing to compare.
    if (text === this.index && Object.keys(svgs).every((path) => Object.hasOwn(this.previous, path)))
      return this.previous;
    this.index = text;
    this.previous = { [INDEX_FILE]: text, ...svgs };
    return this.previous;
  }
}

/**
 * Draws a document's Mermaid diagrams with pele, for `@typstream/mermaid`'s Typst. The worker
 * imports it by URL (`MERMAID_GENERATOR`); a server that runs no client modules, or a worker of
 * your own, can pass it in `ServerOptions.generators` instead. @beta
 */
const mermaidGenerator: FileGenerator = { name: "mermaid", open: () => new Session() };

export default mermaidGenerator;
