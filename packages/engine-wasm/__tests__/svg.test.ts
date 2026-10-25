import { beforeEach, describe, expect, it } from "vitest";
import { benchDoc } from "./support/documents.js";
import { newEngine } from "./support/engine.js";

const engine = newEngine();

const compile = (source: string) => {
  engine.set_source("/main.typ", source);
  const result = engine.compile_svg_changed();
  return { ...result, indices: result.changed?.map((page) => page.index) };
};

describe("compile_svg_changed", () => {
  beforeEach(() => engine.reset_pages());

  it("sends every page first, then nothing for an unchanged source", () => {
    const first = compile(benchDoc());
    expect(first.ok).toBe(true);
    expect(first.pageCount).toBe(6);
    expect(first.indices).toEqual([0, 1, 2, 3, 4, 5]);
    expect(first.changed?.every((page) => page.svg.startsWith("<svg"))).toBe(true);
    expect(first.compileMs).toBeGreaterThan(0);
    expect(first.exportMs).toBeGreaterThan(0);
    expect(first.ms).toBeGreaterThanOrEqual(first.compileMs + first.exportMs);

    const again = compile(benchDoc());
    expect(again.pageCount).toBe(6);
    expect(again.indices).toEqual([]);
  });

  it("sends only the changed pages when text is appended", () => {
    compile(benchDoc());
    const appended = compile(`${benchDoc()}\nOne more streamed sentence.`);
    expect(appended.pageCount).toBe(6);
    expect(appended.indices).toEqual([5]);
  });

  it("sends only the changed page for an edit in the middle", () => {
    const source = benchDoc();
    compile(source);
    // "Section 3" sits on the first or second page; the page count must not change.
    const edited = compile(source.replace("Section 3:", "Part 3:"));
    expect(edited.pageCount).toBe(6);
    expect(edited.indices).toHaveLength(1);
    expect(edited.indices?.[0]).toBeLessThan(3);
  });

  it("sends the new page when the document grows by a page", () => {
    compile(benchDoc());
    const grown = compile(`${benchDoc()}\n#pagebreak()\nA new page.`);
    expect(grown.pageCount).toBe(7);
    expect(grown.indices).toEqual([6]);
  });

  it("reports a shrinking document through pageCount", () => {
    compile(`${benchDoc()}\n#pagebreak()\nA new page.`);
    const shrunk = compile(benchDoc());
    expect(shrunk.pageCount).toBe(6);
    expect(shrunk.indices).toEqual([]);
  });

  it("keeps the last good pages across a failed compile", () => {
    compile(benchDoc());
    const failed = compile(`${benchDoc()}\n#foo`);
    expect(failed.ok).toBe(false);
    expect(failed.pageCount).toBeUndefined();
    expect(failed.changed).toBeUndefined();
    expect(failed.exportMs).toBe(0);
    expect(failed.diagnostics[0]?.message).toBe("unknown variable: foo");
    // Diffed against the last success, not the failure.
    expect(compile(benchDoc()).indices).toEqual([]);
  });

  it("sends every page again after reset_pages", () => {
    compile(benchDoc());
    engine.reset_pages();
    expect(compile(benchDoc()).indices).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
