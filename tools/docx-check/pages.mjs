// Apple's Pages as the layout engine (macOS only, local): each DOCX opened in Pages and exported as PDF through
// AppleScript, so check.mjs compares Pages' pages with Typst's as it compares LibreOffice's.
//
// Pages is sandboxed: it reads a file it's given through Launch Services (`open -a Pages file`), not one an AppleScript
// `open` names, so each file goes in by `open` and the script exports the front document. It ignores the fonts a DOCX
// embeds (a family it hasn't is Helvetica, whatever the font table's hints say), so the engine's fonts are installed for
// the run, in ~/Library/Fonts under a prefix of their own, and removed after it: what's compared is the layout, as
// a reader with the fonts would see it. A run that didn't get to remove them removes them first.
//
// About 3 seconds a document. Pages comes to the front for each.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const FONTS = join(homedir(), "Library", "Fonts");

/**
 * What Pages' PDFs draw without text for it, left out of both sides' lines: Libertinus' ligatures (fi, fl, ff, ffi,
 * ffl, ft) and its Q (an alternate), which Pages subsets into MacRoman fonts without a Unicode map.
 */
export const PAGES_UNMAPPED = /Q|ff[il]?|f[ilt]/g;
/** Installed fonts' names start with it, so they're told from the user's own. */
const PREFIX = "typstream-docx-check-";

const EXPORT = `
on run argv
  tell application "Pages"
    repeat 240 times
      if (count of documents) > 0 then exit repeat
      delay 0.25
    end repeat
    set doc to front document
    export doc to (POSIX file (item 1 of argv)) as PDF
    close doc saving no
  end tell
end run`;

const osascript = (script, args = [], timeout = 30_000) =>
  execFileSync("osascript", ["-e", script, ...args], { encoding: "utf8", stdio: "pipe", timeout }).trim();

/** The fonts this module installed (by an earlier run too), removed. */
const uninstall = () => {
  for (const f of readdirSync(FONTS).filter((f) => f.startsWith(PREFIX))) rmSync(join(FONTS, f));
};

/** Pages quit (its documents unsaved) and started again: it reads installed fonts when it starts. */
const restart = () => {
  try {
    osascript('tell application "Pages" to quit saving no');
  } catch {}
  // A Pages started while the last one is still quitting doesn't answer AppleScript ("every document doesn't
  // understand the count message") until it's quit again.
  for (let i = 0; i < 60 && running(); i++) execFileSync("sleep", ["0.5"]);
  execFileSync("open", ["-g", "-a", "Pages"]);
  for (let i = 0; i < 60; i++) {
    try {
      osascript('tell application "Pages" to count documents');
      return;
    } catch {
      execFileSync("sleep", ["0.5"]);
    }
  }
  throw new Error("Pages doesn't answer AppleScript");
};

const running = () => {
  try {
    execFileSync("pgrep", ["-x", "Pages"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};

/**
 * Lays `files` (DOCX paths, distinct base names) out to PDFs in `out` with Pages, with `fonts` installed for the run:
 * each file's PDF path, or null when Pages didn't export it (its error in `errors`, by file).
 */
export const layOutWithPages = (files, { out, fonts, log = () => {} }) => {
  if (!existsSync("/Applications/Pages.app")) throw new Error("Pages isn't installed (/Applications/Pages.app)");
  mkdirSync(out, { recursive: true });
  uninstall();
  const faces = readdirSync(fonts).filter((f) => /\.(ttf|otf)$/i.test(f));
  for (const f of faces) copyFileSync(join(fonts, f), join(FONTS, PREFIX + f));
  log(`Pages: ${faces.length} fonts installed in ${FONTS} for the run`);
  const pdfs = files.map(() => null);
  const errors = {};
  try {
    restart();
    for (const [i, file] of files.entries()) {
      const pdf = join(out, `${basename(file, ".docx")}.pdf`);
      rmSync(pdf, { force: true });
      try {
        // A document left open would be the front one.
        osascript('tell application "Pages" to close every document saving no');
        execFileSync("open", ["-g", "-a", "Pages", file]);
        osascript(EXPORT, [pdf], 120_000);
        if (existsSync(pdf)) pdfs[i] = pdf;
        else errors[file] = "Pages exported nothing";
      } catch (e) {
        errors[file] = String(e.stderr || e.message).trim().slice(0, 300);
        restart();
      }
    }
  } finally {
    try {
      osascript('tell application "Pages" to quit saving no');
    } catch {}
    uninstall();
  }
  return { pdfs, errors };
};
