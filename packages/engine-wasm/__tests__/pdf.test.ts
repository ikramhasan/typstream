// PDF export (`compile_pdf`), in the default build since #18.
import { describe, expect, it } from "vitest";
import { benchDoc, SMOKE } from "./support/documents.js";
import { newEngine } from "./support/engine.js";
import { nativeSvgPages } from "./support/native.js";

const engine = newEngine();

const pdfPages = (pdf: Uint8Array): number =>
  (
    Buffer.from(pdf)
      .toString("latin1")
      .match(/\/Type\s*\/Page\b/g) ?? []
  ).length;

describe("compile_pdf", () => {
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
