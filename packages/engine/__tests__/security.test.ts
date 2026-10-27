// The sandbox against hostile documents (PLAN §9, §11.7, #29): the corpus's
// hostile set compiled by the server on engine-wasm in process, in both
// targets. What the renderers make of the output, and the watchdog, are
// tested in browsers (tools/browser-suites, security.test.ts).

import { homedir } from "node:os";
import {
  type Artifact,
  type ClientMessage,
  type CompileTarget,
  type Diagnostic,
  type FileDelta,
  PROTOCOL_VERSION,
  type ServerMessage,
  type ServerNotification,
} from "@typstream/core";
import { type CorpusEntry, loadCorpus } from "@typstream/corpus";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server/server";
import { nodeEngineWasm } from "./support/engine-wasm";

const TARGETS: CompileTarget[] = ["html", "paged"];

/** A server on the calling thread; `fatal` collects what would end a worker. */
const start = async () => {
  const notes: ServerNotification[] = [];
  const fatal: unknown[] = [];
  const waiting = new Map<number, (m: ServerMessage) => void>();
  const server = createServer(
    nodeEngineWasm(),
    (m) => {
      if ("id" in m) waiting.get(m.id as number)?.(m);
      else notes.push(m as ServerNotification);
    },
    { onFatal: (e) => fatal.push(e) },
  );
  let id = 0;
  const request = (method: string, params: unknown) =>
    new Promise<ServerMessage | null>((resolve) => {
      const n = ++id;
      waiting.set(n, resolve);
      server.receive({ id: n, method, params } as ClientMessage);
      // A fatal error answers nothing.
      setTimeout(() => fatal.length && resolve(null), 50);
    });
  await request("initialize", { protocolVersion: PROTOCOL_VERSION, capabilities: {} });
  let docs = 0;
  return {
    fatal,
    async compile(text: string, target: CompileTarget, files?: FileDelta) {
      const uri = `doc-${++docs}`;
      const opened = await request("document/open", { uri, rev: 1, text, files });
      notes.length = 0;
      const response = await request("compile", { uri, rev: 1, target, mode: "final" });
      const mine = notes.filter((n) => n.method !== "$/log" && n.params.uri === uri);
      const diagnostics: Diagnostic[] = mine.flatMap((n) =>
        n.method === "document/diagnostics" ? n.params.diagnostics : [],
      );
      const artifact = mine.flatMap((n) => (n.method === "document/artifact" ? [n.params.artifact] : [])).at(-1);
      return { opened, response, errors: diagnostics.filter((d) => d.severity === "error"), diagnostics, artifact };
    },
  };
};

const text = (a: Artifact | undefined): string =>
  !a ? "" : a.target === "html" ? a.html : a.pages.map((p) => `${p.svg}${JSON.stringify(p.text)}`).join("");

const hostile = loadCorpus({ sets: ["adversarial"] }).filter((e) => e.name.startsWith("hostile-"));
const byName = (name: string): CorpusEntry => {
  const entry = hostile.find((e) => e.name === name);
  if (!entry) throw new Error(`no corpus entry adversarial/${name}`);
  return entry;
};

/** What the engine says instead of native typst's message, where it differs. */
const ENGINE_ERRORS: Record<string, string> = {
  "hostile-import-local": "package @local/secrets:1.0.0 is not allowed",
  "hostile-import-unlisted": "package @preview/typstream-hostile-not-a-package:0.0.1 is not allowed",
};

