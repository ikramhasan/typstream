// The wasm engine (@typstream/engine-wasm's build) with Typst's bundled fonts, edu's files and
// html-compat's prelude mounted, and helpers to compile a document the way the engine does: a
// preamble (edu's, optionally after html-compat's) prepended to /main.typ, `sys.inputs` for the
// answer switch. comemo's cache and wasm memory are global per instance; vitest gives every test
// file its own module graph, so its own instance.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Diagnostic, TextRun } from "@typstream/engine-wasm";
import { Engine, initSync } from "@typstream/engine-wasm";
import { HTML_COMPAT_PATH, htmlCompatPreamble, htmlCompatSource } from "@typstream/html-compat";
import { eduFiles, eduPreamble, SHOW_ANSWERS_INPUT } from "../../src/index";
import { fonts } from "./fonts";

initSync({ module: readFileSync(createRequire(import.meta.url).resolve("@typstream/engine-wasm/engine_bg.wasm")) });

export type { Diagnostic };

/** An engine with Typst's bundled fonts, edu and html-compat mounted. */
export const newEngine = (): Engine => {
  const engine = new Engine();
  for (const font of fonts()) engine.add_font(font.bytes);
  for (const [path, source] of Object.entries(eduFiles)) engine.set_source(path, source);
  engine.set_source(HTML_COMPAT_PATH, htmlCompatSource);
  return engine;
};

export interface CompileOptions {
  /** Show answers (`sys.inputs.showAnswers`). Default false. */
  answers?: boolean;
  /** Put html-compat's preamble before edu's. Default false. */
  compat?: boolean;
}

const prepare = (engine: Engine, source: string, options: CompileOptions): void => {
  engine.set_inputs(options.answers ? { [SHOW_ANSWERS_INPUT]: "true" } : {});
  engine.set_source("/main.typ", (options.compat ? htmlCompatPreamble : "") + eduPreamble + source);
};

export interface HtmlOutput {
  html: string;
  diagnostics: Diagnostic[];
}

export const compileHtml = (engine: Engine, source: string, options: CompileOptions = {}): HtmlOutput => {
  prepare(engine, source, options);
  const result = engine.compile_html();
  return { html: result.html ?? "", diagnostics: result.diagnostics };
};

export interface PagedOutput {
  pages: { svg: string; text: TextRun[] }[];
  diagnostics: Diagnostic[];
}

/** Every page as SVG with its text runs, from scratch. */
export const compilePaged = (engine: Engine, source: string, options: CompileOptions = {}): PagedOutput => {
  prepare(engine, source, options);
  engine.reset_pages();
  const result = engine.compile_svg_changed();
  return { pages: (result.changed ?? []).map((p) => ({ svg: p.svg, text: p.text })), diagnostics: result.diagnostics };
};

/** The text of paged output, runs joined with spaces (enough to test what appears). */
export const pagedText = (out: PagedOutput): string => out.pages.flatMap((p) => p.text.map((r) => r.text)).join(" ");

/** HTML's text: tags dropped, entities for the characters Typst escapes decoded. */
export const htmlText = (html: string): string =>
  html
    .replace(/<head>[\s\S]*?<\/head>/, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

/** Errors and warnings, except HTML export's standing "under active development" warning. */
export const problems = (diagnostics: Diagnostic[]): string[] =>
  diagnostics
    .filter((d) => !/html export is under active development/.test(d.message))
    .map((d) => `${d.severity}: ${d.message}`);
