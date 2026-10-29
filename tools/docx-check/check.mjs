// DOCX exports against Typst's own PDF (#131): every Latin corpus document is exported to PDF and DOCX by
// @typstream/node (engine-wasm, the layout profile, edu's and Universe's packages as files), the DOCX converted to PDF
// by LibreOffice (which sees only the engine's fonts), and its lines and page starts compared with Typst's.
//
//   node check.mjs [--native] [--onlyoffice] [--validate DLL] [--min-lines RATIO] [filter...]
//
// --validate: Microsoft's Open XML validator (validator/, `dotnet publish -c Release -o out`) on every file; any
// error fails the check. --min-lines: fail when fewer of Typst's lines come back in LibreOffice, over the documents
// without equations or images (#132 and #133 write those), than RATIO (CI: 0.94; LibreOffice versions differ).
//
// --onlyoffice: lay the files out with ONLYOFFICE (`x2t` in the onlyoffice/documentserver image, Docker) instead of
// LibreOffice: a second engine written apart from Word and LibreOffice (nightly). It reads only installed fonts.
// --native: the model and PDF from engine-wasm's native example (`cargo run --release --example docx_model`), for
// working on the model without a wasm build.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { writeDocx } from "@typstream/docx";
import { strFromU8, unzipSync } from "fflate";
import { EDU_VERSION, eduFiles, eduPreamble } from "@typstream/edu";
import { heal } from "@typstream/heal";
import { render } from "@typstream/node";
import { compare, linesOf } from "./lines.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const args = process.argv.slice(2);
const native = args.includes("--native");
const onlyoffice = args.includes("--onlyoffice");
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args.splice(at, 2)[1] : undefined;
};
const validator = option("--validate");
const minLines = Number(option("--min-lines") ?? 0);
const filters = () => args.filter((a) => !a.startsWith("--"));
const out = join(tmpdir(), "typstream-docx-check");
mkdirSync(out, { recursive: true });
const fonts = join(root, "packages/engine-wasm/dist/fonts");
const example = join(root, "packages/engine-wasm/target/release/examples/docx_model");
const profile = /export const LAYOUT_PROFILE: string = `([^`]*)`;/.exec(
  readFileSync(join(root, "packages/engine/src/server/profile.ts"), "utf8"),
)[1];

// edu's package where native compiles find it, as corpus:validate lays it out.
const packages = join(out, "packages");
const eduVersion = /^version = "(.+)"$/m.exec(readFileSync(join(root, "packages/edu/typst/typst.toml"), "utf8"))[1];
rmSync(packages, { recursive: true, force: true });
mkdirSync(join(packages, "typstream/edu"), { recursive: true });
execFileSync("cp", ["-r", join(root, "packages/edu/typst"), join(packages, "typstream/edu", eduVersion)]);

/** Latin corpus documents that compile: the edu set, and the llm set's (their plugins' preambles first). */
const documents = () => {
  const docs = [];
  for (const set of ["edu", "llm"]) {
    const meta = JSON.parse(readFileSync(join(root, "corpus", set, "meta.json"), "utf8"));
    for (const [name, m] of Object.entries(meta)) {
      if ((m.expect ?? "ok") !== "ok") continue;
      if (/arabic|bengali|chinese|hindi|multilingual/.test(name)) continue;
      const plugins = m.plugins ?? [];
      if (plugins.some((p) => p !== "edu")) continue;
      docs.push({ id: `${set}/${name}`, path: join(root, "corpus", set, `${name}.typ`), edu: plugins.includes("edu") });
    }
  }
  return docs.filter((d) => filters().length === 0 || filters().some((f) => d.id.includes(f)));
};

/** A corpus set's `assets/` folder, as files its documents read. */
const assetFiles = (dir) => {
  const assets = join(dir, "assets");
  if (!existsSync(assets)) return {};
  return Object.fromEntries(readdirSync(assets).map((name) => [`assets/${name}`, new Uint8Array(readFileSync(join(assets, name)))]));
};

/** Universe's vendored packages as files, as @typstream/universe mounts them (ustar, regular files only). */
const packageFiles = {};
const vendor = join(root, "packages/universe/vendor");
for (const tarball of readdirSync(vendor).filter((f) => f.endsWith(".tar.gz"))) {
  const [, name, version] = /^(.+)-(\d+\.\d+\.\d+)\.tar\.gz$/.exec(tarball);
  const tar = gunzipSync(readFileSync(join(vendor, tarball)));
  for (let at = 0; at + 512 <= tar.length && tar[at] !== 0; ) {
    const field = (from, length) => tar.toString("utf8", at + from, at + from + length).replace(/\0.*$/s, "");
    const size = Number.parseInt(field(124, 12).trim() || "0", 8);
    const path = ((field(345, 155) ? `${field(345, 155)}/` : "") + field(0, 100)).replace(/^\.\//, "");
    if (["0", ""].includes(field(156, 1))) packageFiles[`@preview/${name}:${version}/${path}`] = new Uint8Array(tar.subarray(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
}

// Native compiles read them from --packages, as @preview/name/version/….
if (native) {
  for (const [key, data] of Object.entries(packageFiles)) {
    const [, name, version, path] = /^@preview\/(.+?):(.+?)\/(.*)$/.exec(key);
    const file = join(packages, "preview", name, version, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
  }
}

/** Whether a DOCX holds room for equations or images (the writer's placeholder styles), which #132 and #133 fill. */
const placeholders = (data) => strFromU8(unzipSync(data)["word/document.xml"] ?? new Uint8Array()).includes("TypstreamPlaceholder");

const results = [];
const docx = [];
for (const doc of documents()) {
  const dir = join(out, doc.id.replace("/", "__"));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // What an engine exports: the document healed in final mode, lint fixes included (the layout profile's among them).
  const text = heal(readFileSync(doc.path, "utf8"), { final: true }).source;
  const file = join(dir, `${basename(doc.path, ".typ")}.docx`);
  if (native) {
    const typ = join(dir, "main.typ");
    writeFileSync(typ, profile + (doc.edu ? `#import "@typstream/edu:${eduVersion}": *\n` : "") + text);
    for (const [name, data] of Object.entries(assetFiles(dirname(doc.path)))) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), data);
    }
    try {
      execFileSync(example, [typ, "--out", dir, "--fonts", fonts, "--packages", packages], { stdio: "pipe" });
    } catch (e) {
      results.push({ id: doc.id, error: String(e.stderr ?? e).slice(0, 300) });
      continue;
    }
    const json = readFileSync(join(dir, "model.json"), "utf8");
    const model = JSON.parse(json);
    // Math and images are placeholders until #132 and #133: such documents are reported apart.
    doc.placeholders = /"placeholder":true/.test(json);
    const data = model.fonts.map((_, i) => new Uint8Array(readFileSync(join(dir, `font-${i}.ttf`))));
    writeFileSync(file, writeDocx(model, data));
    // The fonts are in the DOCX now; copies per document would fill the disk.
    for (let i = 0; i < data.length; i++) rmSync(join(dir, `font-${i}.ttf`));
  } else {
    const options = {
      preamble: doc.edu ? eduPreamble : undefined,
      files: { ...packageFiles, ...assetFiles(dirname(doc.path)), ...(doc.edu ? eduFiles : {}) },
    };
    const [pdf, out] = await Promise.all([render(text, "pdf", options), render(text, "docx", options)]);
    if (!pdf.ok || !out.ok) {
      results.push({ id: doc.id, error: (pdf.ok ? out : pdf).diagnostics.map((d) => d.message).join("; ").slice(0, 300) });
      continue;
    }
    writeFileSync(join(dir, "typst.pdf"), pdf.data);
    writeFileSync(file, out.data);
    doc.placeholders = placeholders(out.data);
  }
  docx.push({ doc, dir, file });
}

