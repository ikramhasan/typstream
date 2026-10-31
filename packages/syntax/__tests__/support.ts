import { readFileSync } from "node:fs";
import { loadSyntax } from "../src/index";

/** Loads the parser from the bytes build.sh wrote (Node's fetch can't read files). */
export const load = (): Promise<void> => loadSyntax(readFileSync(new URL("../wasm/syntax_bg.wasm", import.meta.url)));
