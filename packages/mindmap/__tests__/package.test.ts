import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain .mjs script without types
import { generate, generateCss, publicNames } from "../scripts/embed.mjs";
import {
  MINDMAP_ROOT,
  MINDMAP_VERSION,
  mindmap,
  mindmapCatalogue,
  mindmapFiles,
  mindmapIsland,
  mindmapPreamble,
  mindmapPromptRules,
} from "../src/index";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("package", () => {
  it("embeds the current Typst files, catalogue, examples and React Flow CSS (run `pnpm embed`)", () => {
    expect(read("../src/assets.generated.ts")).toBe(generate());
    expect(read("../src/react/xyflow-css.generated.ts")).toBe(generateCss());
  });

  it("keeps the generated modules ASCII", () => {
    for (const path of ["../src/assets.generated.ts", "../src/react/xyflow-css.generated.ts"])
      expect(read(path).match(/[^\t\n -~]/g) ?? [], path).toEqual([]);
  });

  it("mounts every file under the root the preamble imports from", () => {
    expect(MINDMAP_ROOT).toBe(`@typstream/mindmap:${MINDMAP_VERSION}`);
    expect(mindmapPreamble).toBe(`#import "${MINDMAP_ROOT}": mindmap, topic\n`);
    expect(Object.keys(mindmapFiles).every((path) => path.startsWith(`${MINDMAP_ROOT}/`))).toBe(true);
    expect(mindmap.engine).toEqual({ files: mindmapFiles, preamble: mindmapPreamble });
    expect(mindmap.islands).toEqual({ mindmap: mindmapIsland });
    const toml = mindmapFiles[`${MINDMAP_ROOT}/typst.toml`] ?? "";
    expect(toml).toMatch(/^name = "mindmap"$/m);
    expect(toml).toMatch(new RegExp(`^version = "${MINDMAP_VERSION}"$`, "m"));
  });

  it("keeps the Typst package small (8 KB gzipped)", () => {
    expect(gzipSync(Object.values(mindmapFiles).join(""), { level: 9 }).length).toBeLessThanOrEqual(8 * 1024);
  });

  it("documents every public function, each with an example", () => {
    const lib = mindmapFiles[`${MINDMAP_ROOT}/lib.typ`] ?? "";
    const names = (publicNames(lib) as { names: string[] }[]).flatMap((p) => p.names);
    expect(names).toEqual(["mindmap", "topic"]);
    expect(mindmapCatalogue.map((d) => d.name)).toEqual(names);
    for (const doc of mindmapCatalogue) {
      expect(doc.signature, doc.name).toMatch(new RegExp(`^${doc.name}\\(.*\\)$`));
      expect(doc.example, doc.name).toBeTruthy();
    }
  });

  it("names in its prompt rules only parameters the functions have", () => {
    const params = new Set(
      mindmapCatalogue.flatMap((d) => [...d.signature.matchAll(/([a-z-]+):/g)].map((m) => m[1] as string)),
    );
    for (const rule of mindmapPromptRules)
      for (const [, name] of rule.matchAll(/`(?:#?(?:topic|mindmap)\()?([a-z-]+): /g))
        expect(params, `${name} in: ${rule}`).toContain(name);
  });
});
