// Where the chrome goes over the pages: the part of the window that shows them (the pane), and a
// bar's place by what it belongs to, inside that pane. The component's bar and the floating toolbar
// both ask here, so neither covers the fixed toolbar, leaves the editor, or lies over the other.

import type { EditorView } from "@typstream/editor-core";

/** A rectangle in client coordinates. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Between a bar and what it belongs to. */
export const BAR_GAP = 6;

/**
 * What of the window shows the pages: inside every ancestor that clips them, under the fixed
 * toolbar, and within the editor's own box and the window (8px in from the window's sides).
 */
export const paneOf = (view: EditorView): Box => {
  let top = 0;
  let bottom = window.innerHeight;
  const body = view.element.ownerDocument.body;
  for (let el = view.element.parentElement; el && el !== body; el = el.parentElement) {
    if (getComputedStyle(el).overflowY === "visible") continue;
    const r = el.getBoundingClientRect();
    top = Math.max(top, r.top);
    bottom = Math.min(bottom, r.bottom);
  }
  const root = view.element.closest(".tse-root") ?? view.element;
  const fixed = root.querySelector(":scope > .tse-fixed");
  if (fixed) top = Math.max(top, fixed.getBoundingClientRect().bottom);
  const r = root.getBoundingClientRect();
  return { top, bottom, left: Math.max(r.left, 8), right: Math.min(r.right, window.innerWidth - 8) };
};

/** The box around some rectangles; `null` for none. */
export const unionOf = (rects: readonly Box[]): Box | null => {
  if (rects.length === 0) return null;
  return {
    left: Math.min(...rects.map((r) => r.left)),
    top: Math.min(...rects.map((r) => r.top)),
    right: Math.max(...rects.map((r) => r.right)),
    bottom: Math.max(...rects.map((r) => r.bottom)),
  };
};

/** Whether two boxes share any area. */
export const overlaps = (a: Box, b: Box): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * A bar's place by `box` (its component): above it; below it where there is no room above (the
 * component is at the pane's top); else at the pane's top, over a component taller than the pane.
 * Its left edge is the component's, kept inside the pane. `hidden` once the component is scrolled
 * out of the pane.
 */
export const placeBar = (
  box: Box,
  size: { width: number; height: number },
  pane: Box,
): { left: number; top: number; hidden: boolean } => {
  const floor = pane.top + 4;
  let top = box.top - size.height - BAR_GAP;
  if (top < floor) top = box.bottom + BAR_GAP + size.height <= pane.bottom - 4 ? box.bottom + BAR_GAP : floor;
  const left = Math.max(pane.left, Math.min(box.left, pane.right - size.width));
  return { left, top, hidden: box.bottom <= pane.top || box.top >= pane.bottom };
};

/**
 * A popover's place by `anchor`, inside `pane`: below it, or above where there is no room below
 * (`prefer` the other way round), its left edge the anchor's, never outside the pane or the window.
 */
export const placePopover = (
  anchor: Box,
  size: { width: number; height: number },
  pane: Box,
  prefer: "below" | "above" = "below",
): { left: number; top: number } => {
  const vh = window.innerHeight;
  const below = anchor.bottom + BAR_GAP;
  const above = anchor.top - size.height - BAR_GAP;
  let top = prefer === "below" ? below : above;
  if (prefer === "below" && below + size.height > vh - 8 && above > 8) top = above;
  if (prefer === "above" && above < 8) top = below;
  top = Math.max(8, Math.min(top, vh - size.height - 8));
  const left = Math.max(pane.left, Math.min(anchor.left, pane.right - size.width));
  return { left, top };
};

const bars = new WeakMap<EditorView, () => Box | null>();

/** Says where a view's component bar is (or will be, once placed); what it returns takes it back. */
export const registerBar = (view: EditorView, measure: () => Box | null): (() => void) => {
  bars.set(view, measure);
  return () => {
    if (bars.get(view) === measure) bars.delete(view);
  };
};

/** The component bar's box now, for what must stay clear of it; `null` when none shows. */
export const componentBarBox = (view: EditorView): Box | null => bars.get(view)?.() ?? null;
