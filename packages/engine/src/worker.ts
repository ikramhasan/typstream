// The default engine worker: engine-wasm with the base fonts, both loaded from
// next to engine-wasm's JS (bundlers emit them as assets). `engineWorker()`
// spawns it. Write your own worker with `@typstream/engine/server` to load them
// from elsewhere.

import { baseFonts } from "@typstream/engine-wasm/fonts";
import { engineWasm, serve } from "./server";

serve(engineWasm({ fonts: baseFonts }));
