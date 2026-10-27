// Layer 4 in the worker (PLAN §5.6): block isolation, the stable prefix and
// skipped ranges, through the protocol server and engine-wasm. Compiles are
// counted by kind: checks of prefixes, and compiles for an artifact.

import {
  type CompileParams,
  type Diagnostic,
  type HtmlArtifact,
  type PagedArtifact,
  PROTOCOL_VERSION,
} from "@typstream/core";
import { afterEach, describe, expect, it } from "vitest";
import { applyPaged } from "../src/paged";
import type { EngineAdapter } from "../src/server/adapter";
import { blockStarts } from "../src/server/anchors";
import { SKIP_MESSAGES } from "../src/server/fallback";
import { inProcess } from "../src/server/serve";
import type { ServerOptions } from "../src/server/server";
import { codeOf, TestClient } from "./conformance";
import { nodeEngineWasm } from "./support/engine-wasm";

/** engine-wasm, counting compiles for an artifact and checks. */
const counted = () => {
  const counter = { compiles: 0, checks: 0 };
  const adapter = (): EngineAdapter => {
    const inner = nodeEngineWasm();
    return {
      ...inner,
      init: (o) => inner.init(o),
      open() {
        const doc = inner.open();
        return {
          ...doc,
          compileHtml(o) {
            counter.compiles++;
            return doc.compileHtml(o);
          },
          compilePaged(o) {
            counter.compiles++;
            return doc.compilePaged(o);
          },
          check(o) {
            counter.checks++;
            return doc.check?.(o) ?? { diagnostics: [] };
          },
        };
      },
    };
  };
  return { counter, adapter };
};

const clients: TestClient[] = [];
afterEach(() => {
  for (const c of clients.splice(0)) c.close();
});

const serverWith = async (options: ServerOptions = {}) => {
  const { counter, adapter } = counted();
  const c = new TestClient(inProcess(adapter, options));
  clients.push(c);
  await c.request("initialize", { protocolVersion: PROTOCOL_VERSION, capabilities: { pagedDiff: true } });
  let n = 0;
  /** Opens `text` as a new document and compiles it with the fallback (final mode unless `params` say otherwise). */
  const compile = async (text: string, params: Partial<CompileParams> = {}) => {
    const uri = `d${n++}`;
    await c.request("document/open", { uri, rev: 1, text });
    counter.compiles = 0;
    counter.checks = 0;
    const out = await c.compile({
      uri,
      rev: 1,
      target: "html",
      anchors: false,
      mode: "final",
      fallback: { isolate: true },
      ...params,
    });
    return {
      ...out,
      uri,
      compiles: counter.compiles,
      checks: counter.checks,
      html: (out.artifact as HtmlArtifact | null)?.html ?? "",
    };
  };
  return { client: c, counter, compile };
};

const at = (text: string, d: Diagnostic) => (d.span ? text.slice(d.span.from, d.span.to) : null);
/** The source error blocks show, in order. */
const errorBlocks = (html: string) =>
  [...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/g)].map((m) => (m[1] as string).replaceAll("&quot;", '"'));
/** Block `i` of `text`, as `fallback.isolated` reports it. */
const block = (text: string, i: number) => {
  const starts = blockStarts(text);
  return { from: starts[i] as number, to: starts[i + 1] ?? text.length };
};

/** Eight paragraphs; `bad` replaces some of them. */
const paragraphs = (bad: Record<number, string> = {}) =>
  Array.from({ length: 8 }, (_, i) => bad[i] ?? `Paragraph ${i}.`).join("\n\n");

