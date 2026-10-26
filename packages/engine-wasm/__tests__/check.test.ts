// check_paged: a paged compile without export, for validation (@typstream/node).
import { describe, expect, it } from "vitest";
import { benchDoc, SMOKE } from "./support/documents.js";
import { newEngine } from "./support/engine.js";

const engine = newEngine();

describe("check_paged", () => {
  it("reports the page count and diagnostics a paged compile would", () => {
    for (const source of [SMOKE, benchDoc(), '#set page(height: auto)\nA warning: #text(font: "Nope")[x]']) {
      engine.set_source("/main.typ", source);
      const checked = engine.check_paged();
      engine.reset_pages();
      const compiled = engine.compile_svg_changed();
      expect(checked.ok).toBe(true);
      expect(checked.pageCount).toBe(compiled.pageCount);
      expect(checked.diagnostics).toEqual(compiled.diagnostics);
      expect(checked.ms).toBeGreaterThan(0);
    }
  });

  it("reports errors without a page count", () => {
    engine.set_source("/main.typ", "#nope");
    const result = engine.check_paged();
    expect(result.ok).toBe(false);
    expect(result.pageCount).toBeUndefined();
    expect(result.diagnostics.map((d) => d.message)).toEqual(["unknown variable: nope"]);
  });

  it("leaves the changed-page baseline alone", () => {
    engine.set_source("/main.typ", benchDoc());
    engine.reset_pages();
    engine.compile_svg_changed();
    engine.set_source("/main.typ", `${benchDoc()}\nMore.`);
    engine.check_paged();
    // Still diffed against the first compile, so the changed last page is sent.
    expect(engine.compile_svg_changed().changed?.map((p) => p.index)).toEqual([5]);
  });
});
