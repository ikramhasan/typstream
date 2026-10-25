// Smoke test + Node timings for the custom Typst wasm engine.
//
//   node smoke.mjs [variant=html-svg] [fontDir]
//
// Loads dist/<variant>/typstream_engine.js (the --target web glue) via
// initSync({ module: bytes }). Each measurement gets a *fresh* wasm instance
// (the glue module is re-imported with a cache-busting query) because comemo's
// memoization cache is global per instance.
import { readFileSync, readdirSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const variant = process.argv[2] ?? "html-svg";
const fontDir =
  process.argv[3] ??
  process.env.FONT_DIR ??
  "/private/tmp/claude-501/-Users-ikramulhasan--claude-spares-spare-vnReLr/a9551ddc-5948-409f-94e9-774df6f7cc1d/scratchpad/fonts";
const distDir = join(here, "dist", variant);
const wasmFile = process.env.WASM ?? "typstream_engine_bg.wasm";
const wasmBytes = readFileSync(join(distDir, wasmFile));
let tc = performance.now();
const wasmModule = await WebAssembly.compile(wasmBytes);
const wasmCompileMs = performance.now() - tc;
const fonts = readdirSync(fontDir)
  .filter((f) => /\.(otf|ttf|ttc)$/i.test(f))
  .map((f) => readFileSync(join(fontDir, f)));

let instanceCounter = 0;
let lastInstantiateMs = 0;
async function freshEngine() {
  const url = pathToFileURL(join(distDir, "typstream_engine.js")).href + `?i=${instanceCounter++}`;
  const mod = await import(url);
  const ti = performance.now();
  mod.initSync({ module: wasmModule });
  lastInstantiateMs = performance.now() - ti;
  const engine = new mod.Engine();
  let faces = 0;
  for (const f of fonts) faces += engine.add_font(f);
  return { mod, engine, faces };
}

const hasSvg = variant !== "html";
const fmtMs = (x) => x.toFixed(1);
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

// ---------------------------------------------------------------- smoke doc
const SMOKE = `#set page(paper: "a4")
#set heading(numbering: "1.")
= Introduction
This is *strong* text, _emphasis_, and inline math $a^2 + b^2 = c^2$.

$ integral_0^1 x^2 dif x = 1/3 $

== Data
#figure(
  table(columns: 3, [*A*], [*B*], [*C*], [1], [2], [3], [4], [5], [6]),
  caption: [A small table],
) <tab>

As shown in @tab, numbers increase. See also @sec-grid.

== Layout <sec-grid>
#grid(columns: 2, gutter: 1em, [Left cell with $sqrt(x)$], [Right cell])

\`inline raw\` and a list:
- one
- two

\`\`\`python
def hyphenation_example(x): return "Donaudampfschifffahrt" + str(x)
\`\`\`
#set text(lang: "de", hyphenate: true)
#block(width: 3cm)[Donaudampfschifffahrtsgesellschaftskapitän Rechtsschutzversicherungsgesellschaften]
`;

console.log(`# variant: ${variant}  (wasm: ${wasmFile}, ${(wasmBytes.length / 1e6).toFixed(2)} MB)`);
{
  const { mod, engine, faces } = await freshEngine();
  console.log(`features: ${JSON.stringify(mod.Engine.features())}, font faces added: ${faces}`);
  console.log(`WebAssembly.compile: ${fmtMs(wasmCompileMs)}ms, instantiate (initSync): ${fmtMs(lastInstantiateMs)}ms, memory after fonts: ${(engine.memory_bytes() / 1048576).toFixed(1)}MiB`);
  engine.set_source("/main.typ", SMOKE);
  const h = engine.compile_html();
  console.log(`\n## compile_html ok=${h.ok} ms=${fmtMs(h.ms)} diagnostics=${JSON.stringify(h.diagnostics)}`);
  if (!h.ok) process.exitCode = 1;
  const html = h.html ?? "";
  console.log(`contains <math: ${html.includes("<math")}, <table: ${html.includes("<table")}, <figure: ${html.includes("<figure")}, length=${html.length}`);
  const body = html.slice(html.indexOf("<body>"), html.indexOf("</body>") + 7);
  console.log(body);
  console.log(`syntax-highlighted raw (has <span style="color): ${/<code[^>]*>.*<span style="color/s.test(html)}`);
  if (!html.includes("<math")) {
    console.error("FAIL: no <math in HTML");
    process.exitCode = 1;
  }

  if (hasSvg) {
    const s = engine.compile_svg();
    console.log(`\n## compile_svg ok=${s.ok} ms=${fmtMs(s.ms)} pages=${s.pages?.length} diagnostics=${JSON.stringify(s.diagnostics)}`);
    // Cross-check page count with native typst.
    const tmp = join(here, ".tmp-smoke");
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp);
    for (const [name, src] of [["smoke", SMOKE], ["bench", benchDoc(0)]]) {
      writeFileSync(join(tmp, `${name}.typ`), src);
      execFileSync("typst", [
        "compile", "--ignore-system-fonts", "--ignore-embedded-fonts", "--font-path", fontDir,
        join(tmp, `${name}.typ`), join(tmp, `${name}-{p}.svg`),
      ]);
      const nativePages = readdirSync(tmp).filter((f) => f.startsWith(`${name}-`) && f.endsWith(".svg")).length;
      engine.set_source("/main.typ", src);
      const w = engine.compile_svg();
      console.log(`page count ${name}: wasm=${w.pages?.length} native=${nativePages} ${w.pages?.length === nativePages ? "MATCH" : "MISMATCH"}`);
      if (w.pages?.length !== nativePages) process.exitCode = 1;
    }
    rmSync(tmp, { recursive: true, force: true });
  }
  if (variant === "full") {
    engine.set_source("/main.typ", SMOKE);
    const p = engine.compile_pdf();
    const head = p.pdf ? Buffer.from(p.pdf.slice(0, 8)).toString("latin1") : "";
    console.log(`\n## compile_pdf ok=${p.ok} ms=${fmtMs(p.ms)} bytes=${p.pdf?.length} header=${JSON.stringify(head)}`);
  } else {
    console.log(`\n## compile_pdf (not built): ${JSON.stringify(engine.compile_pdf())}`);
  }

  // sys.inputs
  engine.set_inputs(JSON.stringify({ name: "Ada", n: 3 }));
  engine.set_source("/main.typ", "Hello #sys.inputs.name, n=#sys.inputs.n");
  const inp = engine.compile_html();
  console.log(`\n## sys.inputs: ${inp.html?.match(/<p>.*<\/p>/)?.[0]}`);
  engine.set_inputs("{}");

  // Imports from another virtual file
  engine.set_source("/lib.typ", "#let greet(x) = [Hi *#x*]");
  engine.set_source("/main.typ", '#import "lib.typ": greet\n#greet("there")\n#image("missing.png")');
  const imp = engine.compile_html();
  console.log(`## import + missing file: ok=${imp.ok} diags=${JSON.stringify(imp.diagnostics)}`);

  // Broken doc
  const broken = "Hello *bold";
  engine.set_source("/main.typ", broken);
  const b = engine.compile_html();
  console.log(`\n## broken doc ${JSON.stringify(broken)}: ok=${b.ok}`);
  for (const d of b.diagnostics) {
    console.log(`  ${d.severity}: ${d.message} [${d.start}..${d.end}] -> ${JSON.stringify(broken.slice(d.start, d.end))} hints=${JSON.stringify(d.hints)}`);
  }
  const broken2 = "#let x = (1, 2\n= Heading\n#foo(1)";
  engine.set_source("/main.typ", broken2);
  const b2 = engine.compile_html();
  console.log(`## broken doc 2 ${JSON.stringify(broken2)}: ok=${b2.ok}`);
  for (const d of b2.diagnostics) {
    console.log(`  ${d.severity}: ${d.message} [${d.start}..${d.end}] -> ${JSON.stringify(broken2.slice(d.start, d.end))} hints=${JSON.stringify(d.hints)}`);
  }
  engine.set_source("/main.typ", "#let x = 1\nUnused warning? #text(fill: red)[ok] #h(1em) #pagebreak()");
  const wn = engine.compile_html();
  console.log(`## html-target warnings: ok=${wn.ok} diags=${JSON.stringify(wn.diagnostics)}`);
}

