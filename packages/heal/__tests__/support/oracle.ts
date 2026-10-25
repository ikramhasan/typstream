// Typst 0.15.1's real parser (tools/typst-syntax-oracle), the ground truth for
// whether a healed source parses. Build it with `pnpm oracle` from the repo root.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const pkg = fileURLToPath(new URL("../../../../tools/typst-syntax-oracle/pkg/oracle.js", import.meta.url));

if (!existsSync(pkg)) {
  throw new Error(`typst-syntax oracle not built: run \`pnpm oracle\` (expected ${pkg})`);
}

const oracle = createRequire(import.meta.url)(pkg) as {
  check(text: string): string;
  tree(text: string): string;
};

export interface OracleError {
  message: string;
  start: number;
  end: number;
}

export const syntaxErrors = (text: string): OracleError[] =>
  (JSON.parse(oracle.check(text)) as { errors: OracleError[] }).errors;

export const syntaxTree = (text: string): string => oracle.tree(text);
