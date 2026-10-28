import type { CompileParams, DocumentOpenParams, HtmlArtifact, PagedArtifact } from "@typstream/core";
import { heal } from "@typstream/heal";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type EngineEvents, fromWorker, type SpawnEngine, type WorkerLike } from "../src/connection";
import { type DocumentState, ExportError } from "../src/document";
import { createEngine, type EngineEvent, type EngineOptions } from "../src/engine";
import { compileInterval, DEFAULT_SCHEDULE, updateEma } from "../src/schedule";
import { type FakeOptions, FakeWorkers } from "./support/fake-worker";

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

const setup = (fake: FakeOptions = {}, options: Partial<EngineOptions> = {}) => {
  const workers = new FakeWorkers(fake);
  const engine = createEngine({ spawn: workers.spawn, ...options });
  const events: EngineEvent[] = [];
  engine.onEvent((e) => events.push(e));
  return { workers, engine, events };
};

const html = (s: DocumentState) => (s.artifact as HtmlArtifact | null)?.html;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("compiling", () => {
  it("heals on the main thread and compiles the healed source", async () => {
    const { workers, engine } = setup();
    const doc = engine.open();
    doc.push("Hello *bo");
    doc.push("ld");
    expect(doc.getState().status).toBe("compiling");
    await tick(100);
    const s = doc.getState();
    expect(s.status).toBe("idle");
    expect(html(s)).toBe("<p>Hello *bold*</p>");
    expect(s.heal.source).toBe("Hello *bold*");
    // Both chunks went into one compile.
    expect(workers.compileRequests()).toHaveLength(1);
    const open = workers.spawned[0]?.requests("document/open")[0]?.params as DocumentOpenParams;
    expect(open.text).toBe("Hello *bold*");
  });

  it("sends edits, not the whole text, once the document is open", async () => {
    const { workers, engine } = setup();
    const doc = engine.open({ text: "Hello" });
    await tick(100);
    doc.push(" world");
    await tick(100);
    const edits = workers.spawned[0]?.requests("document/edit") ?? [];
    expect(edits.map((r) => r.params)).toEqual([
      { uri: doc.uri, rev: 2, edits: [{ from: 5, to: 5, insert: " world" }] },
    ]);
    expect(html(doc.getState())).toBe("<p>Hello world</p>");
  });

  it("doesn't compile when healing leaves the source unchanged", async () => {
    const { workers, engine } = setup();
    const doc = engine.open({ text: "Hello\n" });
    await tick(100);
    expect(workers.compileRequests()).toHaveLength(1);
    // An incomplete statement is cut, so the healed source is the same.
    doc.push("#let x =");
    expect(doc.getState().heal.source).toBe("Hello\n");
    expect(doc.getState().status).toBe("idle");
    await tick(1000);
    expect(workers.compileRequests()).toHaveLength(1);
  });

  it("maps diagnostics back to input positions", async () => {
    const { engine } = setup();
    const doc = engine.open();
    // The fence is stripped, so the healed source starts 9 characters later.
    doc.push("```typst\nSee ERROR");
    await tick(100);
    const s = doc.getState();
    expect(s.heal.source).toBe("See ERROR");
    expect(s.diagnostics.map((d) => d.span)).toEqual([{ from: 13, to: 18 }]);
  });

  it("compiles the finished document in final mode", async () => {
    const { workers, engine } = setup();
    const doc = engine.open({ text: "Hello *bold" });
    await tick(100);
    doc.finish();
    expect(doc.getState().final).toBe(true);
    await tick(100);
    const last = workers.compileRequests().at(-1);
    expect(last?.mode).toBe("final");
    // No tail repair in final mode.
    expect(workers.alive[0]?.docs.get(doc.uri)?.text).toBe("Hello *bold");
    expect(doc.getState().status).toBe("done");
  });

  it("tells the worker which text is settled while streaming, for its fixers", async () => {
    const { workers, engine } = setup();
    const doc = engine.open();
    doc.push("Intro.\n\n#text(");
    await tick(100);
    const settled = workers.compileRequests().at(-1)?.settled;
    expect(settled).toBe(doc.getState().heal.stableOffset);
    expect(settled).toBe("Intro.\n\n".length);
    doc.finish();
    await tick(100);
    expect(workers.compileRequests().at(-1)?.settled).toBeUndefined();
  });

  it("passes target and inputs, and recompiles when they change", async () => {
    const { workers, engine } = setup();
    const doc = engine.open({ text: "Hi", inputs: { answers: "false" } });
    await tick(100);
    doc.setInputs({ answers: "false" });
    await tick(100);
    expect(workers.compileRequests()).toHaveLength(1);
    doc.setInputs({ answers: "true" });
    await tick(100);
    expect(workers.compileRequests().map((p) => p.inputs)).toEqual([{ answers: "false" }, { answers: "true" }]);
  });

  it("runs one compile at a time across documents", async () => {
    const { workers, engine } = setup({ compileMs: () => 40 });
    const a = engine.open();
    const b = engine.open();
    for (let i = 0; i < 20; i++) {
      a.push(`a${i} `);
      b.push(`b${i} `);
      await tick(15);
    }
    await tick(500);
    expect(workers.alive[0]?.maxRunning).toBe(1);
    expect(html(a.getState())).toContain("a19");
    expect(html(b.getState())).toContain("b19");
  });
});

