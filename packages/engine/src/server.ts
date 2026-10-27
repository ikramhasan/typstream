// @typstream/engine/server: the worker half (PLAN §6.1). The engine server
// speaks the protocol from @typstream/core and compiles with an EngineAdapter;
// engine-wasm is the default. Failed compiles go through the Layer 3 fixers
// (PLAN §5.5); Typst packages come from an allowlist (§6.4). The default worker
// script (worker.ts) is `serve(engineWasm({ fonts: baseFonts, lazyFonts: scriptFonts }))`; write your
// own worker with these exports to load the wasm or fonts from elsewhere.

export type { InitInput } from "@typstream/engine-wasm";
// What `inProcess` returns; the same types as the main entry's.
export type { EngineConnection, EngineEvents, SpawnDefaults, SpawnEngine } from "./connection";
export type { WatchdogOptions } from "./document";
export type {
  AdapterCompileOptions,
  AdapterCompileResult,
  AdapterDocument,
  AdapterHtmlResult,
  AdapterPagedResult,
  EngineAdapter,
  MaybePromise,
} from "./server/adapter";
export {
  type EngineWasmOptions,
  engineWasm,
  type FontInput,
  type LazyFontInput,
  TYPST_VERSION,
} from "./server/engine-wasm";
export { DEFAULT_FIXERS, missingImage, packageStub, pendingRef, tailCut } from "./server/fixers";
export type { PackageOptions } from "./server/packages";
export { RUNTIME_PATH } from "./server/runtime";
export { inProcess, serve, type WorkerScope } from "./server/serve";
export { createServer, type EngineServer, fromMain, PREAMBLE_PATH, type ServerOptions } from "./server/server";
