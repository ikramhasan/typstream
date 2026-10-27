// Telemetry hooks (PLAN §8.6, §12) on <TypstreamProvider> as well as on each
// <Typstream>: an app wires its log or analytics sink once, for every document.
// Unlike other settings, a provider's hooks don't give way to an instance's:
// both are called, outer ones first.

import type { TypstreamOptions } from "@typstream/dom";

/**
 * Callbacks for logging and telemetry. The library sends nothing itself; the
 * app decides what to collect (render latency, heal patches, fixer hits,
 * fallbacks as candidate test cases, watchdog strikes).
 * @public
 */
export type TelemetryHooks = Pick<TypstreamOptions, "onRendered" | "onFallback" | "onWatchdog" | "onDiagnostics">;

const HOOKS = ["onRendered", "onFallback", "onWatchdog", "onDiagnostics"] as const;

type Hook = (...args: never[]) => void;

/** `outer`'s and `inner`'s hooks, each calling both when both have one. @internal */
export const mergeHooks = (outer: TelemetryHooks, inner: TelemetryHooks): TelemetryHooks => {
  const merged: Record<string, Hook> = {};
  for (const name of HOOKS) {
    const a = outer[name] as Hook | undefined;
    const b = inner[name] as Hook | undefined;
    const both = (...args: never[]) => {
      a?.(...args);
      b?.(...args);
    };
    const hook = a && b ? both : (a ?? b);
    if (hook) merged[name] = hook;
  }
  return merged as TelemetryHooks;
};
