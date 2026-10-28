// Typst's bundled fonts (Libertinus Serif, New Computer Modern, DejaVu Sans Mono) from the
// typst-assets crate Cargo downloaded for the engine build, with the ones that have CFF outlines
// swapped for engine-wasm's TrueType conversions (#118), as html-compat's tests use. Native `typst`
// gets the same directory, so engine-wasm and native compiles see the same fonts.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const manifest = fileURLToPath(new URL("../../../engine-wasm/Cargo.toml", import.meta.url));
/** engine-wasm's dist/fonts: its build converts typst-assets' CFF fonts to TrueType outlines. */
const shipped = fileURLToPath(new URL("../../../engine-wasm/dist/fonts/", import.meta.url));

let dir: string | undefined;

/**
 * A directory of links to typst-assets' font files, with the CFF ones swapped for the TrueType conversions
 * engine-wasm ships (#118): the same fonts users get, under the same names.
 */
export const fontDir = (): string => {
  if (dir) return dir;
  const metadata = JSON.parse(
    execFileSync("cargo", ["metadata", "--format-version", "1", "--locked", "--manifest-path", manifest], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }),
  ) as { packages: { name: string; manifest_path: string }[] };
  const assets = metadata.packages.find((p) => p.name === "typst-assets");
  if (!assets) throw new Error("typst-assets not found in `cargo metadata`");
  const source = join(dirname(assets.manifest_path), "files", "fonts");
  const links = mkdtempSync(join(tmpdir(), "typstream-fonts-"));
  for (const name of readdirSync(source)) {
    const converted = join(shipped, name.replace(/\.otf$/, ".ttf"));
    const file = name.endsWith(".otf") && existsSync(converted) ? converted : join(source, name);
    symlinkSync(file, join(links, basename(file)));
  }
  dir = links;
  return dir;
};

let cache: { name: string; bytes: Uint8Array }[] | undefined;

export const fonts = (): { name: string; bytes: Uint8Array }[] => {
  cache ??= readdirSync(fontDir())
    .filter((name) => /\.(otf|ttf)$/.test(name))
    .sort()
    .map((name) => ({ name, bytes: readFileSync(join(fontDir(), name)) }));
  return cache;
};
