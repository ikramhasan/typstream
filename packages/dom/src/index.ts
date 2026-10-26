// @typstream/dom: framework-free renderers for typstream's output (PLAN §4.1,
// §6.5). Each target lives in its own module: html/ (Typst's HTML export) and
// paged/ (SVG pages). mount.ts puts either on an engine document: what the
// framework bindings wrap.

export * from "./html";
export { type MountedTypstream, mountTypstream, type RenderedInfo, type TypstreamOptions } from "./mount";
export * from "./paged";
