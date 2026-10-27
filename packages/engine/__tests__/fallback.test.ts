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
import { blockStarts } from "@typstream/heal";
import { afterEach, describe, expect, it } from "vitest";
import { applyPaged } from "../src/paged";
import type { EngineAdapter } from "../src/server/adapter";
import { SKIP_MESSAGES, showsLess } from "../src/server/fallback";
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

describe("showsLess", () => {
  const same = (p: number) => p;

  it("is true when the tail lost more than closers, false when it only grew or closed differently", () => {
    expect(showsLess("A\n\nB *bold*", "A\n\nB", same, 3)).toBe(true);
    expect(showsLess("A\n\nB *bo*", "A\n\nB *bold*", same, 3)).toBe(false);
    expect(showsLess("A\n\n#box[x]", "A\n\n#box[x y]", same, 3)).toBe(false);
    // Before the settled offset the text changed: that shows.
    expect(showsLess("A long\n\nB", "A\n\nB", same, 9)).toBe(false);
  });

  it("compares what a streaming range wrote, not the settled text after it", () => {
    const after = "\n\n== Next section\n\nMore text.";
    // The range grew: everything after it is the same, so nothing is less.
    expect(showsLess(`A\n\nNew *wor*${after}`, `A\n\nNew *words*${after}`, same, 3)).toBe(false);
    // A cut in the range dropped text it had shown.
    expect(showsLess(`A\n\nNew words here${after}`, `A\n\nNew${after}`, same, 3)).toBe(true);
  });
});

describe("last good render (level 1, #65)", { timeout: 30_000 }, () => {
  const intro = '#let xs = ("Alpha", "Beta")\n\n';
  // A spread being typed: its closure returns pairs, an array of arrays, until `.flatten()` arrives.
  const rows = `${intro}#list(..xs.map(x => ([#x])))`;
  const pairs = `${intro}#list(..xs.map(x => ([#x], [#x.len()])))`;
  const flat = `${intro}#list(..xs.map(x => ([#x], [#x.len()])).flatten())`;

  /** A document streamed through `texts`, with the tail after `intro` unsettled and the client's fallback. */
  const streamed = async (params: Partial<CompileParams> = {}, options: ServerOptions = {}) => {
    const { client } = await serverWith(options);
    const uri = "s";
    let rev = 0;
    let text = "";
    const step = async (next: string, more: Partial<CompileParams> = {}) => {
      rev++;
      if (rev === 1) await client.request("document/open", { uri, rev, text: next });
      else await client.request("document/edit", { uri, rev, edits: [{ from: 0, to: text.length, insert: next }] });
      text = next;
      return client.compile({
        uri,
        rev,
        target: "html",
        anchors: false,
        settled: intro.length,
        fallback: { isolate: true },
        ...params,
        ...more,
      });
    };
    return { client, step };
  };
  const htmlOf = (out: { artifact: unknown }) => (out.artifact as HtmlArtifact | null)?.html ?? "";

  it("keeps the last artifact while a cut shows less of the tail than it did", async () => {
    const { step } = await streamed();
    expect(htmlOf(await step(rows))).toContain("Beta");
    // Tail cut drops the whole spread: the list would lose the items it showed.
    const cut = await step(pairs);
    expect(cut.result.status).toBe("error");
    expect(cut.artifact).toBeNull();
    expect(cut.diagnostics.map((d) => [d.severity, d.source, d.message])).toEqual([
      ["info", "tail-cut", "expected content, found array"],
    ]);
    const back = await step(flat);
    expect(back.result.status).toBe("ok");
    expect(htmlOf(back)).toContain("5");
  });

  it("keeps it while the client finds it stale, until that text is settled", async () => {
    const { step } = await streamed();
    await step(rows);
    const stale = await step(pairs, { fallback: { isolate: true, stablePrefix: true } });
    expect(stale.result.status).toBe("error");
    // Settled, the text can't be cut any more: what shows is what it renders.
    const settled = await step(`${pairs}\n\nNext.`, { settled: pairs.length + 2 });
    expect(settled.result.status).toBe("ok");
  });

  it("doesn't show a tail that rendered as plain text (the stable prefix), only one that never did", async () => {
    const { step } = await streamed({ fallback: { isolate: true, stablePrefix: true } }, { fixers: [] });
    await step(rows);
    expect((await step(pairs)).result.status).toBe("error");
    // The list is settled; the block being written never rendered.
    const next = `${flat}\n\nNow #text()`;
    const plain = await step(next, { settled: next.indexOf("Now") });
    expect(plain.result.fallback?.plainFrom).toBe(next.indexOf("Now"));
    expect(htmlOf(plain)).toContain("Now #text()");
  });

  it("keeps nothing for text that only grows, edits before the settled offset, final mode, or without the fallback", async () => {
    const grows = await streamed();
    await grows.step(`${intro}Writing *bold`);
    expect((await grows.step(`${intro}Writing *bold words*`)).result.status).toBe("ok");
    const edited = await streamed();
    await edited.step(rows);
    // The settled text changed: the tail shows less because the text does.
    const shorter = `#let xs = ("Alpha",)\n\n#list()`;
    expect((await edited.step(shorter, { settled: shorter.indexOf("#list") })).result.status).toBe("ok");
    const final = await streamed({ mode: "final" });
    await final.step(rows);
    expect((await final.step(`${intro}#list()`)).result.status).toBe("ok");
    const plain = await streamed({ fallback: undefined });
    await plain.step(rows);
    expect((await plain.step(pairs)).result.status).toBe("ok");
  });

  it("sends every page with the next paged artifact, since the client never got the one it kept", async () => {
    const { step } = await streamed({ target: "paged" });
    expect((await step(rows)).result.status).toBe("ok");
    expect((await step(pairs)).result.status).toBe("error");
    const back = await step(flat);
    expect((back.artifact as PagedArtifact).base).toBeNull();
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
