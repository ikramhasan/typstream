// Validates the corpus against native Typst (PLAN.md §11.2): every entry has
// metadata, streams join back to their source, and `typst compile` does what
// meta.json says (pages, warnings, errors, or hitting resource limits).
//
//   pnpm corpus:validate [filter...] [--write-pages]
//
// Needs `typst` 0.15.1 on PATH (or TYPST=/path/to/typst). Compiles with
// embedded fonts only (--ignore-system-fonts), so results don't depend on the
// machine. `limit` entries run under `prlimit` (util-linux); without it they're
// skipped. --write-pages records the page counts of `ok` entries in meta.json.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TYPST_VERSION = "0.15.1";
const SETS = ["edu", "adversarial"];
const TIMEOUT_MS = 60_000;
// Runaway loops and memory bombs must fail inside these.
const LIMIT_TIMEOUT_MS = 10_000;
const LIMIT_MEMORY_BYTES = 2 * 1024 ** 3;

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const writePages = args.includes("--write-pages");
const filters = args.filter((a) => !a.startsWith("--"));
const typst = process.env.TYPST ?? "typst";

const version = spawnSync(typst, ["--version"], { encoding: "utf8" });
if (version.error || !version.stdout.startsWith(`typst ${TYPST_VERSION} `)) {
  console.error(
    `corpus: need typst ${TYPST_VERSION} (found: ${version.error ? "none" : version.stdout.trim()}).\n` +
      "Install it from https://github.com/typst/typst/releases/tag/v0.15.1 or set TYPST=/path/to/typst.",
  );
  process.exit(2);
}
const hasPrlimit = !spawnSync("prlimit", ["--version"]).error;

const failures = [];
const fail = (id, message) => failures.push(`${id}: ${message}`);

// 1. Structure: meta.json ↔ .typ files, streams join to their source.
const entries = [];
for (const set of SETS) {
  const dir = join(root, set);
  const metaPath = join(dir, "meta.json");
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  const names = readdirSync(dir)
    .filter((f) => f.endsWith(".typ"))
    .map((f) => f.slice(0, -4))
    .sort();
  for (const name of Object.keys(meta)) {
    if (!names.includes(name)) fail(`${set}/${name}`, "listed in meta.json but has no .typ");
  }
  for (const name of names) {
    const id = `${set}/${name}`;
    const m = meta[name];
    if (!m) {
      fail(id, "missing from meta.json");
      continue;
    }
    if (typeof m.category !== "string") fail(id, "meta.category must be a string");
    const expect = m.expect ?? "ok";
    if (!["ok", "error", "limit"].includes(expect)) fail(id, `unknown expect "${expect}"`);
    if (expect === "error" && !m.expectedErrors?.length) fail(id, "expect=error needs expectedErrors");
    const path = join(dir, `${name}.typ`);
    const streamPath = join(dir, `${name}.stream.jsonl`);
    if (existsSync(streamPath)) {
      const joined = readFileSync(streamPath, "utf8")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l).text)
        .join("");
      if (joined !== readFileSync(path, "utf8")) fail(id, "stream chunks don't join to the .typ source");
      if (!m.stream) fail(id, "has a .stream.jsonl but no meta.stream provenance");
    }
    if (filters.length === 0 || filters.some((f) => id.includes(f)))
      entries.push({ id, set, name, path, meta: m, expect });
  }
}

// 2. Native compiles.
const out = mkdtempSync(join(tmpdir(), "typstream-corpus-"));
const run = (entry) =>
  new Promise((resolve) => {
    const limited = entry.expect === "limit";
    const pdf = join(out, `${entry.id.replace("/", "__")}.pdf`);
    const compile = [
      "compile",
      // `html.elem` exists only with the feature; paged output is the same either way.
      "--features",
      "html",
      "--ignore-system-fonts",
      "--diagnostic-format",
      "short",
      "--root",
      root,
      entry.path,
      pdf,
    ];
    const [cmd, cmdArgs] = limited
      ? ["prlimit", [`--as=${LIMIT_MEMORY_BYTES}`, "--core=0", "--", typst, ...compile]]
      : [typst, compile];
    const started = Date.now();
    const child = spawn(cmd, cmdArgs, {
      timeout: limited ? LIMIT_TIMEOUT_MS : TIMEOUT_MS,
      killSignal: "SIGKILL",
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => {
      if (stderr.length < 100_000) stderr += d;
    });
    child.on("close", (code, signal) => {
      const ms = Date.now() - started;
      const diagnostics = [...stderr.matchAll(/^.*?: (warning|error): (.*)$/gm)].map((m) => ({
        severity: m[1],
        message: m[2],
      }));
      const pages = code === 0 ? (readFileSync(pdf, "latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length : 0;
      resolve({ entry, code, signal, ms, stderr, diagnostics, pages });
    });
  });

const check = ({ entry, code, signal, ms, stderr, diagnostics, pages }) => {
  const { id, meta, expect } = entry;
  const ended = signal ? `killed (${signal}) after ${ms} ms` : `exit ${code} after ${ms} ms`;
  if (expect === "ok") {
    if (code !== 0) return fail(id, `expected to compile, ${ended}:\n${stderr.trim()}`);
    const allowed = meta.allowedWarnings ?? [];
    for (const w of diagnostics.filter((d) => d.severity === "warning")) {
      if (!allowed.some((a) => w.message.includes(a))) fail(id, `unexpected warning: ${w.message}`);
    }
    for (const a of allowed) {
      if (!diagnostics.some((d) => d.message.includes(a))) fail(id, `allowed warning never emitted: ${a}`);
    }
    if (writePages) meta.expectedPages = pages;
    else if (meta.expectedPages !== pages) fail(id, `expected ${meta.expectedPages} pages, got ${pages}`);
  } else if (expect === "error") {
    if (code === 0 || signal) return fail(id, `expected compile errors, ${ended}`);
    for (const e of meta.expectedErrors) {
      if (!stderr.includes(e)) fail(id, `expected error "${e}" not reported:\n${stderr.trim()}`);
    }
  } else if (code === 0) {
    fail(id, `expected to hit a limit (${LIMIT_TIMEOUT_MS} ms, ${LIMIT_MEMORY_BYTES} bytes) but compiled in ${ms} ms`);
  }
  const ok = !failures.some((f) => f.startsWith(`${id}:`));
  console.log(`${ok ? "✓" : "✗"} ${id} [${expect}] ${ended}${code === 0 ? `, ${pages} pages` : ""}`);
};

const runnable = entries.filter((e) => e.expect !== "limit" || hasPrlimit);
for (const e of entries.filter((e) => !runnable.includes(e))) console.log(`- ${e.id} [limit] skipped: no prlimit`);

const queue = [...runnable];
const workers = Array.from({ length: Math.max(1, availableParallelism() - 1) }, async () => {
  while (queue.length > 0) {
    check(await run(queue.shift()));
  }
});
await Promise.all(workers);
rmSync(out, { recursive: true, force: true });

if (writePages) {
  for (const set of SETS) {
    const metaPath = join(root, set, "meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    for (const e of entries.filter((e) => e.set === set)) meta[e.name] = e.meta;
    writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} problem(s):\n${failures.map((f) => `  ${f}`).join("\n")}`);
  process.exit(1);
}
console.log(`\ncorpus: ${runnable.length} entries OK with typst ${TYPST_VERSION}`);
