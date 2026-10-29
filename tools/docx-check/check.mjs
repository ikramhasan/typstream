// DOCX exports against Typst's own PDF (#131): every Latin corpus document is exported to PDF and DOCX by
// @typstream/node (engine-wasm, the layout profile, edu's, mindmap's and Universe's packages as files), the DOCX
// converted to PDF by LibreOffice (which sees only the engine's fonts), and its lines and page starts compared with
// Typst's. Pictures (#133) are compared pixel by pixel on their regions, and text drawn in them, which a DOCX has as
// outlines, is left out of the lines.
//
//   node check.mjs [--native] [--onlyoffice] [--validate DLL] [--min-lines RATIO] [--min-math-lines RATIO]
//                  [--min-picture-lines RATIO] [--min-pictures RATIO] [filter...]
//
// --validate: Microsoft's Open XML validator (validator/, `dotnet publish -c Release -o out`) on every file; any
// error fails the check. --min-lines, --min-math-lines, --min-picture-lines: fail when fewer of Typst's lines come
// back, over the documents without equations or pictures, those with equations and those with pictures, than RATIO
// (LibreOffice versions differ). --min-pictures: fail when fewer pictures than RATIO come out within the tolerance of
// tools/browser-suites' PDF raster suite (a few differing pixels touching; pixels.mjs).
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
import { eduFiles, eduPreamble } from "@typstream/edu";
import { heal } from "@typstream/heal";
import { mindmapFiles, mindmapPreamble } from "@typstream/mindmap";
import { render, renderDocxModel } from "@typstream/node";
import { compare, linesOf, mathOf, sharedChars, textFaces, textLinesOf } from "./lines.mjs";
import { compareRegions, TOLERANCE } from "./pixels.mjs";

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
const minMathLines = Number(option("--min-math-lines") ?? 0);
const minPictureLines = Number(option("--min-picture-lines") ?? 0);
const minPictures = Number(option("--min-pictures") ?? 0);
const filters = () => args.filter((a) => !a.startsWith("--"));
const out = join(tmpdir(), "typstream-docx-check");
mkdirSync(out, { recursive: true });
const fonts = join(root, "packages/engine-wasm/dist/fonts");
const example = join(root, "packages/engine-wasm/target/release/examples/docx_model");
const profile = /export const LAYOUT_PROFILE: string = `([^`]*)`;/.exec(
  readFileSync(join(root, "packages/engine/src/server/profile.ts"), "utf8"),
)[1];

// edu's and mindmap's packages where native compiles find them, as corpus:validate lays them out.
const packages = join(out, "packages");
const version = (name) =>
  /^version = "(.+)"$/m.exec(readFileSync(join(root, `packages/${name}/typst/typst.toml`), "utf8"))[1];
rmSync(packages, { recursive: true, force: true });
for (const name of ["edu", "mindmap"]) {
  mkdirSync(join(packages, "typstream", name), { recursive: true });
  execFileSync("cp", ["-r", join(root, `packages/${name}/typst`), join(packages, "typstream", name, version(name))]);
}
/** The plugins a corpus document may name: their preambles and files. */
const PLUGINS = {
  edu: { preamble: eduPreamble, files: eduFiles, native: `#import "@typstream/edu:${version("edu")}": *\n` },
  mindmap: { preamble: mindmapPreamble, files: mindmapFiles, native: mindmapPreamble },
};