describe("block isolation", { timeout: 30_000 }, () => {
  it("isolates the failing block in ⌈log₂ n⌉ checks and one compile", async () => {
    const { compile } = await serverWith();
    const text = paragraphs({ 5: "Five is #nope here." });
    const out = await compile(text);
    expect(out.result.status).toBe("ok");
    // The first compile, then the whole text with block 5 isolated.
    expect([out.checks, out.compiles]).toEqual([Math.ceil(Math.log2(8)), 2]);
    expect(out.result.fallback).toEqual({ level: 3, isolated: [block(text, 5)], plainFrom: null });
    expect(out.html).toContain("Paragraph 4.");
    expect(out.html).toContain("Paragraph 6.");
    expect(out.html).toContain("This part couldn’t be displayed.");
    expect(out.html).toContain("unknown variable: nope");
    expect(errorBlocks(out.html)).toEqual(["Five is #nope here."]);
    expect(out.diagnostics.map((d) => [d.severity, d.message, at(text, d)])).toEqual([
      ["error", "unknown variable: nope", "nope"],
    ]);
  });

  it("finds every failing block, each in at most ⌈log₂ n⌉ checks", async () => {
    const { compile } = await serverWith();
    const text = paragraphs({ 1: "#nope", 6: '#text(size: "big")[x]' });
    const out = await compile(text);
    expect(out.result.status).toBe("ok");
    expect(out.result.fallback?.isolated).toEqual([block(text, 1), block(text, 6)]);
    expect(out.checks).toBeLessThanOrEqual(2 * Math.ceil(Math.log2(8)));
    expect(out.compiles).toBe(3);
    expect(errorBlocks(out.html)).toEqual(["#nope", '#text(size: "big")[x]']);
    expect(out.html).toContain("Paragraph 7.");
  });

  it("blames the block that calls a function, not the one that defines it", async () => {
    const { compile } = await serverWith();
    const text = paragraphs({ 1: "#let shout(x) = upper(x).nope", 5: '#shout("hi")' });
    const out = await compile(text);
    expect(out.result.fallback?.isolated).toEqual([block(text, 5)]);
  });

  it("isolates what uses an isolated block's definitions too", async () => {
    const { compile } = await serverWith();
    const text = paragraphs({ 1: "#let total = nope + 1", 4: "Total: #total" });
    const out = await compile(text);
    expect(out.result.status).toBe("ok");
    expect(out.result.fallback?.isolated).toEqual([block(text, 1), block(text, 4)]);
    expect(out.diagnostics.map((d) => d.message)).toEqual(["unknown variable: nope", "unknown variable: total"]);
  });

  it("isolates blocks with syntax errors without checking prefixes", async () => {
    const { compile } = await serverWith();
    // A cut-off final document: heal leaves it unclosed in final mode (PLAN §5.7).
    const text = "= Quiz\n\n#let = 1\n\nGood.\n\n#q(1)[What is the unit of";
    const out = await compile(text);
    expect(out.result.status).toBe("ok");
    expect([out.checks, out.compiles]).toEqual([0, 2]);
    expect(out.result.fallback?.isolated).toEqual([block(text, 1), block(text, 3)]);
    expect(out.html).toContain("Good.");
    expect(out.diagnostics.map((d) => d.message)).toEqual(["expected pattern", "unclosed delimiter"]);
  });

  it("doesn't blame a prefix for citing a label that comes later", async () => {
    const { compile } = await serverWith();
    const text = '#set heading(numbering: "1.")\n\nSee @later.\n\n#nope\n\nMore.\n\n= Later <later>\n';
    const out = await compile(text);
    expect(out.result.fallback?.isolated).toEqual([block(text, 2)]);
    expect(out.html).not.toContain("typstream-pending-ref");
  });

  it("reports the fixes of the compile it publishes, around isolated blocks", async () => {
    const { compile } = await serverWith();
    const text = "See @nowhere.\n\n#nope\n\nMore.\n";
    const out = await compile(text);
    expect(out.result.fallback).toEqual({ level: 3, isolated: [block(text, 1)], plainFrom: null });
    expect(out.result.fixes).toEqual([
      { fixer: "pending-ref", message: "label `<nowhere>` does not exist in the document" },
    ]);
  });

  it("shows the whole document as source when nothing else compiles", async () => {
    const { compile } = await serverWith();
    // A reference built at runtime: no prefix can be blamed and no fixer sees it.
    const text = '#let k = "x"\n\nSee #ref(label(k)).';
    const out = await compile(text);
    expect(out.result.status).toBe("ok");
    expect(out.result.fallback).toEqual({ level: 4, isolated: [{ from: 0, to: text.length }], plainFrom: null });
    expect(errorBlocks(out.html)).toEqual([text]);
    expect(out.diagnostics.map((d) => d.message)).toEqual(["label `<x>` does not exist in the document"]);
  });

  it("is off without `fallback`, as for any client that doesn't ask", async () => {
    const { compile } = await serverWith();
    const out = await compile(paragraphs({ 3: "#nope" }), { fallback: undefined });
    expect([out.result.status, out.result.fallback, out.compiles, out.checks]).toEqual(["error", undefined, 1, 0]);
  });

  it("draws error blocks in paged output, and keeps the changed-page baseline", async () => {
    const { client, compile } = await serverWith();
    const good = paragraphs();
    const bad = paragraphs({ 2: "#nope" });
    const first = await compile(good, { target: "paged", mode: "streaming" });
    let pages = first.artifact as PagedArtifact;
    let rev = 1;
    let length = good.length;
    for (const text of [bad, good, bad]) {
      rev++;
      await client.request("document/edit", { uri: first.uri, rev, edits: [{ from: 0, to: length, insert: text }] });
      length = text.length;
      const out = await client.compile({ uri: first.uri, rev, target: "paged", fallback: { isolate: true } });
      expect(out.result.status).toBe("ok");
      pages = applyPaged(pages, rev - 1, out.artifact as PagedArtifact) as PagedArtifact;
      expect(pages).not.toBeNull();
    }
    const fresh = await client.compile({
      uri: first.uri,
      rev,
      target: "paged",
      fullPages: true,
      fallback: { isolate: true },
    });
    expect(pages.pages.map((p) => p.svg)).toEqual((fresh.artifact as PagedArtifact).pages.map((p) => p.svg));
    // The error block: a dashed frame.
    expect(pages.pages.some((p) => p.svg.includes("stroke-dasharray"))).toBe(true);
  });
});

