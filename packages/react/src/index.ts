// @typstream/react (PLAN §4.1, §7): <Typstream>, useTypstream() and
// TypstreamProvider, a thin layer over @typstream/dom's mountTypstream.

export type {
  AppliedFix,
  CompiledEvent,
  CompileReport,
  DocumentEvent,
  FallbackEvent,
  FallbackLevel,
  IslandProps,
  RenderedEvent,
  WatchdogEvent,
} from "@typstream/core";
export type { StandaloneHtmlOptions, TypstreamExportOptions } from "@typstream/dom";
export type { DocumentState, DocumentStatus, Engine } from "@typstream/engine";
export { type TypstreamDefaults, TypstreamProvider, type TypstreamProviderProps, useTypstreamDefaults } from "./context";
export { acquireEngine, releaseEngine } from "./engine";
export type { IslandComponent, IslandComponents } from "./islands";
export { Typstream, type TypstreamHandle, type TypstreamProps } from "./Typstream";
export type { TelemetryHooks } from "./telemetry";
export { type TypstreamInfo, useTypstream } from "./useTypstream";
