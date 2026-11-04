// The engine as an app runs it, in-process: `createEngine` with engine-wasm (its build, the base
// fonts) and the server's file generators, which import the plugin's generator module by URL
// from this package's build, as the worker does.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Diagnostic, HtmlArtifact, PagedArtifact, TypstreamPlugin } from "@typstream/core";
import { createEngine, type DocumentState, type Engine, type EngineDocument } from "@typstream/engine";
import { engineWasm, inProcess } from "@typstream/engine/server";
import { baseFonts } from "@typstream/engine-wasm/fonts";
import { htmlCompat } from "@typstream/html-compat";
import { mermaid } from "../../src/index";

const dist = dirname(createRequire(import.meta.url).resolve("@typstream/engine-wasm"));
const wasm = readFileSync(join(dist, "engine_bg.wasm"));
const fonts = baseFonts.map((url) => new Uint8Array(readFileSync(url)));

export const newEngine = (): Engine =>
  createEngine({ spawn: inProcess(() => engineWasm({ wasm, fonts })), spare: false });

export const done = (doc: EngineDocument): Promise<DocumentState> =>
  new Promise((resolve) => {
    const check = (s: DocumentState) => {
      if (s.status === "done" || s.status === "error") resolve(s);
    };
    doc.subscribe(check);
    check(doc.getState());
  });

/** Opens `text` with `plugin` and html-compat (and `plugins` before them), finished, in `target`. */
export const render = async (
  engine: Engine,
  text: string,
  target: "html" | "paged" = "paged",
  plugins: TypstreamPlugin[] = [],
  plugin: TypstreamPlugin = mermaid,
): Promise<{ state: DocumentState; doc: EngineDocument }> => {
  const doc = engine.open({ plugins: [...plugins, htmlCompat, plugin], text, target, fallback: false });
  doc.finish();
  return { state: await done(doc), doc };
};

export const html = (s: DocumentState): string => (s.artifact as HtmlArtifact | null)?.html ?? "";

/** The pages' SVG, joined. */
export const pages = (s: DocumentState): string =>
  ((s.artifact as PagedArtifact | null)?.pages ?? []).map((p) => p.svg).join("\n");

/** Errors and warnings, except HTML export's standing ones. */
export const problems = (diagnostics: readonly Diagnostic[]): string[] =>
  diagnostics
    .filter(
      (d) =>
        d.severity !== "info" && !/html export is under active development|page set rule was ignored/.test(d.message),
    )
    .map((d) => `${d.severity}: ${d.message}`);
