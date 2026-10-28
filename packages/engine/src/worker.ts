// The default engine worker: engine-wasm with the base fonts, and the rest of
// Typst's bundled faces and the script fonts registered to download when a
// document first uses them (PLAN §6.4, #128): it chooses from the faces native
// typst and @typstream/node have, so it picks the same ones. All are loaded
// from next to engine-wasm's JS (bundlers emit them as assets).
// `engineWorker()` spawns it. Write your own worker with
// `@typstream/engine/server` to load them from elsewhere.

import { baseFonts, extraFonts, scriptFonts } from "@typstream/engine-wasm/fonts";
import { engineWasm, serve } from "./server";

serve(engineWasm({ fonts: baseFonts, lazyFonts: [...extraFonts, ...scriptFonts] }));
