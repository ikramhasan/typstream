// @typstream/dom: framework-free renderers for typstream's output (PLAN §4.1,
// §6.5). Each target lives in its own module: html/ (Typst's HTML export) and
// paged/ (SVG pages); export/ makes downloadable files from the engine's exports.
// mount.ts puts either on an engine document: what the framework bindings wrap.

export * from "./export";
export * from "./html";
export { type MountedTypstream, mountTypstream, type RenderedInfo, type TypstreamOptions } from "./mount";
export * from "./paged";
