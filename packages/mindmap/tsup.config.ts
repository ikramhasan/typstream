import { rmSync } from "node:fs";
import { packageConfig } from "../../tools/repo/tsup";

// tsup builds the two configs at once, so neither cleans: the one that did could remove what the
// other had just written (a `dist/` without `react.js`, which turbo then cached).
rmSync("dist", { recursive: true, force: true });

// index: the plugin (Typst files, prompt kit, the island's spec); no React, so servers can build
// prompts with it. react: the interactive map, which Next.js's App Router must render on the
// client; React Flow is in a chunk it loads when a map first shows.
export default [
  packageConfig({ clean: false }),
  packageConfig({ entry: ["src/react.tsx"], clean: false, banner: { js: '"use client";' } }),
];
