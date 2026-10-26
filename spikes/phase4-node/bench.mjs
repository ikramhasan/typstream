// Throwaway (#22): engine-wasm in Node vs. the same World as a napi-rs addon.
//
//   node bench.mjs                  # everything: cold starts (fresh processes) + warm compiles
//   node bench.mjs cold wasm|native # one cold start, prints JSON (used by the parent)
//   node bench.mjs warm wasm|native # warm compiles over the edu corpus, prints JSON
//
// WASM_DIR (default packages/engine-wasm/dist/pdf) must hold an engine-wasm build with the
// `pdf` feature; native/typstream_native.node comes from `cargo build --release`
// in native/. Fonts are Typst's bundled set from the typst-assets crate.
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../..");
const WASM_DIR = process.env.WASM_DIR ?? join(here, "../../packages/engine-wasm/dist/pdf");

const fontFiles = () => {
  const meta = JSON.parse(
    execFileSync("cargo", ["metadata", "--format-version", "1", "--manifest-path", join(repo, "packages/engine-wasm/Cargo.toml")], {
      encoding: "utf8",
      maxBuffer: 1 << 26,
    }),
  );
  const dir = join(dirname(meta.packages.find((p) => p.name === "typst-assets").manifest_path), "files/fonts");
  return readdirSync(dir)
    .filter((f) => /\.(otf|ttf)$/.test(f))
    .sort()
    .map((f) => join(dir, f));
};

const corpus = () => {
  const dir = join(repo, "corpus/edu");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".typ"))
    .sort()
    .map((f) => ({ name: f.slice(0, -4), source: readFileSync(join(dir, f), "utf8") }));
};

const bib = readFileSync(join(repo, "corpus/edu/assets/climate-refs.yml"));

/** A uniform face over both engines: html, svg (every page) and pdf. */
const load = async (kind) => {
  if (kind === "wasm") {
    const glue = await import(join(WASM_DIR, "engine.js"));
    glue.initSync({ module: readFileSync(join(WASM_DIR, "engine_bg.wasm")) });
    const e = new glue.Engine();
    return {
      addFont: (b) => e.add_font(b),
      setSource: (s) => e.set_source("/main.typ", s),
      setBib: () => e.set_file("/assets/climate-refs.yml", bib),
      html: () => e.compile_html(),
      svg: () => {
        e.reset_pages();
        return e.compile_svg_changed();
      },
      pdf: () => e.compile_pdf(),
      memory: () => glue.Engine.memory_bytes(),
    };
  }
  const { NativeEngine } = createRequire(import.meta.url)(join(here, "native/typstream_native.node"));
  const e = new NativeEngine();
  return {
    addFont: (b) => e.addFont(b),
    setSource: (s) => e.setSource("/main.typ", s),
    setBib: () => {}, // the spike has no set_file; the one doc that needs it fails the same way each time
    html: () => e.compileHtml(),
    svg: () => e.compileSvg(),
    pdf: () => e.compilePdf(),
    memory: () => 0,
  };
};

const now = () => performance.now();
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const p = (xs, q) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))];
const r1 = (x) => Math.round(x * 10) / 10;

const cold = async (kind) => {
  const t0 = now();
  const fonts = fontFiles().map((f) => readFileSync(f));
  const tRead = now();
  const engine = await load(kind);
  const tInit = now();
  for (const f of fonts) engine.addFont(f);
  const tFonts = now();
  const doc = corpus().find((d) => d.name === "exam-calculus-midterm").source;
  engine.setSource(doc);
  const html = engine.html();
  const tHtml = now();
  engine.setSource(`${doc}\n\nOne more line.`);
  const pdf = engine.pdf();
  const tPdf = now();
  if (!html.ok || !pdf.ok) throw new Error(`cold compile failed: ${JSON.stringify(html.diagnostics ?? html.errors)}`);
  return {
    // Reading font files is the same for both; reported apart from init.
    readFontsMs: r1(tRead - t0),
    initMs: r1(tInit - tRead),
    addFontsMs: r1(tFonts - tInit),
    firstHtmlMs: r1(tHtml - tFonts),
    firstPdfMs: r1(tPdf - tHtml),
    totalMs: r1(tPdf - t0),
    rssMB: Math.round(process.memoryUsage().rss / 2 ** 20),
  };
};

const warm = async (kind) => {
  const engine = await load(kind);
  for (const f of fontFiles()) engine.addFont(readFileSync(f));
  engine.setBib();
  const docs = corpus();
  // Warm-up: code paths and font parsing, on a document not in the measured set's first pass.
  engine.setSource(docs[0].source);
  engine.html();
  engine.pdf();

  const results = { html: { first: [], again: [] }, svg: { first: [], again: [] }, pdf: { first: [], again: [] } };
  let failed = 0;
  for (const format of ["html", "svg", "pdf"]) {
    for (const [i, doc] of docs.entries()) {
      // "first": this document hasn't been compiled for this format in this process (a new
      // request); "again": the same document with a different last line (an LLM fix round).
      engine.setSource(`${doc.source}\n\nRequest ${format}-${i}.`);
      let t = now();
      const out = engine[format]();
      results[format].first.push(now() - t);
      if (!out.ok) failed++;
      const again = [];
      for (let k = 0; k < 5; k++) {
        engine.setSource(`${doc.source}\n\nRequest ${format}-${i}, round ${k}.`);
        t = now();
        engine[format]();
        again.push(now() - t);
      }
      results[format].again.push(median(again));
    }
  }
  const summary = {};
  for (const [format, { first, again }] of Object.entries(results)) {
    summary[format] = {
      firstP50: r1(median(first)),
      firstP90: r1(p(first, 0.9)),
      firstMax: r1(Math.max(...first)),
      againP50: r1(median(again)),
      againP90: r1(p(again, 0.9)),
    };
  }
  return {
    docs: docs.length,
    failed,
    ...summary,
    rssMB: Math.round(process.memoryUsage().rss / 2 ** 20),
    wasmMemoryMB: Math.round(engine.memory() / 2 ** 20),
  };
};

const [mode, kind] = process.argv.slice(2);
if (mode === "cold") console.log(JSON.stringify(await cold(kind)));
else if (mode === "warm") console.log(JSON.stringify(await warm(kind)));
else {
  const runs = Number(process.env.RUNS ?? 5);
  for (const k of ["wasm", "native"]) {
    const samples = [];
    for (let i = 0; i < runs; i++) {
      const out = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "cold", k], { encoding: "utf8" });
      if (out.status !== 0) throw new Error(out.stderr);
      samples.push(JSON.parse(out.stdout));
    }
    const med = Object.fromEntries(Object.keys(samples[0]).map((key) => [key, median(samples.map((s) => s[key]))]));
    console.log(`cold ${k} (median of ${runs})`, JSON.stringify(med));
  }
  for (const k of ["wasm", "native"]) {
    const out = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "warm", k], { encoding: "utf8" });
    if (out.status !== 0) throw new Error(out.stderr);
    console.log(`warm ${k}`, out.stdout.trim());
  }
}
