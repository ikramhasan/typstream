// A pool worker (worker_threads): one engine-wasm `Engine` that compiles jobs
// one at a time. It holds no document state the main thread depends on, only
// caches (files it was sent, Typst's memoization, the changed-page baseline),
// so the pool can terminate it at any moment (the watchdog) and start afresh.
//
// Runs as built JS (dist/worker.js) and, in this package's tests, as TypeScript
// through Node's type stripping: keep it free of runtime imports other than
// engine-wasm.

import { parentPort, workerData } from "node:worker_threads";
import { Engine, initSync } from "@typstream/engine-wasm";
import type { Job, JobResult, WorkerInit, WorkerReply, WorkerRequest } from "./jobs";

const { module, fonts } = workerData as WorkerInit;
initSync({ module });
for (const font of fonts) Engine.add_font(font);
const engine = new Engine();

/** Path → version of every file set on the engine (sources and binary files). */
const held = new Map<string, number>();
let inputsKey = "{}";
/** Token of the last successful `svg` job: what `compile_svg_changed` diffs against. */
let pagedToken: string | null = null;

const decoder = new TextDecoder();

const setFiles = (job: Job): void => {
  const wanted = new Set<string>();
  for (const file of job.files) {
    wanted.add(file.path);
    if (held.get(file.path) === file.version) continue;
    if (file.data === undefined) throw new Error(`worker lacks ${file.path} v${file.version}`);
    // Typst reads `.typ` files (includes, imports) only as sources; data files work either way.
    if (typeof file.data === "string") engine.set_source(file.path, file.data);
    else if (file.path.endsWith(".typ")) engine.set_source(file.path, decoder.decode(file.data));
    else engine.set_file(file.path, file.data);
    held.set(file.path, file.version);
  }
  for (const path of held.keys()) {
    if (!wanted.has(path)) {
      engine.remove_file(path);
      held.delete(path);
    }
  }
};

const run = (job: Job): JobResult => {
  setFiles(job);
  const key = JSON.stringify(Object.entries(job.inputs).sort(([a], [b]) => (a < b ? -1 : 1)));
  if (key !== inputsKey) {
    engine.set_inputs(job.inputs);
    inputsKey = key;
  }
  engine.set_source("/main.typ", job.main);
  switch (job.op) {
    case "check": {
      const r = engine.check_paged();
      return { ok: r.ok, diagnostics: r.diagnostics, pageCount: r.pageCount, compileMs: r.ms };
    }
    case "html": {
      const r = engine.compile_html();
      return { ok: r.ok, diagnostics: r.diagnostics, html: r.html, compileMs: r.ms };
    }
    case "pdf": {
      const r = engine.compile_pdf();
      return { ok: r.ok, diagnostics: r.diagnostics, pdf: r.pdf, pageCount: r.pageCount, compileMs: r.ms };
    }
    case "docx": {
      const r = engine.compile_docx_model();
      return {
        ok: r.ok,
        diagnostics: r.diagnostics,
        model: r.model,
        fonts: r.fonts,
        pictures: r.pictures,
        pageCount: r.pageCount,
        compileMs: r.ms,
      };
    }
    case "svg": {
      const full = job.baseline == null || job.baseline !== pagedToken;
      if (full) engine.reset_pages();
      const r = engine.compile_svg_changed();
      if (r.ok) pagedToken = job.token ?? null;
      else if (full) pagedToken = null; // reset, then failed: the baseline is empty
      return {
        ok: r.ok,
        diagnostics: r.diagnostics,
        pageCount: r.pageCount,
        pages: r.changed,
        full,
        compileMs: r.compileMs,
        exportMs: r.exportMs,
      };
    }
  }
};

const port = parentPort;
if (!port) throw new Error("@typstream/node's worker must run in a worker thread");

port.on("message", ({ id, job }: WorkerRequest) => {
  let reply: WorkerReply;
  try {
    reply = { id, ok: true, result: run(job), memoryBytes: Engine.memory_bytes() };
  } catch (error) {
    // A trap leaves the instance in an unknown state (Rust aborts on allocation
    // failure); anything else is a bad request (an invalid path) and harmless.
    const crashed = error instanceof WebAssembly.RuntimeError;
    reply = { id, ok: false, message: error instanceof Error ? error.message : String(error), crashed };
  }
  const transfer = reply.ok && reply.result.pdf ? [reply.result.pdf.buffer as ArrayBuffer] : [];
  port.postMessage(reply, transfer);
});
