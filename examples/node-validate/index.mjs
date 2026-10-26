// Validate an LLM-written Typst document before saving it, let a model repair
// it, and render the result to PDF.
//
//   node index.mjs [file.typ] [--quiet]
//
// The "model" here is a stand-in that fixes exactly what the prompt reports, so
// the example runs without an API key. A real one is a few lines; see README.md.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fixLoop, render, validate } from "@typstream/node";

const args = process.argv.slice(2);
const quiet = args.includes("--quiet");
const file = args.find((a) => !a.startsWith("--")) ?? "worksheet.typ";
const log = (...parts) => quiet || console.log(...parts);
const source = readFileSync(file, "utf8");

const first = await validate(source);
log(`${file}: ${first.ok ? "valid" : "invalid"}, ${first.diagnostics.length} diagnostics`);

/** Stand-in for an LLM: applies the fix for each problem it is told about, and answers in a fence like models do. */
const model = ({ source, diagnostics }) => {
  let fixed = source;
  for (const d of diagnostics) {
    if (d.message === "unknown variable: hilight") fixed = fixed.replaceAll("#hilight", "#highlight");
    if (/label `<.*>` does not exist/.test(d.message)) fixed = fixed.replace(/(\w)@(\w)/g, "$1\\@$2");
    if (d.code === "markdown-bold") fixed = fixed.replace(/\*\*(.+?)\*\*/g, "*$1*");
  }
  return `\`\`\`typst\n${fixed}\n\`\`\``;
};

const result = await fixLoop({
  source,
  strict: true, // also repair lint warnings such as Markdown **bold**
  generate: (request) => {
    log(`\n--- round ${request.round}: prompt sent to the model ---\n${request.prompt}`);
    return model(request);
  },
});
log(`\n${result.ok ? "repaired" : "still broken"} after ${result.attempts.length - 1} round(s)`);
if (!result.ok) {
  console.error(result.diagnostics);
  process.exit(1);
}

const pdf = await render(result.source, "pdf");
if (!pdf.ok) {
  console.error(pdf.diagnostics);
  process.exit(1);
}
mkdirSync("out", { recursive: true });
const out = join("out", `${basename(file, ".typ")}.pdf`);
writeFileSync(out, pdf.data);
writeFileSync(join("out", basename(file)), result.source);
log(`wrote ${out} (${pdf.pageCount} page${pdf.pageCount === 1 ? "" : "s"}, ${pdf.data.length} bytes)`);
