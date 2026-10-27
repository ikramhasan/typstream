// Plugin resolution (PLAN §8.0): keys, dependencies and a deterministic order.
import { describe, expect, it } from "vitest";
import { resolvePlugins, type TypstreamPlugin } from "../src/index";

const p = (key: string, ...dependencies: string[]): TypstreamPlugin => ({
  key,
  ...(dependencies.length ? { dependencies } : {}),
});
const keys = (plugins: readonly TypstreamPlugin[]) => resolvePlugins(plugins).map((x) => x.key);

describe("resolvePlugins", () => {
  it("keeps the given order when nothing depends on anything", () => {
    expect(keys([p("c"), p("a"), p("b")])).toEqual(["c", "a", "b"]);
    expect(resolvePlugins([])).toEqual([]);
  });

  it("loads a key given twice once, as its last definition at the place of its first", () => {
    const outer = { key: "a", version: "1" };
    const inner = { key: "a", version: "2" };
    const b = p("b");
    expect(resolvePlugins([outer, b, inner])).toEqual([inner, b]);
    expect(resolvePlugins([b, b])).toEqual([b]);
  });

  it("moves dependencies up to just before the first plugin that needs them", () => {
    expect(keys([p("x"), p("app", "edu"), p("y"), p("edu", "compat"), p("compat")])).toEqual([
      "x",
      "compat",
      "edu",
      "app",
      "y",
    ]);
    // Already earlier: nothing moves.
    expect(keys([p("compat"), p("edu", "compat")])).toEqual(["compat", "edu"]);
  });

  it("is deterministic: the same plugins in the same order resolve the same way", () => {
    const plugins = [p("d", "b", "a"), p("c"), p("b", "a"), p("a")];
    expect(keys(plugins)).toEqual(["a", "b", "d", "c"]);
    expect(keys(plugins)).toEqual(keys([...plugins]));
  });

  it("rejects a missing dependency, a cycle and a plugin without a key", () => {
    expect(() => resolvePlugins([p("edu", "compat")])).toThrow(
      'typstream plugin "edu" depends on "compat", which isn\'t loaded',
    );
    expect(() => resolvePlugins([p("a", "b"), p("b", "c"), p("c", "a")])).toThrow("cycle: a → b → c → a");
    expect(() => resolvePlugins([p("a", "a")])).toThrow("cycle: a → a");
    expect(() => resolvePlugins([{ key: "" }])).toThrow("without a key");
    expect(() => resolvePlugins([{} as TypstreamPlugin])).toThrow("without a key");
  });

  it("leaves facets it doesn't know alone", () => {
    const future = { key: "acme/future", editor: { nodes: [] }, hologram: { depth: 3 } } as TypstreamPlugin;
    expect(resolvePlugins([future])).toEqual([future]);
    expect(resolvePlugins([future])[0]).toBe(future);
  });
});
