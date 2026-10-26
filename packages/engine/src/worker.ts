// The default engine worker: engine-wasm with the base fonts, and the script
// fonts registered to download when a document first uses them (PLAN §6.4),
// all loaded from next to engine-wasm's JS (bundlers emit them as assets).
// `engineWorker()` spawns it. Write your own worker with
// `@typstream/engine/server` to load them from elsewhere.

import { baseFonts, scriptFonts } from "@typstream/engine-wasm/fonts";
import { engineWasm, serve } from "./server";

serve(engineWasm({ fonts: baseFonts, lazyFonts: scriptFonts }));
