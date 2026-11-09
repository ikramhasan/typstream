import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain .mjs script without types
import { generate } from "../scripts/embed.mjs";
import {
  MERMAID_GENERATOR,
  MERMAID_ROOT,
  MERMAID_VERSION,
  mermaid,
  mermaidExamples,
  mermaidFiles,
  mermaidPreamble,
} from "../src/index";
import { INDEX_FILE } from "../src/paths";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("package", () => {
  it("embeds the current Typst files and examples (run `pnpm embed`)", () => {
    expect(read("../src/assets.generated.ts")).toBe(generate());
  });

  it("keeps the generated modules ASCII", () => {
    for (const path of ["../src/assets.generated.ts", "../src/widths.generated.ts"])
      expect(read(path).match(/[^\t\n -~]/g) ?? [], path).toEqual([]);
  });

  it("mounts every file under the root the preamble imports from, and an empty index", () => {
    expect(MERMAID_ROOT).toBe(`@typstream/mermaid:${MERMAID_VERSION}`);
    expect(mermaidPreamble).toContain(`#import "${MERMAID_ROOT}": mermaid-diagram\n`);
    expect(Object.keys(mermaidFiles).every((path) => path.startsWith(`${MERMAID_ROOT}/`))).toBe(true);
    expect(mermaidFiles[INDEX_FILE]).toBe("{}");
    const toml = mermaidFiles[`${MERMAID_ROOT}/typst.toml`] ?? "";
    expect(toml).toMatch(/^name = "mermaid"$/m);
    expect(toml).toMatch(new RegExp(`^version = "${MERMAID_VERSION}"$`, "m"));
  });

  it("names the generator's build, next to dist/, for the worker", () => {
    expect(MERMAID_GENERATOR).toMatch(/\/packages\/mermaid\/generator\/mermaid\.js$/);
    expect(mermaid.engine?.generatorModules).toEqual([MERMAID_GENERATOR]);
    expect(mermaid.dependencies).toEqual(["html-compat"]);
  });

  it("writes every prompt example with a diagram in a block", () => {
    expect(mermaidExamples.length).toBeGreaterThan(0);
    for (const e of mermaidExamples) expect(e.output, e.title).toContain("```mermaid\n");
  });
});