describe("scheduling", () => {
  it("computes clamp(min, 1.25 × EMA(compileMs), max)", () => {
    expect(compileInterval(null, DEFAULT_SCHEDULE)).toBe(33);
    expect(compileInterval(10, DEFAULT_SCHEDULE)).toBe(33);
    expect(compileInterval(100, DEFAULT_SCHEDULE)).toBe(125);
    expect(compileInterval(1000, DEFAULT_SCHEDULE)).toBe(500);
    expect(updateEma(null, 100)).toBe(100);
    expect(updateEma(100, 200)).toBeCloseTo(130);
  });

  it("latest wins: one compile in flight, the pending one takes the newest text", async () => {
    const { workers, engine } = setup({ compileMs: () => 100 });
    const doc = engine.open();
    for (let i = 0; i < 60; i++) {
      doc.push(`w${i} `);
      await tick(5);
    }
    await tick(1000);
    const worker = workers.spawned[0];
    expect(worker?.maxRunning).toBe(1);
    // 300 ms of tokens at one compile per 125 ms: a handful of compiles, not 60.
    const compiles = workers.compileRequests();
    expect(compiles.length).toBeLessThanOrEqual(5);
    const revs = compiles.map((p) => p.rev);
    expect(revs).toEqual([...revs].sort((x, y) => x - y));
    expect(html(doc.getState())).toBe(`<p>${doc.getState().heal.source}</p>`);
    expect(doc.getState().heal.source).toContain("w59");
  });

  it("spaces compiles by the adaptive interval", async () => {
    const { workers, engine } = setup({ compileMs: () => 200 });
    const doc = engine.open();
    for (let i = 0; i < 200; i++) {
      doc.push("word ");
      await tick(10);
    }
    const times = workers.spawned[0]?.compileTimes() ?? [];
    const gaps = times.slice(1).map((t, i) => t - (times[i] ?? 0));
    // Every compile takes 200 ms, so after the first one the interval is 1.25 × 200.
    expect(gaps.length).toBeGreaterThan(4);
    for (const gap of gaps) expect(gap).toBe(250);
  });

  it("caps the interval at maxInterval", async () => {
    const { workers, engine } = setup({ compileMs: () => 50 }, { schedule: { maxInterval: 40, minInterval: 10 } });
    const doc = engine.open();
    for (let i = 0; i < 50; i++) {
      doc.push("word ");
      await tick(10);
    }
    const times = workers.spawned[0]?.compileTimes() ?? [];
    // A compile can't start before the previous one ends (+ at most a 1 ms timer tick).
    for (const gap of times.slice(1).map((t, i) => t - (times[i] ?? 0))) {
      expect(gap).toBeGreaterThanOrEqual(50);
      expect(gap).toBeLessThanOrEqual(51);
    }
  });

  it("compiles sooner when a line or block just finished (boundary bias)", async () => {
    const run = async (chunk: string) => {
      const { workers, engine } = setup({ compileMs: () => 200 });
      await tick(100); // initialized
      const t0 = Date.now();
      const doc = engine.open({ text: "First paragraph" });
      await tick(210); // compiled at 0, settled at 200; the interval is now 250
      const before = doc.getState().heal.stableOffset;
      doc.push(chunk);
      const advanced = doc.getState().heal.stableOffset > before;
      await tick(100);
      return { advanced, at: (workers.spawned[0]?.compileTimes()[1] ?? 0) - t0 };
    };
    const word = await run(" continues");
    expect(word).toEqual({ advanced: false, at: 250 });
    const block = await run("\n\nSecond paragraph");
    expect(block).toEqual({ advanced: true, at: 210 });
  });

  it("drops output of a revision other than the one last sent", async () => {
    const { workers, engine } = setup();
    const doc = engine.open({ text: "one" });
    await tick(100);
    doc.push(" two");
    await tick(100);
    const s = doc.getState();
    expect(s.artifactRev).toBe(2);
    const worker = workers.spawned[0];
    const old = { target: "html" as const, html: "<p>old</p>" };
    worker?.post({ method: "document/artifact", params: { uri: doc.uri, rev: 1, artifact: old } });
    worker?.post({ method: "document/artifact", params: { uri: doc.uri, rev: 7, artifact: old } });
    expect(doc.getState()).toBe(s);
    // A server-initiated recompile of the current revision replaces the artifact.
    const fresh = { target: "html" as const, html: "<p>with fonts</p>" };
    worker?.post({ method: "document/artifact", params: { uri: doc.uri, rev: 2, artifact: fresh } });
    expect(doc.getState().artifact).toEqual(fresh);
  });
});

