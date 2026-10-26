// The package layers of PLAN.md §4.1, as data. `.dependency-cruiser.mjs` turns
// this into import rules and `check-layers.mjs` checks package.json against it.
//
// `deps` is the "Deps" column of §4.1: the only workspace packages a package may
// import. Deps must sit in a lower layer, or in the same layer when §4.1 says so
// (engine → engine-wasm, node → engine, react → dom, typstream → react). Packages that don't exist yet
// are listed so their rules are in place before their code is.
//
// `testDeps` are packages only the package's tests (`__tests__/`) may import too, as
// devDependencies: html-compat's tests compile documents with the engine.
//
// `fixed` marks the packages released in one fixed version group (PLAN §10.4).
// Changesets rejects names that don't exist yet, so .changeset/config.json lists
// only the ones that do; check-layers.mjs keeps the two in sync.
//
// Adding a package: add a row here, plus a `fixed` entry in .changeset/config.json
// if its row says so.

/** Layer names, lowest first. */
export const LAYERS = ["contracts", "language", "runtime", "content", "bindings", "integrations"];

/** Index of the bindings layer: nothing below it may import React. */
export const BINDINGS = LAYERS.indexOf("bindings");

/**
 * Keyed by directory under `packages/`.
 * @type {Record<string, { name: string, layer: number, deps: string[], testDeps?: string[], fixed?: boolean }>}
 */
export const PACKAGES = {
  core: { name: "@typstream/core", layer: 0, deps: [], fixed: true },
  heal: { name: "@typstream/heal", layer: 1, deps: ["core"], fixed: true },
  syntax: { name: "@typstream/syntax", layer: 1, deps: ["core"] },
  engine: { name: "@typstream/engine", layer: 2, deps: ["core", "heal", "engine-wasm"], fixed: true },
  "engine-wasm": { name: "@typstream/engine-wasm", layer: 2, deps: [] },
  node: { name: "@typstream/node", layer: 2, deps: ["core", "heal", "engine"] },
  edu: { name: "@typstream/edu", layer: 3, deps: ["core"] },
  "html-compat": { name: "@typstream/html-compat", layer: 3, deps: ["core"], testDeps: ["engine-wasm"] },
  dom: { name: "@typstream/dom", layer: 4, deps: ["core", "engine"], fixed: true },
  react: { name: "@typstream/react", layer: 4, deps: ["dom"], fixed: true },
  typstream: { name: "typstream", layer: 4, deps: ["react", "engine", "heal"], fixed: true },
  ai: { name: "@typstream/ai", layer: 5, deps: ["core", "heal"] },
  codemirror: { name: "@typstream/codemirror", layer: 5, deps: ["syntax", "engine"] },
  "editor-core": { name: "@typstream/editor-core", layer: 5, deps: ["syntax", "engine", "dom"] },
  "editor-react": { name: "@typstream/editor-react", layer: 5, deps: ["editor-core", "syntax", "engine", "dom"] },
};

// The table must itself respect the layering, or the rules built from it would
// allow what §4.1 forbids.
for (const [dir, pkg] of Object.entries(PACKAGES)) {
  for (const dep of [...pkg.deps, ...(pkg.testDeps ?? [])]) {
    const target = PACKAGES[dep];
    if (!target) throw new Error(`layers.mjs: ${dir} depends on unknown package ${dep}`);
    if (target.layer > pkg.layer)
      throw new Error(`layers.mjs: ${dir} (layer ${pkg.layer}) depends on ${dep} (layer ${target.layer})`);
  }
}
