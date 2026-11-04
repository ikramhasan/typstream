// The compiled engine, shared by the page's workers. A `WebAssembly.Module`
// can be posted to another worker of the page: the default worker (worker.ts)
// sends the one it compiled to the page, and `engineWorker()` (spawn.ts) gives
// it to every worker it starts after that, before `initialize`. The spare, a
// replacement after a watchdog strike, another engine's worker: none of them
// downloads or compiles the 20 MB of wasm again. These messages are outside
// the protocol; `fromWorker` doesn't pass them on.

const KEY = "typstream/wasm";

/** A compiled `WebAssembly.Module`; opaque, as the package compiles without DOM types. */
export type CompiledWasm = object;

/** The message that carries a compiled module, either way. */
export const wasmMessage = (module: CompiledWasm): Record<typeof KEY, CompiledWasm> => ({ [KEY]: module });

/** The module `data` carries, when it is a {@link wasmMessage}. */
export const wasmOf = (data: unknown): CompiledWasm | undefined =>
  typeof data === "object" && data !== null && KEY in data
    ? (data as Record<typeof KEY, CompiledWasm>)[KEY]
    : undefined;
