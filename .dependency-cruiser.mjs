// Layering rules (PLAN.md §4.1), built from tools/repo/layers.mjs. Run with
// `pnpm check:layers`, which also proves the rules fire on a fixture of illegal
// imports (tools/repo/fixtures/layering).
import { BINDINGS, LAYERS, PACKAGES } from "./tools/repo/layers.mjs";

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

// A workspace package, whether the import resolved to its directory (tsconfig
// paths, relative paths) or stayed a bare specifier (not linked, not built).
const packagePath = (dirs) => {
  const names = dirs.map((d) => escapeRegExp(PACKAGES[d].name));
  return `^(packages/(${dirs.map(escapeRegExp).join("|")})/|(${names.join("|")})(/|$))`;
};

const layering = Object.entries(PACKAGES).map(([dir, pkg]) => {
  const forbidden = Object.keys(PACKAGES).filter((d) => d !== dir && !pkg.deps.includes(d));
  const allowed = pkg.deps.map((d) => PACKAGES[d].name).join(", ") || "no other packages";
  return {
    name: `layering:${dir}`,
    severity: "error",
    comment: `${pkg.name} (layer ${pkg.layer}, ${LAYERS[pkg.layer]}) may import ${allowed} (PLAN.md §4.1).`,
    from: { path: `^packages/${escapeRegExp(dir)}/` },
    to: { path: packagePath(forbidden) },
  };
});

const belowBindings = Object.keys(PACKAGES).filter((d) => PACKAGES[d].layer < BINDINGS);

/** @type {import("dependency-cruiser").IConfiguration} */
export default {
  forbidden: [
    ...layering,
    {
      name: "core-no-dependencies",
      severity: "error",
      comment: "@typstream/core has no dependencies: contracts and tiny pure helpers only (PLAN.md §4.1).",
      from: { path: "^packages/core/src/" },
      to: { pathNot: "^packages/core/src/" },
    },
    {
      name: "no-react-below-bindings",
      severity: "error",
      comment: "Only the bindings layer and above may import React (PLAN.md §4.1).",
      from: { path: `^packages/(${belowBindings.map(escapeRegExp).join("|")})/` },
      to: { path: "(^|/node_modules/)(react|react-dom|preact)(/|$)" },
    },
    {
      name: "no-apps",
      severity: "error",
      comment: "Apps import packages, never the reverse.",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "no-spikes",
      severity: "error",
      comment: "spikes/ is throwaway: port code into packages/ instead of importing it.",
      from: { pathNot: "^spikes/" },
      to: { path: "^spikes/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // Build output: bundles, not the source the rules are about.
    exclude: { path: "(^|/)dist/" },
    // Resolve @typstream/* to source, so the check doesn't need a build.
    tsConfig: { fileName: "tsconfig.base.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "types", "default"],
      mainFields: ["module", "types", "main"],
    },
  },
};
