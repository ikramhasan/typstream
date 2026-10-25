// Prints a compact per-run summary of results/*.json (optionally filtered).
import { readdirSync, readFileSync } from "node:fs";
const filters = process.argv.slice(2);
const r1 = (x) => (typeof x === "number" ? Math.round(x * 10) / 10 : x);
for (const f of readdirSync("results").sort()) {
  if (filters.length && !filters.every((x) => f.includes(x))) continue;
  const r = JSON.parse(readFileSync(`results/${f}`, "utf8"));
  console.log(`\n## ${f.replace(".json", "")}${r.error ? `  ERROR: ${r.error.split("\n")[0]}` : ""}`);
  if (r.init) console.log("init", JSON.stringify(Object.fromEntries(Object.entries(r.init).map(([k, v]) => [k, r1(v)]))));
  for (const [p, d] of Object.entries(r.docs ?? {})) {
    const s = d.stream;
    console.log(`${p}p (${d.chars} ch, ${d.steps} steps): first ${r1(d.firstPrefix.ms)}ms | stream compile p50 ${s.compile?.p50} p90 ${s.compile?.p90} max ${s.compile?.max} | roundtrip p50 ${s.roundtrip?.p50} p90 ${s.roundtrip?.p90} | render p50 ${s.render?.p50} p90 ${s.render?.p90} | fails ${s.failures}${s.firstError ? ` ${JSON.stringify(s.firstError)}` : ""} | full ${r1(d.fullDoc.compileMs)}ms render ${r1(d.fullDoc.renderMs)}ms pages ${d.fullDoc.pages ?? "-"} bytes ${d.fullDoc.bytes} ok ${d.fullDoc.ok} | warm ${d.warmIdentical} | mem ${d.memoryAfter ? Math.round(d.memoryAfter / 2 ** 20) + "MB" : "-"}`);
  }
  if (r.memory) console.log("memory", JSON.stringify(r.memory.samples.map((s) => `${s.i}:${s.memoryMB}MB/${s.lastMs}ms`)), "compile", JSON.stringify(r.memory.compile));
  if (r.longTasks) console.log("longTasks", JSON.stringify(r.longTasks), "crossOriginIsolated", r.crossOriginIsolated, r.consoleErrors?.length ? `console: ${r.consoleErrors[0].slice(0, 200)}` : "");
}
