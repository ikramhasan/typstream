// Bundle size budget (PLAN.md §11.6): @typstream/react with @typstream/dom's renderers,
// minified + gzipped ESM. React and @typstream/engine (with heal, its own budgets) are
// external; @typstream/core's helpers are inlined.
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
// 15 KB until #19's renderer fixes (language and direction, filled areas in the dark theme, unchanged pages
// not redrawn, lone wrappers) added 0.3 KB to a bundle that was at 14.9; 15.5 KB until the paged text
// layer's structure, language and direction (#63) added 0.5 KB to 15.3; 16 KB until #29 applied Typst's inline
// styles through the CSSOM, for strict CSPs (0.15 KB), when it was 11 bytes under; 16.5 KB until #95's wide
// blocks (0.45 KB, most of it paid for by CSS strings without comments) left it 30 bytes over; 16.6 KB until
// #18's exports on the handle and useTypstream(), with per-export inputs (95 bytes), left it 63 bytes over;
// 16.7 KB until font catalogues' web fonts (registering them, the mount's listener, standalone exports'
// @font-face rules, 0.55 KB) made it 17.2 KB; 17.3 KB until render islands (#28: dom's island manager, 0.8 KB,
// and the portals, the store and the error boundary, 0.6 KB) made it 18.6 KB; 18.7 KB until canvas pages (#14:
// the painter, the drawing's decoder, the link layer and pixel management, 1.6 KB) made it 20.2 KB; 20.3 KB until
// streaming ranges in the mount (#34: a finished document streaming into a range again, and the edit typed at the
// range's end, 0.16 KB) left it 148 bytes over; 20.5 KB until standalone exports' math font with its own media type
// (#118's TrueType fonts: `fontType`, read from the file's first bytes) left it 2 bytes over.
const BUDGET = 20.6 * 1024;

const result = await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  write: false,
  platform: "neutral",
  jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime", "@typstream/engine"],
  alias: { "@typstream/core": "../core/src/index.ts", "@typstream/dom": "../dom/src/index.ts" },
});
const code = result.outputFiles[0].contents;
const gz = gzipSync(code, { level: 9 }).length;
console.log(
  `@typstream/react (incl. @typstream/dom): ${kb(code.length)} minified, ${kb(gz)} gzipped (budget ${kb(BUDGET)})`,
);
process.exitCode = gz <= BUDGET ? 0 : 1;
