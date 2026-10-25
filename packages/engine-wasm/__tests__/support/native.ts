// The native Typst CLI, the ground truth for what the wasm engine should
// produce. It must be 0.15.1, the version the engine pins.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fontDir } from "./fonts.js";

const TYPST_VERSION = "0.15.1";

const typst = (args: string[]): string => {
  try {
    return execFileSync("typst", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`native \`typst\` ${TYPST_VERSION} not on PATH (https://github.com/typst/typst/releases)`);
    }
    throw error;
  }
};

const version = typst(["--version"]).split(" ")[1];
if (version !== TYPST_VERSION) throw new Error(`native typst is ${version}, expected ${TYPST_VERSION}`);

const withProject = <T>(source: string, run: (dir: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), "typstream-native-"));
  try {
    writeFileSync(join(dir, "main.typ"), source);
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// Only the fonts the wasm tests load (see fonts.ts), nothing from the system.
const FONT_ARGS = ["--ignore-system-fonts", "--ignore-embedded-fonts", "--font-path", fontDir()];

/** Native `typst compile` to SVG: one string per page. */
export const nativeSvgPages = (source: string): string[] =>
  withProject(source, (dir) => {
    typst(["compile", ...FONT_ARGS, join(dir, "main.typ"), join(dir, "page-{0p}.svg")]);
    return readdirSync(dir)
      .filter((name) => name.startsWith("page-"))
      .sort()
      .map((name) => readFileSync(join(dir, name), "utf8"));
  });

/** Native `typst compile` to HTML. */
export const nativeHtml = (source: string): string =>
  withProject(source, (dir) => {
    typst([
      "compile",
      ...FONT_ARGS,
      "--features",
      "html",
      "--format",
      "html",
      join(dir, "main.typ"),
      join(dir, "out.html"),
    ]);
    return readFileSync(join(dir, "out.html"), "utf8");
  });
