// The real compiler: @typstream/engine-wasm (Typst 0.15.1) in Node, with
// Typst's bundled fonts, the same ones native `typst --ignore-system-fonts`
// uses. Build it first: `pnpm turbo run build --filter=@typstream/engine-wasm`.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const resolveEngine = (specifier: string): string => {
  try {
    return require.resolve(specifier);
  } catch {
    throw new Error(`engine not built: run \`pnpm turbo run build --filter=@typstream/engine-wasm\` (${specifier})`);
  }
};

const glue: typeof import("@typstream/engine-wasm") = await import(resolveEngine("@typstream/engine-wasm"));
glue.initSync({ module: readFileSync(resolveEngine("@typstream/engine-wasm/engine_bg.wasm")) });

export type { Diagnostic } from "@typstream/engine-wasm";
export type Engine = InstanceType<typeof glue.Engine>;

// typst-assets' font files, from the crate Cargo downloaded for the engine build.
const fontDir = (): string => {
  const manifest = fileURLToPath(new URL("../../../packages/engine-wasm/Cargo.toml", import.meta.url));
  const metadata = JSON.parse(
    execFileSync("cargo", ["metadata", "--format-version", "1", "--locked", "--manifest-path", manifest], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }),
  ) as { packages: { name: string; manifest_path: string }[] };
  const assets = metadata.packages.find((p) => p.name === "typst-assets");
  if (!assets) throw new Error("typst-assets not found in `cargo metadata`");
  const dir = join(dirname(assets.manifest_path), "files", "fonts");
  if (!existsSync(dir)) throw new Error(`typst-assets fonts missing at ${dir}`);
  return dir;
};

let fonts: Uint8Array[] | undefined;

/** An engine with Typst's bundled fonts. The .pfb files are PDF standard-font substitutes, not layout fonts. */
export const newEngine = (): Engine => {
  if (!fonts) {
    const dir = fontDir();
    fonts = readdirSync(dir)
      .filter((name) => /\.(otf|ttf)$/.test(name))
      .sort()
      .map((name) => readFileSync(join(dir, name)));
    // Fonts belong to the wasm instance: every engine sees them.
    for (const font of fonts) glue.Engine.add_font(font);
  }
  return new glue.Engine();
};
