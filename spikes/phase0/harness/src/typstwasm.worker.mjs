// typst-wasm 1.0.0 hosted inside our own dedicated worker with the JSPI
// backend: no SharedArrayBuffer, so no COOP/COEP needed, and compiles stay off
// the main thread.
import { createTypstCompiler } from "typst-wasm";

let compiler;

const handlers = {
  async init({ base, fonts }) {
    let t = performance.now();
    const mod = (name) => WebAssembly.compileStreaming(fetch(`${base}/${name}`));
    const coreModules = { "engine.core.wasm": mod("engine.core.wasm"), "engine.core2.wasm": mod("engine.core2.wasm"), "engine.core3.wasm": mod("engine.core3.wasm") };
    await Promise.all(Object.values(coreModules));
    const downloadCompile = performance.now() - t;
    t = performance.now();
    compiler = await createTypstCompiler({ backend: "jspi", coreModules, packageCache: false });
    const instantiate = performance.now() - t;
    t = performance.now();
    await compiler.addFonts(...fonts.map(async (u) => new Uint8Array(await (await fetch(u)).arrayBuffer())));
    return { downloadCompile, instantiate, fonts: performance.now() - t, backend: "jspi-in-worker" };
  },

  newDoc() {
    return {};
  },

  async compile({ src, format }) {
    await compiler.addSource("main.typ", src);
    const t = performance.now();
    let out;
    let errors = [];
    try {
      out = await compiler.compile({ format, main: "main.typ" });
    } catch (e) {
      errors = (e.diagnostics ?? [{ message: String(e) }]).filter((d) => d.severity !== "warning").slice(0, 3).map((d) => d.message);
    }
    const ms = performance.now() - t;
    const output = out?.format === "html" ? out.output : out?.pages?.map((p) => p.output);
    const bytes = typeof output === "string" ? output.length : (output ?? []).reduce((n, p) => n + p.length, 0);
    return { ms, ok: !!out, errors, bytes, pages: out?.pages?.length, output };
  },

  memory() {
    return { memory: null };
  },
};

self.onmessage = async ({ data: { id, method, params } }) => {
  try {
    self.postMessage({ id, result: await handlers[method](params ?? {}) });
  } catch (e) {
    self.postMessage({ id, error: `${e?.stack ?? e}\ncause: ${JSON.stringify(e?.cause ?? null)}` });
  }
};
