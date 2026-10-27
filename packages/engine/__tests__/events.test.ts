// Document events (PLAN §8.6): what `EngineDocument.onEvent` and, wrapped,
// `Engine.onEvent` report per compile, against the fake worker. The worker's
// own side (which fixes it applied, which fallback level) is in fixers.test.ts
// and fallback.test.ts, against engine-wasm.

import type {
  CompiledEvent,
  DiagnosticsEvent,
  DocumentEvent,
  FallbackEvent,
  HtmlArtifact,
  WatchdogEvent,
} from "@typstream/core";
import { heal } from "@typstream/heal";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineDocument } from "../src/document";
import { createEngine, type EngineEvent } from "../src/engine";
import { FakeWorkers } from "./support/fake-worker";

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

const setup = () => {
  const workers = new FakeWorkers();
  const engine = createEngine({ spawn: workers.spawn });
  const engineEvents: EngineEvent[] = [];
  engine.onEvent((e) => engineEvents.push(e));
  return { workers, engine, engineEvents };
};

/** Records a document's events. */
const record = (doc: EngineDocument) => {
  const events: DocumentEvent[] = [];
  doc.onEvent((e) => events.push(e));
  const of = <T extends DocumentEvent["type"]>(type: T) =>
    events.filter((e): e is Extract<DocumentEvent, { type: T }> => e.type === type);
  return { events, of };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("compiled", () => {
  it("reports each compile: timings, healing, patches by reason, fallback level", async () => {
    const { engine } = setup();
    const doc = engine.open();
    const { events } = record(doc);
    doc.push("Hello *bo");
    doc.push("ld");
    await tick(100);
    const healed = heal("Hello *bold");
    expect(healed.patches.length).toBeGreaterThan(0);
    const reasons: Record<string, number> = {};
    for (const p of healed.patches) reasons[p.reason] = (reasons[p.reason] ?? 0) + 1;
    expect(events.map((e) => e.type)).toEqual(["diagnostics", "compiled"]);
    expect(events[0]).toEqual({
      type: "diagnostics",
      uri: doc.uri,
      rev: 1,
      target: "html",
      mode: "streaming",
      diagnostics: [],
    } satisfies DiagnosticsEvent);
    expect(events[1]).toEqual({
      type: "compiled",
      uri: doc.uri,
      rev: 1,
      target: "html",
      mode: "streaming",
      status: "ok",
      timings: { totalMs: 10 },
      compileMs: 0,
      healMs: expect.any(Number),
      patches: healed.patches.length,
      patchReasons: reasons,
      fixersApplied: [],
      fallbackLevel: 0,
      errors: 0,
      warnings: 0,
      sourceLength: healed.source.length,
    } satisfies CompiledEvent);
  });

  it("sums the healing since the previous compile", async () => {
    // Every call of performance.now() is a millisecond later: each healer call takes 1 ms.
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now++);
    const { engine } = setup();
    const doc = engine.open({ text: "One" });
    const { of } = record(doc);
    doc.push(" two");
    doc.push(" three");
    await tick(100);
    doc.push(" four");
    await tick(100);
    expect(of("compiled").map((e) => e.healMs)).toEqual([3, 1]);
  });

  it("fires before the state the compile leads to is published", async () => {
    const { engine } = setup();
    const doc = engine.open({ text: "Hi" });
    const seen: unknown[] = [];
    doc.onEvent((e) => {
      if (e.type === "compiled") seen.push(doc.getState().lastCompile);
    });
    await tick(100);
    expect(seen).toEqual([null]);
    expect(doc.getState().lastCompile?.rev).toBe(1);
  });

  it("lists the fixes that made the output", async () => {
    const { engine } = setup();
    const doc = engine.open({ text: "Needs a FIX" });
    const { of } = record(doc);
    await tick(100);
    expect(of("compiled")[0]).toMatchObject({
      status: "ok",
      fixersApplied: [{ fixer: "fake-fixer", message: "unknown variable: FIX" }],
      fallbackLevel: 0,
    });
    expect(of("fallback")).toEqual([]);
  });

  it("counts errors and pages", async () => {
    const { engine } = setup();
    const doc = engine.open({ target: "paged", text: "A\n\nB\n\nC" });
    const { of } = record(doc);
    await tick(100);
    doc.push(" ERROR");
    await tick(100);
    expect(of("compiled").map((e) => [e.status, e.errors, e.pages])).toEqual([
      ["ok", 0, 3],
      ["error", 1, undefined],
    ]);
  });

  it("reaches the engine's listeners too, with the document's uri", async () => {
    const { engine, engineEvents } = setup();
    const a = engine.open({ text: "A" });
    const b = engine.open({ text: "B" });
    await tick(100);
    const compiled = engineEvents.flatMap((e) =>
      e.type === "document" && e.event.type === "compiled" ? [e.event.uri] : [],
    );
    expect(compiled).toEqual([a.uri, b.uri]);
  });

  it("reports diagnostics the worker publishes on its own", async () => {
    const { workers, engine } = setup();
    const doc = engine.open({ text: "Hi" });
    const { events } = record(doc);
    await tick(100);
    events.length = 0;
    // As when a lazily loaded font arrives and the server compiles again.
    const diagnostics = [{ severity: "warning" as const, span: null, message: "font", hints: [], trace: [] }];
    workers.spawned[0]?.post({
      method: "document/diagnostics",
      params: { uri: doc.uri, rev: 1, target: "html", diagnostics },
    });
    await tick(0);
    expect(events).toEqual([
      { type: "diagnostics", uri: doc.uri, rev: 1, target: "html", mode: "streaming", diagnostics },
    ]);
  });
});

