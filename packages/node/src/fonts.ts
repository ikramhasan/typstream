// Fonts for the server engine. By default, Typst's bundled set (what native
// `typst compile --ignore-system-fonts` uses), copied into dist/fonts at build
// time, and engine-wasm's script fonts (which browsers load lazily, PLAN §6.4;
// a server has them on disk, so it loads them up front); plus any the caller adds.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { scriptFonts } from "@typstream/engine-wasm/fonts";

const FONT_FILE = /\.(ttf|otf|ttc|otc)$/i;

/** Where the bundled fonts are: dist/fonts, from both src/ (tests) and dist/. */
export const bundledFontDir = (): string => fileURLToPath(new URL("../dist/fonts/", import.meta.url));

const fontFilesIn = (dir: string): string[] =>
  readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return fontFilesIn(path);
      return FONT_FILE.test(name) ? [path] : [];
    });

export interface FontOptions {
  /**
   * Load Typst's bundled fonts (Libertinus Serif, New Computer Modern, DejaVu
   * Sans Mono). Default true.
   */
  typstFonts?: boolean;
  /**
   * Load engine-wasm's script fonts: Noto Naskh Arabic, Noto Serif Bengali and
   * Noto Serif Devanagari, regular and bold. Default true.
   */
  scriptFonts?: boolean;
  /** Font files (TTF, OTF, TTC) as bytes. */
  fonts?: Uint8Array[];
  /** Directories searched recursively for font files, like `typst --font-path`. */
  fontPaths?: string[];
}

/** Every font file, as bytes, in a stable order. */
export const loadFonts = (options: FontOptions = {}): Uint8Array[] => {
  const paths: string[] = [];
  if (options.typstFonts !== false) {
    let bundled: string[] = [];
    try {
      bundled = fontFilesIn(bundledFontDir());
    } catch {}
    // Without fonts Typst still compiles, but text and math fail later with "no font could be found".
    if (bundled.length === 0) {
      throw new Error(
        `@typstream/node: bundled fonts missing in ${bundledFontDir()} (build the package, or pass typstFonts: false)`,
      );
    }
    paths.push(...bundled);
  }
  if (options.scriptFonts !== false) paths.push(...scriptFonts.map((font) => fileURLToPath(font.url)));
  for (const dir of options.fontPaths ?? []) paths.push(...fontFilesIn(dir));
  return [...paths.map((path) => new Uint8Array(readFileSync(path))), ...(options.fonts ?? [])];
};
