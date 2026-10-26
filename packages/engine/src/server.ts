// @typstream/engine/server: the worker half (PLAN §6.1). The engine server
// speaks the protocol from @typstream/core and compiles with an EngineAdapter;
// engine-wasm is the default. The default worker script (worker.ts) is
// `serve(engineWasm({ fonts: baseFonts }))`; write your own worker with these
// exports to load the wasm or fonts from elsewhere.

export type { InitInput } from "@typstream/engine-wasm";
// What `inProcess` returns; the same types as the main entry's.
export type { EngineConnection, EngineEvents, SpawnEngine } from "./connection";
export type {
  AdapterCompileResult,
  AdapterDocument,
  AdapterHtmlResult,
  AdapterPagedResult,
  EngineAdapter,
  MaybePromise,
} from "./server/adapter";
export { type EngineWasmOptions, engineWasm, type FontInput, TYPST_VERSION } from "./server/engine-wasm";
export { inProcess, serve, type WorkerScope } from "./server/serve";
export { createServer, type EngineServer, PREAMBLE_PATH, type ServerOptions } from "./server/server";
