// Typst itself for the commands' tests: engine-wasm's built wasm in Node, with its base fonts.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as glue from "@typstream/engine-wasm";
import { baseFonts } from "@typstream/engine-wasm/fonts";

const dist = dirname(createRequire(import.meta.url).resolve("@typstream/engine-wasm"));
if (!existsSync(join(dist, "engine_bg.wasm"))) {
  throw new Error(`engine-wasm not built: run \`pnpm --filter @typstream/engine-wasm build\` (expected ${dist})`);
}
glue.initSync({ module: readFileSync(join(dist, "engine_bg.wasm")) });
for (const url of baseFonts) glue.Engine.add_font(new Uint8Array(readFileSync(url)));
const engine = new glue.Engine();

/** `source` compiled to HTML: its body, and its errors. */
export const compile = (source: string): { body: string; errors: string[] } => {
  engine.set_source("/main.typ", source);
  const r = engine.compile_html();
  const errors = r.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
  const html = r.html ?? "";
  return { body: html.slice(html.indexOf("<body>")), errors };
};

/** The text an HTML body shows, entities decoded. */
export const textOf = (body: string): string =>
  body
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&amp;/g, "&");
