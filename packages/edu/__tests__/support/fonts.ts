// Typst's bundled fonts (Libertinus Serif, New Computer Modern, DejaVu Sans Mono) from the
// typst-assets crate Cargo downloaded for the engine build, as html-compat's tests use. Native
// `typst` gets the same directory, so engine-wasm and native compiles see the same fonts.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const manifest = fileURLToPath(new URL("../../../engine-wasm/Cargo.toml", import.meta.url));

let dir: string | undefined;

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
  dir = join(dirname(assets.manifest_path), "files", "fonts");
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
