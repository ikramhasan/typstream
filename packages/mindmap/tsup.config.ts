import { packageConfig } from "../../tools/repo/tsup";

// index: the plugin (Typst files, prompt kit, the island's spec); no React, so servers can build
// prompts with it. react: the interactive map, which Next.js's App Router must render on the
// client; React Flow is in a chunk it loads when a map first shows.
export default [
  packageConfig(),
  packageConfig({ entry: ["src/react.tsx"], clean: false, banner: { js: '"use client";' } }),
];
