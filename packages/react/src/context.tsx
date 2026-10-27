// Configuration layering (PLAN §7): library defaults → <TypstreamProvider>
// (app-wide) → a <Typstream>'s own props. Lists (plugins, stylesheets) add up,
// records (inputs, files) merge, and anything else a prop sets wins.

import type { TypstreamOptions } from "@typstream/dom";
import type { Engine } from "@typstream/engine";
import { createContext, type ReactNode, useContext, useEffect } from "react";
import { acquireEngine, releaseEngine } from "./engine";
import { mergeHooks, type TelemetryHooks } from "./telemetry";

/**
 * Settings that make sense for every document of an app. Everything except
 * `engine`, `resolveImage` and plugins' functions is serializable, so it can
 * be stored per organization or per user.
 * @public
 */
export interface TypstreamDefaults
  extends Pick<
      TypstreamOptions,
      | "target"
      | "layout"
      | "pageHeight"
      | "preamble"
      | "template"
      | "inputs"
      | "files"
      | "resolveImage"
      | "heal"
      | "schedule"
      | "plugins"
      | "stylesheets"
      | "animated"
      | "caret"
      | "theme"
      | "linkTarget"
      | "textLayer"
      | "lazy"
    >,
    TelemetryHooks {
  /**
   * The engine every `<Typstream>` below compiles with, unless it is given its
   * own. Default: one engine worker for the page, shared by all instances.
   */
  engine?: Engine;
  /**
   * URL of the math font for MathML (HTML target), registered as a web font
   * when a document first renders. The engine's copy is in
   * `@typstream/engine-wasm/fonts`; the `typstream` package sets it for you.
   */
  mathFont?: string | URL;
}

const Context = createContext<TypstreamDefaults>({});

/** The defaults in effect here. @internal */
export const useTypstreamDefaults = (): TypstreamDefaults => useContext(Context);

/** Props of {@link TypstreamProvider}. @public */
export interface TypstreamProviderProps extends TypstreamDefaults {
  /** The app, or the part of it these settings apply to. */
  children?: ReactNode;
}

/**
 * App-wide settings for the `<Typstream>`s below it. Nested providers merge:
 * the inner one's settings win. Without an `engine`, it keeps the page's
 * default engine alive while it is mounted, so the worker survives documents
 * coming and going (a chat switching conversations).
 * @public
 */
export const TypstreamProvider = ({ children, ...defaults }: TypstreamProviderProps) => {
  const outer = useContext(Context);
  const own = defaults.engine;
  useEffect(() => {
    if (own) return;
    acquireEngine();
    return releaseEngine;
  }, [own]);
  return <Context value={mergeDefaults(outer, defaults)}>{children}</Context>;
};

/** Keeps the last plugin of each key, so a plugin added at two levels is applied once. */
const dedupePlugins = (plugins: TypstreamOptions["plugins"]) => {
  if (!plugins || plugins.length < 2) return plugins;
  const byKey = new Map(plugins.map((p) => [p.key, p]));
  return byKey.size === plugins.length ? plugins : [...byKey.values()];
};

const concat = <T,>(a: readonly T[] | undefined, b: readonly T[] | undefined): readonly T[] | undefined =>
  a && b ? [...a, ...b] : (b ?? a);

const assign = <T extends object>(a: T | undefined, b: T | undefined): T | undefined =>
  a && b ? { ...a, ...b } : (b ?? a);

/** `inner` over `outer`. @internal */
export const mergeDefaults = <T extends TypstreamDefaults>(
  outer: TypstreamDefaults,
  inner: T,
): TypstreamDefaults & T => {
  const merged: Record<string, unknown> = { ...outer };
  for (const [k, v] of Object.entries(inner)) if (v !== undefined) merged[k] = v;
  const plugins = dedupePlugins(concat(outer.plugins, inner.plugins));
  const stylesheets = concat(outer.stylesheets, inner.stylesheets);
  const inputs = assign(outer.inputs, inner.inputs);
  const files = assign(outer.files, inner.files);
  return {
    ...(merged as TypstreamDefaults & T),
    ...(plugins ? { plugins } : {}),
    ...(stylesheets ? { stylesheets: [...new Set(stylesheets)] } : {}),
    ...(inputs ? { inputs } : {}),
    ...(files ? { files } : {}),
    ...mergeHooks(outer, inner),
  };
};
