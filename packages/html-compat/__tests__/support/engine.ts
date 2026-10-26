// The wasm engine (@typstream/engine-wasm's build) with Typst's bundled fonts, and helpers to
// compile a document to HTML with and without the prelude. comemo's cache and wasm memory are
// global per instance; vitest gives every test file its own module graph, so its own instance.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Diagnostic, HtmlResult } from "@typstream/engine-wasm";
import { Engine, initSync } from "@typstream/engine-wasm";
import { HTML_COMPAT_PATH, htmlCompatPreamble, htmlCompatSource } from "../../src/index";
import { fonts } from "./fonts";

initSync({ module: readFileSync(createRequire(import.meta.url).resolve("@typstream/engine-wasm/engine_bg.wasm")) });

export type { Diagnostic };

/** An engine with Typst's bundled fonts and the prelude mounted. */
export const newEngine = (): Engine => {
  const engine = new Engine();
  for (const font of fonts()) engine.add_font(font.bytes);
  engine.set_source(HTML_COMPAT_PATH, htmlCompatSource);
  return engine;
};

export interface CompileOptions {
  /** Prepend the html-compat preamble. Default true. */
  prelude?: boolean;
  /** Binary files the document reads, by absolute virtual path. */
  files?: Record<string, Uint8Array>;
}

/**
 * Compiles to HTML. With the prelude, diagnostic spans are shifted back so they point
 * into `source` (the preamble is a prefix of /main.typ).
 */
export const compileHtml = (engine: Engine, source: string, options: CompileOptions = {}): HtmlResult => {
  const prefix = options.prelude === false ? "" : htmlCompatPreamble;
  for (const [path, bytes] of Object.entries(options.files ?? {})) engine.set_file(path, bytes);
  engine.set_source("/main.typ", prefix + source);
  const result = engine.compile_html();
  for (const d of result.diagnostics) {
    if (d.span) d.span = { from: d.span.from - prefix.length, to: d.span.to - prefix.length };
  }
  return result;
};

/** Every page as SVG, from scratch. */
export const compileSvg = (engine: Engine, source: string, options: CompileOptions = {}): string[] => {
  const prefix = options.prelude === false ? "" : htmlCompatPreamble;
  for (const [path, bytes] of Object.entries(options.files ?? {})) engine.set_file(path, bytes);
  engine.set_source("/main.typ", prefix + source);
  engine.reset_pages();
  const result = engine.compile_svg_changed();
  if (!result.ok) throw new Error(`paged compile failed: ${result.diagnostics.map((d) => d.message).join("; ")}`);
  return (result.changed ?? []).map((page) => page.svg);
};

/** Warnings and errors that mean HTML export dropped something. */
export const dropped = (diagnostics: Diagnostic[]): string[] =>
  diagnostics.map((d) => d.message).filter((m) => /was ignored during (HTML|MathML) export/.test(m));
