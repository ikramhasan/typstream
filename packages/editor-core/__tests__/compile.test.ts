// Canonical Typst means the same document to Typst: every corpus document, written back with every
// block canonical (as if the teacher had changed each one) and the whitespace between blocks kept,
// compiles to the same HTML with the same errors and warnings. engine-wasm compiles both (HTML needs no fonts); edu's files are mounted
// for the documents written for it.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { ALL_SETS, loadCorpus } from "@typstream/corpus";
import { eduFiles, eduPreamble } from "@typstream/edu";
import { Engine, initSync } from "@typstream/engine-wasm";
import { hasErrors, parse } from "@typstream/syntax";
import { beforeAll, describe, expect, it } from "vitest";
import { TypstDocument } from "../src/index";
import { loadParser } from "./support/syntax";

initSync({ module: readFileSync(createRequire(import.meta.url).resolve("@typstream/engine-wasm/engine_bg.wasm")) });

beforeAll(loadParser);

const engine = new Engine();
for (const [path, source] of Object.entries(eduFiles)) engine.set_source(path, source);

const compile = (source: string, preamble: string): { html: string; diagnostics: string[] } => {
  engine.set_source("/main.typ", preamble + source);
  const result = engine.compile_html();
  return { html: result.html ?? "", diagnostics: result.diagnostics.map((d) => `${d.severity}: ${d.message}`) };
};

describe("canonical Typst compiles the same", () => {
  const entries = loadCorpus({ sets: ALL_SETS }).filter((entry) => entry.meta.expect !== "limit");
  it.each(entries.map((entry) => [entry.id, entry]))("%s", (_, entry) => {
    if (hasErrors(parse(entry.source))) return;
    const preamble = entry.meta.plugins?.includes("edu") ? eduPreamble : "";
    const original = compile(entry.source, preamble);
    // Documents that need what isn't mounted here (universe's packages, the mind map) can't be compared.
    if (original.diagnostics.some((d) => d.startsWith("error"))) return;
    const doc = new TypstDocument(entry.source);
    const canonical = compile(doc.serialize(doc.value, { rewrite: true }), preamble);
    expect(canonical.diagnostics).toEqual(original.diagnostics);
    expect(canonical.html).toBe(original.html);
  });
});
