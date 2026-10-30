import { readFileSync } from "node:fs";
import { loadSyntax } from "@typstream/syntax";

/** Loads Typst's parser from the bytes @typstream/syntax's build wrote (Node's fetch can't read files). */
export const loadParser = (): Promise<void> =>
  loadSyntax(readFileSync(new URL("../../../syntax/wasm/syntax_bg.wasm", import.meta.url)));
