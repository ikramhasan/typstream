// Performance budgets for @typstream/heal (PLAN.md §1, §11.5). Streams
// generated documents token by token through the incremental healer and
// asserts per-token latency and linear scaling. `node scripts/perf.mjs`
// after `pnpm build`.
import { performance } from "node:perf_hooks";
import { createHealer, heal } from "../dist/index.js";

const ATOMS = [
  "= Heading",
  "Some *strong* and _emph_ text with $x^2$ math.",
  "- item\n- item",
  "#table(\n  columns: 3,\n  [a], [b], [c],\n)",
  "$ sum_(k=1)^n k = (n(n+1))/2 $",
  "#let f(x) = x + 1",
  "```python\nprint(1)\n```",
  '#figure(image("a.png"), caption: [Cap]) <fig>',
  'See @fig and #link("https://typst.app")[Typst].',
];
const makeDoc = (size) => {
  let out = "";
  for (let i = 0; out.length < size; i++) out += `${ATOMS[(i * 5) % ATOMS.length]}\n\n`;
  return out.slice(0, size);
};
const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];

let failed = false;
const budget = (name, value, max, unit = "ms") => {
  const ok = value <= max;
  failed ||= !ok;
  console.log(`${ok ? "✓" : "✗"} ${name}: ${value.toFixed(3)} ${unit} (budget ${max} ${unit})`);
};

// 1. Per-token cost while streaming a 50 KB document in 4-char tokens.
{
  const doc = makeDoc(50_000);
  const healer = createHealer();
  const times = [];
  for (let i = 0; i < doc.length; i += 4) {
    const t = performance.now();
    healer.push(doc.slice(i, i + 4));
    times.push(performance.now() - t);
  }
  const tail = times.slice(Math.floor(times.length * 0.8)); // the last 10 KB, where the document is largest
  budget("per-token p50 at 40–50 KB", pct(tail, 0.5), 0.25);
  budget("per-token p95 at 40–50 KB", pct(tail, 0.95), 0.5);
  budget("per-token max at 40–50 KB", Math.max(...tail), 20);
}

// 2. Stateless healing scales linearly: µs per KB stays flat from 10 KB to 1 MB.
{
  const perKb = [];
  for (const size of [10_000, 100_000, 1_000_000]) {
    const doc = makeDoc(size);
    heal(doc);
    const runs = size >= 1_000_000 ? 3 : 10;
    const t = performance.now();
    for (let i = 0; i < runs; i++) heal(doc);
    perKb.push(((performance.now() - t) / runs / (size / 1000)) * 1000);
    console.log(
      `  stateless ${size / 1000} KB: ${((perKb.at(-1) * size) / 1000 / 1000).toFixed(2)} ms (${perKb.at(-1).toFixed(1)} µs/KB)`,
    );
  }
  budget("scaling 1 MB vs 10 KB (µs/KB ratio)", perKb[2] / perKb[0], 2, "×");
}

// 3. Editing the middle of a document resyncs after the edited block (PLAN.md §5.2)
// instead of re-parsing to the end. What's left per edit is string work over the
// whole input (normalize, diff, output), a small fraction of a stateless heal.
{
  const doc = makeDoc(100_000);
  const healer = createHealer();
  healer.set(doc);
  const times = [];
  for (let i = 0; i < 200; i++) {
    const at = 40_000 + ((i * 7919) % 20_000);
    for (const edit of [
      { from: at, to: at, insert: "x" },
      { from: at, to: at + 1, insert: "" },
    ]) {
      const t = performance.now();
      healer.applyEdit(edit);
      times.push(performance.now() - t);
    }
  }
  const t = performance.now();
  for (let i = 0; i < 5; i++) heal(doc);
  const stateless = (performance.now() - t) / 5;
  budget("mid-document 1-char edit p50 at 100 KB", pct(times, 0.5), 2);
  budget("mid-document edit p50 vs stateless heal at 100 KB", (pct(times, 0.5) / stateless) * 100, 10, "%");
}

// 4. Pathological inputs stay linear and don't overflow the stack.
for (const [name, input] of [
  ["100k nested [", `${"#box[".repeat(20_000)}x`],
  ["10k backtick runs", "`` ".repeat(10_000)],
  ["50k stars", "*a ".repeat(50_000)],
  ["unclosed comment 1 MB", `/* ${"x".repeat(1_000_000)}`],
]) {
  const t = performance.now();
  heal(input);
  budget(`pathological: ${name}`, performance.now() - t, 500);
}

process.exitCode = failed ? 1 : 0;
