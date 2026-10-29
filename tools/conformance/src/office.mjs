// Laying DOCX files out as Word-like engines do, and Microsoft's validator: what tools/docx-check (#131) and the
// conformance suite (#135) run. Files go through LibreOffice (`soffice` on PATH) or ONLYOFFICE (`x2t` in the
// onlyoffice/documentserver image, Docker), each seeing only the fonts given (and what the DOCX embeds).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const root = fileURLToPath(new URL("../../..", import.meta.url));

/** The engine's fonts, which the layout engines get: what a reader without other fonts has. */
export const ENGINE_FONTS = join(root, "packages/engine-wasm/dist/fonts");

/** Microsoft's validator, where `dotnet publish tools/docx-check/validator -c Release -o …/out` puts it. */
export const VALIDATOR = join(root, "tools/docx-check/validator/out/validator.dll");

// ONLYOFFICE: one container for the batch, a font index of the fonts given, then x2t per file.
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

/**
 * Lays `files` (DOCX paths, distinct base names) out to PDFs in `out` with LibreOffice or ONLYOFFICE: each file's PDF
 * path, or null when the engine didn't convert it.
 */
export const layOut = (files, { out, engine = "libreoffice", fonts = ENGINE_FONTS }) => {
  mkdirSync(out, { recursive: true });
  // A PDF left from an earlier run isn't this one's.
  for (const f of files) rmSync(join(out, `${basename(f, ".docx")}.pdf`), { force: true });
  if (engine === "onlyoffice") {
    for (const file of files) execFileSync("cp", [file, out]);
    execFileSync(
      "docker",
      [
        ...["run", "--rm", "-v", `${fonts}:/fonts:ro`, "-v", `${out}:/work`, "--entrypoint", "bash"],
        ...["onlyoffice/documentserver", "-c", OO_SCRIPT, "x", ...files.map((f) => basename(f, ".docx"))],
      ],
      { stdio: "pipe", timeout: 1_800_000 },
    );
  } else {
    const conf = join(out, "fonts.conf");
    writeFileSync(
      conf,
      `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>${fonts}</dir><cachedir>${join(out, "fc-cache")}</cachedir></fontconfig>`,
    );
    // In batches: a LibreOffice start costs seconds, and a document that hangs it costs only its batch.
    for (let i = 0; i < files.length; i += 40) {
      try {
        execFileSync(
          "soffice",
          [
            `-env:UserInstallation=file://${join(out, "lo-profile")}`,
            ...["--headless", "--convert-to", "pdf", "--outdir", out, ...files.slice(i, i + 40)],
          ],
          { env: { ...process.env, FONTCONFIG_FILE: conf, SAL_USE_VCLPLUGIN: "svp" }, stdio: "pipe", timeout: 600_000 },
        );
      } catch {}
    }
  }
  return files.map((f) => {
    const pdf = join(out, `${basename(f, ".docx")}.pdf`);
    return existsSync(pdf) ? pdf : null;
  });
};

/**
 * Microsoft's Open XML validator (for Microsoft 365) on `files`: the errors of each file that has some, by its base
 * name (its count line, then up to 10 errors). Any error is one Word would report as unreadable content.
 */
export const validate = (files, dll = VALIDATOR) => {
  let report;
  try {
    report = execFileSync("dotnet", [dll, ...files], { encoding: "utf8", maxBuffer: 1 << 26 });
  } catch (e) {
    report = String(e.stdout ?? e);
  }
  const errors = {};
  let file = null;
  let seen = 0;
  for (const line of report.split("\n")) {
    const count = /^(.+): (\d+) error/.exec(line);
    if (count) {
      seen++;
      file = Number(count[2]) > 0 ? count[1] : null;
      if (file) errors[file] = [line];
    } else if (file && line.startsWith("  ")) errors[file].push(line);
  }
  // The validator didn't run, or stopped at a file it couldn't open.
  if (seen < files.length) throw new Error(`validator: ${report.slice(0, 2000)}`);
  return errors;
};

/**
 * Typst packages (`{ namespace, name, version, url }`, the url a `file:` one or a path, as @typstream/universe's
 * are from source) as files a document reads, `@namespace/name:version/path`: the tarballs' regular files (ustar).
 */
export const packageFiles = (packages) => {
  const files = {};
  for (const p of packages) {
    if (!p.url) continue;
    const tar = gunzipSync(readFileSync(p.url.startsWith("file:") ? fileURLToPath(p.url) : p.url));
    for (let at = 0; at + 512 <= tar.length && tar[at] !== 0; ) {
      const field = (from, length) => tar.toString("utf8", at + from, at + from + length).replace(/\0.*$/s, "");
      const size = Number.parseInt(field(124, 12).trim() || "0", 8);
      const path = ((field(345, 155) ? `${field(345, 155)}/` : "") + field(0, 100)).replace(/^\.\//, "");
      if (["0", ""].includes(field(156, 1)))
        files[`@${p.namespace}/${p.name}:${p.version}/${path}`] = new Uint8Array(
          tar.subarray(at + 512, at + 512 + size),
        );
      at += 512 + Math.ceil(size / 512) * 512;
    }
  }
  return files;
};
