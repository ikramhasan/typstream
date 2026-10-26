// The text of a document's paged (PDF) output: native `typst compile` 0.15.1, read back with
// pdf.js. This is the reference the HTML output must not lose characters against.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { fontDir } from "./fonts";

const TYPST_VERSION = "0.15.1";

const typst = (args: string[]): Buffer => {
  try {
    return execFileSync("typst", args, { stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`native \`typst\` ${TYPST_VERSION} not on PATH (https://github.com/typst/typst/releases)`);
    }
    throw new Error(String((error as { stderr?: Buffer }).stderr ?? error));
  }
};

const version = typst(["--version"]).toString().split(" ")[1];
if (version !== TYPST_VERSION) throw new Error(`native typst is ${version}, expected ${TYPST_VERSION}`);

/** Native typst → PDF → the text of every page, concatenated. `files` are absolute virtual paths. */
export const pagedText = async (source: string, files: Record<string, Uint8Array> = {}): Promise<string> => {
  const dir = mkdtempSync(join(tmpdir(), "typstream-html-compat-"));
  try {
    writeFileSync(join(dir, "main.typ"), source);
    for (const [path, bytes] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), bytes);
    }
    // Same fonts as the wasm engine, nothing from the system. `html` so documents may mention it.
    const pdf = typst([
      "compile",
      "--root",
      dir,
      "--ignore-system-fonts",
      "--ignore-embedded-fonts",
      "--font-path",
      fontDir(),
      "--features",
      "html",
      join(dir, "main.typ"),
      "-",
    ]);
    const task = getDocument({ data: new Uint8Array(pdf), verbosity: 0 });
    const doc = await task.promise;
    let text = "";
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      for (const item of content.items) if ("str" in item) text += `${item.str} `;
    }
    await task.destroy();
    return text;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
