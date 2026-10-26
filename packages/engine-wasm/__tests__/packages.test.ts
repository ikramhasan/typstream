import { describe, expect, it } from "vitest";
import { newEngine } from "./support/engine.js";

const MANIFEST = '[package]\nname = "demo"\nversion = "1.0.0"\nentrypoint = "src/lib.typ"\n';

describe("package files", () => {
  it("roots `@ns/name:version/…` paths at the package, as Typst's import resolves them", () => {
    const engine = newEngine();
    engine.set_file("@preview/demo:1.0.0/typst.toml", new TextEncoder().encode(MANIFEST));
    engine.set_source("@preview/demo:1.0.0/src/lib.typ", '#import "words.typ": word\n#let greet() = [Hello, #word]');
    engine.set_source("@preview/demo:1.0.0/src/words.typ", "#let word = [class]");
    engine.set_source("/main.typ", '#import "@preview/demo:1.0.0": greet\n#greet()');
    const result = engine.compile_html();
    expect(result.diagnostics).toEqual([]);
    expect(result.html).toContain("Hello, class");
  });

  it("reports problems inside a package at its path, and the call site in /main.typ", () => {
    const engine = newEngine();
    engine.set_file("@preview/demo:1.0.0/typst.toml", new TextEncoder().encode(MANIFEST));
    engine.set_source("@preview/demo:1.0.0/src/lib.typ", "#let boom() = nope");
    const main = '#import "@preview/demo:1.0.0": boom\n#boom()';
    engine.set_source("/main.typ", main);
    const [error] = engine.compile_html().diagnostics;
    expect(error?.message).toBe("unknown variable: nope");
    expect(error?.file?.path).toBe("@preview/demo:1.0.0/src/lib.typ");
    expect(main.slice(error?.span?.from, error?.span?.to)).toBe("boom()");
  });

  it("reports a package with no files mounted as not found, at the import", () => {
    const engine = newEngine();
    const main = '#import "@preview/cetz:0.5.3"';
    engine.set_source("/main.typ", main);
    const [error] = engine.compile_html().diagnostics;
    expect(error?.message).toBe("package not found (searched for @preview/cetz:0.5.3)");
    expect(main.slice(error?.span?.from, error?.span?.to)).toBe('"@preview/cetz:0.5.3"');
  });

  it("rejects package paths that aren't a spec and a path", () => {
    const engine = newEngine();
    expect(() => engine.set_source("@preview/demo/lib.typ", "")).toThrow(/invalid virtual path/);
    expect(() => engine.set_source("@preview/demo:1.0.0", "")).toThrow(/invalid virtual path/);
  });
});
