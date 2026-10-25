// typst.ts web compiler (0.8.0-rc3) in a dedicated worker. Paged output only:
// incremental vector deltas are posted to the page, which merges and renders
// them with typst-ts-renderer.
import { initSync, TypstCompilerBuilder } from "/node_modules/@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler.mjs";

const DIAG_FULL = 3;
let wasm;
let compiler;
let srv;

const handlers = {
  async init({ wasmUrl, fonts }) {
    let t = performance.now();
    const module = await WebAssembly.compileStreaming(fetch(wasmUrl));
    const downloadCompile = performance.now() - t;
    t = performance.now();
    wasm = initSync({ module });
    const instantiate = performance.now() - t;
    t = performance.now();
    const builder = new TypstCompilerBuilder();
    builder.set_dummy_access_model();
    for (const url of fonts) {
      await builder.add_raw_font(new Uint8Array(await (await fetch(url)).arrayBuffer()));
    }
    compiler = await builder.build();
    const fontsMs = performance.now() - t;
    return { downloadCompile, instantiate, fonts: fontsMs, memory: wasm.memory.buffer.byteLength };
  },

  newDoc() {
    srv?.free();
    srv = compiler.create_incr_server();
    return {};
  },

  compile({ src, format }) {
    compiler.add_source("/main.typ", src);
    const t = performance.now();
    const world = compiler.snapshot(null, "/main.typ", null);
    const out = format === "vector-full" ? world.get_artifact(0, DIAG_FULL) : world.incr_compile(srv, DIAG_FULL);
    world.free();
    const ms = performance.now() - t;
    const delta = out?.result;
    const errors = (out?.diagnostics ?? []).filter((d) => d.severity === "error");
    return {
      ms,
      ok: !!delta && errors.length === 0,
      bytes: delta?.length ?? 0,
      errors: errors.slice(0, 3).map((d) => d.message),
      memory: wasm.memory.buffer.byteLength,
      transfer: delta,
    };
  },

  memory() {
    return { memory: wasm.memory.buffer.byteLength };
  },
};

self.onmessage = async ({ data: { id, method, params } }) => {
  try {
    const result = await handlers[method](params ?? {});
    const transfer = result.transfer ? [result.transfer.buffer] : [];
    self.postMessage({ id, result }, transfer);
  } catch (e) {
    self.postMessage({ id, error: String(e?.stack ?? e) });
  }
};
