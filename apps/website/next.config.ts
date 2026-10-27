import { fileURLToPath } from "node:url";
import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

// The live demos use the `typstream` package as any app would: its engine worker, wasm and fonts are
// `new URL(…, import.meta.url)` assets that Turbopack emits. The root tells Turbopack this app lives
// in a pnpm workspace, whose packages are symlinked from outside the app's directory.
const config: NextConfig = {
  reactStrictMode: true,
  turbopack: { root: fileURLToPath(new URL("../..", import.meta.url)) },
};

export default createMDX()(config);
