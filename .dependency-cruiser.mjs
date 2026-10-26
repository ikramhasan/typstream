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

// A package's tests may also import its `testDeps` (e.g. html-compat's tests compile with
// the engine); its shipped code may not.
const layering = Object.entries(PACKAGES).flatMap(([dir, pkg]) => {
  const rule = (name, from, deps, what) => {
    const forbidden = Object.keys(PACKAGES).filter((d) => d !== dir && !deps.includes(d));
    const allowed = deps.map((d) => PACKAGES[d].name).join(", ") || "no other packages";
    return {
      name,
      severity: "error",
      comment: `${what} (layer ${pkg.layer}, ${LAYERS[pkg.layer]}) may import ${allowed} (PLAN.md §4.1).`,
      from,
      to: { path: packagePath(forbidden) },
    };
  };
  const root = `^packages/${escapeRegExp(dir)}/`;
  if (!pkg.testDeps?.length) return [rule(`layering:${dir}`, { path: root }, pkg.deps, pkg.name)];
  const tests = `${root}__tests__/`;
  return [
    rule(`layering:${dir}`, { path: root, pathNot: tests }, pkg.deps, pkg.name),
    rule(`layering:${dir}:tests`, { path: tests }, [...pkg.deps, ...pkg.testDeps], `${pkg.name}'s tests`),
  ];
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
      name: "no-spikes",
      severity: "error",
      comment: "spikes/ is throwaway: port code into packages/ instead of importing it.",
      from: { pathNot: "^spikes/" },
      to: { path: "^spikes/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
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
