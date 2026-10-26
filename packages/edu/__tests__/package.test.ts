import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain .mjs script without types
import { generate, publicNames } from "../scripts/embed.mjs";
import {
  EDU_ROOT,
  EDU_VERSION,
  edu,
  eduCatalogue,
  eduCss,
  eduExamples,
  eduFiles,
  eduPreamble,
  eduTemplates,
} from "../src/index";

const lib = eduFiles[`${EDU_ROOT}/lib.typ`] ?? "";

describe("package", () => {
  it("embeds the current Typst files, CSS, catalogue and examples (run `pnpm embed` after editing them)", () => {
    expect(readFileSync(new URL("../src/assets.generated.ts", import.meta.url), "utf8")).toBe(generate());
  });

  it("keeps the generated module ASCII (Arabic and Bengali are escaped)", () => {
    const text = readFileSync(new URL("../src/assets.generated.ts", import.meta.url), "utf8");
    expect(text.match(/[^\t\n -~]/g) ?? []).toEqual([]);
  });

  it("mounts every file under the root the preamble imports from", () => {
    expect(EDU_ROOT).toBe(`@typstream/edu:${EDU_VERSION}`);
    expect(eduPreamble).toBe(`#import "${EDU_ROOT}": *\n`);
    expect(Object.keys(eduFiles).every((path) => path.startsWith(`${EDU_ROOT}/`))).toBe(true);
    expect(edu.engine?.files).toBe(eduFiles);
    expect(edu.engine?.preamble).toBe(eduPreamble);
  });

  it("has a typst.toml for the same version, which Typst checks against the import", () => {
    const toml = eduFiles[`${EDU_ROOT}/typst.toml`] ?? "";
    expect(toml).toMatch(/^name = "edu"$/m);
    expect(toml).toMatch(new RegExp(`^version = "${EDU_VERSION}"$`, "m"));
    expect(toml).toMatch(/^entrypoint = "lib.typ"$/m);
    expect(edu.version).toBe(EDU_VERSION);
  });

  it("keeps the Typst package within its size budget (PLAN §11.6: 30 KB gzipped)", () => {
    const bytes = gzipSync(Object.values(eduFiles).join(""), { level: 9 }).length;
    expect(bytes).toBeLessThanOrEqual(30 * 1024);
  });

  it("documents every public function, each with an example", () => {
    const names = (publicNames(lib) as { names: string[] }[]).flatMap((p) => p.names);
    expect(names.length).toBeGreaterThan(20);
    expect(eduCatalogue.map((d) => d.name)).toEqual(names);
    for (const doc of eduCatalogue) {
      expect(doc.signature, doc.name).toMatch(new RegExp(`^${doc.name}\\(.*\\)$`));
      expect(doc.description.length, doc.name).toBeGreaterThan(20);
      expect(doc.example, doc.name).toBeTruthy();
    }
    // Helpers stay out of the public names (a document's glob import brings in everything lib.typ binds).
    expect(names.filter((n) => n.startsWith("_"))).toEqual([]);
    expect(lib).not.toMatch(/^#let /m);
  });

  it("ships the catalogue, rules, examples and templates as the prompt and template facets", () => {
    expect(edu.prompt?.catalogue).toBe(eduCatalogue);
    expect(edu.prompt?.rules?.length).toBeGreaterThan(5);
    expect(edu.prompt?.examples).toBe(eduExamples);
    expect(eduExamples.map((e) => e.title)).toEqual([
      "exam-chemistry",
      "quiz-arabic",
      "worksheet-bengali",
      "worksheet-fractions",
    ]);
    for (const e of eduExamples) expect(e.output, e.title ?? "").toMatch(/^#show: (worksheet|quiz|exam)\.with\(/);
    const templates = eduTemplates.map((t) => t.name);
    expect(templates).toEqual(["worksheet", "quiz", "exam", "lesson-plan", "handout"]);
    for (const t of templates) expect(eduCatalogue.some((d) => d.name === t)).toBe(true);
    expect(edu.templates).toBe(eduTemplates);
  });

  it("scopes every CSS rule to the renderer root", () => {
    const selectors = eduCss
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("}")
      .map((block) => block.split("{")[0]?.trim())
      .filter((s): s is string => !!s);
    expect(selectors.length).toBeGreaterThan(20);
    for (const selector of selectors) {
      for (const part of selector.split(/,(?![^(]*\))/)) expect(part.trim()).toMatch(/^:where\(\.typstream[ )]/);
    }
  });
});
