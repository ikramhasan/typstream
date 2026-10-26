// @typstream/react (PLAN §4.1, §7): <Typstream>, useTypstream() and
// TypstreamProvider, a thin layer over @typstream/dom's mountTypstream.

export type { RenderedInfo } from "@typstream/dom";
export type { DocumentState, DocumentStatus, Engine } from "@typstream/engine";
export { type TypstreamDefaults, TypstreamProvider, type TypstreamProviderProps } from "./context";
export { Typstream, type TypstreamHandle, type TypstreamProps } from "./Typstream";
export { type TypstreamInfo, useTypstream } from "./useTypstream";
