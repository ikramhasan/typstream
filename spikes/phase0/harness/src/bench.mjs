// Page-side bench runner. Query params:
//   engine = typstts | custom | typstwasm
//   format = paged | html | svg       (typstts: paged; others: html | svg)
//   mode   = stream | memory
//   docs   = comma list of page counts (default 1,5,20)
//   variant (custom only) = html | html-svg | full
//   evict  (custom memory mode) = 0 | N (evict every N compiles)
//   backend (typstwasm) = auto | worker | jspi
// Results land in window.__result (or window.__error).
import { initSync as initRenderer, TypstRendererBuilder } from "@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer.mjs";
import { createTypstCompiler, selectAutomaticBackendKind } from "typst-wasm";
import { createWebWorker } from "typst-wasm/worker/browser";
import { patchRoot } from "../vendor/typst-ts-patch.mts";
import { makeDoc, SECTIONS_FOR_PAGES, streamSteps } from "./docs.mjs";

const q = new URLSearchParams(location.search);
const ENGINE = q.get("engine") ?? "typstts";
const FORMAT = q.get("format") ?? (ENGINE === "typstts" ? "paged" : "html");
const MODE = q.get("mode") ?? "stream";
const DOCS = (q.get("docs") ?? "1,5,20").split(",").map(Number);
const VARIANT = q.get("variant") ?? "html-svg";
const EVICT = Number(q.get("evict") ?? 0);
const EVICT_AGE = Number(q.get("evictAge") ?? 10);
const BACKEND = q.get("backend") ?? "auto";

const FONTS = [
  "LibertinusSerif-Regular.otf",
  "LibertinusSerif-Bold.otf",
  "LibertinusSerif-Italic.otf",
  "NewCMMath-Regular.otf",
  "DejaVuSansMono.ttf",
].map((f) => `/assets/fonts/${f}`);

const log = (...a) => {
  console.log(...a);
  document.querySelector("#log").textContent += `${a.join(" ")}\n`;
};

const longTasks = [];
try {
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) longTasks.push(Math.round(e.duration));
  }).observe({ type: "longtask", buffered: true });
} catch {
  // longtask is Chromium-only
}

const stats = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const p = (f) => s[Math.min(s.length - 1, Math.floor(f * s.length))];
  return { n: s.length, p50: +p(0.5).toFixed(2), p90: +p(0.9).toFixed(2), max: +s.at(-1).toFixed(2), mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2) };
};

// --- engine clients ---------------------------------------------------------

const workerClient = (url) => {
  const worker = new Worker(url, { type: "module" });
  let seq = 0;
  const pending = new Map();
  worker.onmessage = ({ data }) => {
    const p = pending.get(data.id);
    pending.delete(data.id);
    data.error ? p.reject(new Error(data.error)) : p.resolve(data.result);
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message ?? "worker error"));
  };
  return (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, method, params });
    });
};

const makeTypstTs = async () => {
  const call = workerClient("/src/typstts.worker.mjs");
  const t = performance.now();
  const init = await call("init", { wasmUrl: "/node_modules/@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm", fonts: FONTS });
  init.wall = performance.now() - t;

  // renderer on the main thread, as typstream's paged renderer would be
  let r = performance.now();
  const module = await WebAssembly.compileStreaming(fetch("/node_modules/@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm"));
  init.rendererDownloadCompile = performance.now() - r;
  r = performance.now();
  initRenderer({ module });
  const renderer = await new TypstRendererBuilder().build();
  init.rendererInstantiate = performance.now() - r;

  const root = document.querySelector("#out");
  let session = null;
  return {
    init,
    newDoc: async () => {
      await call("newDoc");
      session?.free();
      session = renderer.create_session();
      root.replaceChildren();
    },
    compile: async (src) => {
      const t0 = performance.now();
      const res = await call("compile", { src, format: "paged" });
      res.roundtrip = performance.now() - t0;
      if (res.transfer) {
        const t1 = performance.now();
        // Same path as typst.ts's own TypstDocument: merge the delta, render an
        // SVG diff for the whole document, patch the existing DOM in place.
        renderer.manipulate_data(session, "merge", res.transfer);
        const patch = renderer.render_svg_diff(session, 0, 0, 1e33, 1e33);
        if (root.firstElementChild) {
          const tmp = document.createElement("div");
          tmp.innerHTML = patch;
          patchRoot(root.firstElementChild, tmp.firstElementChild);
        } else {
          root.innerHTML = patch;
        }
        res.render = performance.now() - t1;
        res.pages = session.pages_info.page_count;
        res.transfer = undefined;
      }
      return res;
    },
    memory: () => call("memory"),
  };
};

