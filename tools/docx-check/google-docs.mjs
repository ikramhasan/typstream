// Google Docs as the layout engine (local only): each DOCX uploaded to Google Drive through the Composio CLI, converted
// to a Google Doc and exported as PDF, so check.mjs compares Google's pages with Typst's as it compares LibreOffice's.
// Google Docs has no exact line heights (it makes them multiples of the font's line), which LibreOffice and ONLYOFFICE
// don't show: a drawing's room held by an exact line shrank there and the text after it ran under the picture (#149).
//
// Everything goes in one Drive folder, `typstream-docx-check`, a folder per run in it (the uploaded DOCX and its
// Google Doc); nothing is deleted, so removing that folder cleans up every run. Three Composio requests a document
// (upload, convert, export), a fourth with `docx` (Google's own DOCX, for looking at what it made of the file), and two
// a run for the folders. Needs `composio` on PATH, logged in, with a Google Drive connection (`composio link
// googledrive`).
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const DRIVE = "https://www.googleapis.com/drive/v3/files";
const FOLDER = "application/vnd.google-apps.folder";
const DOCUMENT = "application/vnd.google-apps.document";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
/** Drive's folder for every run, in My Drive. */
export const DRIVE_FOLDER = "typstream-docx-check";
/** Composio's upload tool takes files up to 5 MB. */
const MAX_UPLOAD = 5 * 1024 * 1024;

/** Composio requests made so far. */
export let requests = 0;

/** A Composio CLI call's JSON output; a request that fails is tried once more. */
const composio = async (args, tries = 2) => {
  for (let i = 1; ; i++) {
    requests++;
    try {
      // stdin closed: with a pipe there, the CLI waits to read a body from it.
      const stdout = await new Promise((resolve, reject) => {
        const child = spawn("composio", args, { stdio: ["ignore", "pipe", "pipe"], timeout: 180_000 });
        let out = "";
        let err = "";
        child.stdout.on("data", (d) => {
          out += d;
        });
        child.stderr.on("data", (d) => {
          err += d;
        });
        child.on("error", reject);
        child.on("close", (code) =>
          code === 0 ? resolve(out) : reject(new Error(`composio ${args[1]}: exit ${code}\n${err}`.trim())),
        );
      });
      const json = JSON.parse(stdout);
      if (json.successful === false || json.error?.message || (json.status && json.status >= 400))
        throw new Error(JSON.stringify(json.error ?? json).slice(0, 300));
      return json;
    } catch (e) {
      if (i >= tries) throw e;
    }
  }
};

/** A Drive API request through `composio proxy`. */
const drive = (url, method = "GET", body) =>
  composio([
    "proxy",
    url,
    "--toolkit",
    "googledrive",
    "--method",
    method,
    ...(body ? ["-H", "Content-Type: application/json", "-d", JSON.stringify(body)] : []),
  ]);

/** A Drive folder named `name` in `parent`: found, or made. */
const folder = async (name, parent, find = true) => {
  if (find) {
    const q = `name = '${name}' and mimeType = '${FOLDER}' and '${parent}' in parents and trashed = false`;
    const found = await drive(`${DRIVE}?q=${encodeURIComponent(q)}&fields=files(id)`);
    if (found.files?.[0]) return found.files[0].id;
  }
  return (await drive(DRIVE, "POST", { name, mimeType: FOLDER, parents: [parent] })).id;
};

/** An export of a Google Doc, written to `file`: the proxy hands back a temporary URL for binary bodies. */
const download = async (id, mimeType, file) => {
  const res = await drive(`${DRIVE}/${id}/export?mimeType=${encodeURIComponent(mimeType)}`);
  const url = res.binary_data?.url;
  if (!url) throw new Error(`no export of ${id}: ${JSON.stringify(res).slice(0, 200)}`);
  const body = await fetch(url);
  if (!body.ok) throw new Error(`export of ${id}: HTTP ${body.status}`);
  writeFileSync(file, new Uint8Array(await body.arrayBuffer()));
};

/**
 * Words of `pdf` drawn over its images: what a picture's room that didn't hold leaves (#149). Google Docs draws
 * pictures from their PNGs, their own text inside them, so a word over one is text the layout ran into it. Pictures
 * can't be compared with Typst's pixel by pixel there: Google scales them about 1% and draws from the PNG. `scratch` is
 * a folder for poppler's image files (deleted). Each overlap is `{ page, word, box }`, box in points.
 */
