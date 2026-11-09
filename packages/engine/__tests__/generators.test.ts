// File generators (PLAN §8.2): plugins' code that writes files from a document's source before each compile. The
// diffing alone, then through `createEngine` and the server: a document's generator modules, its files following
// its text, the server's own generators, and a server that runs no client modules.
import { definePlugin, type FileGenerator, type HtmlArtifact } from "@typstream/core";
import { describe, expect, it } from "vitest";
import type { DocumentState, EngineDocument } from "../src/document";
import { createEngine, type EngineEvent } from "../src/engine";
import { DocumentGenerators, generatorsOf } from "../src/server/generators";
import { inProcess } from "../src/server/serve";
import { nodeEngineWasm } from "./support/engine-wasm";

const moduleUrl = (code: string) => `data:text/javascript,${encodeURIComponent(code)}`;

/** `/acme/count.typ`: how many times the source says "word", and the compile's mode. */
const COUNT = `{
  name: "acme/count",
  open: () => ({
    files: (source, { mode }) => ({
      "acme/count.typ": "#let count = " + (source.match(/\\bword\\b/g) ?? []).length + "\\n#let mode = \\"" + mode + "\\"",
    }),
  }),
}`;

const counting = definePlugin({
  key: "acme/count",
  engine: {
    generatorModules: [moduleUrl(`export default ${COUNT};`)],
    preamble: '#import "/acme/count.typ": count, mode',
  },
});

const done = (doc: EngineDocument) =>
  new Promise<DocumentState>((resolve) => {
    const check = (s: DocumentState) => (s.status === "done" || s.status === "error") && resolve(s);
    doc.subscribe(check);
    check(doc.getState());
  });

const html = (s: DocumentState) => (s.artifact as HtmlArtifact | null)?.html ?? "";

describe("DocumentGenerators", () => {
  const logs: string[] = [];
  const log = (level: string, message: string) => logs.push(`${level}: ${message}`);

  it("returns what changed since the last run, null for files no longer provided", async () => {
    let files: Record<string, string> = { a: "1", b: "2" };
    const g = new DocumentGenerators([{ name: "g", open: () => ({ files: () => files }) }], log);
    expect(await g.run("", "streaming")).toEqual({ a: "1", b: "2" });
    expect(await g.run("", "streaming")).toBeNull();
    files = { a: "1", b: "3" };
    expect(await g.run("", "streaming")).toEqual({ b: "3" });
    files = { b: "3" };
    expect(await g.run("", "streaming")).toEqual({ a: null });
  });

  it("keeps a generator's files when it throws, and logs it", async () => {
    let fail = false;
    const g = new DocumentGenerators(
      [
        {
          name: "flaky",
          open: () => ({
            files: () => {
              if (fail) throw new Error("bug");
              return { a: "1" };
            },
          }),
        },
      ],
      log,
    );
    expect(await g.run("", "final")).toEqual({ a: "1" });
    fail = true;
    expect(await g.run("", "final")).toBeNull();
    expect(logs).toEqual(["error: file generator flaky: bug"]);
  });

  it("checks a module's default export", () => {
    const g: FileGenerator = { name: "g", open: () => ({ files: () => ({}) }) };
    expect(generatorsOf([g], "m")).toEqual([g]);
    expect(() => generatorsOf({ name: "x" }, "m")).toThrow(/m: the default export must be a file generator/);
  });
});

describe("file generators in the engine", { timeout: 30_000 }, () => {
  it("writes a document's generated files before each compile, in its mode, for that document only", async () => {
    const engine = createEngine({ spawn: inProcess(nodeEngineWasm), spare: false });
    const doc = engine.open({ plugins: [counting], text: "word word: #count (#mode)", fallback: false });
    const other = engine.open({ text: '#import "/acme/count.typ": count\n#count', fallback: false });
    doc.finish();
    other.finish();
    const [a, b] = await Promise.all([done(doc), done(other)]);
    expect(html(a)).toContain("word word: 2 (final)");
    expect(b.status).toBe("error");
    engine.dispose();
  });

  it("follows the text as it streams", async () => {
    const engine = createEngine({ spawn: inProcess(nodeEngineWasm), spare: false });
    const doc = engine.open({ plugins: [counting], text: "#count word", fallback: false });
    await new Promise<void>((resolve) => {
      doc.subscribe((s) => html(s).includes(">1 word<") && resolve());
    });
    doc.push(" word");
    doc.finish();
    expect(html(await done(doc))).toContain("2 word word");
    engine.dispose();
  });

  it("runs the server's own generators, and ignores the client's modules when it doesn't trust it", async () => {
    const logs: EngineEvent[] = [];
    const own = (await import(moduleUrl(`export default ${COUNT};`))).default as FileGenerator;
    const engine = createEngine({
      spawn: inProcess(nodeEngineWasm, { generators: [own], clientFixers: false }),
      spare: false,
    });
    engine.onEvent((e) => e.type === "log" && logs.push(e));
    const doc = engine.open({ plugins: [counting], text: "word: #count", fallback: false });
    doc.finish();
    expect(html(await done(doc))).toContain("word: 1");
    expect(logs).toEqual([
      expect.objectContaining({ level: "warn", message: "ignored the client's file generator modules" }),
    ]);
    engine.dispose();
  });

  it("compiles without a module that doesn't load, and logs why", async () => {
    const logs: string[] = [];
    const engine = createEngine({ spawn: inProcess(nodeEngineWasm), spare: false });
    engine.onEvent((e) => e.type === "log" && logs.push(`${e.level}: ${e.message}`));
    const broken = definePlugin({
      key: "acme/broken",
      engine: { generatorModules: [moduleUrl("export default 42;")] },
    });
    const doc = engine.open({ plugins: [broken], text: "= Fine" });
    doc.finish();
    expect(html(await done(doc))).toContain("Fine");
    expect(logs).toEqual([expect.stringMatching(/^error: .*file generator/)]);
    engine.dispose();
  });
});