const makeCustom = async () => {
  const call = workerClient("/src/custom.worker.mjs");
  const base = `/custom/dist/${VARIANT}`;
  const t = performance.now();
  const init = await call("init", { glueUrl: `${base}/typstream_engine.js`, wasmUrl: `${base}/typstream_engine_bg.wasm`, fonts: FONTS });
  init.wall = performance.now() - t;
  const root = document.querySelector("#out");
  // svgdiff: one container per page; only changed pages get new markup.
  const pageEls = [];
  const applyChangedPages = (pageCount, changed) => {
    while (pageEls.length > pageCount) pageEls.pop().remove();
    while (pageEls.length < pageCount) {
      const el = document.createElement("div");
      el.className = "page";
      root.append(el);
      pageEls.push(el);
    }
    for (const { index, svg } of changed) pageEls[index].innerHTML = svg;
  };
  return {
    init,
    newDoc: async () => {
      await call("newDoc");
      pageEls.length = 0;
      root.replaceChildren();
    },
    compile: async (src) => {
      const t0 = performance.now();
      const res = await call("compile", { src, format: FORMAT });
      res.roundtrip = performance.now() - t0;
      const t1 = performance.now();
      if (FORMAT === "html" && res.output) root.innerHTML = res.output.replace(/^[\s\S]*<body>|<\/body>[\s\S]*$/g, "");
      if (FORMAT === "svg" && res.output) root.innerHTML = res.output.join("");
      if (FORMAT === "svgdiff" && res.ok) applyChangedPages(res.pages, res.output);
      res.render = performance.now() - t1;
      res.output = undefined;
      return res;
    },
    evict: (maxAge) => call("evict", { maxAge }),
    memory: () => call("memory"),
  };
};

const makeTypstWasmInWorker = async () => {
  const call = workerClient("/dist/typstwasm.worker.js");
  const t = performance.now();
  const init = await call("init", { base: `${location.origin}/node_modules/typst-wasm/dist/engine`, fonts: FONTS.map((f) => location.origin + f) });
  init.wall = performance.now() - t;
  const root = document.querySelector("#out");
  return {
    init,
    newDoc: () => call("newDoc"),
    compile: async (src) => {
      const t0 = performance.now();
      const res = await call("compile", { src, format: FORMAT });
      res.roundtrip = performance.now() - t0;
      const t1 = performance.now();
      if (FORMAT === "html" && res.output) root.innerHTML = res.output.replace(/^[\s\S]*<body>|<\/body>[\s\S]*$/g, "");
      if (FORMAT === "svg" && res.output) root.innerHTML = res.output.join("");
      res.render = performance.now() - t1;
      res.output = undefined;
      return res;
    },
    memory: () => call("memory"),
  };
};

const makeTypstWasm = async () => {
  const init = {};
  const t = performance.now();
  const mod = (name) => WebAssembly.compileStreaming(fetch(`/node_modules/typst-wasm/dist/engine/${name}`));
  const coreModules = { "engine.core.wasm": mod("engine.core.wasm"), "engine.core2.wasm": mod("engine.core2.wasm"), "engine.core3.wasm": mod("engine.core3.wasm") };
  await Promise.all(Object.values(coreModules));
  init.downloadCompile = performance.now() - t;
  const t2 = performance.now();
  const options = {
    backend: BACKEND,
    coreModules,
    worker: () => createWebWorker(new URL("/node_modules/typst-wasm/dist/worker/web-worker.js", location.href)),
    packageCache: false,
  };
  init.backend = BACKEND === "auto" ? selectAutomaticBackendKind(options) : BACKEND;
  const compiler = await createTypstCompiler(options);
  init.instantiate = performance.now() - t2;
  const t3 = performance.now();
  await compiler.addFonts(...FONTS.map(async (u) => new Uint8Array(await (await fetch(u)).arrayBuffer())));
  init.fonts = performance.now() - t3;
  init.wall = performance.now() - t;
  init.crossOriginIsolated = self.crossOriginIsolated;
  const root = document.querySelector("#out");
  return {
    init,
    newDoc: async () => {},
    compile: async (src) => {
      await compiler.addSource("main.typ", src);
      const t0 = performance.now();
      let out;
      let ok = true;
      let errors = [];
      try {
        out = await compiler.compile({ format: FORMAT, main: "main.typ" });
      } catch (e) {
        ok = false;
        errors = (e.diagnostics ?? [{ message: String(e) }]).filter((d) => d.severity !== "warning").slice(0, 3).map((d) => d.message);
      }
      const roundtrip = performance.now() - t0;
      const t1 = performance.now();
      let bytes = 0;
      let pages;
      if (out?.format === "html") {
        bytes = out.output.length;
        root.innerHTML = out.output.replace(/^[\s\S]*<body>|<\/body>[\s\S]*$/g, "");
      } else if (out?.format === "svg") {
        pages = out.pages.length;
        bytes = out.pages.reduce((n, p) => n + p.output.length, 0);
        root.innerHTML = out.pages.map((p) => p.output).join("");
      }
      return { ms: roundtrip, roundtrip, ok, errors, bytes, pages, render: performance.now() - t1 };
    },
    memory: async () => ({ memory: null }),
  };
};

