// Checks that the compatibility page (content/docs/resources/compatibility.mdx) states what the repo enforces
// (PLAN.md §10.4: "each release declares its Typst version, supported browsers and React versions; documented on the
// website and asserted in CI"). Each fact is read from where it is decided, and the page must say it:
//   - the Typst version engine-wasm compiles (its Cargo.lock);
//   - the Playwright the browser tests run in, the React range the bindings take, the React, Next.js, Vite and AI
//     SDK versions the examples are built with, and the Node.js versions @typstream/node supports and CI runs;
//   - every bundle budget, read from the packages' scripts/size.mjs, which CI's size jobs enforce.
// A budget that changes without the page fails here, with the line to write.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const json = (path) => JSON.parse(read(path));
const page = read("apps/website/content/docs/resources/compatibility.mdx");
const errors = [];

/** `^19.3.1` → `19.3`. */
const minor = (range) => /(\d+\.\d+)/.exec(range)?.[1];
/** `^7.0.2` → `7`. */
const major = (range) => /(\d+)/.exec(range)?.[1];
const expect = (fact, text) => {
  if (!page.includes(text)) errors.push(`${fact}: the page should say \`${text}\``);
};

// Typst.
const typst = /\[\[package\]\]\nname = "typst"\nversion = "([^"]+)"/.exec(read("packages/engine-wasm/Cargo.lock"))?.[1];
if (!typst) errors.push("can't find the typst crate in packages/engine-wasm/Cargo.lock");
expect("Typst (engine-wasm's Cargo.lock)", `## Typst ${typst}`);
expect("Typst (engine-wasm's Cargo.lock)", `**Typst ${typst}**`);

// Browsers, frameworks and runtimes.
const react = json("packages/react/package.json");
expect("Playwright (packages/react's devDependencies)", `(Playwright ${minor(react.devDependencies.playwright)})`);
for (const name of ["packages/react", "packages/typstream"]) {
  expect(`React peer range (${name})`, `\`react\` \`${json(`${name}/package.json`).peerDependencies.react}\``);
}
expect("React tested (packages/react's devDependencies)", `| ${minor(react.devDependencies.react)} |`);
const nextjs = json("examples/nextjs-ai-sdk/package.json").dependencies;
expect("Next.js (examples/nextjs-ai-sdk)", `| ${minor(nextjs.next)}, Turbopack`);
expect(
  "AI SDK (examples/nextjs-ai-sdk)",
  `\`ai\` ${major(nextjs.ai)}, \`@ai-sdk/react\` ${major(nextjs["@ai-sdk/react"])}`,
);
const viteApp = ["examples/vite-react", "apps/playground"].find((dir) => existsSync(join(root, dir, "package.json")));
const vitePkg = json(`${viteApp}/package.json`);
const vite = vitePkg.devDependencies?.vite ?? vitePkg.dependencies?.vite;
expect(`Vite (${viteApp})`, `| No configuration | ${minor(vite)} |`);
const nodeEngine = /^>=(\d+)$/.exec(json("packages/node/package.json").engines?.node ?? "")?.[1];
if (!nodeEngine) errors.push('packages/node/package.json: engines.node should be ">=<major>"');
const ciNode = /^ {2}NODE: "(\d+)"$/m.exec(read(".github/workflows/ci.yml"))?.[1];
expect("Node.js (@typstream/node's engines, CI's NODE)", `| ${nodeEngine} or later | ${ciNode} |`);

// Bundle budgets: [the page's text, the size script, the budget's literal in it].
const kb = (n) => `≤ ${Number(n)} KB`;
const budgets = [
  ["| `@typstream/heal` | ", "heal", /BUDGET_GZ = ([\d.]+) \* 1024/],
  ["| `@typstream/engine`, main thread | ", "engine", /MAIN_THREAD = ([\d.]+) \* 1024/],
  ["| `@typstream/engine/websocket` | ", "engine", /"src\/websocket\.ts", ([\d.]+) \* 1024/],
  ["| `@typstream/engine/images` | ", "engine", /"src\/images\.ts", ([\d.]+) \* 1024/],
  ["| `@typstream/react`, with `@typstream/dom` | ", "react", /const BUDGET = ([\d.]+) \* 1024/],
  ["| `@typstream/dom` HTML renderer | ", "dom", /"src\/html\/index\.ts", ([\d.]+) \* 1024/],
  ["| `@typstream/dom` paged renderer | ", "dom", /"src\/paged\/index\.ts", ([\d.]+) \* 1024/],
  ["| `@typstream/dom` standalone HTML export | ", "dom", /"src\/export\/index\.ts", ([\d.]+) \* 1024/],
  ["| `@typstream/ai` | ", "ai", /const budget = ([\d.]+) \* 1024/],
  ["| Engine worker JS | ", "engine", /"src\/worker\.ts", ([\d.]+) \* 1024/],
  ["| `@typstream/docx` | ", "engine", /"\.\.\/docx\/src\/index\.ts", ([\d.]+) \* 1024/],
  ["| `@typstream/mindmap` plugin | ", "mindmap", /\["plugin", [^\n]*, ([\d.]+) \* 1024\]/],
  ["Its React entry ", "mindmap", /\["React entry", [^\n]*, ([\d.]+) \* 1024\]/],
  ["React Flow ", "mindmap", /chunks\.reduce[^\n]*\n\s*([\d.]+) \* 1024/],
  ["| `@typstream/mermaid` plugin | ", "mermaid", /\["plugin", [^\n]*, ([\d.]+) \* 1024\]/],
  ["the plugin opens: ", "mermaid", /\["generator[^\n]*, ([\d.]+) \* 1024\]/],
];
for (const [text, pkg, pattern] of budgets) {
  const script = `packages/${pkg}/scripts/size.mjs`;
  const n = pattern.exec(read(script))?.[1];
  if (n === undefined) errors.push(`${script}: can't find the budget for "${text.trim()}" (${pattern})`);
  else expect(`budget in ${script}`, `${text}${kb(n)}`);
}
const wasm = /BUDGET_BR = ([\d_]+);/.exec(read("packages/engine-wasm/scripts/size.mjs"))?.[1];
if (!wasm) errors.push("packages/engine-wasm/scripts/size.mjs: can't find BUDGET_BR");
expect("budget in packages/engine-wasm/scripts/size.mjs", `≤ ${Number(wasm?.replaceAll("_", "")) / 1e6} MB brotli`);

if (errors.length > 0) {
  for (const e of errors) console.error(`✗ compatibility.mdx: ${e}`);
  process.exit(1);
}
console.log(`✓ compatibility.mdx states Typst ${typst}, the versions tested and ${budgets.length + 1} budgets`);
