// The paged renderer: SVG pages from changed-page artifacts (PLAN §6.5, #14).

export { isSafeHref } from "./links";
export { type MountedPaged, type MountPagedOptions, mountPaged, REFLOW_PREAMBLE, reflowInputs } from "./mount";
export { createPagedView, type DrawInfo, type PagedRenderOptions, type PagedView, type PagedViewOptions } from "./view";
