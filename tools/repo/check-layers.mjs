// `pnpm check:layers`: the layering of PLAN.md §4.1.
//
// 1. Every directory in packages/ is in tools/repo/layers.mjs, under its npm
//    name, and declares only the workspace dependencies its row allows.
// 2. dependency-cruiser on a fixture of illegal imports reports exactly the
//    expected violations, so a rule that silently stopped matching fails here.
// 3. dependency-cruiser on packages/.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PACKAGES } from "./layers.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const depcruise = join(root, "node_modules/.bin/depcruise");
const config = join(root, ".dependency-cruiser.mjs");
const errors = [];

// 1. Manifests.
const names = new Map(Object.entries(PACKAGES).map(([dir, pkg]) => [pkg.name, dir]));
for (const dir of readdirSync(join(root, "packages"))) {
  const manifest = join(root, "packages", dir, "package.json");
  if (!existsSync(manifest)) continue;
  const pkg = PACKAGES[dir];
  if (!pkg) {
    errors.push(`packages/${dir} is not in tools/repo/layers.mjs: give it a layer and its allowed deps`);
    continue;
  }
  const json = JSON.parse(readFileSync(manifest, "utf8"));
  if (json.name !== pkg.name) errors.push(`packages/${dir}: name is ${json.name}, layers.mjs says ${pkg.name}`);
  const declared = { ...json.dependencies, ...json.peerDependencies, ...json.optionalDependencies };
  for (const dep of Object.keys(declared)) {
    const target = names.get(dep);
    if (target && !pkg.deps.includes(target)) {
      errors.push(`packages/${dir}/package.json depends on ${dep}, which layers.mjs doesn't allow for ${pkg.name}`);
    }
  }
}

// The changesets fixed group is exactly the existing packages marked `fixed`.
const existing = Object.entries(PACKAGES).filter(([dir]) => existsSync(join(root, "packages", dir, "package.json")));
const wantFixed = existing.filter(([, pkg]) => pkg.fixed).map(([, pkg]) => pkg.name);
const changesets = JSON.parse(readFileSync(join(root, ".changeset/config.json"), "utf8"));
const haveFixed = changesets.fixed.flat();
if (changesets.fixed.length !== 1 || wantFixed.sort().join() !== [...haveFixed].sort().join()) {
  errors.push(
    `.changeset/config.json: fixed should be [${JSON.stringify(wantFixed)}], is ${JSON.stringify(changesets.fixed)}`,
  );
}

// 2. Fixture: [rule, from, to] for every violation it must produce.
const expected = [
  ["core-no-dependencies", "packages/core/src/index.ts", "packages/heal/src/index.ts"],
  ["core-no-dependencies", "packages/core/src/index.ts", "react"],
  ["layering:core", "packages/core/src/index.ts", "packages/heal/src/index.ts"],
  ["layering:dom", "packages/dom/src/index.ts", "packages/heal/src/index.ts"],
  ["layering:heal", "packages/heal/src/index.ts", "packages/engine/src/index.ts"],
  ["layering:html-compat", "packages/html-compat/src/index.ts", "packages/engine-wasm/src/index.ts"],
  ["layering:html-compat:tests", "packages/html-compat/__tests__/a.test.ts", "packages/heal/src/index.ts"],
  ["no-react-below-bindings", "packages/core/src/index.ts", "react"],
  ["no-react-below-bindings", "packages/engine/src/index.ts", "react"],
  ["no-spikes", "packages/heal/src/index.ts", "spikes/spike.ts"],
].map((v) => v.join(" "));
const fixture = spawnSync(depcruise, ["packages", "--config", config, "--output-type", "json"], {
  cwd: join(root, "tools/repo/fixtures/layering"),
  encoding: "utf8",
});
const actual = JSON.parse(fixture.stdout)
  .summary.violations.map((v) => [v.rule.name, v.from, v.to].join(" "))
  .sort();
const missing = expected.filter((v) => !actual.includes(v));
const extra = actual.filter((v) => !expected.includes(v));
for (const v of missing) errors.push(`fixture: expected violation not reported: ${v}`);
for (const v of extra) errors.push(`fixture: unexpected violation: ${v}`);

if (errors.length > 0) {
  for (const e of errors) console.error(`✗ ${e}`);
  process.exit(1);
}
console.log(`✓ manifests match layers.mjs; fixture reports all ${expected.length} expected violations`);

// 3. The real tree. depcruise prints the violations and sets the exit code.
try {
  execFileSync(depcruise, ["packages", "--config", config, "--output-type", "err-long"], {
    cwd: root,
    stdio: "inherit",
  });
} catch {
  process.exit(1);
}