describe("last-good fallback", () => {
  it("keeps the previous artifact and reports stale while compiles fail", async () => {
    const { engine } = setup();
    const doc = engine.open({ text: "Good" });
    await tick(100);
    const good = doc.getState().artifact;
    doc.push(" ERROR");
    await tick(100);
    let s = doc.getState();
    expect(s.status).toBe("stale");
    expect(s.artifact).toBe(good);
    expect(s.failure).toEqual({ reason: "diagnostics", message: "unknown variable: ERROR" });
    expect(s.diagnostics).toHaveLength(1);
    doc.push(" more");
    expect(doc.getState().status).toBe("stale");
    doc.set("Good again");
    await tick(100);
    s = doc.getState();
    expect(s.status).toBe("idle");
    expect(html(s)).toBe("<p>Good again</p>");
    expect(s.failure).toBeNull();
    expect(s.diagnostics).toEqual([]);
  });

  it("reports error when the finished document doesn't compile", async () => {
    const { engine } = setup();
    const doc = engine.open({ text: "Good" });
    await tick(100);
    doc.push(" ERROR");
    doc.finish();
    await tick(100);
    expect(doc.getState().status).toBe("error");
    expect(html(doc.getState())).toBe("<p>Good</p>");
  });
});

describe("fallback ladder", () => {
  it("asks the worker to isolate failing blocks, unless the fallback is off", async () => {
    const { workers, engine } = setup();
    engine.open({ text: "a" });
    engine.open({ text: "b", fallback: false });
    await tick(100);
    expect(workers.compileRequests().map((p) => p.fallback)).toEqual([{ isolate: true }, undefined]);
  });

  it("asks for the stable prefix once the last good render is stale", async () => {
    const { workers, engine } = setup();
    const doc = engine.open({ text: "Good" });
    await tick(100);
    doc.push(" ERROR");
    await tick(100);
    doc.push(" a");
    await tick(1600);
    expect(workers.compileRequests().at(-1)?.fallback).toEqual({ isolate: true });
    doc.push(" b");
    await tick(100);
    expect(workers.compileRequests().at(-1)?.fallback).toEqual({ isolate: true, stablePrefix: true });
    // A good render ends it.
    doc.set("Good again");
    await tick(100);
    doc.push(" ERROR");
    await tick(100);
    expect(workers.compileRequests().at(-1)?.fallback).toEqual({ isolate: true });
  });

  // Eight blocks; the sixth hangs.
  const BLOCKS = ["A", "B", "C", "D", "E", "LOOP", "G", "H"];

  it("finds the block that hangs a finished document in ⌈log₂ n⌉ + 1 compiles, each under its own budget", async () => {
    const { workers, engine } = setup();
    const doc = engine.open({ text: BLOCKS.join("\n\n") });
    doc.finish();
    // The whole text runs out of its 10 s; then prefixes of 4 blocks (finishes), 6 (runs past the 5 s
    // probe budget) and 5 (finishes), and the whole text without block 5.
    await tick(16_000);
    const [first, ...after] = workers.compileRequests();
    expect(first?.fallback).toEqual({ isolate: true });
    const text = doc.getState().heal.source;
    const start = (i: number) => text.indexOf(BLOCKS[i] as string);
    expect(after.map((p) => p.fallback?.skip)).toEqual([
      [{ from: start(4), to: text.length, reason: "timeout" }],
      [{ from: start(6), to: text.length, reason: "timeout" }],
      [{ from: start(5), to: text.length, reason: "timeout" }],
      [{ from: start(5), to: start(6), reason: "timeout" }],
    ]);
    expect(after).toHaveLength(Math.ceil(Math.log2(BLOCKS.length)) + 1);
    const s = doc.getState();
    expect(s.status).toBe("done");
    expect(html(s)).toBe(`<p>${BLOCKS.join("\n\n").replace("LOOP\n\n", "[skipped:timeout]")}</p>`);
  });

  it("doesn't show what the probes compile, and keeps skipping what hangs", async () => {
    const { workers, engine } = setup();
    const doc = engine.open({ text: BLOCKS.join("\n\n") });
    const shown: (string | undefined)[] = [];
    doc.subscribe((s) => shown.push(html(s)));
    doc.finish();
    await tick(16_000);
    expect(new Set(shown.filter(Boolean))).toEqual(new Set([html(doc.getState())]));
    doc.setInputs({ answers: "true" });
    await tick(100);
    expect(workers.compileRequests().at(-1)?.fallback?.skip).toHaveLength(1);
    expect(doc.getState().status).toBe("done");
  });

  it("skips what crashes the worker", async () => {
    const { workers, engine } = setup();
    const doc = engine.open({ text: "A\n\nCRASH\n\nC" });
    doc.finish();
    await tick(1000);
    expect(workers.compileRequests().at(-1)?.fallback?.skip).toEqual([{ from: 3, to: 10, reason: "crash" }]);
    expect(doc.getState().status).toBe("done");
    expect(html(doc.getState())).toBe("<p>A\n\n[skipped:crash]C</p>");
  });

  it("starts over when the finished source changes", async () => {
    const { workers, engine } = setup();
    const doc = engine.open({ text: "A\n\nLOOP" });
    doc.finish();
    await tick(10_200);
    expect(doc.getState().status).toBe("done");
    doc.applyEdit({ from: 0, to: 1, insert: "Z" });
    await tick(100);
    expect(workers.compileRequests().at(-1)?.fallback?.skip).toBeUndefined();
  });
});