/** Latin corpus documents that compile: the edu set, the llm set's and the islands' (their plugins' preambles first). */
const documents = () => {
  const docs = [];
  for (const set of ["edu", "llm", "islands"]) {
    const meta = JSON.parse(readFileSync(join(root, "corpus", set, "meta.json"), "utf8"));
    for (const [name, m] of Object.entries(meta)) {
      if ((m.expect ?? "ok") !== "ok") continue;
      if (/arabic|bengali|chinese|hindi|multilingual/.test(name)) continue;
      const plugins = m.plugins ?? [];
      if (plugins.some((p) => !(p in PLUGINS))) continue;
      docs.push({ id: `${set}/${name}`, path: join(root, "corpus", set, `${name}.typ`), plugins });
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

const results = [];
const docx = [];
for (const doc of documents()) {
  const dir = join(out, doc.id.replace("/", "__"));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // What an engine exports: the document healed in final mode, lint fixes included (the layout profile's among them).
  const text = heal(readFileSync(doc.path, "utf8"), { final: true }).source;
  const file = join(dir, `${basename(doc.path, ".typ")}.docx`);
  const plugins = doc.plugins.map((p) => PLUGINS[p]);
  if (native) {
    const typ = join(dir, "main.typ");
    writeFileSync(typ, profile + plugins.map((p) => p.native).join("") + text);
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
    const data = model.fonts.map((_, i) => new Uint8Array(readFileSync(join(dir, `font-${i}.ttf`))));
    const pictures = (model.pictures ?? []).map((_, i) => ({
      svg: readFileSync(join(dir, `picture-${i}.svg`), "utf8"),
      png: new Uint8Array(readFileSync(join(dir, `picture-${i}.png`))),
    }));
    writeFileSync(file, writeDocx(model, data, pictures));
    // The fonts and pictures are in the DOCX now; copies per document would fill the disk.
    for (let i = 0; i < data.length; i++) rmSync(join(dir, `font-${i}.ttf`));
    for (let i = 0; i < pictures.length; i++) for (const ext of ["svg", "png"]) rmSync(join(dir, `picture-${i}.${ext}`));
    doc.model = model;
  } else {
    const options = {
      preamble: plugins.map((p) => p.preamble).join("") || undefined,
      files: { ...packageFiles, ...assetFiles(dirname(doc.path)), ...Object.assign({}, ...plugins.map((p) => p.files)) },
    };
    const [pdf, out] = await Promise.all([render(text, "pdf", options), renderDocxModel(text, options)]);
    if (!pdf.ok || !out.ok) {
      results.push({ id: doc.id, error: (pdf.ok ? out : pdf).diagnostics.map((d) => d.message).join("; ").slice(0, 300) });
      continue;
    }
    writeFileSync(join(dir, "typst.pdf"), pdf.data);
    writeFileSync(file, writeDocx(out.model, out.fonts, out.pictures));
    writeFileSync(join(dir, "model.json"), JSON.stringify(out.model));
    doc.model = out.model;
  }
  // Equations are set by each engine its own way, and pictures hold text as outlines: such documents are reported
  // apart.
  doc.pictures = doc.model.pictures ?? [];
  doc.math = JSON.stringify(doc.model.sections).includes('"math":[');
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
  const typst = join(dir, "typst.pdf");
  // With equations, lines are compared by their text around them, and every equation's letters and digits must be
  // there (#132). Text in pictures is outlines in the DOCX: Typst's is left out.
  const regions = doc.pictures;
  const math = doc.math ? [mathOf(typst, regions), mathOf(pdf)] : undefined;
  const faces = doc.math ? textFaces(typst) : undefined;
  const pictures = compareRegions(typst, pdf, regions);
  results.push({
    id: doc.id,
    pictures: pictures.length ? pictures : undefined,
    math: math && { chars: math[0].length, same: sharedChars(math[0], math[1]) },
    ...(doc.math
      ? compare(textLinesOf(typst, undefined, regions), textLinesOf(pdf, faces))
      : compare(linesOf(typst, regions), linesOf(pdf))),
  });
}

let lines = 0;
let same = 0;
let starts = 0;
let startsSame = 0;
let identical = 0;
const plain = { docs: 0, identical: 0, lines: 0, same: 0 };
const withMath = { docs: 0, identical: 0, lines: 0, same: 0 };
const withPictures = { docs: 0, identical: 0, lines: 0, same: 0, pictures: 0, close: 0, worst: null };
const chars = { all: 0, same: 0 };
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
  const group = r.pictures ? withPictures : r.math ? withMath : plain;
  group.docs++;
  group.lines += r.lines;
  group.same += r.same;
  if (ok) group.identical++;
  if (r.math) {
    chars.all += r.math.chars;
    chars.same += r.math.same;
  }
  const close = (r.pictures ?? []).filter((p) => p.cluster <= TOLERANCE).length;
  for (const p of r.pictures ?? []) {
    withPictures.pictures++;
    if (p.cluster <= TOLERANCE) withPictures.close++;
    if (!withPictures.worst || p.cluster > withPictures.worst.cluster) withPictures.worst = { id: r.id, ...p };
  }
  const tags = [
    r.pictures && `pictures ${close}/${r.pictures.length}`,
    r.math && `math ${r.math.same}/${r.math.chars}`,
  ].filter(Boolean);
  console.log(
    `${ok && close === (r.pictures?.length ?? 0) ? "✓" : "✗"}${tags.length ? ` (${tags.join(", ")})` : ""} ${r.id}: ` +
      `${r.same}/${r.lines} lines, pages ${r.pages.join("/")}, starts ${r.pageStartsSame}/${r.pageStarts}` +
      (ok || !r.first ? "" : `  typst ${JSON.stringify(r.first.typst)} other ${JSON.stringify(r.first.other)}`) +
      (r.pictures ?? [])
        .filter((p) => p.cluster > TOLERANCE)
        .map((p) => `  picture on page ${p.page + 1}: ${p.cluster} pixels touching at ${JSON.stringify(p.box)}`)
        .join(""),
  );
}
console.log(
  `\n${identical}/${results.length} identical; lines ${same}/${lines} (${((100 * same) / Math.max(1, lines)).toFixed(1)}%), page starts ${startsSame}/${starts}`,
);
const ratio = plain.same / Math.max(1, plain.lines);
const mathRatio = withMath.same / Math.max(1, withMath.lines);
const pictureRatio = withPictures.same / Math.max(1, withPictures.lines);
const charsRatio = chars.same / Math.max(1, chars.all);
const percent = (r) => `${(100 * r).toFixed(1)}%`;
const summary = [
  `${identical}/${results.length} identical; lines ${same}/${lines}, page starts ${startsSame}/${starts}`,
  `without math and pictures: ${plain.identical}/${plain.docs} identical; lines ${plain.same}/${plain.lines} (${percent(ratio)})`,
  `with math, without pictures: ${withMath.identical}/${withMath.docs} identical; lines ${withMath.same}/${withMath.lines} (${percent(mathRatio)})`,
  `with pictures: ${withPictures.identical}/${withPictures.docs} identical; lines ${withPictures.same}/${withPictures.lines} ` +
    `(${percent(pictureRatio)}); pictures within ${TOLERANCE} touching pixels of the PDF ${withPictures.close}/${withPictures.pictures}`,
  `equations' letters and digits ${chars.same}/${chars.all} (${percent(charsRatio)})`,
];
for (const line of summary.slice(1)) console.log(line);
if (withPictures.worst)
  console.log(
    `most differing picture: ${withPictures.worst.id}, page ${withPictures.worst.page + 1}, ` +
      `${withPictures.worst.cluster} pixels touching at ${JSON.stringify(withPictures.worst.box)}`,
  );
writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 2));
let failed = results.some((r) => r.error) ? "documents that didn't export" : "";
if (ratio < minLines) failed = `line agreement ${percent(ratio)} under ${percent(minLines)}`;
if (mathRatio < minMathLines) failed = `line agreement with math ${percent(mathRatio)} under ${percent(minMathLines)}`;
if (pictureRatio < minPictureLines)
  failed = `line agreement with pictures ${percent(pictureRatio)} under ${percent(minPictureLines)}`;
if (chars.same < chars.all) failed = "equations that didn't come out whole";
const picturesRatio = withPictures.close / Math.max(1, withPictures.pictures);
if (picturesRatio < minPictures)
  failed = `pictures within the PDF's tolerance ${percent(picturesRatio)} under ${percent(minPictures)}`;
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
