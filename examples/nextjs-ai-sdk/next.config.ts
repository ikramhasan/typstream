import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// typstream needs no configuration: the engine's worker, its wasm and fonts are
// `new URL(…, import.meta.url)` assets that Turbopack emits. The root only tells
// Turbopack this app lives in a pnpm workspace, whose packages are symlinked from
// outside the app's directory.
const config: NextConfig = {
  turbopack: { root: fileURLToPath(new URL("../..", import.meta.url)) },
};

export default config;
