import type { Diagnostic } from "@typstream/core";
import { afterAll, describe, expect, it } from "vitest";
import { createEngine, type FixRequest, fixLoop, formatDiagnosticsForLLM, validate } from "../src";

const engine = createEngine({ workers: 2 });
afterAll(() => engine.close());

const diag = (from: number, to: number, message: string, extra: Partial<Diagnostic> = {}): Diagnostic => ({
  severity: "error",
  span: { from, to },
  message,
  hints: [],
  trace: [],
  source: "typst",
  ...extra,
});

describe("formatDiagnosticsForLLM", () => {
  it("prints each problem like the Typst CLI: message, location, underlined line, hints", async () => {
    const source = "= Quiz\nThe answer is #answr.\nMore text.";
    const { diagnostics } = await validate(source, { engine });
    expect(formatDiagnosticsForLLM(source, diagnostics)).toBe(
      [
        "The Typst document has 1 error.",
        "",
        "error: unknown variable: answr",
        " --> line 2, column 16",
        "  |",
        "1 | = Quiz",
        "2 | The answer is #answr.",
        "  |                ^^^^^",
        "3 | More text.",
        "",
        "Fix every error, and the warnings where they point at a real mistake. Reply with the complete corrected Typst document only.",
      ].join("\n"),
    );
  });

  it("puts errors first, labels lint findings with their rule, and shows hints and the call chain", async () => {
    const source = 'Some **bold**.\n#let f(x) = x + 1\n#f("a")';
    const { diagnostics } = await validate(source, { engine });
    const text = formatDiagnosticsForLLM(source, diagnostics, { contextLines: 0, instructions: "" });
    expect(text.split("\n")[0]).toBe("The Typst document has 1 error and 3 warnings.");
    const firstError = text.indexOf("\nerror: ");
    expect(firstError).toBeGreaterThan(0);
    expect(firstError).toBeLessThan(text.indexOf("\nwarning"));
    expect(text).toContain("error: cannot add string and integer");
    expect(text).toContain("  = note: while calling `f` (line 3)");
    expect(text).toContain("warning[markdown-bold]: Markdown `**`; Typst uses single `*`");
    expect(text).toContain("= hint: replace `**bold**` with `*bold*`");
    expect(text.endsWith("\n")).toBe(false);
  });

  it("caps the number of diagnostics and can leave warnings out", () => {
    const source = "a b c d e";
    const ds = [0, 2, 4, 6, 8].map((i) => diag(i, i + 1, `problem ${i}`));
    const capped = formatDiagnosticsForLLM(source, ds, { maxDiagnostics: 2, instructions: "" });
    expect(capped.match(/^error:/gm)).toHaveLength(2);
    expect(capped).toContain("(3 more problems not shown)");

    const mixed = [diag(0, 1, "bad"), diag(2, 3, "meh", { severity: "warning" })];
    const errorsOnly = formatDiagnosticsForLLM(source, mixed, { includeWarnings: false, instructions: "" });
    expect(errorsOnly).not.toContain("meh");
    expect(errorsOnly.split("\n")[0]).toBe("The Typst document has 1 error.");
  });

  it("clips very long lines around the problem", () => {
    const source = `${"x".repeat(5000)}#oops${"y".repeat(5000)}`;
    const text = formatDiagnosticsForLLM(source, [diag(5000, 5005, "unknown variable: oops")], { instructions: "" });
    const [line, carets] = text.split("\n").slice(5, 7);
    expect(line?.length).toBeLessThan(180);
    expect(line).toMatch(/^1 \| …x+#oopsy+…$/);
    // The carets still sit under `#oops`.
    expect(carets?.indexOf("^")).toBe(line?.indexOf("#oops"));
    expect(carets).toMatch(/^ {2}\| +\^{5}$/);
  });

  it("marks spans that continue over several lines, and diagnostics without a position", () => {
    const source = "#box[\nlong\n]";
    const text = formatDiagnosticsForLLM(
      source,
      [diag(0, source.length, "too big"), { ...diag(0, 0, "no font"), span: null, hints: ["install one"] }],
      {
        contextLines: 0,
        instructions: "",
      },
    );
    expect(text).toContain("  | ^^^^^ (continues to line 3)");
    expect(text).toContain("error: no font\n  = hint: install one");
  });

  it("points at the call site for problems in other files", () => {
    const source = "#template[x]";
    const d = diag(1, 9, "unknown variable: y", { file: { path: "/preamble.typ", span: { from: 3, to: 4 } } });
    expect(formatDiagnosticsForLLM(source, [d])).toContain(
      " --> line 1, column 2 (called from here; the problem is in /preamble.typ)",
    );
  });

  it("says so when there is nothing to fix", () => {
    expect(formatDiagnosticsForLLM("ok", [])).toBe("The Typst document compiles without problems.");
  });
});

describe("fixLoop", () => {
  const broken = "= Worksheet\n#table(columns: 2, [a], [b]\n";
  const fixed = "= Worksheet\n#table(columns: 2, [a], [b])\n";

  it("returns a valid document without asking the model", async () => {
    const calls: FixRequest[] = [];
    const r = await fixLoop({
      source: fixed,
      engine,
      generate: (req) => {
        calls.push(req);
        return "";
      },
    });
    expect(r).toMatchObject({ ok: true, source: fixed, diagnostics: [] });
    expect(calls).toEqual([]);
    expect(r.attempts).toHaveLength(1);
  });

  it("asks the model with the formatted prompt and accepts a fenced reply", async () => {
    const calls: FixRequest[] = [];
    const r = await fixLoop({
      source: broken,
      engine,
      generate: (req) => {
        calls.push(req);
        return `\`\`\`typst\n${fixed}\n\`\`\``;
      },
    });
    expect(r).toMatchObject({ ok: true, source: fixed });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ source: broken, round: 1 });
    expect(calls[0]?.prompt).toBe(formatDiagnosticsForLLM(broken, calls[0]?.diagnostics ?? []));
    expect(r.attempts.map((a) => a.ok)).toEqual([false, true]);
  });

  it("gives up after maxRounds and keeps the best attempt, not the last", async () => {
    // Typst stops evaluating at the first runtime error, so counts stay small.
    const replies = [
      "#table(columns: 2, [a], [b]\n#nope", // 2 errors: worse than the original's 1
      "#table(columns: 2, [a], [b])\n#nope", // 1 error: ties with the original, and is later
      "#table(columns: 2, [a], [b]\n#nope", // 2 errors again
    ];
    let round = 0;
    const r = await fixLoop({ source: broken, engine, maxRounds: 3, generate: () => replies[round++] ?? "" });
    expect(round).toBe(3);
    expect(r.ok).toBe(false);
    expect(r.attempts).toHaveLength(4);
    expect(r.source).toBe(replies[1]);
    expect(r.diagnostics.map((d) => d.message)).toEqual(["unknown variable: nope"]);
  });

  it("with strict, also repairs documents that only have lint warnings", async () => {
    const source = "Some **bold** text.";
    const lenient = await fixLoop({ source, engine, generate: () => "unused" });
    expect(lenient.ok).toBe(true);
    expect(lenient.attempts).toHaveLength(1);

    const strict = await fixLoop({ source, engine, strict: true, generate: () => "Some *bold* text." });
    expect(strict).toMatchObject({ ok: true, source: "Some *bold* text.", diagnostics: [] });
  });
});