// --- runs -------------------------------------------------------------------

const streamRun = async (engine) => {
  const docs = {};
  for (const pages of DOCS) {
    const doc = makeDoc(SECTIONS_FOR_PAGES[pages]);
    const steps = streamSteps(doc, 40);
    await engine.newDoc();
    const first = await engine.compile(steps[0]);
    const compileMs = [];
    const roundtrip = [];
    const render = [];
    const changedPages = [];
    const changedLog = [];
    const workerSplit = { compile: [], export: [] };
    let failures = 0;
    let firstError = null;
    let last;
    for (const src of steps.slice(1)) {
      last = await engine.compile(src);
      // Production setting for our engine: evict after every compile.
      if (EVICT && engine.evict) await engine.evict(EVICT_AGE);
      compileMs.push(last.ms);
      roundtrip.push(last.roundtrip);
      if (last.render !== undefined) render.push(last.render);
      if (last.changedPages !== undefined) {
        changedPages.push(last.changedPages);
        changedLog.push(`${last.pages}:${last.changedIdx.join(",")}`);
      }
      if (last.compileMs !== undefined) {
        workerSplit.compile.push(last.compileMs);
        workerSplit.export.push(last.exportMs);
      }
      if (!last.ok) {
        failures++;
        firstError ??= last.errors;
      }
    }
    // full document, cold in a fresh doc session
    await engine.newDoc();
    const full = await engine.compile(doc);
    const warm = await engine.compile(doc);
    docs[pages] = {
      chars: doc.length,
      steps: steps.length,
      firstPrefix: { ms: +first.ms.toFixed(2), ok: first.ok },
      stream: {
        compile: stats(compileMs),
        roundtrip: stats(roundtrip),
        render: stats(render),
        changedPages: stats(changedPages),
        changedLog: changedLog.length ? changedLog : undefined,
        workerCompile: stats(workerSplit.compile),
        workerExport: stats(workerSplit.export),
        failures,
        firstError,
      },
      fullDoc: { compileMs: +full.ms.toFixed(2), renderMs: full.render && +full.render.toFixed(2), ok: full.ok, errors: full.errors, pages: full.pages, bytes: full.bytes },
      warmIdentical: +warm.ms.toFixed(2),
      memoryAfter: (await engine.memory()).memory,
    };
    log(`${pages}p`, JSON.stringify(docs[pages]));
  }
  return docs;
};

// 200 compiles of a changing 5-page document; memory sampled every 20.
const memoryRun = async (engine) => {
  const base = makeDoc(SECTIONS_FOR_PAGES[5]);
  await engine.newDoc();
  const samples = [];
  const times = [];
  for (let i = 1; i <= 200; i++) {
    const src = `${base}\nRevision ${i}: #lorem(${20 + (i % 40)})\n`;
    const r = await engine.compile(src);
    times.push(r.ms);
    if (EVICT && i % EVICT === 0) await engine.evict(EVICT_AGE);
    if (i % 20 === 0) {
      samples.push({ i, memoryMB: +((await engine.memory()).memory / 2 ** 20).toFixed(1), lastMs: +r.ms.toFixed(2) });
      log("mem", JSON.stringify(samples.at(-1)));
    }
  }
  return { samples, compile: stats(times) };
};

const main = async () => {
  const makers = { typstts: makeTypstTs, custom: makeCustom, typstwasm: makeTypstWasm, typstwasmw: makeTypstWasmInWorker };
  const engine = await makers[ENGINE]();
  log("init", JSON.stringify(engine.init));
  const result = { engine: ENGINE, format: FORMAT, variant: ENGINE === "custom" ? VARIANT : undefined, mode: MODE, ua: navigator.userAgent, crossOriginIsolated: self.crossOriginIsolated, init: engine.init };
  if (MODE === "memory") result.memory = await memoryRun(engine);
  else result.docs = await streamRun(engine);
  result.longTasks = { count: longTasks.length, max: Math.max(0, ...longTasks), over50: longTasks.filter((d) => d > 50).length };
  window.__result = result;
  log("done");
};

main().catch((e) => {
  window.__error = `${e?.stack ?? e}\ncause: ${e?.cause?.stack ?? e?.cause?.message ?? JSON.stringify(e?.cause ?? null)}`;
  log("ERROR", window.__error);
});