describe("sandbox", { timeout: 60_000 }, () => {
  // Reads, images, imports, plugins and XML outside what the app mounted fail inside Typst.
  const failing = hostile.filter((e) => e.meta.expect === "error");

  it("has hostile documents for every way out", () => {
    const categories = new Set(failing.map((e) => e.meta.category));
    expect([...categories].sort()).toEqual([
      "hostile-file-access",
      "hostile-memory",
      "hostile-package",
      "hostile-plugin",
      "hostile-runaway",
    ]);
  });

  for (const target of TARGETS) {
    it(`stops every hostile document with Typst's error (${target})`, async () => {
      const s = await start();
      for (const entry of failing) {
        const r = await s.compile(entry.source, target);
        const messages = r.errors.map((d) => d.message).join("\n");
        const expected = ENGINE_ERRORS[entry.name] ? [ENGINE_ERRORS[entry.name]] : (entry.meta.expectedErrors ?? []);
        for (const e of expected) expect.soft(messages, entry.name).toContain(e);
        expect.soft(r.artifact, entry.name).toBeUndefined();
      }
      expect(s.fatal).toEqual([]);
    });
  }

  it("never names a path outside the virtual file system", async () => {
    const s = await start();
    const host = [homedir(), process.cwd()];
    for (const entry of hostile.filter((e) => e.meta.category === "hostile-file-access")) {
      const r = await s.compile(entry.source, "html");
      const said = JSON.stringify(r.diagnostics);
      for (const path of host) expect.soft(said, entry.name).not.toContain(path);
    }
    const r = await s.compile(byName("hostile-read-absolute").source, "html");
    expect(r.errors[0]?.message).toBe("file not found (searched at /etc/passwd)");
  });

  it("keeps each document's files to itself", async () => {
    const s = await start();
    const owner = await s.compile('#read("answers.txt")', "html", { "answers.txt": "SECRET-ANSWERS" });
    expect(owner.errors).toEqual([]);
    expect(text(owner.artifact)).toContain("SECRET-ANSWERS");
    for (const target of TARGETS) {
      const other = await s.compile('#read("answers.txt") #read("/answers.txt")', target);
      expect(other.errors.map((d) => d.message)).toEqual(["file not found (searched at /answers.txt)"]);
      expect(text(other.artifact)).not.toContain("SECRET-ANSWERS");
    }
  });

  it("can't write the document or reach outside the root through its files", async () => {
    const s = await start();
    // A file path is the app's input, but it must not escape the project either.
    for (const path of ["../outside.typ", "/main.typ", "main.typ"]) {
      const r = await s.compile("x", "html", { [path]: "#panic()" });
      expect.soft(r.opened && "error" in r.opened && r.opened.error.code, path).toBe("invalid-params");
    }
  });

  it("is replaced, not reused, after content nested so deep that wasm overflows the stack", async () => {
    const s = await start();
    const r = await s.compile(byName("hostile-deep-content").source, "paged");
    // Answered with nothing: the worker would end here, and the client replace it.
    expect(r.response).toBeNull();
    expect(s.fatal).toHaveLength(1);
  });
});

describe("output", { timeout: 60_000 }, () => {
  // The engine passes `html.elem` through as Typst writes it: removing it is
  // the renderer's job (packages/dom's sanitizer), tested in browsers.
  it("compiles the hostile output documents in both targets", async () => {
    const s = await start();
    for (const entry of hostile.filter((e) => e.meta.category === "hostile-output")) {
      for (const target of TARGETS) {
        const r = await s.compile(entry.source, target);
        expect.soft(r.errors, `${entry.name} (${target})`).toEqual([]);
        expect.soft(r.artifact?.target, `${entry.name} (${target})`).toBe(target);
      }
    }
  });

  it("escapes markup in text and attribute values", async () => {
    const s = await start();
    const r = await s.compile(byName("hostile-markup-text").source, "html");
    const html = text(r.artifact);
    // Typst writes attribute values double-quoted, with `"` escaped: outside them, no markup.
    expect(html.replace(/"[^"]*"/g, '""')).not.toMatch(/<script|<img|<svg|<b /);
    expect(html).toContain("&lt;script>");
    // Inside a quoted attribute value, `<` is text.
    expect(html).toContain(`title="&quot;><script>window.typstreamPwned = 'attr'</script>"`);
  });
});
