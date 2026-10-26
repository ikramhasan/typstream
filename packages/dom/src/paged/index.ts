// The paged renderer: SVG pages from changed-page artifacts (PLAN §6.5, #14).

export { isSafeHref } from "./links";
export { FIT_WIDTH_PREAMBLE, fitWidthInputs, type MountedPaged, type MountPagedOptions, mountPaged } from "./mount";
export { createPagedView, type DrawInfo, type PagedView, type PagedViewOptions } from "./view";
