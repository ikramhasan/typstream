// Streaming into a range of a finished document (PLAN §5.2): an edit such as a
// model rewriting one section. Through the real client, server and engine-wasm.
import type { Artifact, CompileResult, CompileTarget } from "@typstream/core";
import { synthesizeStream } from "@typstream/corpus";
import { blockStarts } from "@typstream/heal";
import { describe, expect, it } from "vitest";
import type { DocumentState, EngineDocument } from "../src/document";
import { createEngine, type Engine } from "../src/engine";
import { inProcess } from "../src/server/serve";
import { FIVE_PAGES } from "./support/documents";
import { nodeEngineWasm } from "./support/engine-wasm";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const until = (doc: EngineDocument, done: (s: DocumentState) => boolean): Promise<DocumentState> =>
  new Promise((resolve) => {
    const check = (s: DocumentState) => {
      if (!done(s)) return;
      stop();
      resolve(s);
    };
    const stop = doc.subscribe(check);
    check(doc.getState());
  });

const finished = (doc: EngineDocument) => until(doc, (s) => s.status === "done" || s.status === "error");

/** What a reader sees: pages without their hashes, which include source spans. */
const visible = (a: Artifact | null) =>
  a?.target === "paged" ? { ...a, pages: a.pages.map(({ hash: _, ...page }) => page) } : a;

const oneShot = async (engine: Engine, text: string, target: CompileTarget) => {
  const doc = engine.open({ text, target });
  doc.finish();
  const s = await finished(doc);
  doc.dispose();
  return visible(s.artifact);
};

/** Section `n` of FIVE_PAGES: from its heading to the end of its text, before the blank line after it. */
const section = (n: number) => {
  const from = FIVE_PAGES.indexOf(`== Section ${n}:`);
  const to = FIVE_PAGES.indexOf(`\n\n== Section ${n + 1}:`);
  return { from, to };
};

describe("streaming into a range of a finished document", { timeout: 120_000 }, () => {
  it("a regenerated answer that starts like the old one shows at once, not the old one until it catches up", async () => {
    const engine = createEngine({ spawn: inProcess(nodeEngineWasm), spare: false });
    const doc = engine.open({
      text: "= Title\n\nThe old answer, long enough to be more than the new one.",
      target: "html",
    });
    doc.finish();
    await finished(doc);
    // Past the settled heading, the new text is shorter than the old: level 1 would keep the old one.
    doc.reset("= Title\n\nA new");
    const s = await until(doc, (s) => s.lastCompile !== null && s.status === "idle");
    const html = s.artifact?.target === "html" ? s.artifact.html : "";
    expect(html).toContain("A new");
    expect(html).not.toContain("old answer");
    engine.dispose();
  });

  it("is block-aligned in the test document", () => {
    const { from, to } = section(5);
    const starts = blockStarts(FIVE_PAGES);
    expect(starts).toContain(from);
    expect(starts).toContain(to + 2);
  });

  it.each([
    "html",
    "paged",
  ] as const)("%s: a section written back token by token: no error frames, the rest shown throughout, the result as compiled at once", async (target) => {
    const engine = createEngine({ spawn: inProcess(nodeEngineWasm), spare: false });
    const expected = await oneShot(engine, FIVE_PAGES, target);
    const doc = engine.open({ text: FIVE_PAGES, target });
    doc.finish();
    expect((await finished(doc)).status).toBe("done");

    const { from, to } = section(5);
    const tokens = synthesizeStream(FIVE_PAGES.slice(from, to), { seed: 5 }).map((c) => c.text);
    const frames: { compile: CompileResult; errors: number; artifact: Artifact | null }[] = [];
    let last: CompileResult | null = null;
    doc.subscribe((s) => {
      if (!s.lastCompile || s.lastCompile === last) return;
      last = s.lastCompile;
      frames.push({
        compile: s.lastCompile,
        errors: s.diagnostics.filter((d) => d.severity === "error").length,
        artifact: s.artifact,
      });
    });

    doc.setStreamingRange({ from, to });
    doc.applyEdit({ from, to, insert: "" });
    let at = from;
    for (const [i, token] of tokens.entries()) {
      doc.applyEdit({ from: at, to: at, insert: token });
      at += token.length;
      // About 400 tokens a second, as a fast model streams.
      if (i % 4 === 3) await sleep(10);
    }
    expect(doc.getState().streamingRange).toEqual({ from, to });
    expect(doc.getState().heal.source).toBe(FIVE_PAGES);
    doc.finish();
    const done = await finished(doc);

    expect(frames.length).toBeGreaterThan(5);
    expect(frames.filter((f) => f.compile.status !== "ok" || f.errors > 0)).toEqual([]);
    if (target === "html") {
      // Every render shows the sections around the one being written.
      for (const f of frames) {
        const html = f.artifact?.target === "html" ? f.artifact.html : "";
        expect(html).toContain("Section 4: roots");
        expect(html).toContain("Section 11: roots");
      }
    }
    expect(done.status).toBe("done");
    expect(visible(done.artifact)).toEqual(expected);
    engine.dispose();
  });
});
