// Real Typst agrees: native `typst compile` 0.15.1 builds the package's examples and templates as
// edu's files mounted in a project root (as engine-wasm mounts them) without warnings, into as
// many pages as engine-wasm makes. edu is also usable outside typstream, with plain `typst`.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { eduExamples, eduFiles, eduPreamble, eduTemplates, SHOW_ANSWERS_INPUT } from "../src/index";
import { compilePaged, newEngine } from "./support/engine";
import { fontDir } from "./support/fonts";

const TYPST_VERSION = "0.15.1";

/** Runs native typst; its warnings go to stderr. */
const typst = (args: string[]): { stdout: string; stderr: string } => {
  const result = spawnSync("typst", args, { encoding: "utf8" });
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
    throw new Error(`native \`typst\` ${TYPST_VERSION} not on PATH (https://github.com/typst/typst/releases)`);
  }
  return { stdout: result.stdout, stderr: result.stderr };
};

const version = typst(["--version"]).stdout.split(" ")[1];
if (version !== TYPST_VERSION) throw new Error(`native typst is ${version}, expected ${TYPST_VERSION}`);

const root = mkdtempSync(join(tmpdir(), "typstream-edu-"));
for (const [path, source] of Object.entries(eduFiles)) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), source);
}
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** Native typst's page count (one SVG per page) and what it printed: warnings, errors. */
const native = (source: string, answers: boolean): { pages: number; stderr: string } => {
  writeFileSync(join(root, "main.typ"), eduPreamble + source);
  const out = join(root, "out");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out);
  const args = ["compile", "--root", root, "--ignore-system-fonts", "--font-path", fontDir()];
  if (answers) args.push("--input", `${SHOW_ANSWERS_INPUT}=true`);
  const { stderr } = typst([...args, join(root, "main.typ"), join(out, "{0p}.svg")]);
  return { pages: readdirSync(out).length, stderr };
};

const engine = newEngine();

const documents: [string, string][] = [
  ...eduExamples.map((e): [string, string] => [e.title ?? "", e.output]),
  ...eduTemplates.map((t): [string, string] => [`template ${t.name}`, `${t.preamble}#question(points: 1)[x]\n`]),
];

describe("native typst", () => {
  it.each(documents)("%s", (_, source) => {
    for (const answers of [false, true]) {
      const { pages, stderr } = native(source, answers);
      expect(stderr).toBe("");
      expect(pages).toBe(compilePaged(engine, source, { answers }).pages.length);
    }
  });
});
