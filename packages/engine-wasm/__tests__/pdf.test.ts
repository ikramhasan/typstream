// The `pdf` build (dist/pdf, `@typstream/engine-wasm/pdf`): the same engine plus compile_pdf.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { benchDoc, SMOKE } from "./support/documents.js";
import { fonts } from "./support/fonts.js";
import { nativeSvgPages } from "./support/native.js";

const dist = fileURLToPath(new URL("../dist/pdf/", import.meta.url));
if (!existsSync(`${dist}engine.js`)) throw new Error(`pdf build missing: run ./build.sh (expected ${dist}engine.js)`);
const glue: typeof import("../dist/pdf/engine.js") = await import("../dist/pdf/engine.js");
glue.initSync({ module: readFileSync(`${dist}engine_bg.wasm`) });

const engine = new glue.Engine();
for (const font of fonts()) engine.add_font(font.bytes);

const pdfPages = (pdf: Uint8Array): number =>
  (
    Buffer.from(pdf)
      .toString("latin1")
      .match(/\/Type\s*\/Page\b/g) ?? []
  ).length;

describe("pdf build", () => {
  it("has the pdf feature", () => {
    expect(glue.Engine.features()).toEqual(["html", "svg", "pdf"]);
  });

  it.each([
    ["smoke", SMOKE],
    ["six pages", benchDoc()],
  ])("exports %s with as many pages as native typst", (_name, source) => {
    engine.set_source("/main.typ", source);
    const result = engine.compile_pdf();
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    const pdf = result.pdf as Uint8Array;
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    const pages = nativeSvgPages(source).length;
    expect(pdfPages(pdf)).toBe(pages);
    expect(result.pageCount).toBe(pages);
  });

  it("reports errors like the other compiles", () => {
    engine.set_source("/main.typ", "#nope");
    const result = engine.compile_pdf();
    expect(result.ok).toBe(false);
    expect(result.pdf).toBeUndefined();
    expect(result.diagnostics.map((d) => d.message)).toEqual(["unknown variable: nope"]);
  });
});
