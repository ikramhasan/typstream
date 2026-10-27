// What plugins bring to rendering (PLAN §8.0): their stylesheets, before the
// app's own. The sanitizer reads their `sanitize` facet itself
// (html/sanitize.ts). Plugins are taken in the order given: mountTypstream
// resolves them first (core's resolvePlugins, kept out of the renderers' bundles).

import type { TypstreamPlugin } from "@typstream/core";

/** Plugins' stylesheets, then `stylesheets`, each once. */
export const stylesheetsOf = (
  plugins: readonly TypstreamPlugin[] | undefined,
  stylesheets: readonly string[] | undefined,
): string[] => [...new Set([...(plugins ?? []).flatMap((p) => p.stylesheets ?? []), ...(stylesheets ?? [])])];
