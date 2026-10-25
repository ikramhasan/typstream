// Custom wasm-bindgen build of Typst 0.15.1 (spikes/phase0/custom-engine) in a
// dedicated worker. HTML and SVG pages, plus comemo eviction.
let Engine;
let initSync;
let wasm;
let engine;

const handlers = {
  async init({ glueUrl, wasmUrl, fonts }) {
    ({ Engine, initSync } = await import(glueUrl));
    let t = performance.now();
    const module = await WebAssembly.compileStreaming(fetch(wasmUrl));
    const downloadCompile = performance.now() - t;
    t = performance.now();
    wasm = initSync({ module });
    const instantiate = performance.now() - t;
    t = performance.now();
    engine = new Engine();
    for (const url of fonts) {
      engine.add_font(new Uint8Array(await (await fetch(url)).arrayBuffer()));
    }
    const fontsMs = performance.now() - t;
    return { downloadCompile, instantiate, fonts: fontsMs, memory: wasm.memory.buffer.byteLength };
  },

  newDoc() {
    engine.reset_pages();
    return {};
  },

  compile({ src, format }) {
    engine.set_source("/main.typ", src);
    if (format === "svgdiff") {
      const t = performance.now();
      const out = engine.compile_svg_changed();
      const ms = performance.now() - t;
      const errors = (out.diagnostics ?? []).filter((d) => d.severity === "error");
      return {
        ms,
        compileMs: out.compileMs,
        exportMs: out.exportMs,
        ok: out.ok && errors.length === 0,
        pages: out.pageCount,
        changedPages: out.changed?.length ?? 0,
        changedIdx: (out.changed ?? []).map((p) => p.index),
        bytes: (out.changed ?? []).reduce((n, p) => n + p.svg.length, 0),
        errors: errors.slice(0, 3).map((d) => d.message),
        memory: wasm.memory.buffer.byteLength,
        output: out.changed,
      };
    }
    const t = performance.now();
    const out = format === "html" ? engine.compile_html() : engine.compile_svg();
    const ms = performance.now() - t;
    const errors = (out.diagnostics ?? []).filter((d) => d.severity === "error");
    const bytes = format === "html" ? (out.html?.length ?? 0) : (out.pages ?? []).reduce((n, p) => n + p.length, 0);
    return {
      ms,
      ok: out.ok && errors.length === 0,
      bytes,
      pages: out.pages?.length,
      errors: errors.slice(0, 3).map((d) => d.message),
      memory: wasm.memory.buffer.byteLength,
      output: format === "html" ? out.html : out.pages,
    };
  },

  evict({ maxAge }) {
    engine.evict(maxAge);
    return { memory: wasm.memory.buffer.byteLength };
  },

  memory() {
    return { memory: wasm.memory.buffer.byteLength };
  },
};

self.onmessage = async ({ data: { id, method, params } }) => {
  try {
    self.postMessage({ id, result: await handlers[method](params ?? {}) });
  } catch (e) {
    self.postMessage({ id, error: String(e?.stack ?? e) });
  }
};
