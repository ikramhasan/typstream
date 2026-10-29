// @typstream/node: validate and render Typst on the server, repair it with an
// LLM, and serve the worker protocol to clients that don't load the engine
// (PLAN §4.1, §5.7, §6.1). Runs @typstream/engine-wasm on worker threads.

export {
  createEngine,
  type DocumentOptions,
  defaultEngine,
  type EngineOptions,
  type NodeEngine,
} from "./engine";
export type { FontOptions } from "./fonts";
export {
  type FixAttempt,
  type FixLoopOptions,
  type FixLoopResult,
  type FixRequest,
  type FormatOptions,
  fixLoop,
  formatDiagnosticsForLLM,
} from "./llm";
export {
  createProtocolServer,
  handleWebSocket,
  type ProtocolConnection,
  type ProtocolServer,
  type ProtocolServerOptions,
  type WebSocketLike,
} from "./server";
export {
  type RenderData,
  type RenderFormat,
  type RenderResult,
  render,
  renderDocxModel,
  type ValidateOptions,
  type ValidateResult,
  validate,
} from "./validate";