// ---------------------------------------------------------------- bench doc
function section(i) {
  return `
== Section ${i}: on the behaviour of series
Let $f(x) = sum_(k=0)^n a_k x^k$ be a polynomial of degree $n$ with *real* coefficients. We study
how the roots move as the coefficients $a_k$ vary, and give a short argument for
the bound $|z| <= 1 + max_k |a_k / a_n|$. The proof is elementary and uses only the triangle inequality.

$ |f(z)| >= |a_n| |z|^n - sum_(k<n) |a_k| |z|^k > 0 quad "for" |z| > R $

#table(columns: 4, [$k$], [$a_k$], [$|a_k|$], [note],
  [0], [$-1$], [1], [constant], [1], [$1/2$], [0.5], [linear], [2], [$pi$], [3.14], [quadratic])

Some more prose follows so that the section has realistic paragraph length. Students often confuse
the _degree_ of a polynomial with the number of distinct roots; the fundamental theorem of algebra
counts roots with multiplicity. #lorem(40)
`;
}
function benchDoc(extraParas) {
  let s = `#set page(paper: "a4")\n#set heading(numbering: "1.")\n= A six page document\n`;
  for (let i = 1; i <= 13; i++) s += section(i);
  for (let j = 0; j < extraParas; j++) s += `\nAppended paragraph ${j}: ${"streamed words go here and ".repeat(6)}done.\n`;
  return s;
}

