// The default worker: engine-wasm with the base fonts, and the rest of
// Typst's bundled faces and the script fonts registered to download when a
// document first uses them (PLAN §6.4, #128): it chooses from the faces native
// typst and @typstream/node have, so it picks the same ones. All are loaded
// from next to engine-wasm's JS (bundlers emit them as assets).
// `engineWorker()` spawns it. Write your own worker with
// `@typstream/engine/server` to load them from elsewhere.
//
// The first worker on a page compiles the wasm itself, as it downloads, and
// sends the module to the page; the workers after it get that module before
// `initialize` and start from it (./shared-wasm.ts).

import type { InitInput } from "@typstream/engine-wasm";
import { baseFonts, extraFonts, scriptFonts } from "@typstream/engine-wasm/fonts";
import { wasmUrl } from "@typstream/engine-wasm/wasm";
import { engineWasm, serve, type WorkerScope } from "./server";
import { type CompiledWasm, wasmMessage, wasmOf } from "./shared-wasm";

// The parts of the WebAssembly API used here, declared so the package needs no DOM types.
declare const WebAssembly: {
  compile(bytes: ArrayBuffer): Promise<CompiledWasm>;
  compileStreaming(source: Response): Promise<CompiledWasm>;
};

const scope = globalThis as unknown as WorkerScope;

/** The engine an earlier worker compiled, if engineWorker() sent one. */
let shared: CompiledWasm | undefined;

/** Compiles the engine while it downloads, and sends it to the page for the workers after this one. */
const compile = async (): Promise<CompiledWasm> => {
  const response = await fetch(wasmUrl);
  if (!response.ok)
    throw new Error(`failed to fetch the engine: ${response.status} ${response.statusText} (${wasmUrl})`);
  // Streaming needs the `application/wasm` type; a server that sends another gets the slower way.
  const streams = response.headers.get("Content-Type")?.split(";")[0]?.trim() === "application/wasm";
  const module = streams
    ? await WebAssembly.compileStreaming(response)
    : await WebAssembly.compile(await response.arrayBuffer());
  scope.postMessage(wasmMessage(module));
  return module;
};

serve(
  engineWasm({
    wasm: () => (shared ?? compile()) as InitInput | Promise<InitInput>,
    fonts: baseFonts,
    lazyFonts: [...extraFonts, ...scriptFonts],
  }),
  {
    postMessage: (message) => scope.postMessage(message),
    addEventListener: (type, listener) =>
      scope.addEventListener(type, (event) => {
        const module = wasmOf(event.data);
        if (module) shared = module;
        else listener(event);
      }),
  },
);
