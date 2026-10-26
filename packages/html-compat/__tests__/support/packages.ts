// The Typst packages @typstream/universe vendors, for matrix entries that import them (#25):
// mounted in the wasm engine under `@ns/name:version/…` keys, and extracted once into a
// package directory for native typst (`--package-path`), so neither touches the network.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import type { Engine } from "@typstream/engine-wasm";
import { UNIVERSE_PACKAGES } from "@typstream/universe";

/** A ustar archive's regular files (Universe tarballs hold nothing else but directories). */
const untar = (tar: Buffer): Map<string, Buffer> => {
  const files = new Map<string, Buffer>();
  for (let at = 0; at + 512 <= tar.length && tar[at] !== 0; ) {
    const field = (from: number, length: number) =>
      tar.toString("utf8", at + from, at + from + length).replace(/\0.*$/s, "");
    const size = Number.parseInt(field(124, 12).trim() || "0", 8);
    const prefix = field(345, 155);
    const type = field(156, 1);
    const name = (prefix ? `${prefix}/` : "") + field(0, 100);
    if (type === "0" || type === "") files.set(name.replace(/^\.\//, ""), tar.subarray(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
};

const packages = UNIVERSE_PACKAGES.map((p) => ({
  ...p,
  files: untar(gunzipSync(readFileSync(fileURLToPath(p.url)))),
}));

/** Mounts every vendored package in the engine. */
export const mountPackages = (engine: Engine): void => {
  for (const p of packages) {
    for (const [path, bytes] of p.files) {
      const key = `@${p.namespace}/${p.name}:${p.version}/${path}`;
      if (path.endsWith(".typ")) engine.set_source(key, bytes.toString("utf8"));
      else engine.set_file(key, bytes);
    }
  }
};

let dir: string | undefined;

/** A `--package-path` directory holding every vendored package, extracted on first use. */
export const packageDir = (): string => {
  if (dir) return dir;
  dir = mkdtempSync(join(tmpdir(), "typstream-packages-"));
  for (const p of packages) {
    for (const [path, bytes] of p.files) {
      const file = join(dir, p.namespace, p.name, p.version, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, bytes);
    }
  }
  return dir;
};
