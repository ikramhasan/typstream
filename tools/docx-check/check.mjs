// DOCX exports against Typst's own PDF (#131): every Latin corpus document is exported to PDF and DOCX by
// @typstream/node (engine-wasm, the layout profile, edu's, mindmap's and Universe's packages as files), the DOCX
// converted to PDF by LibreOffice (which sees only the engine's fonts), and its lines and page starts compared with
// Typst's. Pictures (#133) are compared pixel by pixel on their regions, and text drawn in them, which a DOCX has as
// outlines, is left out of the lines.
//
//   node check.mjs [--native] [--onlyoffice | --google-docs [--google-docx]] [--scripts] [--fonts DIR]
//                  [--validate DLL] [--min-lines RATIO] [--min-math-lines RATIO] [--min-picture-lines RATIO]
//                  [--min-pictures RATIO] [--ink] [--positions] [--colours] [filter...]
//
// --validate: Microsoft's Open XML validator (validator/, `dotnet publish -c Release -o out`) on every file; any
// error fails the check. --min-lines, --min-math-lines, --min-picture-lines: fail when fewer of Typst's lines come
// back, over the documents without equations or pictures, those with equations and those with pictures, than RATIO
// (LibreOffice versions differ). --min-pictures: fail when fewer pictures than RATIO come out within the tolerance of
// tools/browser-suites' PDF raster suite (a few differing pixels touching; pixels.mjs). Each document is compared as the
// plugin conformance suite compares an example (tools/conformance's compare.mjs, #135), whose modules this uses.
// --ink: fail when a document laid out as Typst's (every line and page) draws rules, borders or shading otherwise
// (ink.mjs). An equation drawn with an operand missing (LibreOffice's red "¿") always fails.
// --positions: fail when such a document sets a line farther than lines.mjs's DRIFT_TOLERANCE from where Typst set it
// (a gap lost above it, a label centred with it): its lines would all match by text.
// --colours: fail when a word's paper or ink (a highlight, a shaded box, a coloured word) isn't Typst's colour
// (colour.mjs), equations aside.
//
// --onlyoffice: lay the files out with ONLYOFFICE (`x2t` in the onlyoffice/documentserver image, Docker) instead of
// LibreOffice: a second engine written apart from Word and LibreOffice (nightly). It reads only installed fonts.
// --google-docs: lay them out with Google Docs (google-docs.mjs; local only, through the Composio CLI): each file
// uploaded into Google Drive's `typstream-docx-check/<run>`, converted and exported as PDF, about 3 requests a
// document. Everything local goes in `$TMPDIR/typstream-docx-check/google-docs/<run>`. Google Docs spaces lines as
// multiples of the font's and scales pictures, so lines and pages are only reported, and pictures are checked for text
// over them (a room that didn't hold, #149): any fails the run. --google-docx: Google's own DOCX of each too (a fourth
// request each).
// --scripts: the documents in other scripts than Latin instead (#134: Arabic, Bengali, Devanagari, Chinese), their
// lines compared by `scriptLinesOf`. --fonts: the fonts the native example and the layout engine see (default
// engine-wasm's; a CJK face, say, which the engine doesn't ship).
// --native: the model and PDF from engine-wasm's native example (`cargo run --release --example docx_model`), for
// working on the model without a wasm build.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareExport } from "@typstream/conformance/compare";
import { COLOUR_TOLERANCE } from "@typstream/conformance/colour";
import { INK_TOLERANCE } from "@typstream/conformance/ink";
import { DRIFT_TOLERANCE } from "@typstream/conformance/lines";
import { layOut, packageFiles, validate } from "@typstream/conformance/office";
import { TOLERANCE } from "@typstream/conformance/pixels";
import { writeDocx } from "@typstream/docx";
import { eduFiles, eduPreamble } from "@typstream/edu";
import { heal } from "@typstream/heal";
import { mindmapFiles, mindmapPreamble } from "@typstream/mindmap";
import { render, renderDocxModel } from "@typstream/node";
import { DRIVE_FOLDER, layOutWithGoogleDocs, requests, textOverPictures } from "./google-docs.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const args = process.argv.slice(2);
const native = args.includes("--native");
const onlyoffice = args.includes("--onlyoffice");
const googleDocs = args.includes("--google-docs");
const googleDocx = args.includes("--google-docx");
const scripts = args.includes("--scripts");
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args.splice(at, 2)[1] : undefined;
};
const validator = option("--validate");
const minLines = Number(option("--min-lines") ?? 0);
const minMathLines = Number(option("--min-math-lines") ?? 0);
const minPictureLines = Number(option("--min-picture-lines") ?? 0);
const minPictures = Number(option("--min-pictures") ?? 0);
const minInk = args.includes("--ink");
const positions = args.includes("--positions");
const colours = args.includes("--colours");
const filters = () => args.filter((a) => !a.startsWith("--"));
// A Google Docs run's files, its own and the exports it uploads, are kept apart from the others' and each other's,
// named as its Drive folder is: when it ran, from which commit.
const commit = () => {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
};
const run = googleDocs ? `${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}-${commit()}` : undefined;
const out = join(tmpdir(), "typstream-docx-check", ...(run ? ["google-docs", run] : []));
mkdirSync(out, { recursive: true });
const fonts = option("--fonts") ?? join(root, "packages/engine-wasm/dist/fonts");
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

