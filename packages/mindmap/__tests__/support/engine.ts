// The wasm engine (@typstream/engine-wasm's build) with Typst's bundled fonts and the mind map
// package mounted, compiling a document the way the engine does: the plugin's preamble before
// /main.typ. comemo's cache and wasm memory are global per instance; vitest gives every test
// file its own module graph, so its own instance.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Diagnostic } from "@typstream/engine-wasm";
import { Engine, initSync } from "@typstream/engine-wasm";
import { mindmapFiles, mindmapPreamble } from "../../src/index";
import { fonts } from "./fonts";

initSync({ module: readFileSync(createRequire(import.meta.url).resolve("@typstream/engine-wasm/engine_bg.wasm")) });

export type { Diagnostic };

export const newEngine = (): Engine => {
  for (const font of fonts()) Engine.add_font(font.bytes);
  const engine = new Engine();
  for (const [path, source] of Object.entries(mindmapFiles)) engine.set_source(path, source);
  return engine;
};

export const compileHtml = (engine: Engine, source: string) => {
  engine.set_source("/main.typ", mindmapPreamble + source);
  const result = engine.compile_html();
  return { html: result.html ?? "", diagnostics: result.diagnostics };
};

export const compilePaged = (engine: Engine, source: string) => {
  engine.set_source("/main.typ", mindmapPreamble + source);
  engine.reset_pages();
  const result = engine.compile_svg_changed();
  return { result, diagnostics: result.diagnostics };
};

/** Errors and warnings, except HTML export's standing "under active development" warning. */
export const problems = (diagnostics: Diagnostic[]): string[] =>
  diagnostics
    .filter((d) => !/html export is under active development/.test(d.message))
    .map((d) => `${d.severity}: ${d.message}`);

const ENTITIES: Record<string, string> = { quot: '"', amp: "&", lt: "<", gt: ">" };

/** The island markers of an HTML export: name and parsed props, in order. */
export const htmlIslands = (html: string): { name: string; data: unknown }[] =>
  [...html.matchAll(/<typstream-island name="([^"]*)" props="([^"]*)">/g)].map((m) => ({
    name: m[1] as string,
    data: JSON.parse(
      (m[2] as string)
        .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
        .replace(/&(quot|amp|lt|gt);/g, (_, e: string) => ENTITIES[e] as string),
    ),
  }));
