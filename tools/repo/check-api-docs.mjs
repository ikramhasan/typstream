// `pnpm check:api-docs`: everything a consumer can import is documented (#33, #4's 0.1 checklist).
//
// It reads the API reports (packages/*/api/*.api.md), which `pnpm check:api` keeps equal to the built
// .d.ts, so it needs no build. For every report it checks, on everything not tagged @internal (@public
// and @beta alike: both are published, and @beta only warns that it may change):
//
// 1. TSDoc. api-extractor marks a declaration `(undocumented)` when its doc comment has no summary of
//    at least 10 characters. That covers each export and each member (properties, methods, enum
//    members); constructors are exempt (api-extractor writes their summary). Re-exports of another
//    package's names (`export { X }`) are checked in the package that declares them.
// 2. The website. Each export's name appears in code (a code span, a fence, or an
//    `<auto-type-table name="…">`) on its package's reference page,
//    apps/website/content/docs/reference/<dir>.mdx (or <dir>/index.mdx).
//
// A fixture (tools/repo/fixtures/api-docs) must produce exactly the expected problems, so a parser that
// silently stopped matching the report format fails here.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

/**
 * The declarations of an API report: `{ name, path, tag, undocumented, exported }`, where `path` names
 * members after their container (`Healer.reset`) and `tag` is the effective release tag (a member
 * inherits its container's unless it has its own). A default export (`function init …;` then
 * `export default init;`) has `exported: "default"`.
 */
export function parseReport(text) {
  const items = [];
  // The container at each depth (4 spaces per level): its path and effective tag.
  const stack = [];
  let pending = null;
  for (const line of text.split("\n")) {
    const indent = line.match(/^ */)[0].length;
    const body = line.trim();
    if (body === "" || body.startsWith("```") || body === "}" || body === "};") continue;
    if (body.startsWith("//")) {
      // `// @public`, `// @beta (undocumented)`, `// (undocumented)`; other notes (warnings,
      // "No @packageDocumentation") don't belong to a declaration.
      const comment = body.match(/^\/\/ (@\w+)?\s*(\(undocumented\))?$/);
      if (comment?.[1] || comment?.[2]) pending = { tag: comment[1], undocumented: Boolean(comment[2]) };
      continue;
    }
    const defaultExport = body.match(/^export default (\w+);$/);
    if (defaultExport) {
      for (const item of items) if (item.path === defaultExport[1]) item.exported = "default";
      continue;
    }
    // `export { Range_2 as Range }`: api-extractor renamed a declaration that clashes with a global.
    for (const [, local, alias] of body.startsWith("export {") ? body.matchAll(/(\w+) as (\w+)/g) : []) {
      for (const item of items) if (item.path === local) item.name = alias;
    }
    if (/^(?:import |export \{|export \*)/.test(body)) continue;
    // A documented member with the default tag has no annotation, but its line still names the
    // container of what follows. Lines that name nothing continue a multi-line declaration.
    const depth = indent / 4;
    const name = Number.isInteger(depth) ? declarationName(body) : null;
    if (name === null) {
      if (pending) throw new Error(`can't read the declaration after a doc annotation: ${line}`);
      continue;
    }
    stack.length = depth;
    const parent = stack[depth - 1];
    const tag = pending?.tag ?? parent?.tag;
    const path = parent ? `${parent.path}${name.startsWith("[") ? "" : "."}${name}` : name;
    if (pending) items.push({ name, path, tag, undocumented: pending.undocumented, exported: depth === 0 });
    stack[depth] = { path, tag };
    pending = null;
  }
  return items;
}

// The declared name of a report line: `export interface Healer {`, `function init (…`, `readonly input:
// string;`, `reset(input?: string): void;`, `get done(): boolean;`, `Html = "html",`, `"aria-label"?:
// string;`, `[key: string]: X;` ("[key: string]"), `new (url: string): X;` (a construct signature:
// "new"), `(input: string): X;` (a call signature: "(call)").
function declarationName(body) {
  const declared = body.match(
    /^(?:export )?(?:declare )?(?:abstract )?(?:const|let|var|function|interface|type|class|enum|namespace) (\w+)/,
  );
  if (declared) return declared[1];
  const member = body
    .replace(/^(?:(?:public|protected|private|static|readonly|abstract|declare|get|set) )+/, "")
    .match(/^(?:"([^"]+)"|(\[[^\]]+\])|(new)\b|(\w+)|(\(|<))/);
  if (!member) return null;
  return member[5] ? "(call)" : (member[1] ?? member[2] ?? member[3] ?? member[4]);
}

/** The names an MDX page shows in code: code spans, fenced blocks and `name="…"` attributes. */
export function namesInCode(mdx) {
  const code = [];
  const prose = mdx.replace(/^(`{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, (fence) => {
    code.push(fence);
    return "";
  });
  for (const span of prose.matchAll(/(`+)([\s\S]+?)\1/g)) code.push(span[2]);
  for (const attr of prose.matchAll(/\bname="([^"]+)"/g)) code.push(attr[1]);
  return new Set(code.join("\n").match(/[A-Za-z_$][\w$]*/g));
}

