// The text runs each exported page carries (`ChangedPage.text`), for the paged
// renderer's selectable text layer (#14).

import { describe, expect, it } from "vitest";
import { newEngine } from "./support/engine.js";

const pageOf = (source: string) => {
  const engine = newEngine();
  engine.set_source("/main.typ", source);
  const result = engine.compile_svg_changed();
  expect(result.ok).toBe(true);
  return result.changed?.[0] as NonNullable<typeof result.changed>[number];
};

describe("text runs", () => {
  it("lists the page's text in document order, with baseline positions in points", () => {
    const page = pageOf(
      `#set page(width: 300pt, height: 200pt, margin: 20pt)\n= Title\nFirst line.\n\nSecond paragraph.`,
    );
    expect(page.text.map((r) => r.text)).toEqual(["Title", "First line.", "Second paragraph."]);
    const [title, first, second] = page.text;
    // Left margin, baselines going down the page; body text at the default 11pt.
    expect(title?.x).toBeCloseTo(20, 1);
    expect(first?.size).toBe(11);
    expect(title?.y).toBeLessThan(first?.y as number);
    expect(first?.y).toBeLessThan(second?.y as number);
    for (const run of page.text) {
      expect(run.width).toBeGreaterThan(0);
      expect(run.x + run.width).toBeLessThanOrEqual(280);
      expect(run.matrix).toBeUndefined();
    }
  });

  it("includes text in math, tables and nested layout, and nothing for blank runs", () => {
    const page = pageOf(`$x^2 + 1$ #table(columns: 2, [a], [b]) #box(pad(left: 1em)[inner])`);
    const text = page.text.map((r) => r.text).join("|");
    for (const part of ["𝑥", "2", "+", "1", "a", "b", "inner"]) expect(text).toContain(part);
    expect(page.text.every((r) => r.text.trim() !== "")).toBe(true);
    // The superscript is smaller and sits higher than the base.
    const x = page.text.find((r) => r.text === "𝑥");
    const two = page.text.find((r) => r.text === "2");
    expect(two?.size).toBeLessThan(x?.size as number);
    expect(two?.y).toBeLessThan(x?.y as number);
  });

  it("gives rotated and scaled text its linear transform", () => {
    const page = pageOf(`#rotate(90deg)[Turned] #scale(x: 200%)[Wide]`);
    const turned = page.text.find((r) => r.text === "Turned");
    const wide = page.text.find((r) => r.text === "Wide");
    expect(turned?.matrix?.map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 1, -1, 0]);
    expect(wide?.matrix).toEqual([2, 0, 0, 1]);
  });

  it("is empty for a page without text", () => {
    expect(pageOf(`#rect(width: 2cm)`).text).toEqual([]);
  });
});
