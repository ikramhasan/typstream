"use client";
// Telemetry (PLAN §8.6, §12): typstream sends nothing itself; the app wires
// the hooks. These are on the provider, so they cover every answer. Each event
// is logged to the console and batched to an analytics sink, here
// `/api/telemetry`, which prints a line per event in the server's log.
//
// What's worth collecting: render and compile latency by document size, heal
// patches by reason (candidate lint rules), fixer hits by error (prompt
// "don'ts"), fallback levels, and watchdog stops. A fallback event carries the
// input and healed source, a ready-made test case; collecting documents needs
// your users' consent, so this example sends only their lengths.

import type { ReactNode } from "react";
import { type FallbackEvent, type RenderedEvent, TypstreamProvider, type WatchdogEvent } from "typstream";

type Event = RenderedEvent | FallbackEvent | WatchdogEvent;

let batch: object[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

const flush = () => {
  clearTimeout(timer);
  if (batch.length === 0) return;
  const body = JSON.stringify(batch);
  batch = [];
  // sendBeacon survives the page closing; fetch is the fallback where it's missing.
  if (!navigator.sendBeacon?.("/api/telemetry", body)) void fetch("/api/telemetry", { method: "POST", body });
};

if (typeof window !== "undefined") {
  addEventListener("pagehide", flush);
  addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
}

const send = (event: Event) => {
  // Lengths, not text: see above.
  if (event.type === "fallback") {
    const { input, source, diagnostics, ...rest } = event;
    batch.push({ ...rest, inputLength: input.length, errors: diagnostics.map((d) => d.message) });
  } else batch.push(event);
  clearTimeout(timer);
  timer = setTimeout(flush, 1000);
};

const onRendered = (e: RenderedEvent) => {
  // Every compile while streaming renders: log only the finished document's.
  if (e.mode === "final") {
    console.info(
      `[typstream] rendered ${e.uri} rev ${e.rev}: compile ${e.compileMs.toFixed(1)} ms, heal ${e.healMs.toFixed(1)} ms, ` +
        `render ${e.renderMs.toFixed(1)} ms, ${e.patches} patches, ${e.fixersApplied.length} fixes, fallback ${e.fallbackLevel}`,
    );
  }
  send(e);
};

const onFallback = (e: FallbackEvent) => {
  // While streaming, a lasting error falls back once per revision: report the first of a run.
  if (e.consecutive === 1 || e.mode === "final") {
    console.info(`[typstream] fallback level ${e.level} in ${e.uri} (${e.mode}):`, e.diagnostics[0]?.message);
  }
  send(e);
};

const onWatchdog = (e: WatchdogEvent) => {
  console.info(`[typstream] ${e.reason} in ${e.uri} after ${e.budgetMs} ms (strike ${e.strikes}, live: ${e.live})`);
  send(e);
};

export const Telemetry = ({ children }: { children: ReactNode }) => (
  <TypstreamProvider onRendered={onRendered} onFallback={onFallback} onWatchdog={onWatchdog}>
    {children}
  </TypstreamProvider>
);
