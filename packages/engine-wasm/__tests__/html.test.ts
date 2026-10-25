import { describe, expect, it } from "vitest";
import { SMOKE } from "./support/documents.js";
import { Engine, newEngine } from "./support/engine.js";

const engine = newEngine();

const compile = (source: string) => {
  engine.set_source("/main.typ", source);
  return engine.compile_html();
};

const body = (html = ""): string => html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));

describe("compile_html", () => {
  it("renders math as MathML, and tables, figures and refs as HTML", () => {
    const result = compile(SMOKE);
    expect(result.ok).toBe(true);
    const html = result.html ?? "";
    expect(html).toMatch(/<math[ >]/);
    expect(html).toContain('<math display="block"');
    expect(html).toContain("<table");
    expect(html).toContain("<figure");
    expect(html).toContain('href="#tab"');
    expect(result.ms).toBeGreaterThan(0);
  });

  it("drops the constant 'html export is under active development' warning", () => {
    const result = compile("Hello");
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps the HTML target's own warnings, with spans", () => {
    const source = "Text #h(1em) more";
    const result = compile(source);
    expect(result.ok).toBe(true);
    const warning = result.diagnostics.find((d) => d.message.includes("was ignored"));
    expect(warning).toMatchObject({ severity: "warning", source: "typst" });
    expect(warning?.file).toBeUndefined();
    expect(source.slice(warning?.span?.from, warning?.span?.to)).toBe("h(1em)");
  });

  it("returns errors without html", () => {
    const result = compile('#panic("boom")');
    expect(result.ok).toBe(false);
    expect(result.html).toBeUndefined();
    expect(result.diagnostics[0]).toMatchObject({ severity: "error", message: "panicked with: boom" });
  });
});

describe("files", () => {
  it("imports other source files", () => {
    engine.set_source("/lib.typ", "#let greet(x) = [Hi *#x*]");
    const result = compile('#import "lib.typ": greet\n#greet("there")');
    expect(body(result.html)).toContain("Hi <strong>there</strong>");
  });

  it("updates an existing source in place", () => {
    engine.set_source("/lib.typ", "#let greet(x) = [Bye _#x;_]");
    const result = compile('#import "lib.typ": greet\n#greet("there")');
    expect(body(result.html)).toContain("Bye <em>there</em>");
  });

  it("reads binary files", () => {
    engine.set_file("/data.json", new TextEncoder().encode('{"answer": 42}'));
    expect(body(compile('#json("/data.json").answer').html)).toContain("42");
  });

  it("reports a missing file with its path", () => {
    engine.remove_file("/data.json");
    const result = compile('#json("/data.json")');
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.message).toContain("/data.json");
  });

  it("can't remove the main source", () => {
    engine.set_source("/main.typ", "still here");
    engine.remove_file("/main.typ");
    expect(engine.compile_html().ok).toBe(true);
  });

  it("throws on invalid paths", () => {
    expect(() => engine.set_source("/../escape.typ", "")).toThrow(/invalid virtual path/);
    expect(() => engine.set_file("/../escape.bin", new Uint8Array())).toThrow(/invalid virtual path/);
  });
});

describe("sys.inputs", () => {
  it("passes string inputs", () => {
    engine.set_inputs({ name: "Ada", n: "3" });
    expect(body(compile("Hello #sys.inputs.name, n=#sys.inputs.n").html)).toContain("Hello Ada, n=3");
    engine.set_inputs({});
    expect(compile('#sys.inputs.at("name", default: "none")').html).toContain("none");
  });

  it("rejects non-string values", () => {
    expect(() => engine.set_inputs({ n: 3 } as unknown as Record<string, string>)).toThrow(/sys.inputs.n/);
  });
});

describe("engine", () => {
  it("reports its features", () => {
    expect(Engine.features()).toEqual(["html", "svg"]);
  });

  it("counts the faces a font file adds", () => {
    const fresh = new Engine();
    expect(fresh.add_font(new Uint8Array([1, 2, 3]))).toBe(0);
    fresh.free();
  });

  it("reports wasm memory", () => {
    expect(Engine.memory_bytes()).toBeGreaterThan(0);
    expect(Engine.memory_bytes() % 65536).toBe(0);
  });

  it("uses today's date", () => {
    const now = new Date();
    const result = compile('#datetime.today().display("[year]-[month]-[day]")');
    const expected = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
      .map((n) => String(n).padStart(2, "0"))
      .join("-");
    expect(body(result.html)).toContain(expected);
  });
});
