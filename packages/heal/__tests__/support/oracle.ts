// Typst 0.15.1's real parser (tools/typst-syntax-oracle), the ground truth for
// whether a healed source parses. Build it with `pnpm oracle` from the repo root.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Walk up to the workspace root: Stryker runs the tests from a sandbox copy
// nested inside packages/heal, so a fixed relative path would miss.
const findRoot = (dir: string): string => (existsSync(join(dir, "pnpm-workspace.yaml")) ? dir : findRoot(dirname(dir)));
const pkg = join(findRoot(dirname(fileURLToPath(import.meta.url))), "tools/typst-syntax-oracle/pkg/oracle.js");

if (!existsSync(pkg)) {
  throw new Error(`typst-syntax oracle not built: run \`pnpm oracle\` (expected ${pkg})`);
}

const oracle = createRequire(import.meta.url)(pkg) as {
  check(text: string): string;
  tree(text: string): string;
  lex(text: string, mode: string): string;
  modes(text: string): string;
};

export interface OracleError {
  message: string;
  start: number;
  end: number;
}

export const syntaxErrors = (text: string): OracleError[] =>
  (JSON.parse(oracle.check(text)) as { errors: OracleError[] }).errors;

export const syntaxTree = (text: string): string => oracle.tree(text);

export interface OracleToken {
  kind: string;
  start: number;
  end: number;
  error?: string;
}

/** Typst's lexer alone, in one mode, from the start of `text` to its end. */
export const lexTokens = (text: string, mode: "markup" | "math" | "code"): OracleToken[] =>
  JSON.parse(oracle.lex(text, mode)) as OracleToken[];

/** The lexer mode of every non-trivia token in Typst's parse of `text`. */
export const tokenModes = (text: string): { start: number; mode: "markup" | "math" | "code" | "raw" }[] =>
  JSON.parse(oracle.modes(text)) as { start: number; mode: "markup" | "math" | "code" | "raw" }[];