export const textOverPictures = (pdf, scratch) => {
  mkdirSync(scratch, { recursive: true });
  let xml;
  try {
    execFileSync("pdftohtml", ["-xml", "-q", "-zoom", "1", pdf, join(scratch, "page")], { stdio: "pipe" });
    xml = readFileSync(join(scratch, "page.xml"), "utf8");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const images = [];
  let page = 0;
  for (const m of xml.matchAll(/<page number="(\d+)"|<image top="([\d.-]+)" left="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
    if (m[1]) page = Number(m[1]);
    else images.push({ page, x0: +m[3], y0: +m[2], x1: +m[3] + +m[4], y1: +m[2] + +m[5] });
  }
  if (!images.length) return [];
  const words = execFileSync("pdftotext", ["-bbox", pdf, "-"], { encoding: "utf8", maxBuffer: 1 << 26 });
  const overlaps = [];
  page = 0;
  for (const m of words.matchAll(
    /<page |<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g,
  )) {
    if (!m[1]) {
      page++;
      continue;
    }
    const [x0, y0, x1, y1] = [+m[1], +m[2], +m[3], +m[4]];
    // More than a quarter of the word inside the picture: a word that only touches its edge is beside it.
    const over = images.some((im) => {
      if (im.page !== page) return false;
      const w = Math.max(0, Math.min(x1, im.x1) - Math.max(x0, im.x0));
      const h = Math.max(0, Math.min(y1, im.y1) - Math.max(y0, im.y0));
      return w * h > 0.25 * (x1 - x0) * (y1 - y0);
    });
    if (over) overlaps.push({ page: page - 1, word: m[5], box: [x0, y0, x1, y1].map(Math.round) });
  }
  return overlaps;
};

/**
 * Google Docs' PDFs of `files` (null where one failed, its error in `errors`), in `out`, as `layOut` gives
 * LibreOffice's: each file uploaded into Drive's `typstream-docx-check/<run>`, converted to a Google Doc there and
 * exported, `concurrency` at a time. With `docx`, Google's DOCX of each too (`<name>.google.docx`).
 */
export const layOutWithGoogleDocs = async (files, { out, run, docx = false, concurrency = 4, log = () => {} }) => {
  mkdirSync(out, { recursive: true });
  const parent = await folder(DRIVE_FOLDER, "root");
  const runFolder = await folder(run, parent, false);
  log(`Google Drive: ${DRIVE_FOLDER}/${run} (https://drive.google.com/drive/folders/${runFolder})`);
  const pdfs = files.map(() => null);
  const errors = {};
  let next = 0;
  const one = async (i) => {
    const file = files[i];
    const name = basename(file, ".docx");
    const pdf = join(out, `${name}.pdf`);
    rmSync(pdf, { force: true });
    if (statSync(file).size > MAX_UPLOAD) throw new Error("over Composio's 5 MB upload limit");
    const upload = await composio([
      "execute",
      "GOOGLEDRIVE_UPLOAD_FILE",
      "--file",
      file,
      "-d",
      JSON.stringify({ folder_to_upload_to: runFolder }),
    ]);
    const uploaded = upload.data?.id;
    if (!uploaded) throw new Error(`upload: ${JSON.stringify(upload).slice(0, 200)}`);
    const doc = await drive(`${DRIVE}/${uploaded}/copy`, "POST", { name, mimeType: DOCUMENT, parents: [runFolder] });
    await download(doc.id, "application/pdf", pdf);
    if (docx) await download(doc.id, DOCX, join(out, `${name}.google.docx`));
    pdfs[i] = pdf;
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, files.length) }, async () => {
      while (next < files.length) {
        const i = next++;
        try {
          await one(i);
          log(`  ${i + 1}/${files.length} ${basename(files[i])}`);
        } catch (e) {
          errors[files[i]] = String(e.message ?? e).split("\n")[0].slice(0, 300);
          log(`  ${i + 1}/${files.length} ${basename(files[i])}: ${errors[files[i]]}`);
        }
      }
    }),
  );
  return { pdfs, errors };
};
