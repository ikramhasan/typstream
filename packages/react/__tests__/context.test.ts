// Configuration layering (PLAN §7): provider settings under a <Typstream>'s props.
import type { TypstreamPlugin } from "@typstream/core";
import { describe, expect, it } from "vitest";
import { mergeDefaults } from "../src/context";

const plugin = (key: string, preamble = ""): TypstreamPlugin => ({ key, engine: { preamble } });

describe("mergeDefaults", () => {
  it("lets the inner settings win, and ignores ones left undefined", () => {
    expect(mergeDefaults({ target: "paged", theme: "dark" }, { target: "html", theme: undefined })).toEqual({
      target: "html",
      theme: "dark",
    });
  });

  it("adds up plugins, once per key, the inner one winning", () => {
    const outer = plugin("a", "outer");
    const inner = plugin("a", "inner");
    const b = plugin("b");
    const merged = mergeDefaults({ plugins: [outer, b] }, { plugins: [inner] });
    expect(merged.plugins).toEqual([inner, b]);
  });

  it("adds up stylesheets without repeats, and merges inputs and files", () => {
    const merged = mergeDefaults(
      { stylesheets: ["x", "y"], inputs: { a: "1", b: "1" }, files: { "a.txt": "a" } },
      { stylesheets: ["y", "z"], inputs: { b: "2" }, files: { "b.txt": "b" } },
    );
    expect(merged.stylesheets).toEqual(["x", "y", "z"]);
    expect(merged.inputs).toEqual({ a: "1", b: "2" });
    expect(merged.files).toEqual({ "a.txt": "a", "b.txt": "b" });
  });

  it("keeps the outer lists and records when the inner has none", () => {
    const plugins = [plugin("a")];
    const inputs = { a: "1" };
    const merged = mergeDefaults({ plugins, inputs }, {});
    expect(merged.plugins).toBe(plugins);
    expect(merged.inputs).toBe(inputs);
  });

  it("calls both the provider's and the instance's telemetry hooks, the provider's first", () => {
    const calls: string[] = [];
    const outer = mergeDefaults({ onFallback: () => calls.push("app") }, { onWatchdog: () => calls.push("section") });
    const merged = mergeDefaults(outer, { onFallback: () => calls.push("instance") });
    merged.onFallback?.({} as never);
    merged.onWatchdog?.({} as never);
    expect(calls).toEqual(["app", "instance", "section"]);
    expect(merged.onRendered).toBeUndefined();
  });

  it("keeps a hook as it is when only one level has it", () => {
    const onRendered = () => {};
    expect(mergeDefaults({ onRendered }, {}).onRendered).toBe(onRendered);
    expect(mergeDefaults({}, { onRendered }).onRendered).toBe(onRendered);
  });
});
