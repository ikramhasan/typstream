// engine-wasm on its own, compiling as the engine's server does: the layout profile, html-compat's
// and the plugin's preambles before /main.typ, their files mounted, and the files the generator
// writes for the source. For the many compiles of a stream's prefixes, faster than the engine.
// comemo's cache and wasm memory are global per instance; vitest gives every test file its own
// module graph, so its own instance.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { CompileMode, DocumentFileGenerator } from "@typstream/core";
import { LAYOUT_PROFILE } from "@typstream/engine/server";
import { type Diagnostic, Engine, initSync } from "@typstream/engine-wasm";
import { baseFonts } from "@typstream/engine-wasm/fonts";
import { htmlCompat } from "@typstream/html-compat";
import generator from "../../src/generator";
import { mermaidFiles, mermaidPreamble } from "../../src/index";

initSync({ module: readFileSync(createRequire(import.meta.url).resolve("@typstream/engine-wasm/engine_bg.wasm")) });
for (const url of baseFonts) Engine.add_font(new Uint8Array(readFileSync(url)));

/**
 * An engine with html-compat's and the plugin's files, and a generator session for one document.
 * `plain`: without the plugin's preamble, so ```mermaid blocks are only code.
 */
export const newWasm = ({ plain = false } = {}) => {
  const PREAMBLE = `${htmlCompat.engine?.preamble ?? ""}\n${plain ? "" : mermaidPreamble}\n`;
  const engine = new Engine();
  for (const [path, source] of Object.entries({ ...htmlCompat.engine?.files, ...mermaidFiles }))
    engine.set_source(path, source as string);
  const session: DocumentFileGenerator = generator.open();
  const prepare = (text: string, mode: CompileMode) => {
    const files = session.files(PREAMBLE + text, { mode }) as Record<string, string>;
    for (const [path, content] of Object.entries(files)) engine.set_source(path, content);
    engine.set_source("/main.typ", LAYOUT_PROFILE + PREAMBLE + text);
  };
  return {
    html(text: string, mode: CompileMode = "final"): { html: string; diagnostics: Diagnostic[] } {
      prepare(text, mode);
      const r = engine.compile_html();
      return { html: r.html ?? "", diagnostics: r.diagnostics };
    },
    paged(text: string, mode: CompileMode = "final"): { svg: string; diagnostics: Diagnostic[] } {
      prepare(text, mode);
      engine.reset_pages();
      const r = engine.compile_svg_changed();
      return { svg: (r.changed ?? []).map((p) => p.svg).join("\n"), diagnostics: r.diagnostics };
    },
  };
};
