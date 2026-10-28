// Copies Typst's bundled fonts (every face `typst compile --ignore-system-fonts`
// embeds: Libertinus Serif, New Computer Modern, DejaVu Sans Mono) into
// dist/fonts as @typstream/engine-wasm ships them: its base fonts and its lazy
// `extraFonts`, the ones typst-assets has with CFF outlines converted to
// TrueType (#118). A server then chooses from the same files the browser does,
// and picks the same faces (#128). The NOTICE records the conversion.
import { copyFileSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { baseFonts, extraFonts } from "@typstream/engine-wasm/fonts";

const out = fileURLToPath(new URL("../dist/fonts/", import.meta.url));
const files = [...baseFonts, ...extraFonts.map((font) => font.url)].map((url) => fileURLToPath(url));
if (files.length !== 17) throw new Error(`expected engine-wasm's 17 bundled faces, found ${files.length}`);

mkdirSync(out, { recursive: true });
for (const file of files) copyFileSync(file, join(out, basename(file)));
copyFileSync(join(dirname(files[0]), "NOTICE"), join(out, "NOTICE"));
console.log(`copied ${files.length} fonts from @typstream/engine-wasm to dist/fonts`);
