// @typstream/engine, main-thread half: the client that heals, schedules and
// supervises compiles in the engine worker (PLAN §4, §6). The worker half is
// `@typstream/engine/server`; `engineWorker()` spawns the default worker.

export type { Clock } from "./clock";
export { type EngineConnection, type EngineEvents, fromWorker, type SpawnEngine, type WorkerLike } from "./connection";
export type {
  CompileFailure,
  DocumentOptions,
  DocumentState,
  DocumentStatus,
  EngineDocument,
  ExportOptions,
  WatchdogOptions,
} from "./document";
export { ExportError } from "./document";
export {
  createEngine,
  DEFAULT_RECYCLE_BYTES,
  DEFAULT_WATCHDOG,
  type Engine,
  type EngineEvent,
  type EngineOptions,
} from "./engine";
export { DEFAULT_SCHEDULE, type ScheduleOptions } from "./schedule";
export { engineWorker } from "./spawn";
