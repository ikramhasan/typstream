// Real Typst agrees: native `typst compile` 0.15.1 builds the examples, with the mind map as a
// local package in a `--package-path` directory (as engine-wasm mounts it), without warnings,
// into as many pages as engine-wasm makes, and its query finds the same island markers. The
// package works outside typstream too, with plain `typst`: as the drawing.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { MINDMAP_ROOT, mindmapCatalogue, mindmapExamples, mindmapFiles, mindmapPreamble } from "../src/index";
import { compilePaged, newEngine } from "./support/engine";
import { fontDir } from "./support/fonts";

const TYPST_VERSION = "0.15.1";

const typst = (args: string[]): { stdout: string; stderr: string } => {
  const result = spawnSync("typst", args, { encoding: "utf8" });
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
    throw new Error(`native \`typst\` ${TYPST_VERSION} not on PATH (https://github.com/typst/typst/releases)`);
  }
  return { stdout: result.stdout, stderr: result.stderr };
};

const version = typst(["--version"]).stdout.split(" ")[1];
if (version !== TYPST_VERSION) throw new Error(`native typst is ${version}, expected ${TYPST_VERSION}`);

const root = mkdtempSync(join(tmpdir(), "typstream-mindmap-"));
const packages = join(root, "packages");
const [, namespace = "", name = "", pkgVersion = ""] = /^@([^/]+)\/([^:]+):(.+)$/.exec(MINDMAP_ROOT) ?? [];
for (const [path, source] of Object.entries(mindmapFiles)) {
  const file = join(packages, namespace, name, pkgVersion, path.slice(MINDMAP_ROOT.length + 1));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
}
afterAll(() => rmSync(root, { recursive: true, force: true }));

// Only fontDir()'s fonts: typst's embedded copies of the same families have CFF outlines (#118).
const common = () => [
  "--root",
  root,
  "--package-path",
  packages,
  "--ignore-system-fonts",
  "--ignore-embedded-fonts",
  "--font-path",
  fontDir(),
];

const engine = newEngine();

const documents: [string, string][] = [
  ...mindmapExamples.map((e): [string, string] => [e.title ?? "", e.output]),
  ...mindmapCatalogue.map((d): [string, string] => [`${d.name} example`, d.example ?? ""]),
];

describe("native typst", () => {
  it.each(documents)("%s", (_, source) => {
    writeFileSync(join(root, "main.typ"), mindmapPreamble + source);
    const out = join(root, "out");
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out);
    const { stderr } = typst(["compile", ...common(), join(root, "main.typ"), join(out, "{0p}.svg")]);
    expect(stderr).toBe("");
    expect(readdirSync(out).length).toBe(compilePaged(engine, source).result.pageCount);
    // One marker per map, each with its name and size.
    const query = typst([
      "eval",
      ...common(),
      "--in",
      join(root, "main.typ"),
      "query(<typstream-island>).map(m => m.value.name)",
    ]);
    expect(JSON.parse(query.stdout)).toEqual(Array(source.match(/#mindmap\b/g)?.length ?? 0).fill("mindmap"));
  });
});
