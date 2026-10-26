// The coverage matrix through the wasm engine: with the prelude, no element is dropped and no
// text is lost against the paged output; without it, the entries marked `nativeDrops` are.
import { describe, expect, it } from "vitest";
import { compileHtml, dropped, newEngine } from "./support/engine";
import { MATRIX } from "./support/matrix";
import { pagedText } from "./support/paged";
import { blocksInInline, htmlText, missing } from "./support/text";

const engine = newEngine();

describe.each(MATRIX)("$name", (entry) => {
  it("keeps every element and all text in HTML", async () => {
    const result = compileHtml(engine, entry.source);
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    expect(dropped(result.diagnostics)).toEqual([]);
    expect(result.diagnostics.filter((d) => d.severity !== "warning")).toEqual([]);
    const html = result.html ?? "";
    expect(missing(await pagedText(entry.source), htmlText(html))).toBe(entry.missing?.chars ?? "");
    if (entry.html) expect(html).toMatch(entry.html);
  });

  if (entry.nativeDrops) {
    it("is dropped by HTML export without the prelude", async () => {
      const result = compileHtml(engine, entry.source, { prelude: false });
      expect(result.ok).toBe(true);
      const lost = missing(await pagedText(entry.source), htmlText(result.html ?? ""));
      expect(dropped(result.diagnostics).length > 0 || lost !== "").toBe(true);
    });
  }
});

describe("HTML structure", () => {
  it.each(MATRIX)("$name: no block element inside an inline one", ({ source }) => {
    expect(blocksInInline(compileHtml(engine, source).html ?? "")).toEqual([]);
  });
});