// Declarations a tool generates with no way to give them doc comments, by report: exempt, with their
// members. wasm-bindgen writes engine-wasm's init types and every exported struct's `free()` and
// `[Symbol.dispose]()` itself (lib.rs documents everything else); the reference page covers them
// under `init` and `initSync`.
const GENERATED = {
  "engine-wasm.api.md": ["InitInput", "SyncInitInput", "InitOutput", "Engine.free", "Engine[Symbol.dispose]"],
};

/**
 * The problems of one report against its reference page (`page` is null when there is none);
 * `generated` lists the declarations to skip.
 */
export function checkReport(report, page, generated = []) {
  const problems = [];
  const isGenerated = (path) => generated.some((g) => path === g || path.startsWith(`${g}.`));
  const items = parseReport(report).filter((item) => item.tag !== "@internal" && !isGenerated(item.path));
  for (const item of items) if (item.undocumented) problems.push(`${item.path}: no TSDoc summary`);
  if (page === null) {
    problems.push("no reference page");
    return problems;
  }
  const shown = namesInCode(page);
  for (const item of items) {
    if (item.exported === true && !shown.has(item.name)) problems.push(`${item.name}: not on the reference page`);
  }
  return problems;
}

// The package's page, or null; problems name the page it should have.
function referencePage(dir) {
  const pages = [`${dir}.mdx`, `${dir}/index.mdx`].map((f) => join(root, "apps/website/content/docs/reference", f));
  return pages.find((path) => existsSync(path)) ?? null;
}

const errors = [];

// The fixture first: its problems, exactly.
const fixture = join(root, "tools/repo/fixtures/api-docs");
const expected = [
  "Documented.short: no TSDoc summary",
  "Documented.new: no TSDoc summary",
  "Documented[key: string]: no TSDoc summary",
  "Documented.Nested: no TSDoc summary",
  "Documented.Nested.inner: no TSDoc summary",
  "Undocumented: no TSDoc summary",
  "BetaThing: no TSDoc summary",
  "BetaThing.member: no TSDoc summary",
  "Kind.B: no TSDoc summary",
  "init: no TSDoc summary",
  "Undocumented: not on the reference page",
  "Kind: not on the reference page",
];
const actual = checkReport(
  readFileSync(join(fixture, "fixture.api.md"), "utf8"),
  readFileSync(join(fixture, "fixture.mdx"), "utf8"),
  ["Generated", "Documented.free"],
);
if (actual.join("\n") !== expected.join("\n")) {
  errors.push(
    `the fixture (tools/repo/fixtures/api-docs) should report\n    ${expected.join("\n    ")}\n  but reports\n    ${actual.join("\n    ")}`,
  );
}

let reports = 0;
for (const dir of readdirSync(join(root, "packages"))) {
  const apiDir = join(root, "packages", dir, "api");
  if (!existsSync(apiDir)) continue;
  const found = referencePage(dir);
  const page = found && readFileSync(found, "utf8");
  const pagePath = found ?? join(root, "apps/website/content/docs/reference", `${dir}.mdx`);
  for (const file of readdirSync(apiDir).filter((f) => f.endsWith(".api.md"))) {
    reports++;
    const where = relative(root, join(apiDir, file));
    for (const problem of checkReport(readFileSync(join(apiDir, file), "utf8"), page, GENERATED[file])) {
      const hint = problem.endsWith("reference page") ? ` (${relative(root, pagePath)})` : "";
      errors.push(`${where}: ${problem}${hint}`);
    }
  }
}

if (errors.length > 0) {
  console.error(`✗ ${errors.length} public API problem(s):\n  ${errors.join("\n  ")}`);
  console.error(
    "\nWrite a TSDoc summary (why, not the name restated) and name the export on its reference page;" +
      " then `pnpm api:update`. Tag it @internal if no consumer should use it.",
  );
  process.exit(1);
}
console.log(`✓ every @public and @beta API in ${reports} reports has TSDoc and a place on the website`);