describe("paged artifacts", () => {
  const pages = (s: DocumentState) => (s.artifact as PagedArtifact).pages.map((p) => p.svg);

  it("applies changed pages to the pages the client has", async () => {
    const { workers, engine } = setup();
    const doc = engine.open({ target: "paged", text: "A\n\nB" });
    await tick(100);
    expect(pages(doc.getState())).toEqual(["A", "B"]);
    doc.push("\n\nC");
    await tick(100);
    expect(pages(doc.getState())).toEqual(["A", "B", "C"]);
    expect((doc.getState().artifact as PagedArtifact).base).toBeNull();
    doc.set("A");
    await tick(100);
    expect(pages(doc.getState())).toEqual(["A"]);
    expect(workers.compileRequests().every((p) => !p.fullPages)).toBe(true);
  });

  it("sends the page format with compiles, and compiles again when it changes", async () => {
    const { workers, engine } = setup();
    const doc = engine.open({ target: "paged", text: "A", pageFormat: "drawing" });
    await tick(100);
    doc.setPageFormat("svg");
    await tick(100);
    doc.setPageFormat("drawing");
    doc.setTarget("html");
    await tick(100);
    expect(workers.compileRequests().map((p) => [p.target, p.pageFormat])).toEqual([
      ["paged", "drawing"],
      ["paged", "svg"],
      ["html", "drawing"],
    ]);
  });

  it("asks for every page when a diff doesn't apply", async () => {
    const { workers, engine } = setup();
    const doc = engine.open({ target: "paged", text: "A\n\nB" });
    await tick(100);
    const fake = workers.spawned[0]?.docs.get(doc.uri);
    if (fake) fake.pagesRev = 99; // the next diff names a base the client never had
    doc.push("2");
    await tick(200);
    expect(workers.compileRequests().map((p) => p.fullPages ?? false)).toEqual([false, false, true]);
    expect(pages(doc.getState())).toEqual(["A", "B2"]);
  });
});

describe("watchdog", () => {
  it("terminates a compile past its budget and continues on the spare", async () => {
    const { workers, engine, events } = setup();
    const doc = engine.open({ text: "Fine" });
    await tick(100);
    expect(workers.alive).toHaveLength(2); // active + warm spare
    doc.push(" LOOP");
    await tick(2990);
    expect(workers.spawned[0]?.terminated).toBe(false);
    await tick(100);
    expect(events.find((e) => e.type === "watchdog")).toMatchObject({ uri: doc.uri, budgetMs: 3000 });
    expect(workers.spawned[0]?.terminated).toBe(true);
    // The spare took over and a new spare is warming up.
    expect(workers.alive).toEqual([workers.spawned[1], workers.spawned[2]]);
    let s = doc.getState();
    expect(s.status).toBe("stale");
    expect(s.failure?.reason).toBe("timeout");
    expect(html(s)).toBe("<p>Fine</p>");
    expect(s.live).toBe(true);

    // The next compile opens the document in the new worker, which is already up.
    const at = Date.now();
    doc.set("Fine again");
    await tick(50);
    const spare = workers.spawned[1];
    expect(spare?.requests("document/open").map((r) => (r.params as DocumentOpenParams).text)).toEqual(["Fine again"]);
    expect((spare?.compileTimes()[0] ?? 0) - at).toBeLessThan(5);
    s = doc.getState();
    expect(s.status).toBe("idle");
    expect(html(s)).toBe("<p>Fine again</p>");
  });

  it("stops compiling live after three strikes and compiles once when finished", async () => {
    const { workers, engine } = setup();
    const doc = engine.open({ text: "LOOP 1" });
    await tick(3100);
    doc.set("LOOP 2");
    await tick(3100);
    expect(doc.getState().live).toBe(true);
    doc.set("LOOP 3");
    await tick(3100);
    let s = doc.getState();
    expect(s.live).toBe(false);
    expect(s.status).toBe("stale");
    expect(s.failure?.reason).toBe("too-complex");

    const count = workers.compileRequests().length;
    doc.set("Simple now");
    await tick(5000);
    expect(workers.compileRequests()).toHaveLength(count);
    expect(doc.getState().status).toBe("stale");

    doc.finish();
    await tick(100);
    expect(workers.compileRequests().at(-1)?.mode).toBe("final");
    s = doc.getState();
    expect(s.status).toBe("done");
    expect(html(s)).toBe("<p>Simple now</p>");
  });

  it("gives a final compile the final budget", async () => {
    const { engine, events } = setup();
    const doc = engine.open({ text: "LOOP", fallback: false });
    doc.finish();
    await tick(9000);
    expect(events.some((e) => e.type === "watchdog")).toBe(false);
    await tick(1100);
    expect(events.find((e) => e.type === "watchdog")).toMatchObject({ budgetMs: 10_000 });
    expect(doc.getState().status).toBe("error");
    expect(doc.getState().failure?.reason).toBe("timeout");
  });

  it("replaces a worker that crashes and counts it as a strike", async () => {
    const { workers, engine, events } = setup();
    const doc = engine.open({ text: "ok" });
    await tick(100);
    doc.push(" CRASH");
    await tick(100);
    expect(events.some((e) => e.type === "crash")).toBe(true);
    expect(workers.spawned[0]?.terminated).toBe(true);
    expect(doc.getState().failure?.reason).toBe("crash");
    doc.set("ok again");
    await tick(100);
    expect(html(doc.getState())).toBe("<p>ok again</p>");
  });

  it("reopens other documents in the new worker", async () => {
    const { workers, engine } = setup();
    const a = engine.open({ text: "a" });
    const b = engine.open({ text: "b" });
    await tick(100);
    a.push(" LOOP");
    await tick(3100);
    b.push(" more");
    await tick(100);
    const opened = workers.spawned[1]?.requests("document/open").map((r) => (r.params as DocumentOpenParams).text);
    expect(opened).toEqual(["b more"]);
    expect(html(b.getState())).toBe("<p>b more</p>");
  });
});

