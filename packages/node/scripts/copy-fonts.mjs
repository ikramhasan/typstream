// Copies Typst's bundled fonts (the set `typst compile --ignore-system-fonts`
// uses: Libertinus Serif, New Computer Modern, DejaVu Sans Mono) and their
// NOTICE from the typst-assets crate into dist/fonts. The engine build has
// already downloaded the crate, so this only asks cargo where it is.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const manifest = fileURLToPath(new URL("../../engine-wasm/Cargo.toml", import.meta.url));
const out = fileURLToPath(new URL("../dist/fonts/", import.meta.url));

const metadata = JSON.parse(
  execFileSync("cargo", ["metadata", "--format-version", "1", "--locked", "--manifest-path", manifest], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }),
);
const assets = metadata.packages.find((p) => p.name === "typst-assets");
if (!assets) throw new Error("typst-assets not found in `cargo metadata` of packages/engine-wasm");
const root = dirname(assets.manifest_path);
const fonts = join(root, "files", "fonts");

mkdirSync(out, { recursive: true });
// The .pfb files are PDF standard-font substitutes, not fonts Typst lays out with.
const files = readdirSync(fonts).filter((name) => /\.(otf|ttf)$/.test(name));
for (const name of files) copyFileSync(join(fonts, name), join(out, name));
copyFileSync(join(root, "NOTICE"), join(out, "NOTICE"));
console.log(`copied ${files.length} fonts from typst-assets ${assets.version} to dist/fonts`);