describe("fallback", () => {
  it("reports level 1 while the last good render stays, counting failures in a row", async () => {
    const { engine } = setup();
    const doc = engine.open({ text: "Good" });
    const { of } = record(doc);
    await tick(100);
    doc.push(" ERROR");
    await tick(100);
    doc.push(" still");
    await tick(500);
    doc.set("Good again");
    await tick(500);
    doc.push(" ERROR");
    await tick(500);
    expect(of("compiled").map((e) => e.fallbackLevel)).toEqual([0, 1, 1, 0, 1]);
    const fallbacks = of("fallback");
    expect(fallbacks.map((e) => [e.level, e.consecutive])).toEqual([
      [1, 1],
      [1, 2],
      [1, 1],
    ]);
    expect(fallbacks[0]).toEqual({
      type: "fallback",
      uri: doc.uri,
      rev: 2,
      target: "html",
      mode: "streaming",
      level: 1,
      isolated: [],
      plainFrom: null,
      consecutive: 1,
      diagnostics: [expect.objectContaining({ message: "unknown variable: ERROR", span: { from: 5, to: 10 } })],
      input: "Good ERROR",
      source: "Good ERROR",
    } satisfies FallbackEvent);
  });

  it("reports isolated blocks with the input and the healed source, to replay as a test case", async () => {
    const { engine } = setup();
    const doc = engine.open();
    const { of } = record(doc);
    // The fence is stripped: input and source differ, and ranges are in the source.
    doc.push("```typst\nIntro.\n\nBROKEN");
    await tick(100);
    const source = "Intro.\n\nBROKEN";
    expect(of("compiled")[0]).toMatchObject({ status: "ok", fallbackLevel: 3 });
    expect(of("fallback")[0]).toMatchObject({
      level: 3,
      isolated: [{ from: 8, to: 14 }],
      input: "```typst\nIntro.\n\nBROKEN",
      source,
      diagnostics: [expect.objectContaining({ span: { from: 17, to: 23 } })],
    });
    expect(doc.getState().status).toBe("idle");
  });

  it("is level 1 with the fallback off: the compile fails", async () => {
    const { engine } = setup();
    const doc = engine.open({ text: "BROKEN", fallback: false });
    const { of } = record(doc);
    await tick(100);
    expect(of("compiled")[0]).toMatchObject({ status: "error", fallbackLevel: 1 });
  });
});

describe("watchdog", () => {
  it("reports strikes, and when live compiling stops", async () => {
    const { engine } = setup();
    const doc = engine.open({ text: "LOOP 1" });
    const { of } = record(doc);
    await tick(3100);
    doc.set("LOOP 2");
    await tick(3100);
    doc.set("CRASH 3");
    await tick(100);
    expect(of("watchdog")).toEqual([
      expect.objectContaining({ reason: "timeout", budgetMs: 3000, strikes: 1, live: true, searching: false }),
      expect.objectContaining({ reason: "timeout", strikes: 2, live: true }),
      expect.objectContaining({ reason: "crash", strikes: 3, live: false }),
    ]);
    expect(of("watchdog")[0]).toEqual({
      type: "watchdog",
      uri: doc.uri,
      rev: 1,
      target: "html",
      mode: "streaming",
      reason: "timeout",
      budgetMs: 3000,
      strikes: 1,
      live: true,
      searching: false,
      sourceLength: "LOOP 1".length,
    } satisfies WatchdogEvent);
    expect(of("compiled")).toEqual([]);
  });

  it("reports the search for what hangs a finished document, but not its probes' compiles", async () => {
    const { engine } = setup();
    const doc = engine.open({ text: ["A", "B", "LOOP", "D"].join("\n\n") });
    const { of } = record(doc);
    doc.finish();
    await tick(30_000);
    const watchdog = of("watchdog");
    expect(watchdog[0]).toMatchObject({ mode: "final", budgetMs: 10_000, searching: true, strikes: 0 });
    // The probes that ran past their own budget.
    expect(watchdog.length).toBeGreaterThan(1);
    expect(watchdog.slice(1).every((e) => e.budgetMs === 5000 && e.searching)).toBe(true);
    // Only the compile whose output is shown: the source with the hanging block skipped.
    const compiled = of("compiled");
    expect(compiled).toHaveLength(1);
    expect(compiled[0]).toMatchObject({ mode: "final", status: "ok", fallbackLevel: 3 });
    expect(of("fallback")[0]?.isolated).toHaveLength(1);
    expect((doc.getState().artifact as HtmlArtifact).html).toContain("[skipped:timeout]");
  });
});

describe("lifetime", () => {
  it("stops reporting to a listener that unsubscribed, or after dispose", async () => {
    const { engine } = setup();
    const doc = engine.open({ text: "A" });
    const events: DocumentEvent[] = [];
    const stop = doc.onEvent((e) => events.push(e));
    await tick(100);
    const count = events.length;
    expect(count).toBeGreaterThan(0);
    stop();
    doc.push(" B");
    await tick(100);
    expect(events).toHaveLength(count);
    const late: DocumentEvent[] = [];
    doc.onEvent((e) => late.push(e));
    doc.push(" C");
    doc.dispose();
    await tick(100);
    expect(late).toEqual([]);
  });
});