describe("limits", () => {
  it("doesn't heal or compile input longer than maxLength until set() shortens it", async () => {
    const { workers, engine } = setup({}, { limits: { maxLength: 20 } });
    const doc = engine.open({ text: "Short" });
    await tick(100);
    doc.push(" and then far too long");
    let s = doc.getState();
    expect(s.status).toBe("stale");
    expect(s.failure).toMatchObject({ reason: "too-large" });
    expect(s.failure?.message).toContain("27 characters");
    expect(s.heal.source).toBe("Short");
    // Later chunks would follow text that was dropped: they are dropped too.
    doc.push("!");
    doc.applyEdit({ from: 0, to: 5, insert: "Long" });
    await tick(1000);
    expect(workers.compileRequests()).toHaveLength(1);
    expect(html(doc.getState())).toBe("<p>Short</p>");
    await expect(doc.exportHtml()).rejects.toMatchObject({ reason: "too-large" });

    doc.finish();
    s = doc.getState();
    expect(s.status).toBe("error");
    expect(s.failure?.reason).toBe("too-large");

    doc.set("Short again");
    await tick(100);
    s = doc.getState();
    expect(s.status).toBe("done");
    expect(s.failure).toBeNull();
    expect(html(s)).toBe("<p>Short again</p>");
  });

  it("applies the limit to opening text, edits and reset()", async () => {
    const { workers, engine } = setup({}, { limits: { maxLength: 10 } });
    const doc = engine.open({ text: "x".repeat(11) });
    await tick(100);
    expect(doc.getState().failure?.reason).toBe("too-large");
    expect(doc.getState().heal.source).toBe("");
    expect(workers.compileRequests()).toHaveLength(0);

    doc.reset("Fits");
    await tick(100);
    expect(doc.getState().failure).toBeNull();
    doc.applyEdit({ from: 4, to: 4, insert: " no more" });
    expect(doc.getState().failure?.reason).toBe("too-large");
    doc.reset("y".repeat(11));
    expect(doc.getState().failure?.reason).toBe("too-large");
    expect(doc.getState().heal.source).toBe("");
  });

  it("stops compiling live past livePages and compiles every page when finished", async () => {
    const { workers, engine } = setup({}, { limits: { livePages: 3 } });
    const doc = engine.open({ target: "paged", text: "A\n\nB\n\nC" });
    await tick(100);
    expect(doc.getState().live).toBe(true);
    doc.push("\n\nD");
    await tick(100);
    let s = doc.getState();
    expect(s.live).toBe(false);
    expect(s.status).toBe("stale");
    expect(s.failure).toMatchObject({ reason: "too-complex" });
    expect(s.failure?.message).toContain("more than 3 pages");
    // The pages that compiled stay.
    expect((s.artifact as PagedArtifact).pages).toHaveLength(4);

    const count = workers.compileRequests().length;
    doc.push("\n\nE");
    await tick(1000);
    expect(workers.compileRequests()).toHaveLength(count);

    doc.finish();
    await tick(100);
    s = doc.getState();
    expect(s.status).toBe("done");
    expect(s.failure).toBeNull();
    expect((s.artifact as PagedArtifact).pages).toHaveLength(5);
  });
});

describe("recycling", () => {
  it("swaps in a fresh worker between compiles past the memory threshold", async () => {
    const MB = 1024 * 1024;
    const { workers, engine, events } = setup({ memoryBytes: (n) => (n >= 3 ? 300 * MB : 100 * MB) });
    const doc = engine.open({ text: "x" });
    await tick(100);
    doc.push("y");
    await tick(100);
    expect(events.find((e) => e.type === "recycle")).toBeUndefined();
    expect(workers.spawned[0]?.terminated).toBe(false);
    doc.push("z"); // the 3rd compile reports 300 MB
    await tick(100);
    expect(events.find((e) => e.type === "recycle")).toEqual({ type: "recycle", memoryBytes: 300 * MB });
    expect(workers.spawned[0]?.terminated).toBe(true);
    expect(html(doc.getState())).toBe("<p>xyz</p>");
    // The document opens itself in the fresh worker at its next compile.
    doc.push("w");
    await tick(100);
    expect(workers.spawned[1]?.requests("document/open").map((r) => (r.params as DocumentOpenParams).text)).toEqual([
      "xyzw",
    ]);
    expect(html(doc.getState())).toBe("<p>xyzw</p>");
    expect(doc.getState().failure).toBeNull();
  });
});