/** Documents in other scripts than Latin (#134), which `--scripts` checks instead. */
const SCRIPT = /arabic|bengali|chinese|hindi/;

/** Latin corpus documents that compile: the edu set, the llm set's and the islands' (their plugins' preambles first). */
const documents = () => {
  const docs = [];
  for (const set of ["edu", "llm", "islands"]) {
    const meta = JSON.parse(readFileSync(join(root, "corpus", set, "meta.json"), "utf8"));
    for (const [name, m] of Object.entries(meta)) {
      if ((m.expect ?? "ok") !== "ok") continue;
      if (SCRIPT.test(name) !== scripts) continue;
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

/** Universe's vendored packages as files, as @typstream/universe mounts them. */
const vendor = join(root, "packages/universe/vendor");
const universeFiles = packageFiles(
  readdirSync(vendor)
    .filter((f) => f.endsWith(".tar.gz"))
    .map((f) => {
      const [, name, version] = /^(.+)-(\d+\.\d+\.\d+)\.tar\.gz$/.exec(f);
      return { namespace: "preview", name, version, url: join(vendor, f) };
    }),
);

// Native compiles read them from --packages, as @preview/name/version/….
if (native) {
  for (const [key, data] of Object.entries(universeFiles)) {
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
      files: { ...universeFiles, ...assetFiles(dirname(doc.path)), ...Object.assign({}, ...plugins.map((p) => p.files)) },
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

// LibreOffice, ONLYOFFICE (seeing only the engine's fonts and what the DOCX embeds) or Google Docs.
const engine = googleDocs ? "Google Docs" : onlyoffice ? "ONLYOFFICE" : "LibreOffice";
const laidOut = googleDocs
  ? await layOutWithGoogleDocs(
      docx.map((d) => d.file),
      { out: join(out, "google"), run, docx: googleDocx, log: (line) => console.log(line) },
    )
  : {
      pdfs: layOut(
        docx.map((d) => d.file),
        { out: join(out, "lo"), engine: onlyoffice ? "onlyoffice" : "libreoffice", fonts },
      ),
      errors: {},
    };
for (const [i, { doc, dir, file }] of docx.entries()) {
  const pdf = laidOut.pdfs[i];
  if (!pdf) {
    results.push({ id: doc.id, error: laidOut.errors[file] ?? `${engine} didn't convert it` });
    continue;
  }
  // With equations, lines are compared by their text around them, and every equation's letters and digits must be
  // there (#132). Text in pictures is outlines in the DOCX: Typst's is left out.
  const r = compareExport(join(dir, "typst.pdf"), pdf, doc.model, { scripts });
  // Google Docs scales pictures and draws their PNGs, so they're checked for text over them instead of pixels, and
  // counted: a picture it dropped has no text over it.
  const google =
    googleDocs && r.pictures.length
      ? textOverPictures(pdf, join(dir, "typst.pdf"), doc.model.pictures, join(out, "google", "scratch"))
      : undefined;
  results.push({
    id: doc.id,
    ...r,
    pictures: r.pictures.length ? r.pictures : undefined,
    overlaps: google?.overlaps,
    missing: google && Math.max(0, doc.model.pictures.length - google.images),
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
// Operands LibreOffice's math drew as missing ("¿"), by document.
const operands = [];
// What pages draw besides text (rules, borders, shading), on documents laid out as Typst's.
const ink = { docs: 0, same: 0 };
// Where their lines are, on the same documents.
const placed = { docs: 0, same: 0 };
// Documents with words in other colours than Typst's.
const recoloured = [];
// Google Docs: documents with text over a picture.
const overlapping = [];
// Google Docs: documents with pictures missing from its PDF.
const missing = [];
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
    if (r.math.missing) operands.push(`${r.id} (${r.math.missing})`);
  }
  if (r.overlaps) {
    // Google Docs: its line spacing moves lines and pages where nothing is wrong, so text over a picture decides.
    if (r.overlaps.length) overlapping.push(r.id);
    if (r.missing) missing.push(r.id);
    const words = r.overlaps.slice(0, 12).map((w) => w.word);
    console.log(
      `${r.overlaps.length || r.missing ? "✗" : "✓"} (pictures ${r.pictures.length}) ${r.id}: ` +
        (r.missing ? `${r.missing} pictures missing, ` : "") +
        `${r.overlaps.length} words over pictures` +
        `${words.length ? ` (page ${r.overlaps[0].page + 1}: ${JSON.stringify(words.join(" "))})` : ""}; ` +
        `${r.same}/${r.lines} lines, pages ${r.pages.join("/")}, starts ${r.pageStartsSame}/${r.pageStarts}`,
    );
    continue;
  }
  const close = (r.pictures ?? []).filter((p) => p.cluster <= TOLERANCE).length;
  const inked = !ok || !r.ink || r.ink.cluster <= INK_TOLERANCE;
  if (ok && r.ink) {
    ink.docs++;
    if (inked) ink.same++;
  }
  const inPlace = !ok || !r.drift || r.drift.distance <= DRIFT_TOLERANCE;
  const coloured = !r.colours?.differing;
  if (!coloured) recoloured.push(`${r.id} (${r.colours.differing})`);
  if (ok && r.drift) {
    placed.docs++;
    if (inPlace) placed.same++;
  }
  for (const p of r.pictures ?? []) {
    withPictures.pictures++;
    if (p.cluster <= TOLERANCE) withPictures.close++;
    if (!withPictures.worst || p.cluster > withPictures.worst.cluster) withPictures.worst = { id: r.id, ...p };
  }
  const tags = [
    r.pictures && `pictures ${close}/${r.pictures.length}`,
    r.math && `math ${r.math.same}/${r.math.chars}${r.math.missing ? `, ${r.math.missing} missing operands` : ""}`,
  ].filter(Boolean);
  console.log(
    `${ok && inked && inPlace && coloured && close === (r.pictures?.length ?? 0) ? "✓" : "✗"}${tags.length ? ` (${tags.join(", ")})` : ""} ${r.id}: ` +
      `${r.same}/${r.lines} lines, pages ${r.pages.join("/")}, starts ${r.pageStartsSame}/${r.pageStarts}` +
      (ok || !r.first ? "" : `  typst ${JSON.stringify(r.first.typst)} other ${JSON.stringify(r.first.other)}`) +
      (r.pictures ?? [])
        .filter((p) => p.cluster > TOLERANCE)
        .map((p) => `  picture on page ${p.page + 1}: ${p.cluster} pixels touching at ${JSON.stringify(p.box)}`)
        .join("") +
      (inked ? "" : `  ink on page ${r.ink.page + 1}: ${r.ink.cluster} pixels touching at ${JSON.stringify(r.ink.box)}`) +
      (inPlace
        ? ""
        : `  line ${JSON.stringify(r.drift.text)} on page ${r.drift.page} moved by ${r.drift.dx.toFixed(1)}, ${r.drift.dy.toFixed(1)} pt`) +
      (coloured ? "" : `  ${r.colours.differing} words in other colours, first ${JSON.stringify(r.colours.first)}`),
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
  `equations' letters and digits ${chars.same}/${chars.all} (${percent(charsRatio)}); operands drawn as missing ("¿") in ` +
    `${operands.length} documents${operands.length ? ` (${operands.join(", ")})` : ""}`,
  `rules, borders and shading as Typst's (within ${INK_TOLERANCE} touching pixels) on ${ink.same} of the ${ink.docs} identical documents without math`,
  `every line where Typst set it (within ${DRIFT_TOLERANCE} pt) on ${placed.same} of the ${placed.docs} identical documents without math`,
  `words in Typst's colours (within ${COLOUR_TOLERANCE} levels) in ${results.length - recoloured.length - results.filter((r) => r.error).length} documents` +
    (recoloured.length ? `; not in ${recoloured.join(", ")}` : ""),
];
// Google Docs: pictures are checked for text over them, not pixel by pixel.
const checked = results.filter((r) => r.overlaps).length;
if (googleDocs)
  summary[3] =
    `with pictures: ${withPictures.identical}/${withPictures.docs} identical; lines ${withPictures.same}/${withPictures.lines} ` +
    `(${percent(pictureRatio)}); text over pictures in ${overlapping.length} of ${checked} documents` +
    (overlapping.length ? ` (${overlapping.join(", ")})` : "") +
    `; pictures missing in ${missing.length}` +
    (missing.length ? ` (${missing.join(", ")})` : "");
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
if (operands.length) failed = "equations drawn with missing operands";
const picturesRatio = withPictures.close / Math.max(1, withPictures.pictures);
if (picturesRatio < minPictures)
  failed = `pictures within the PDF's tolerance ${percent(picturesRatio)} under ${percent(minPictures)}`;
if (minInk && ink.same < ink.docs) failed = "rules, borders or shading unlike Typst's";
if (positions && placed.same < placed.docs) failed = "lines set away from where Typst set them";
if (colours && recoloured.length) failed = "words in other colours than Typst's";
if (overlapping.length) failed = "text over pictures in Google Docs";
if (missing.length) failed = "pictures missing in Google Docs";
if (validator) {
  const files = docx.map((d) => d.file);
  const bad = Object.values(validate(files, validator)).flat();
  if (bad.length) failed = "the validator found errors";
  console.log(bad.length ? bad.join("\n") : `validator: ${files.length} files, no errors`);
  summary.push(bad.length ? `validator: errors\n\n${bad.slice(0, 40).join("\n")}` : `validator: ${files.length} files, no errors`);
}
if (googleDocs)
  console.log(
    `Google Docs: ${requests} Composio requests; files in ${out}, Drive folder ${DRIVE_FOLDER}/${run} ` +
      `(delete ${DRIVE_FOLDER} in Drive and ${join(tmpdir(), "typstream-docx-check", "google-docs")} to clean up)`,
  );
if (process.env.GITHUB_STEP_SUMMARY) {
  const title = scripts ? "DOCX exports, other scripts" : "DOCX exports";
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## ${title}\n\n${summary.map((l) => `- ${l}`).join("\n")}\n`);
}
if (failed) {
  console.error(`docx-check: ${failed}`);
  process.exitCode = 1;
}