async function timeTarget(kind) {
  const { engine } = await freshEngine();
  const call = kind === "html" ? () => engine.compile_html() : () => engine.compile_svg();
  engine.set_source("/main.typ", benchDoc(0));
  let t = performance.now();
  const first = call();
  const firstWall = performance.now() - t;
  if (!first.ok) throw new Error(JSON.stringify(first.diagnostics));
  const pages = first.pages?.length;
  // same source again (pure cache hit)
  t = performance.now();
  const same = call();
  const sameWall = performance.now() - t;
  const warm = [], warmWall = [];
  for (let j = 1; j <= 15; j++) {
    engine.set_source("/main.typ", benchDoc(j));
    t = performance.now();
    const r = call();
    warmWall.push(performance.now() - t);
    warm.push(r.ms);
  }
  return {
    kind, pages, srcBytes: benchDoc(0).length,
    first: first.ms, firstWall, same: same.ms, sameWall,
    warm1: warm[0], warmMedian: median(warm), warmWallMedian: median(warmWall),
    mem: engine.memory_bytes(),
  };
}

console.log(`\n# timings (fresh wasm instance per target; ms = engine-internal, wall = incl. JS marshalling)`);
const targets = hasSvg ? ["html", "svg"] : ["html"];
for (const k of targets) {
  const r = await timeTarget(k);
  console.log(
    `${k.padEnd(4)} src=${r.srcBytes}B pages=${r.pages ?? "-"}  first=${fmtMs(r.first)}ms (wall ${fmtMs(r.firstWall)})  ` +
      `same-src=${fmtMs(r.same)}ms  +1 para: first=${fmtMs(r.warm1)}ms median(15)=${fmtMs(r.warmMedian)}ms (wall ${fmtMs(r.warmWallMedian)})  ` +
      `mem=${(r.mem / 1048576).toFixed(1)}MiB`,
  );
}

// ---------------------------------------------------------------- memory
async function memoryRun(kind, policy) {
  const { engine } = await freshEngine();
  const call = kind === "html" ? () => engine.compile_html() : () => engine.compile_svg();
  const samples = [];
  const base = benchDoc(0);
  let tail = "";
  const t0 = performance.now();
  for (let i = 1; i <= 200; i++) {
    // streaming-like: tail grows by a few words each compile, a new paragraph every 10
    tail += i % 10 === 0 ? `\n\nParagraph ${i}: ` : ` word${i} more text`;
    engine.set_source("/main.typ", base + tail);
    const r = call();
    if (!r.ok) throw new Error(JSON.stringify(r.diagnostics));
    if (policy.every && i % policy.every === 0) engine.evict(policy.age);
    if (i % 50 === 0) samples.push(`${i}:${(engine.memory_bytes() / 1048576).toFixed(0)}`);
  }
  const total = performance.now() - t0;
  return { samples, final: engine.memory_bytes(), avg: total / 200 };
}

if (process.env.MEM === "0") process.exit(process.exitCode ?? 0);
console.log(`\n# memory: 200 compiles of a growing document (MiB of wasm linear memory at compile 50/100/150/200)`);
for (const k of targets) {
  for (const policy of [
    { label: "no evict            ", every: 0 },
    { label: "evict(10) every 10  ", every: 10, age: 10 },
    { label: "evict(10) every 1   ", every: 1, age: 10 },
    { label: "evict(2) every 1    ", every: 1, age: 2 },
  ]) {
    const r = await memoryRun(k, policy);
    console.log(
      `${k.padEnd(4)} ${policy.label}  ${r.samples.join("  ")}  final=${(r.final / 1048576).toFixed(1)}MiB  avg ${fmtMs(r.avg)}ms/compile`,
    );
  }
}
