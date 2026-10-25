import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyEdit, diffEdit, mapPosition, SourceMap } from "../src";

describe("edits", () => {
  it("diffEdit produces an edit that reproduces the target", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        const e = diffEdit(a, b);
        expect(e === null ? a : applyEdit(a, e)).toBe(b);
      }),
    );
  });

  it("diffEdit never splits a surrogate pair", () => {
    const e = diffEdit("a😀", "a😁");
    expect(e).toEqual({ from: 1, to: 3, insert: "😁" });
  });

  it("mapPosition moves positions after the edit and clamps positions inside it", () => {
    const e = { from: 2, to: 4, insert: "xyz" };
    expect(mapPosition(1, e)).toBe(1);
    expect(mapPosition(3, e)).toBe(5);
    expect(mapPosition(3, e, -1)).toBe(2);
    expect(mapPosition(6, e)).toBe(7);
  });
});

describe("SourceMap", () => {
  const map = new SourceMap([
    { original: { from: 0, to: 3 }, result: { from: 0, to: 0 }, reason: "cut" },
    { original: { from: 10, to: 10 }, result: { from: 7, to: 9 }, reason: "insert" },
  ]);
  it("maps both ways", () => {
    expect(map.toResult(5)).toBe(2);
    expect(map.toOriginal(2)).toBe(5);
    expect(map.toResult(10)).toBe(9);
    expect(map.toOriginal(8)).toBe(10);
    expect(map.toOriginal(0)).toBe(3);
    expect(map.toOriginal(0, -1)).toBe(0);
  });
});