// ONLYOFFICE: one container for the batch, a font index of the engine's fonts, then x2t per file.
const OO_SCRIPT = `
set -e
DIR=/var/www/onlyoffice/documentserver
BIN=$DIR/server/FileConverter/bin
export LD_LIBRARY_PATH=$BIN
$DIR/server/tools/allfontsgen --input=/fonts --allfonts=$BIN/AllFonts.js --selection=$BIN/font_selection.bin --use-system=false > /dev/null
cd $BIN
for f in "$@"; do
  printf '<?xml version="1.0" encoding="utf-8"?><TaskQueueDataConvert><m_sFileFrom>/work/%s.docx</m_sFileFrom><m_sFileTo>/work/%s.pdf</m_sFileTo><m_nFormatTo>513</m_nFormatTo><m_sFontDir>/fonts</m_sFontDir><m_bIsNoBase64>true</m_bIsNoBase64></TaskQueueDataConvert>' "$f" "$f" > /tmp/p.xml
  ./x2t /tmp/p.xml > /dev/null 2>&1 || true
  [ -f "/work/$f.pdf" ] && chown "$(stat -c %u:%g /work)" "/work/$f.pdf" || true
done
`;

// LibreOffice, seeing only the engine's fonts (and what the DOCX embeds).
const conf = join(out, "fonts.conf");
writeFileSync(
  conf,
  `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>${fonts}</dir><cachedir>${join(out, "fc-cache")}</cachedir></fontconfig>`,
);
const lo = join(out, "lo");
mkdirSync(lo, { recursive: true });
if (onlyoffice) {
  for (const { file } of docx) execFileSync("cp", [file, lo]);
  execFileSync(
    "docker",
    [
      ...["run", "--rm", "-v", `${fonts}:/fonts:ro`, "-v", `${lo}:/work`, "--entrypoint", "bash"],
      ...["onlyoffice/documentserver", "-c", OO_SCRIPT, "x", ...docx.map(({ file }) => basename(file, ".docx"))],
    ],
    { stdio: "pipe", timeout: 1_800_000 },
  );
}
for (let i = 0; i < (onlyoffice ? 0 : docx.length); i += 40) {
  const batch = docx.slice(i, i + 40).map((d) => d.file);
  try {
    execFileSync(
      "soffice",
      [`-env:UserInstallation=file://${join(out, "lo-profile")}`, "--headless", "--convert-to", "pdf", "--outdir", lo, ...batch],
      { env: { ...process.env, FONTCONFIG_FILE: conf, SAL_USE_VCLPLUGIN: "svp" }, stdio: "pipe", timeout: 600_000 },
    );
  } catch {}
}
for (const { doc, dir, file } of docx) {
  const pdf = join(lo, `${basename(file, ".docx")}.pdf`);
  if (!existsSync(pdf)) {
    results.push({ id: doc.id, error: "LibreOffice didn't convert it" });
    continue;
  }
  results.push({ id: doc.id, placeholders: doc.placeholders, ...compare(linesOf(join(dir, "typst.pdf")), linesOf(pdf)) });
}

