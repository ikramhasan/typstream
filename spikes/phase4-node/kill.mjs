// Throwaway (#22): can a server stop a runaway compile without killing itself?
// Runs a corpus `limit` document in a worker_thread with each engine, calls
// worker.terminate() after 1 s, and reports how long termination took.
//
//   node kill.mjs wasm|native <adversarial-name>
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

const here = dirname(fileURLToPath(import.meta.url));
const WASM_DIR = process.env.WASM_DIR ?? join(here, "../../packages/engine-wasm/dist/pdf");

if (isMainThread) {
  const [kind, name] = process.argv.slice(2);
  const source = readFileSync(join(here, "../../corpus/adversarial", `${name}.typ`), "utf8");
  const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { kind, source } });
  const t0 = performance.now();
  worker.on("message", (m) => console.log(`${kind} ${name}: worker says ${JSON.stringify(m)} at ${Math.round(performance.now() - t0)} ms`));
  worker.on("error", (e) => console.log(`${kind} ${name}: error ${e.message} at ${Math.round(performance.now() - t0)} ms`));
  await new Promise((r) => worker.once("message", r)); // started compiling
  const tStart = performance.now();
  setTimeout(async () => {
    const tKill = performance.now();
    const guard = setTimeout(() => {
      console.log(`${kind} ${name}: terminate() still pending after 5 s; the thread is stuck`);
      process.exit(2);
    }, 5000);
    await worker.terminate();
    clearTimeout(guard);
    console.log(`${kind} ${name}: terminated ${Math.round(performance.now() - tKill)} ms after terminate(), compile ran ${Math.round(tKill - tStart)} ms`);
    // The main thread is still alive and responsive.
    setTimeout(() => console.log(`${kind} ${name}: main thread still responsive`), 10);
  }, 1000);
} else {
  const { kind, source } = workerData;
  let engine;
  if (kind === "wasm") {
    const glue = await import(join(WASM_DIR, "engine.js"));
    glue.initSync({ module: readFileSync(join(WASM_DIR, "engine_bg.wasm")) });
    const e = new glue.Engine();
    engine = { set: (s) => e.set_source("/main.typ", s), compile: () => e.compile_html() };
  } else {
    const { createRequire } = await import("node:module");
    const { NativeEngine } = createRequire(import.meta.url)(join(here, "native/typstream_native.node"));
    const e = new NativeEngine();
    engine = { set: (s) => e.setSource("/main.typ", s), compile: () => e.compileHtml() };
  }
  engine.set(source);
  parentPort.postMessage("compiling");
  const out = engine.compile();
  parentPort.postMessage({ finished: out.ok, ms: out.ms });
}
