// Summarizes Stryker's JSON report (reports/mutation/mutation.json) as Markdown:
// the score per file, then every surviving and uncovered mutant. The nightly job
// writes it to the job summary; locally it is the list to triage.
//
//   node scripts/mutation-report.mjs [--survivors]
import { readFileSync } from "node:fs";

const report = JSON.parse(readFileSync("reports/mutation/mutation.json", "utf8"));
const showSurvivors = process.argv.includes("--survivors");

// Stryker's definition: detected / (detected + undetected); compile and runtime
// errors and ignored mutants don't count.
const DETECTED = new Set(["Killed", "Timeout"]);
const UNDETECTED = new Set(["Survived", "NoCoverage"]);
const score = (mutants) => {
  const detected = mutants.filter((m) => DETECTED.has(m.status)).length;
  const undetected = mutants.filter((m) => UNDETECTED.has(m.status)).length;
  return { detected, undetected, score: (100 * detected) / Math.max(1, detected + undetected) };
};
const count = (mutants, status) => mutants.filter((m) => m.status === status).length;

const files = Object.entries(report.files).sort(([a], [b]) => a.localeCompare(b));
const all = files.flatMap(([, f]) => f.mutants);
const total = score(all);

const lines = [
  `## @typstream/heal mutation score: ${total.score.toFixed(2)}%`,
  "",
  "| File | Score | Killed | Timeout | Survived | No coverage | Ignored |",
  "|---|---:|---:|---:|---:|---:|---:|",
];
for (const [path, f] of [...files, ["**all**", { mutants: all }]]) {
  const s = score(f.mutants);
  lines.push(
    `| ${path} | ${s.score.toFixed(2)}% | ${count(f.mutants, "Killed")} | ${count(f.mutants, "Timeout")} | ${count(
      f.mutants,
      "Survived",
    )} | ${count(f.mutants, "NoCoverage")} | ${count(f.mutants, "Ignored")} |`,
  );
}

if (showSurvivors) {
  for (const [path, f] of files) {
    const source = f.source.split("\n");
    const left = f.mutants
      .filter((m) => UNDETECTED.has(m.status))
      .sort((a, b) => a.location.start.line - b.location.start.line);
    if (left.length === 0) continue;
    lines.push("", `### ${path}`, "");
    for (const m of left) {
      const line = m.location.start.line;
      const code = (source[line - 1] ?? "").trim();
      const replacement = (m.replacement ?? "").replace(/\s+/g, " ").slice(0, 80);
      lines.push(`- L${line} ${m.mutatorName} (${m.status}): \`${code}\` → \`${replacement}\``);
    }
  }
}

console.log(lines.join("\n"));