describe("dispose", () => {
  it("cancels the compile in flight and closes the document", async () => {
    const { workers, engine } = setup({ compileMs: () => 100 });
    const doc = engine.open({ text: "x" });
    await tick(150);
    doc.push("y");
    await tick(60); // compiling
    const states: DocumentState[] = [];
    doc.subscribe((s) => states.push(s));
    const before = doc.getState();
    doc.dispose();
    const worker = workers.spawned[0];
    const id = worker?.requests("compile").at(-1)?.id;
    expect(worker?.received.slice(-2)).toEqual([
      { method: "$/cancel", params: { id } },
      expect.objectContaining({ method: "document/close", params: { uri: doc.uri, rev: 2 } }),
    ]);
    doc.push("z");
    await tick(500);
    expect(states).toEqual([]);
    expect(doc.getState()).toBe(before);
    expect(workers.compileRequests()).toHaveLength(2);
  });

  it("drops a scheduled compile", async () => {
    const { workers, engine } = setup();
    const doc = engine.open({ text: "x" });
    doc.dispose();
    await tick(500);
    expect(workers.compileRequests()).toHaveLength(0);
    // The uri is free again.
    expect(() => engine.open({ uri: doc.uri })).not.toThrow();
  });

  it("disposing the engine terminates its workers", async () => {
    const { workers, engine } = setup({ compileMs: () => 100 });
    engine.open({ text: "x" });
    await tick(80);
    engine.dispose();
    expect(workers.alive).toEqual([]);
    await tick(500);
    expect(() => engine.open()).toThrow(/disposed/);
  });
});

describe("exports", () => {
  const text = (pdf: Uint8Array) => new TextDecoder().decode(pdf);

  it("syncs the worker and exports the healed source before waiting compiles", async () => {
    const { workers, engine } = setup();
    const doc = engine.open({ text: "Hello" });
    await tick(100);
    doc.push(" *wor");
    const pdf = doc.exportPdf();
    await tick(100);
    expect(text(await pdf)).toBe("%PDF Hello *wor*");
    const worker = workers.alive[0];
    const methods = worker?.received.map((m) => m.method) ?? [];
    // The edit, then the export, then the compile of the same source for the preview.
    expect(methods.slice(methods.indexOf("document/edit"))).toEqual(["document/edit", "export/pdf", "compile"]);
    expect(worker?.requests("export/pdf")[0]?.params).toEqual({ uri: doc.uri, rev: 2 });
    expect(html(doc.getState())).toBe("<p>Hello *wor*</p>");
  });

  it("exports HTML, and the source exports compile", async () => {
    const { engine } = setup();
    const doc = engine.open({ text: "```typst\nHi *there" });
    expect(doc.exportSource()).toBe("Hi *there*");
    const page = doc.exportHtml();
    await tick(100);
    expect(await page).toBe("<html><body><p>Hi *there*</p></body></html>");
    doc.finish();
    expect(doc.exportSource()).toBe("Hi *there");
  });

  it("opens the document in a worker that doesn't have it yet", async () => {
    const { workers, engine } = setup();
    const doc = engine.open({ text: "Fresh", preamble: "#set page(width: 10cm)" });
    const pdf = doc.exportPdf();
    await tick(100);
    expect(text(await pdf)).toBe("%PDF Fresh");
    // The export went first; the preview's first compile follows, with nothing more to send.
    const methods = workers.alive[0]?.received.map((m) => m.method);
    expect(methods).toEqual(["initialize", "document/open", "export/pdf", "compile"]);
    expect(html(doc.getState())).toBe("<p>Fresh</p>");
  });

  it("uses the document's inputs unless given others", async () => {
    const { workers, engine } = setup();
    const doc = engine.open({ text: "Hi", inputs: { answers: "true", "typstream-page-width": "300" } });
    await tick(100);
    const exports = [doc.exportPdf(), doc.exportHtml({ inputs: { answers: "true" } })];
    await tick(100);
    await Promise.all(exports);
    const sent = workers.alive[0]?.received.filter((m) => m.method.startsWith("export/"));
    expect(sent?.map((m) => (m.params as { inputs?: unknown }).inputs)).toEqual([
      { answers: "true", "typstream-page-width": "300" },
      { answers: "true" },
    ]);
  });

  it("rejects with diagnostics in input coordinates when the document has errors", async () => {
    const { engine } = setup();
    const doc = engine.open({ text: "```typst\nSee ERROR" });
    const pdf = doc.exportPdf().catch((e: unknown) => e);
    await tick(100);
    const error = await pdf;
    expect(error).toBeInstanceOf(ExportError);
    expect(error).toMatchObject({ reason: "diagnostics", message: "unknown variable: ERROR" });
    expect((error as ExportError).diagnostics.map((d) => d.span)).toEqual([{ from: 13, to: 18 }]);
  });

  it("rejects formats the engine doesn't offer", async () => {
    const { engine } = setup({ exports: ["html"] });
    const doc = engine.open({ text: "Hi" });
    const pdf = doc.exportPdf().catch((e: unknown) => e);
    await tick(100);
    expect(await pdf).toMatchObject({ reason: "unsupported" });
    expect(await engine.ready).toMatchObject({ capabilities: { exports: ["html"] } });
  });

  it("stops an export past the final budget, and continues on the spare", async () => {
    const { workers, engine, events } = setup();
    const doc = engine.open({ text: "ok" });
    await tick(100);
    doc.set("LOOP");
    const pdf = doc.exportPdf().catch((e: unknown) => e);
    await tick(10);
    doc.set("fine");
    await tick(9900);
    expect(workers.spawned[0]?.terminated).toBe(false);
    await tick(200);
    expect(await pdf).toMatchObject({ reason: "timeout", message: "Exporting took longer than 10000 ms." });
    expect(events.find((e) => e.type === "watchdog")).toMatchObject({ uri: doc.uri, budgetMs: 10_000 });
    expect(workers.spawned[0]?.terminated).toBe(true);
    // An export isn't a strike against live compiling; the compile waiting behind it runs on the spare.
    await tick(100);
    expect(doc.getState()).toMatchObject({ status: "idle", live: true, failure: null });
    expect(html(doc.getState())).toBe("<p>fine</p>");
  });

  it("rejects when the worker crashes during the export", async () => {
    const { engine } = setup();
    const doc = engine.open({ text: "ok" });
    await tick(100);
    doc.set("CRASH");
    const page = doc.exportHtml().catch((e: unknown) => e);
    await tick(100);
    expect(await page).toMatchObject({ reason: "crash" });
  });

  it("rejects exports of a disposed document or engine", async () => {
    const { workers, engine } = setup();
    const doc = engine.open({ text: "ok" });
    const queued = doc.exportPdf().catch((e: unknown) => e);
    doc.dispose();
    await tick(100);
    expect(await queued).toMatchObject({ reason: "engine", message: "The document was disposed." });
    expect(await doc.exportPdf().catch((e: unknown) => e)).toMatchObject({ reason: "engine" });
    await tick(100);
    expect(workers.spawned[0]?.requests("export/pdf")).toEqual([]);

    const other = engine.open({ text: "ok" });
    await tick(100);
    const pending = other.exportHtml().catch((e: unknown) => e);
    engine.dispose();
    await tick(100);
    expect(await pending).toMatchObject({ reason: "engine" });
  });
});