let lines = 0;
let same = 0;
let starts = 0;
let startsSame = 0;
let identical = 0;
const plain = { docs: 0, identical: 0, lines: 0, same: 0 };
for (const r of results.sort((a, b) => a.id.localeCompare(b.id))) {
  if (r.error) {
    console.log(`✗ ${r.id}: ${r.error}`);
    continue;
  }
  lines += r.lines;
  same += r.same;
  starts += r.pageStarts;
  startsSame += r.pageStartsSame;
  const ok = r.same === r.lines && r.pageStartsSame === r.pageStarts && r.pages[0] === r.pages[1];
  if (ok) identical++;
  if (!r.placeholders) {
    plain.docs++;
    plain.lines += r.lines;
    plain.same += r.same;
    if (ok) plain.identical++;
  }
  console.log(
    `${ok ? "✓" : "✗"}${r.placeholders ? " (math, images)" : ""} ${r.id}: ${r.same}/${r.lines} lines, pages ${r.pages.join("/")}, starts ${r.pageStartsSame}/${r.pageStarts}` +
      (ok || !r.first ? "" : `  typst ${JSON.stringify(r.first.typst)} other ${JSON.stringify(r.first.other)}`),
  );
}
console.log(
  `\n${identical}/${results.length} identical; lines ${same}/${lines} (${((100 * same) / Math.max(1, lines)).toFixed(1)}%), page starts ${startsSame}/${starts}`,
);
const ratio = plain.same / Math.max(1, plain.lines);
const summary = [
  `${identical}/${results.length} identical; lines ${same}/${lines}, page starts ${startsSame}/${starts}`,
  `without math and images: ${plain.identical}/${plain.docs} identical; lines ${plain.same}/${plain.lines} (${(100 * ratio).toFixed(1)}%)`,
];
console.log(summary[1]);
writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 2));
let failed = results.some((r) => r.error) ? "documents that didn't export" : "";
if (ratio < minLines) failed = `line agreement ${(100 * ratio).toFixed(1)}% under ${(100 * minLines).toFixed(1)}%`;
if (validator) {
  const files = docx.map((d) => d.file);
  let report = "";
  try {
    report = execFileSync("dotnet", [validator, ...files], { encoding: "utf8", maxBuffer: 1 << 26 });
  } catch (e) {
    report = String(e.stdout ?? e);
    failed = "the validator found errors";
  }
  const bad = report.split("\n").filter((l) => /: [1-9]\d* error/.test(l) || l.startsWith("  "));
  console.log(bad.length ? bad.join("\n") : `validator: ${files.length} files, no errors`);
  summary.push(bad.length ? `validator: errors\n\n${bad.slice(0, 40).join("\n")}` : `validator: ${files.length} files, no errors`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## DOCX exports\n\n${summary.map((l) => `- ${l}`).join("\n")}\n`);
}
if (failed) {
  console.error(`docx-check: ${failed}`);
  process.exitCode = 1;
}
