import { describe, expect, expectTypeOf, it } from "vitest";
import {
  compareDiagnostics,
  type Diagnostic,
  definePlugin,
  formatDiagnostic,
  type HealHandler,
  hasErrors,
  isError,
  lineColumn,
  mapDiagnostic,
  mapPosition,
  normalizeDiagnostics,
  SourceMap,
  type TypstreamPlugin,
} from "../src";

const diag = (from: number, to: number, message = "oops", severity: Diagnostic["severity"] = "error"): Diagnostic => ({
  severity,
  span: { from, to },
  message,
  hints: [],
  trace: [],
});

describe("diagnostics", () => {
  it("detects errors", () => {
    expect(isError(diag(0, 1))).toBe(true);
    expect(hasErrors([diag(0, 1, "w", "warning")])).toBe(false);
    expect(hasErrors([diag(0, 1, "w", "warning"), diag(0, 1)])).toBe(true);
  });

  it("maps spans and trace spans through a source map", () => {
    // Healed source = input with "xx" cut at 4..6 and "]" appended at 10.
    const map = new SourceMap([
      { original: { from: 4, to: 6 }, result: { from: 4, to: 4 }, reason: "cut" },
      { original: { from: 10, to: 10 }, result: { from: 8, to: 9 }, reason: "close:]" },
    ]);
    const d: Diagnostic = {
      ...diag(5, 9),
      trace: [{ message: "in call", span: { from: 0, to: 4 } }],
      file: { path: "preamble.typ", span: { from: 1, to: 2 } },
    };
    const mapped = mapDiagnostic(d, (pos, assoc) => map.toOriginal(pos, assoc));
    expect(mapped.span).toEqual({ from: 7, to: 10 });
    expect(mapped.trace[0]?.span).toEqual({ from: 0, to: 4 });
    // Positions in other files are not the document's.
    expect(mapped.file).toEqual(d.file);
    expect(d.span).toEqual({ from: 5, to: 9 });
  });

  it("maps across an edit without widening or inverting", () => {
    const at = (from: number, to: number, edit: { from: number; to: number; insert: string }) =>
      mapDiagnostic(diag(from, to), (pos, assoc) => mapPosition(pos, edit, assoc)).span;
    // Insertions at either boundary stay outside.
    expect(at(2, 4, { from: 2, to: 2, insert: "ab" })).toEqual({ from: 4, to: 6 });
    expect(at(2, 4, { from: 4, to: 4, insert: "ab" })).toEqual({ from: 2, to: 4 });
    // Replacing the whole range collapses it to the replacement's end.
    expect(at(2, 4, { from: 1, to: 5, insert: "z" })).toEqual({ from: 2, to: 2 });
    expect(mapDiagnostic({ ...diag(0, 0), span: null }, () => 99).span).toBeNull();
  });

  it("sorts, then drops duplicates", () => {
    const noSpan = { ...diag(0, 0, "font"), span: null };
    const out = normalizeDiagnostics([noSpan, diag(5, 6), diag(1, 2, "w", "warning"), diag(5, 6), diag(1, 2)]);
    expect(out.map((d) => [d.span?.from, d.severity])).toEqual([
      [1, "error"],
      [1, "warning"],
      [5, "error"],
      [undefined, "error"],
    ]);
    expect(compareDiagnostics(diag(1, 2, "a"), diag(1, 2, "b"))).toBeLessThan(0);
    // Different hints are different diagnostics.
    expect(normalizeDiagnostics([diag(0, 1), { ...diag(0, 1), hints: ["try this"] }])).toHaveLength(2);
  });

  it("finds lines and columns", () => {
    const text = "ab\ncd\n\nef";
    expect(lineColumn(text, 0)).toEqual({ line: 0, column: 0 });
    expect(lineColumn(text, 2)).toEqual({ line: 0, column: 2 });
    expect(lineColumn(text, 3)).toEqual({ line: 1, column: 0 });
    expect(lineColumn(text, 7)).toEqual({ line: 3, column: 0 });
    expect(lineColumn(text, 9)).toEqual({ line: 3, column: 2 });
  });

  it("formats for logs", () => {
    const d = { ...diag(4, 5, "unclosed delimiter"), hints: ["add a ]"] };
    expect(formatDiagnostic(d, "ab\ncd")).toBe("error 2:2: unclosed delimiter\n  hint: add a ]");
    expect(formatDiagnostic(d)).toBe("error 4..5: unclosed delimiter\n  hint: add a ]");
    expect(
      formatDiagnostic({ ...diag(0, 0, "unknown font", "warning"), span: null, file: { path: "p.typ", span: null } }),
    ).toBe("warning: unknown font (in p.typ)");
  });
});

describe("plugin contract", () => {
  it("accepts a plugin with every facet", () => {
    const handler: HealHandler = {
      name: "blank",
      phase: "settled",
      run: (ctx) => (ctx.modeAt(ctx.from) === "markup" ? [{ from: ctx.from, to: ctx.from, insert: "" }] : []),
    };
    const plugin = definePlugin({
      key: "acme/chemistry",
      version: "1.0.0",
      dependencies: ["edu"],
      heal: { handlers: [handler], lint: { "currency-dollar": "fix" } },
      engine: {
        fixerModules: ["https://example.test/fixers.js"],
        files: { "lib.typ": "#let ce(x) = x", "logo.png": new Uint8Array([1]) },
        packages: [{ namespace: "preview", name: "cetz", version: "0.4.2" }],
        fonts: [{ kind: "url", url: "/fonts/noto-bengali.ttf", family: "Noto Sans Bengali", scripts: ["Beng"] }],
        preamble: '#import "lib.typ": ce',
      },
      templates: [{ name: "lab-report", preamble: '#set page(paper: "a4")' }],
      prompt: { catalogue: [{ name: "ce", signature: "ce(formula: str)", description: "A formula." }], rules: [] },
      islands: {
        molecule: {
          description: "A molecule, rotatable.",
          parse: (data) => (typeof data === "string" ? data : undefined),
        },
      },
      sanitize: { allowTags: ["typstream-island"], allowAttrs: { "*": ["data-name"] } },
      stylesheets: [".typstream .molecule { display: block }"],
      // The editor's facet: what it reads is typed, the rest stays open.
      editor: {
        nodes: [{ call: "ce", label: "Formula" }],
        slashItems: [{ key: "ce", label: "Formula", insert: '#ce("H2O")' }],
        someFutureFacet: true,
      },
    });
    expectTypeOf(plugin).toExtend<TypstreamPlugin>();
    expectTypeOf(plugin.key).toBeString();
    expect(plugin.key).toBe("acme/chemistry");
  });

  it("requires a key and rejects unknown facets", () => {
    // @ts-expect-error: key is required
    const a: TypstreamPlugin = { heal: {} };
    // @ts-expect-error: no such facet (typos shouldn't pass silently)
    const b: TypstreamPlugin = { key: "x", heel: {} };
    expect([a, b]).toHaveLength(2);
  });
});
