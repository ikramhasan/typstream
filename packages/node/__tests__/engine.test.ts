// The worker pool behind every compile: lazy workers, the watchdog, crash
// recovery, file caching, concurrency.

import { describe, expect, it } from "vitest";
import { createEngine, render, validate } from "../src";

// 400 million iterations over small ranges: pure CPU, nothing for wasm's memory cap to catch.
// (A single `range(400000000)` would allocate 400M values and trap first.)
const RUNAWAY = "#let n = 0\n#for a in range(20000) { for b in range(20000) { n += 1 } }\n#n";

describe("engine", () => {
  it("starts workers on demand and stops them on close", async () => {
    const engine = createEngine({ workers: 2 });
    expect(engine.workers).toBe(0);
    await validate("x", { engine });
    expect(engine.workers).toBe(1);
    await Promise.all([validate("a", { engine }), validate("b", { engine }), validate("c", { engine })]);
    expect(engine.workers).toBe(2);
    await engine.close();
    expect(engine.workers).toBe(0);
    await expect(validate("x", { engine })).rejects.toThrow(/closed/);
  });

  it("stops a runaway compile with the watchdog, reports it, and replaces the worker", async () => {
    const engine = createEngine({ workers: 1, timeoutMs: 1_000 });
    const t0 = performance.now();
    const r = await validate(RUNAWAY, { engine, lint: false });
    expect(performance.now() - t0).toBeLessThan(5_000);
    expect(r.ok).toBe(false);
    expect(r.diagnostics).toMatchObject([{ severity: "error", code: "timeout", source: "typstream", span: null }]);
    expect(r.diagnostics[0]?.message).toBe("compiling took longer than 1000 ms and was stopped");
    // The next compile gets a fresh worker.
    expect(await validate("= Fine", { engine })).toMatchObject({ ok: true, pageCount: 1 });
    await engine.close();
  });

  it("lets a per-call budget override the engine's", async () => {
    const engine = createEngine({ workers: 1, timeoutMs: 60_000 });
    const r = await validate(RUNAWAY, { engine, lint: false, timeoutMs: 500 });
    expect(r.diagnostics[0]?.message).toBe("compiling took longer than 500 ms and was stopped");
    await engine.close();
  });

  it("reports a memory bomb as an engine crash and recovers", async () => {
    const engine = createEngine({ workers: 1, timeoutMs: 60_000 });
    // Doubling an array until allocation fails at wasm32's limit: a trap, not a hang.
    const bomb = "#let a = (0,)\n#for i in range(64) { a = a + a }\n#a.len()";
    const r = await validate(bomb, { engine, lint: false });
    expect(r.diagnostics).toMatchObject([{ code: "engine-crashed", source: "typstream" }]);
    expect(await validate("= Fine", { engine })).toMatchObject({ ok: true });
    await engine.close();
  }, 60_000);

  it("compiles documents in parallel on several workers", async () => {
    const engine = createEngine({ workers: 3 });
    const docs = Array.from({ length: 9 }, (_, i) => `= Document ${i}\n${"Some text. ".repeat(200)}`);
    const results = await Promise.all(docs.map((d) => render(d, "html", { engine })));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.map((r) => r.ok && r.data.includes(`Document ${results.indexOf(r)}`))).toEqual(docs.map(() => true));
    expect(engine.workers).toBe(3);
    await engine.close();
  });

  it("sends files to workers again only when they change", async () => {
    const engine = createEngine({ workers: 1 });
    const text = '#read("note.txt")';
    const files = { "note.txt": new TextEncoder().encode("first") };
    expect(await render(text, "html", { engine, files })).toMatchObject({
      ok: true,
      data: expect.stringContaining("first"),
    });
    // Same bytes object: the worker reuses what it holds.
    expect(await render(text, "html", { engine, files })).toMatchObject({
      ok: true,
      data: expect.stringContaining("first"),
    });
    const changed = { "note.txt": new TextEncoder().encode("second") };
    expect(await render(text, "html", { engine, files: changed })).toMatchObject({
      data: expect.stringContaining("second"),
    });
    // A document without the file can't see it any more.
    const gone = await render(text, "html", { engine });
    expect(gone.ok).toBe(false);
    await engine.close();
  });

  it("has the script fonts browsers load lazily", async () => {
    const fontsIn = async (options: { scriptFonts?: boolean }) => {
      const engine = createEngine({ workers: 1, ...options });
      const r = await render("= প্রশ্ন\nআমি বাংলায় গান গাই। مرحبا", "pdf", { engine });
      await engine.close();
      if (!r.ok) throw new Error("compile failed");
      const embedded = new TextDecoder("latin1").decode(r.data).matchAll(/\/BaseFont\s*\/[A-Z]{6}\+(Noto[\w-]+)/g);
      return [...new Set([...embedded].map((m) => m[1]))].sort();
    };
    expect(await fontsIn({})).toEqual(["NotoNaskhArabic-Regular", "NotoSerifBengali-Bold", "NotoSerifBengali-Regular"]);
    expect(await fontsIn({ scriptFonts: false })).toEqual([]);
  });

  it("uses only the fonts it is given", async () => {
    const engine = createEngine({ workers: 1, typstFonts: false, scriptFonts: false });
    const r = await render("$x$", "pdf", { engine });
    expect(r).toMatchObject({ ok: false, diagnostics: [{ message: "no font could be found" }] });
    await engine.close();
  });
});
