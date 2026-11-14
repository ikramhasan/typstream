// Warming the engine before a document needs it (PLAN §6.4, mitigation 2): an
// app that knows a document is coming (the user opened "Generate", a model is
// answering) compiles throwaway documents now, so the real one finds the wasm
// compiled, the base fonts parsed, and its plugins' packages, fixer and
// generator modules and lazy fonts already in the worker. All of those are the
// worker's, not a document's (packages.ts and server.ts keep them per worker,
// fonts belong to the wasm instance), so they outlive the documents that
// loaded them.

import { type CompileTarget, resolvePlugins, type TypstreamPlugin } from "@typstream/core";

/**
 * What {@link Engine.preload} warms.
 * @beta
 */
export interface PreloadOptions {
  /**
   * Plugins the coming documents use. Their packages, fixer and generator
   * modules and catalogue fonts load now, and the first of each plugin's
   * prompt examples compiles, so what it draws (a generator's diagrams, a
   * package's imports) is warm too.
   */
  plugins?: readonly TypstreamPlugin[];
  /**
   * The targets the coming documents compile to, each compiled once. Default
   * both: `["html", "paged"]`. The plugins' examples compile in the first only.
   */
  targets?: readonly CompileTarget[];
  /**
   * Typst to compile instead of the built-in sample and the plugins'
   * examples, e.g. a document like the ones the app makes.
   */
  text?: string;
}

/** Headings, the text faces the base fonts have, code and math: what nearly every document lays out. */
const SAMPLE = "= Preload\n*Bold*, _italic_, *_both_*, `code` and $x^2 + sqrt(y) = sum_(i=1)^n i/2$.\n";

/** One compile of a warm-up: its source and target. */
export interface PreloadCompile {
  text: string;
  target: CompileTarget;
}

/**
 * The compiles that warm what `options` asks for: the sample (or `text`) in
 * every target, then the first example of each plugin in the first target.
 * Each is its own document, so an example that fails doesn't stop the others.
 */
export const preloadCompiles = (options: PreloadOptions): PreloadCompile[] => {
  const targets: readonly CompileTarget[] = options.targets?.length ? options.targets : ["html", "paged"];
  const first = targets[0] as CompileTarget;
  if (options.text !== undefined) return targets.map((target) => ({ text: options.text as string, target }));
  const examples = resolvePlugins(options.plugins ?? []).flatMap((p) => {
    const example = p.prompt?.examples?.[0]?.output;
    return example ? [{ text: example, target: first }] : [];
  });
  return [...targets.map((target) => ({ text: SAMPLE, target })), ...examples];
};