describe("dropped connections", () => {
  const noStrikes = (events: EngineEvent[]) =>
    events.some(
      (e) => e.type === "crash" || e.type === "watchdog" || (e.type === "document" && e.event.type === "watchdog"),
    );

  it("opens a new connection and retries the compile, without a strike", async () => {
    const { workers, engine, events } = setup({ compileMs: () => 500 }, { spare: false });
    const doc = engine.open({ text: "one" });
    await tick(1000);
    doc.set("two");
    await tick(100);
    workers.spawned[0]?.drop();
    await tick(1000);
    expect(events.filter((e) => e.type === "disconnect")).toEqual([
      { type: "disconnect", error: new Error("connection lost") },
    ]);
    expect(noStrikes(events)).toBe(false);
    expect(workers.spawned.map((w) => w.terminated)).toEqual([true, false]);
    const opened = workers.spawned[1]?.requests("document/open").map((r) => (r.params as DocumentOpenParams).text);
    expect(opened).toEqual(["two"]);
    const s = doc.getState();
    expect(s.status).toBe("idle");
    expect(s.failure).toBeNull();
    expect(html(s)).toBe("<p>two</p>");
  });

  it("retries an export on the new connection", async () => {
    const { workers, engine } = setup({ compileMs: () => 500 }, { spare: false });
    const doc = engine.open({ text: "ok" });
    await tick(1000);
    const pdf = doc.exportPdf();
    await tick(100);
    workers.spawned[0]?.drop();
    await tick(1000);
    expect(new TextDecoder().decode(await pdf)).toBe("%PDF ok");
    expect(workers.spawned[1]?.requests("export/pdf")).toHaveLength(1);
  });

  it("counts a loss as a crash after three in a row with requests in flight", async () => {
    const { workers, engine, events } = setup({}, { spare: false });
    const doc = engine.open({ text: "ok" });
    await tick(100);
    // Idle connections that drop are replaced, but not counted.
    for (let i = 0; i < 4; i++) {
      workers.alive[0]?.drop();
      await tick(100);
    }
    expect(workers.spawned).toHaveLength(5);
    doc.set("ok DROP");
    await tick(2000);
    // Three retries, then a crash: a strike, and no more retries.
    expect(workers.spawned).toHaveLength(9);
    expect(events.filter((e) => e.type === "disconnect")).toHaveLength(8);
    expect(doc.getState().failure?.reason).toBe("crash");
    expect(doc.getState().live).toBe(true);
    // An answered compile starts the count again: three retries, then a crash.
    doc.set("fine");
    await tick(200);
    expect(html(doc.getState())).toBe("<p>fine</p>");
    doc.set("fine DROP");
    await tick(2000);
    expect(workers.spawned).toHaveLength(13);
    expect(doc.getState().failure?.reason).toBe("crash");
  });

  it("fails the engine when the first connection drops before initialize", async () => {
    const workers = new FakeWorkers();
    const engine = createEngine({
      spawn: (events) => {
        const w = workers.spawn(events);
        setTimeout(() => events.lost(new Error("refused")), 10);
        return w;
      },
    });
    engine.ready.catch(() => {});
    const doc = engine.open({ text: "x" });
    await tick(100);
    expect(workers.spawned).toHaveLength(1);
    expect(doc.getState().status).toBe("error");
    expect(doc.getState().failure?.message).toBe("refused");
  });

  it("takes the spawn's defaults, under the engine's options", async () => {
    const workers = new FakeWorkers();
    const spawn: SpawnEngine = Object.assign((events: EngineEvents) => workers.spawn(events), {
      defaults: { watchdog: { streamingMs: 5000 }, spare: false },
    });
    const events: EngineEvent[] = [];
    const engine = createEngine({ spawn });
    engine.onEvent((e) => events.push(e));
    const doc = engine.open({ text: "x" });
    await tick(100);
    expect(workers.alive).toHaveLength(1);
    doc.push(" LOOP");
    await tick(3100);
    expect(events.some((e) => e.type === "watchdog")).toBe(false);
    await tick(2000);
    expect(events.find((e) => e.type === "watchdog")).toMatchObject({ budgetMs: 5000 });

    const explicit = new FakeWorkers();
    const spawn2: SpawnEngine = Object.assign((events: EngineEvents) => explicit.spawn(events), spawn);
    const other = createEngine({ spawn: spawn2, watchdog: { streamingMs: 1000 }, spare: true });
    const watched: EngineEvent[] = [];
    other.onEvent((e) => watched.push(e));
    const doc2 = other.open({ text: "x" });
    await tick(100);
    expect(explicit.alive).toHaveLength(2);
    doc2.push(" LOOP");
    await tick(1100);
    expect(watched.find((e) => e.type === "watchdog")).toMatchObject({ budgetMs: 1000 });
  });
});

