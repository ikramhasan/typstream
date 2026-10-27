// The compiler production uses: @typstream/engine-wasm (Typst 0.15.1) in-process, with Typst's
// bundled fonts, edu's files and @typstream/universe's vendored packages mounted under their
// `@ns/name:x.y.z/…` keys. Nothing is fetched, so a package outside the allowlist fails to import
// as it does in the app. Build first: `pnpm turbo run build --filter=@typstream/llm-corpus^...`.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { eduFiles, eduPreamble, SHOW_ANSWERS_INPUT } from "@typstream/edu";
import { Engine, initSync } from "@typstream/engine-wasm";
import { UNIVERSE_PACKAGES } from "@typstream/universe";

const require = createRequire(import.meta.url);
initSync({ module: readFileSync(require.resolve("@typstream/engine-wasm/engine_bg.wasm")) });

// typst-assets' fonts, from the crate Cargo downloaded for the engine build: what native
// `typst --ignore-system-fonts` uses. Script fonts (Arabic, Bengali) are lazy in the app; without
// them text draws as tofu, which doesn't change errors.
const fontDir = () => {
  const manifest = fileURLToPath(new URL("../../../packages/engine-wasm/Cargo.toml", import.meta.url));
  const metadata = JSON.parse(
    execFileSync("cargo", ["metadata", "--format-version", "1", "--locked", "--manifest-path", manifest], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
  const assets = metadata.packages.find((p) => p.name === "typst-assets");
  if (!assets) throw new Error("typst-assets not found in `cargo metadata`");
  return join(dirname(assets.manifest_path), "files", "fonts");
};

/** A ustar archive's regular files (Universe tarballs hold nothing else but directories). */
const untar = (tar) => {
  const files = new Map();
  for (let at = 0; at + 512 <= tar.length && tar[at] !== 0; ) {
    const field = (from, length) => tar.toString("utf8", at + from, at + from + length).replace(/\0.*$/s, "");
    const size = Number.parseInt(field(124, 12).trim() || "0", 8);
    const prefix = field(345, 155);
    const type = field(156, 1);
    const name = (prefix ? `${prefix}/` : "") + field(0, 100);
    if (type === "0" || type === "") files.set(name.replace(/^\.\//, ""), tar.subarray(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
};

/** An engine with fonts, edu and the vendored packages. */
export const newEngine = () => {
  const dir = fontDir();
  for (const name of readdirSync(dir).filter((n) => /\.(otf|ttf)$/.test(n))) {
    Engine.add_font(readFileSync(join(dir, name)));
  }
  const engine = new Engine();
  for (const [path, source] of Object.entries(eduFiles)) engine.set_source(path, source);
  for (const p of UNIVERSE_PACKAGES) {
    for (const [path, bytes] of untar(gunzipSync(readFileSync(fileURLToPath(p.url))))) {
      const key = `@${p.namespace}/${p.name}:${p.version}/${path}`;
      if (path.endsWith(".typ")) engine.set_source(key, bytes.toString("utf8"));
      else engine.set_file(key, bytes);
    }
  }
  return engine;
};

/** The preamble a corpus entry's `plugins` put before the document, as the engine prepends it. */
export const preambleFor = (plugins) => (plugins.includes("edu") ? eduPreamble : "");

/**
 * Compiles `source` after `preamble` for one target and returns its diagnostics, with spans moved
 * back into `source`. A span is in /main.typ (for a problem in another file, the call site there).
 */
export const compile = (engine, source, { preamble = "", target = "paged", answers = false } = {}) => {
  engine.set_inputs(answers ? { [SHOW_ANSWERS_INPUT]: "true" } : {});
  engine.set_source("/main.typ", preamble + source);
  const result = target === "html" ? engine.compile_html() : engine.check_paged();
  return result.diagnostics.map((d) =>
    d.span ? { ...d, span: { from: d.span.from - preamble.length, to: d.span.to - preamble.length } } : d,
  );
};
