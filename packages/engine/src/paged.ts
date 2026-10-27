import type { PagedArtifact, Revision } from "@typstream/core";

/**
 * @internal Applies a changed-pages artifact to the complete one it diffs
 * against. Returns every page (`base: null`), or `null` when `next` diffs
 * against pages the client doesn't have, so it needs a `fullPages` compile.
 */
export const applyPaged = (
  prev: PagedArtifact | null,
  prevRev: Revision | null,
  next: PagedArtifact,
): PagedArtifact | null => {
  if (next.base === null) return next;
  if (prev === null || next.base !== prevRev) return null;
  const pages = prev.pages.slice(0, next.pageCount);
  for (const page of next.pages) pages[page.index] = page;
  // A server that skipped a page it should have sent would leave a hole.
  if (pages.length !== next.pageCount) return null;
  for (let i = 0; i < pages.length; i++) if (!pages[i]) return null;
  // Island markers are the whole list, whichever pages changed.
  return { target: "paged", base: null, pageCount: next.pageCount, pages, islands: next.islands };
};
