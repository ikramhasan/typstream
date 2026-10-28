// Measures recorded answers to edit requests (#34): each answer is replayed chunk by chunk
// through @typstream/ai's edit session, as an app applies it, and then:
//
// - edits: applied, or failed and why (malformed, not-found, ambiguous, overlap, incomplete), and
//   how many quotes matched only with whitespace evened out ("loose");
// - target: whether the edits changed the blocks the request meant (exact), more (extra) or not
//   all of them (missed); for a request that doesn't say which part, whether the model asked;
// - compile: the edited document in final mode, as measure.mjs compiles documents (paged, answers
//   hidden and shown). The documents compiled before the edit;
// - streaming: whether a block streamed in, and how long after the first text the document first
//   changed;
// - cost.
//
//   node src/measure-edits.mjs <label>... [--examples]
//
// Writes runs/<label>/measure.json.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createEditSession, findQuote } from "@typstream/ai";
import { blockStarts, heal } from "@typstream/heal";
import { blockAt, baseDocument, blocksOf, selectionOf } from "./edit-documents.mjs";
import { EDIT_REQUESTS } from "./edits.mjs";
import { compile, newEngine, preambleFor } from "./engine.mjs";
import { classify, cost } from "./measure.mjs";
import { loadRun, RUNS } from "./runs.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { examples: { type: "boolean" } },
});

const errorsOf = (engine, text, preamble) => {
  const source = heal(text, { final: true }).source;
  const seen = new Set();
  return [false, true]
    .flatMap((answers) => compile(engine, source, { preamble, answers }))
    .filter((d) => d.severity === "error" && !seen.has(d.message) && seen.add(d.message))
    .map((d) => d.message);
};

/** Replays a recording through an edit session; what it did, and when. */
const replay = (rec, request, edits) => {
  const base = baseDocument(request);
  const session = createEditSession(base);
  const selection = edits === "selection" ? selectionOf(request) : null;
  let sent = "";
  let firstChange = null;
  let streamed = false;
  rec.chunks.forEach((chunk, i) => {
    sent += chunk.text;
    const done = i === rec.chunks.length - 1;
    if (selection) session.write(selection, sent, done);
    else session.update(sent, done);
    const s = session.getState();
    if (s.streamingRange) streamed = true;
    if (firstChange === null && s.text !== base) firstChange = chunk.t;
  });
  if (!rec.chunks.length) session.update("", true);
  return { base, state: session.getState(), selection, firstChange, streamed };
};

/** The blocks of `base` the applied edits changed. */
const touchedBlocks = (base, state, selection) => {
  const starts = blockStarts(base);
  const touched = new Set();
  const ranges = selection
    ? [selection]
    : state.edits
        .filter((e) => e.status === "applied")
        .map((e) => findQuote(base, e.quote).ranges[0])
        .filter(Boolean);
  for (const range of ranges) {
    for (let b = blockAt(starts, range.from); b <= blockAt(starts, Math.max(range.from, range.to - 1)); b++) {
      touched.add(b);
    }
  }
  return touched;
};

const targetOf = (request, touched, state) => {
  if (request.ask) return state.edits.length === 0 && state.message.includes("?") ? "asked" : "edited";
  const expected = blocksOf(request, request.targets);
  const allowed = new Set([...expected, ...blocksOf(request, request.may)]);
  // An addition goes after its target or before the block that follows it: either will do.
  const needed = request.may ? [...allowed].some((b) => touched.has(b)) : [...expected].every((b) => touched.has(b));
  if (!needed) return "missed";
  if ([...touched].some((b) => !allowed.has(b))) return "extra";
  return "exact";
};

export const measureEdit = (engine, rec, edits) => {
  const request = EDIT_REQUESTS.find((r) => r.id === rec.request);
  if (!request) throw new Error(`no edit request ${rec.request}`);
  const { base, state, selection, firstChange, streamed } = replay(rec, request, edits);
  const preamble = preambleFor(rec.plugins);
  const errors = state.text === base ? [] : errorsOf(engine, state.text, preamble);
  return {
    model: rec.model,
    request: rec.request,
    stopReason: rec.meta.stopReason,
    outputTokens: rec.meta.usage.output_tokens,
    cost: cost(rec.model, rec.meta.usage),
    firstTextMs: rec.meta.firstTextMs,
    firstChangeMs: firstChange,
    streamed,
    edits: state.edits.map((e) => ({ status: e.status, error: e.error, loose: e.loose })),
    target: targetOf(request, touchedBlocks(base, state, selection), state),
    changed: state.text !== base,
    errors: errors.map((message) => ({ message, class: classify(message) })),
    message: state.message,
    fenced: selection ? /^\s*```/.test(rec.text) : false,
  };
};

const median = (xs) => {
  const sorted = xs.filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};

const summarize = (label, edits, docs) => {
  const lines = [`### ${label} (${edits})`, ""];
  lines.push(
    "| model | requests | edits applied | failed edits | loose quotes | target exact | extra | missed | asked when unclear | compile errors | streamed | first change (median) | out tokens (mean) | cost |",
  );
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  const models = [...new Set(docs.map((d) => d.model))].sort();
  for (const model of [...models, "all"]) {
    const ds = model === "all" ? docs : docs.filter((d) => d.model === model);
    const all = ds.flatMap((d) => d.edits);
    const failed = all.filter((e) => e.status === "failed");
    const reasons = [...new Set(failed.map((e) => e.error))]
      .map((r) => `${failed.filter((e) => e.error === r).length} ${r}`)
      .join(", ");
    const asks = ds.filter((d) => d.target === "asked" || d.target === "edited");
    const count = (t) => ds.filter((d) => d.target === t).length;
    const firstChange = median(ds.map((d) => d.firstChangeMs));
    lines.push(
      `| ${model} | ${ds.length} | ${all.filter((e) => e.status === "applied").length} | ${failed.length}${reasons ? ` (${reasons})` : ""} | ${all.filter((e) => e.loose).length} | ${count("exact")} | ${count("extra")} | ${count("missed")} | ${count("asked")}/${asks.length} | ${ds.filter((d) => d.errors.length).length} | ${ds.filter((d) => d.streamed).length} | ${firstChange === null ? "–" : `${(firstChange / 1000).toFixed(1)} s`} | ${Math.round(ds.reduce((s, d) => s + d.outputTokens, 0) / (ds.length || 1))} | $${ds.reduce((s, d) => s + d.cost, 0).toFixed(2)} |`,
    );
  }
  if (values.examples) {
    const notable = docs.filter(
      (d) => d.target === "extra" || d.target === "missed" || d.target === "edited" || d.errors.length || d.edits.some((e) => e.status === "failed"),
    );
    if (notable.length) lines.push("", "Notable:", "");
    for (const d of notable) {
      const failed = d.edits.filter((e) => e.status === "failed").map((e) => e.error);
      lines.push(
        `- ${d.model} ${d.request}: target ${d.target}${failed.length ? `, failed ${failed.join(", ")}` : ""}${d.errors.length ? `, errors: ${d.errors.map((e) => e.message).join("; ")}` : ""}`,
      );
    }
  }
  return lines.join("\n");
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const engine = newEngine();
  for (const label of positionals) {
    const run = loadRun(label);
    const edits = run[0]?.edits ?? "quote";
    const docs = run.map((rec) => measureEdit(engine, rec, edits));
    writeFileSync(join(RUNS, label, "measure.json"), `${JSON.stringify(docs, null, 2)}\n`);
    console.log(`${summarize(label, edits, docs)}\n`);
  }
}