describe("streaming", { timeout: 30_000 }, () => {
  it("isolates settled blocks and leaves the one being written to the fixers", async () => {
    const { compile } = await serverWith();
    const text = "Intro.\n\n#nope\n\nWriting #text()";
    const out = await compile(text, { mode: "streaming", settled: text.indexOf("Writing") });
    expect(out.result.status).toBe("ok");
    expect(out.result.fallback?.isolated).toEqual([block(text, 1)]);
    expect(out.html).toContain("Writing");
    expect(out.diagnostics.map((d) => [d.severity, d.source, d.message])).toEqual([
      ["info", "tail-cut", "missing argument: body"],
      ["error", "typst", "unknown variable: nope"],
    ]);
  });

  it("remembers isolated blocks of the settled text for the next revision", async () => {
    const { client, counter, compile } = await serverWith();
    const text = paragraphs({ 2: "#nope" });
    const first = await compile(text, { mode: "streaming", settled: text.length });
    expect(first.result.fallback?.isolated).toEqual([block(text, 2)]);
    const more = "\n\nAnd more.";
    await client.request("document/edit", {
      uri: first.uri,
      rev: 2,
      edits: [{ from: text.length, to: text.length, insert: more }],
    });
    counter.compiles = 0;
    counter.checks = 0;
    const out = await client.compile({
      uri: first.uri,
      rev: 2,
      target: "html",
      anchors: false,
      settled: text.length + more.length,
      fallback: { isolate: true },
    });
    expect(out.result.fallback?.isolated).toEqual([block(text, 2)]);
    expect(out.diagnostics.map((d) => d.message)).toEqual(["unknown variable: nope"]);
    // The first compile, then the text with block 2 isolated straight away.
    expect([counter.checks, counter.compiles]).toEqual([0, 2]);
  });

  it("shows the tail as plain text below the settled text when asked (stable prefix)", async () => {
    const { compile } = await serverWith({ fixers: [] });
    const text = "Done.\n\nNow #text()\nand more";
    const settled = text.indexOf("Now");
    const kept = await compile(text, { mode: "streaming", settled });
    expect(kept.result.status).toBe("error");
    const out = await compile(text, { mode: "streaming", settled, fallback: { isolate: true, stablePrefix: true } });
    expect(out.result.status).toBe("ok");
    expect(out.result.fallback).toEqual({ level: 2, isolated: [], plainFrom: settled });
    expect(out.html).toContain("Done.");
    expect(out.html).toContain(
      '<div class="typstream-pending-text" style="opacity: 0.55; white-space: pre-wrap">Now #text()<br>and more</div>',
    );
    expect(out.diagnostics).toEqual([
      expect.objectContaining({ severity: "info", source: "stable-prefix", message: "missing argument: body" }),
    ]);
  });

  it("doesn't use the stable prefix in final mode", async () => {
    const { compile } = await serverWith({ fixers: [] });
    const out = await compile("Done.\n\n#text()", { fallback: { stablePrefix: true } });
    expect(out.result.status).toBe("error");
  });
});

describe("skipped ranges", { timeout: 30_000 }, () => {
  it("shows what the client found hangs as an error block, without compiling it", async () => {
    const { compile } = await serverWith();
    const text = paragraphs({ 3: "#for i in range(100000000) {}" });
    const skip = { ...block(text, 3), reason: "timeout" as const };
    const out = await compile(text, { fallback: { isolate: true, skip: [skip] } });
    expect(out.result.status).toBe("ok");
    expect([out.compiles, out.checks]).toEqual([1, 0]);
    expect(out.result.fallback?.isolated).toEqual([block(text, 3)]);
    expect(out.html).toContain(SKIP_MESSAGES.timeout);
    expect(out.diagnostics).toEqual([
      expect.objectContaining({ severity: "error", code: "timeout", source: "typstream", span: block(text, 3) }),
    ]);
  });

  it("rejects ranges outside the text or out of order", async () => {
    const { compile } = await serverWith();
    for (const skip of [
      [{ from: 0, to: 99, reason: "timeout" }],
      [
        { from: 4, to: 6, reason: "crash" },
        { from: 0, to: 2, reason: "crash" },
      ],
      [{ from: 0, to: 2, reason: "boom" }],
    ]) {
      const out = compile("Some text.", { fallback: { skip } as never });
      expect(await codeOf(out)).toBe("invalid-params");
    }
  });
});
