// Markdown table of all stream runs for RESULTS.md.
import { readdirSync, readFileSync } from "node:fs";
const rows = [];
const n = (x) => (x === undefined || x === null ? "–" : Math.round(x));
for (const f of readdirSync("results").sort()) {
  const r = JSON.parse(readFileSync(`results/${f}`, "utf8"));
  if (!r.docs) continue;
  const [browser, profile] = f.split("-");
  const d5 = r.docs[5], d20 = r.docs[20];
  rows.push(`| ${browser} | ${profile} | ${r.engine}${r.variant ? `(${r.variant})` : ""} | ${r.format} | ${r.init.backend ?? (r.crossOriginIsolated ? "coi" : "")} | ${n(r.init.downloadCompile)} | ${n(r.init.fonts)} | ${n(r.docs[1]?.firstPrefix.ms)} | ${d5 ? `${n(d5.stream.compile.p50)} / ${n(d5.stream.compile.p90)}` : "–"} | ${d20 ? `${n(d20.stream.compile.p50)} / ${n(d20.stream.compile.p90)}` : "–"} | ${d20 ? `${n(d20.stream.render?.p50)} / ${n(d20.stream.render?.p90)}` : d5 ? `${n(d5.stream.render?.p50)} / ${n(d5.stream.render?.p90)} (5p)` : "–"} | ${d20 ? n(d20.warmIdentical) : "–"} | ${r.longTasks?.over50 ?? "–"} |`);
}
console.log("| browser | profile | engine | format | backend | wasm dl+compile ms | fonts ms | first compile 1p ms | 5p stream p50/p90 ms | 20p stream p50/p90 ms | 20p main-thread render p50/p90 ms | 20p warm recompile ms | long tasks >50ms |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
console.log(rows.join("\n"));
