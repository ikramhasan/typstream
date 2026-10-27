// Plugins' engine and heal facets (PLAN §8.0). Fonts, fixer modules and
// packages shared by the worker come from `createEngine`'s plugins and go out
// with `initialize`; a document's plugins add its files, packages, preamble,
// heal handlers and lint settings, and fixer modules the worker loads for it
// (`document/open`). Fonts stay the engine's: they are the worker's, not a
// document's, so a document's plugin can't bring its own.

import { type FontSource, type InitializeOptions, resolvePlugins, type TypstreamPlugin } from "@typstream/core";
import type { HealOptions } from "@typstream/heal";
import type { DocumentOptions } from "./document";

/** `initialize`'s options: the engine's own, then its plugins' fonts, packages and fixer modules. */
export const initializeOptions = (
  initialize: InitializeOptions | undefined,
  plugins: readonly TypstreamPlugin[],
): InitializeOptions | undefined => {
  const facets = resolvePlugins(plugins).flatMap((p) => (p.engine ? [p.engine] : []));
  if (!facets.length) return initialize;
  const fonts = [...(initialize?.fonts ?? []), ...facets.flatMap((e) => e.fonts ?? [])];
  const packages = [...(initialize?.packages ?? []), ...facets.flatMap((e) => e.packages ?? [])];
  const fixerModules = [
    ...new Set([...(initialize?.fixerModules ?? []), ...facets.flatMap((e) => e.fixerModules ?? [])]),
  ];
  return {
    ...initialize,
    ...(fonts.length ? { fonts } : {}),
    ...(packages.length ? { packages } : {}),
    ...(fixerModules.length ? { fixerModules } : {}),
  };
};

/** A document's options with its plugins applied, and the fixer modules they bring. @internal */
export interface ResolvedDocumentOptions extends DocumentOptions {
  fixerModules?: string[];
}

/**
 * The document's options with its plugins' facets folded in: plugins come
 * first (in {@link resolvePlugins} order) and the document's own options after
 * them, so its preamble runs last, its files replace theirs and its lint
 * settings win. `fonts` lists plugin fonts the engine doesn't have.
 */
export const documentOptions = (
  options: DocumentOptions,
  engineFonts: readonly FontSource[],
): { options: ResolvedDocumentOptions; fonts: { key: string; font: FontSource }[] } => {
  const plugins = resolvePlugins(options.plugins ?? []);
  if (!plugins.length) return { options: { ...options, plugins }, fonts: [] };
  const engines = plugins.flatMap((p) => (p.engine ? [p.engine] : []));
  const preamble = [...engines.map((e) => e.preamble), options.preamble].filter((p) => p).join("\n");
  const files = Object.assign({}, ...engines.map((e) => e.files), options.files);
  const packages = [...engines.flatMap((e) => e.packages ?? []), ...(options.packages ?? [])];
  const fixerModules = [...new Set(engines.flatMap((e) => e.fixerModules ?? []))];
  const handlers = [...plugins.flatMap((p) => p.heal?.handlers ?? []), ...(options.heal?.handlers ?? [])];
  const lint = Object.assign({}, ...plugins.map((p) => p.heal?.lint), options.heal?.lint) as HealOptions["lint"];
  const heal: HealOptions = {
    ...options.heal,
    ...(handlers.length ? { handlers } : {}),
    ...(Object.keys(lint ?? {}).length ? { lint } : {}),
  };
  const known = new Set(engineFonts.map((f) => (f.kind === "url" ? f.url : f.data)));
  const fonts = plugins.flatMap((p) =>
    (p.engine?.fonts ?? [])
      .filter((f) => !known.has(f.kind === "url" ? f.url : f.data))
      .map((font) => ({ key: p.key, font })),
  );
  return {
    options: {
      ...options,
      plugins,
      ...(preamble ? { preamble } : {}),
      ...(Object.keys(files).length ? { files } : {}),
      ...(packages.length ? { packages } : {}),
      ...(fixerModules.length ? { fixerModules } : {}),
      heal,
    },
    fonts,
  };
};
