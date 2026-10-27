// Measures recorded runs: does each finished document compile, what goes wrong, which of heal's
// lint rules fire, and what the run cost.
//
//   node src/measure.mjs <label>... [--json] [--examples]
//
// "Final mode" is what typstream compiles once the stream ends: heal's final mode (fences
// unwrapped, lint fixes, no tail repair) and the run's preamble, then the paged target with
// answers hidden and shown. A document with an error in either counts as failing. "Raw" compiles
// the model's text unchanged. HTML errors are counted separately. Writes runs/<label>/measure.json.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { heal } from "@typstream/heal";
import { compile, newEngine, preambleFor } from "./engine.mjs";
import { loadRun, RUNS } from "./runs.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { json: { type: "boolean" }, examples: { type: "boolean" } },
});

/** $ per million tokens: input, output. Cache writes cost 1.25× input, cache reads 0.1×. */
const PRICES = {
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5-5": [4, 20],
};

export const cost = (model, usage) => {
  const [input, output] = PRICES[model] ?? [Number.NaN, Number.NaN];
  const tokens =
    input * (usage.input_tokens + 1.25 * (usage.cache_creation_input_tokens ?? 0) + 0.1 * (usage.cache_read_input_tokens ?? 0)) +
    output * usage.output_tokens;
  return tokens / 1e6;
};

/**
 * An error's class: its message with the names it mentions replaced, so `unknown variable: foo`
 * and `unknown variable: bar` count together.
 */
export const classify = (message) =>
  message
    .replace(/`[^`]*`/g, "`_`")
    .replace(/"[^"]*"/g, '"_"')
    .replace(/^(unknown variable|unexpected argument|unknown font family|file not found|package not found)(:| ).*$/, "$1: _")
    .replace(/\(searched at .*\)/, "")
    .replace(/\d+/g, "N")
    .trim();

const lineAt = (source, offset) => {
  if (offset == null || offset < 0) return "";
  const start = source.lastIndexOf("\n", offset - 1) + 1;
  const end = source.indexOf("\n", offset);
  return source.slice(start, end < 0 ? undefined : end).trim().slice(0, 160);
};

const errorsOf = (diagnostics) => diagnostics.filter((d) => d.severity === "error");

/** One recording's measurements. */
export const measureRecording = (engine, rec) => {
  const preamble = preambleFor(rec.plugins);
  const final = heal(rec.text, { final: true });
  const source = final.source;
  const paged = errorsOf(compile(engine, source, { preamble }));
  const answers = errorsOf(compile(engine, source, { preamble, answers: true }));
  const html = errorsOf(compile(engine, source, { preamble, target: "html" }));
  const raw = errorsOf(compile(engine, rec.text, { preamble }));
  const seen = new Set();
  const errors = [...paged, ...answers].filter((d) => !seen.has(d.message) && seen.add(d.message));
  return {
    model: rec.model,
    request: rec.request,
    stopReason: rec.meta.stopReason,
    outputTokens: rec.meta.usage.output_tokens,
    cost: cost(rec.model, rec.meta.usage),
    fenced: /^\s*```/.test(rec.text),
    lint: final.findings.map((f) => f.rule),
    raw: raw.map((d) => d.message),
    errors: errors.map((d) => ({ message: d.message, class: classify(d.message), line: lineAt(source, d.span?.from) })),
    html: html.map((d) => d.message),
  };
};

const pct = (n, of) => (of ? `${((100 * n) / of).toFixed(1)}%` : "–");

const tally = (items) => {
  const counts = new Map();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
};

const summarize = (label, docs) => {
  const lines = [`### ${label}`, ""];
  lines.push("| model | docs | final-mode errors | raw errors | HTML errors | truncated | fenced | out tokens (mean) | cost |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  const models = [...new Set(docs.map((d) => d.model))].sort();
  for (const model of [...models, "all"]) {
    const ds = model === "all" ? docs : docs.filter((d) => d.model === model);
    const n = ds.length;
    const count = (f) => ds.filter(f).length;
    const failing = count((d) => d.errors.length > 0);
    lines.push(
      `| ${model} | ${n} | ${failing} (${pct(failing, n)}) | ${pct(count((d) => d.raw.length > 0), n)} | ${pct(count((d) => d.html.length > 0), n)} | ${count((d) => d.stopReason === "max_tokens")} | ${count((d) => d.fenced)} | ${Math.round(ds.reduce((s, d) => s + d.outputTokens, 0) / (n || 1))} | $${ds.reduce((s, d) => s + d.cost, 0).toFixed(2)} |`,
    );
  }
  const classes = tally(docs.flatMap((d) => [...new Set(d.errors.map((e) => e.class))]));
  if (classes.length) {
    lines.push("", "Error classes (documents):", "");
    for (const [c, n] of classes) lines.push(`- ${n} × ${c}`);
  }
  const lint = tally(docs.flatMap((d) => [...new Set(d.lint)]));
  lines.push("", `Lint rules that fired (documents): ${lint.map(([r, n]) => `${r} ${n}`).join(", ") || "none"}`);
  if (values.examples) {
    lines.push("", "Failing documents:", "");
    for (const d of docs.filter((d) => d.errors.length)) {
      for (const e of d.errors) lines.push(`- ${d.model} ${d.request}: ${e.message} — \`${e.line}\``);
    }
  }
  return lines.join("\n");
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const engine = newEngine();
  for (const label of positionals) {
    const docs = loadRun(label).map((rec) => measureRecording(engine, rec));
    writeFileSync(join(RUNS, label, "measure.json"), `${JSON.stringify(docs, null, 2)}\n`);
    console.log(values.json ? JSON.stringify(docs, null, 2) : `${summarize(label, docs)}\n`);
  }
}