describe("startup", () => {
  it("fails every document when the worker speaks another protocol version", async () => {
    const { engine, events } = setup({ protocolVersion: 99 });
    const doc = engine.open({ text: "x" });
    const ready = engine.ready.catch((e: Error) => e.message);
    await tick(100);
    expect(await ready).toMatch(/protocol 99/);
    expect(doc.getState().status).toBe("error");
    expect(doc.getState().failure?.reason).toBe("engine");
    expect(events.some((e) => e.type === "failed")).toBe(true);
    expect(engine.open().getState().status).toBe("error");
  });

  it("doesn't respawn a worker that crashes while starting", async () => {
    const workers = new FakeWorkers();
    const engine = createEngine({
      spawn: (events) => {
        const w = workers.spawn(events);
        setTimeout(() => events.error(new Error("wasm failed to load")), 10);
        return w;
      },
    });
    engine.ready.catch(() => {});
    const doc = engine.open({ text: "x" });
    await tick(100);
    expect(workers.spawned).toHaveLength(1);
    expect(doc.getState().status).toBe("error");
    expect(doc.getState().failure?.message).toBe("wasm failed to load");
  });

  it("waits for initialize before the watchdog starts", async () => {
    const { workers, engine, events } = setup({ initMs: 5000 });
    const doc = engine.open({ text: "x" });
    await tick(5100);
    expect(events.some((e) => e.type === "watchdog")).toBe(false);
    expect(html(doc.getState())).toBe("<p>x</p>");
    expect(workers.compileRequests()).toHaveLength(1);
  });
});

describe("fromWorker", () => {
  it("adapts a Web Worker shape", () => {
    const listeners: Record<string, (e: unknown) => void> = {};
    const posted: unknown[] = [];
    const worker: WorkerLike = {
      postMessage: (m) => posted.push(m),
      terminate: () => posted.push("terminated"),
      addEventListener: (type: string, listener: (e: never) => void) => {
        listeners[type] = listener as (e: unknown) => void;
      },
    };
    const got: unknown[] = [];
    const conn = fromWorker(() => worker)({
      message: (m) => got.push(m),
      error: (e) => got.push(["error", e]),
      lost: (e) => got.push(["lost", e]),
    });
    listeners.message?.({ data: { method: "$/log", params: { level: "info", message: "hi" } } });
    listeners.error?.("boom");
    listeners.messageerror?.("bad");
    conn.postMessage({ method: "$/cancel", params: { id: 1 } });
    conn.terminate();
    expect(got).toEqual([
      { method: "$/log", params: { level: "info", message: "hi" } },
      ["error", "boom"],
      ["error", "bad"],
    ]);
    expect(posted).toEqual([{ method: "$/cancel", params: { id: 1 } }, "terminated"]);
  });
});

// Keep the heal import used: the engine's output must equal heal's on the same input.
it("sends exactly what heal produces", async () => {
  const { workers, engine } = setup();
  const input = "= Title\n#table(columns: 2, [a], [b";
  const doc = engine.open({ text: input });
  await tick(100);
  expect((workers.compileRequests()[0] as CompileParams).rev).toBe(1);
  expect(workers.alive[0]?.docs.get(doc.uri)?.text).toBe(heal(input).source);
});
