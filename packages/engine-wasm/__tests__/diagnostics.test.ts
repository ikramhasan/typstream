// Diagnostics follow @typstream/core's Diagnostic with /main.typ as the
// document. Spans are UTF-16 ranges (JS string indices), so slicing the source
// with them must give the offending text even after astral characters (4 UTF-8
// bytes, 2 UTF-16 units) and other non-ASCII text.
import { describe, expect, it } from "vitest";
import { type Diagnostic, newEngine, type Range } from "./support/engine.js";

const engine = newEngine();

const diagnose = (source: string): Diagnostic[] => {
  engine.set_source("/main.typ", source);
  return engine.compile_html().diagnostics;
};

const slice = (source: string, span: Range | null | undefined): string | undefined =>
  span ? source.slice(span.from, span.to) : undefined;

const text = (source: string, diag: Diagnostic | undefined): string | undefined => slice(source, diag?.span);

describe("UTF-16 spans", () => {
  it("points at an error after emoji", () => {
    const source = "😀🎉 Ünïcödé text #foo(1)";
    const [error] = diagnose(source);
    expect(error).toEqual({
      severity: "error",
      span: { from: source.indexOf("foo"), to: source.indexOf("foo") + 3 },
      message: "unknown variable: foo",
      hints: [],
      trace: [],
      source: "typst",
    });
    expect(text(source, error)).toBe("foo");
  });

  it("points at an error whose span is an emoji", () => {
    // A ZWJ sequence: woman, U+200D, microscope.
    const scientist = "\u{1F469}\u200D\u{1F52C}";
    const source = `😀 #("${scientist}" + 1)`;
    const [error] = diagnose(source);
    expect(error?.message).toContain("cannot add string and integer");
    expect(text(source, error)).toBe(`"${scientist}" + 1`);
  });

  it("points at a syntax error after emoji", () => {
    const source = "Hello 😀 *bold";
    const [error] = diagnose(source);
    expect(error?.message).toBe("unclosed delimiter");
    expect(text(source, error)).toBe("*");
  });

  it("puts a problem in another file at its call site, with the original location in `file`", () => {
    const lib = '// 🧪🧪🧪\n#let f(x) = x + "s"';
    engine.set_source("/lib.typ", lib);
    const source = '#import "lib.typ": f\n😀 #f(1)';
    const [error] = diagnose(source);
    expect(error?.message).toBe("cannot add integer and string");
    expect(text(source, error)).toBe("f(1)");
    expect(error?.file?.path).toBe("/lib.typ");
    expect(slice(lib, error?.file?.span)).toBe('x + "s"');
    expect(error?.trace.map((t) => [t.message, slice(source, t.span)])).toEqual([["while calling `f`", "f(1)"]]);
  });

  it("uses the nearest call site in main when the call chain passes through other files", () => {
    engine.set_source("/lib.typ", '#let f(x) = x + "s"\n#let g(x) = f(x)');
    const source = '#import "lib.typ": g\n😀 #g(1)';
    const [error] = diagnose(source);
    expect(text(source, error)).toBe("g(1)");
    // Innermost first; the call of f is in lib.typ, so it has no span.
    expect(error?.trace.map((t) => [t.message, slice(source, t.span)])).toEqual([
      ["while calling `f`", undefined],
      ["while calling `g`", "g(1)"],
    ]);
    expect(error?.trace[0]?.span).toBeNull();
  });

  it("maps spans in data files", () => {
    const json = '{"emoji": "😀", "broken": }';
    engine.set_file("/data.json", new TextEncoder().encode(json));
    const [error] = diagnose('#json("/data.json")');
    expect(error?.message).toContain("failed to parse JSON");
    // The whole file: 29 UTF-8 bytes, 27 UTF-16 units.
    expect(error?.file).toEqual({ path: "/data.json", span: { from: 0, to: json.length } });
    expect(text('#json("/data.json")', error)).toBe('json("/data.json")');
  });
});

describe("diagnostic content", () => {
  it("returns hints", () => {
    const [error] = diagnose("$ab$");
    expect(error?.message).toBe("unknown variable: ab");
    expect(error?.hints.length).toBeGreaterThan(0);
    expect(error?.hints.join("\n")).toContain("letters");
  });

  it("returns every error", () => {
    const source = "#let x = (1, 2\n= Heading\n#foo(1)";
    const diagnostics = diagnose(source);
    expect(diagnostics.map((d) => [d.message, text(source, d)])).toEqual([
      ["unclosed delimiter", "("],
      ["the character `#` is not valid in code", "#"],
    ]);
  });

  it("returns errors before warnings", () => {
    const source = '#h(1em)\n#context [#panic("late")]';
    const diagnostics = diagnose(source);
    expect(diagnostics.map((d) => [d.severity, text(source, d)])).toEqual([
      ["error", 'panic("late")'],
      ["warning", "h(1em)"],
    ]);
  });

  it("reports a missing import at its path", () => {
    engine.remove_file("/lib.typ");
    const source = '#import "lib.typ": f';
    const [error] = diagnose(source);
    expect(error?.message).toBe("file not found (searched at /lib.typ)");
    expect(text(source, error)).toBe('"lib.typ"');
  });
});
