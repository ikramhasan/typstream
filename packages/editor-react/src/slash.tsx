// The slash menu, as Plate UI's: `/` at the start of an empty line opens the insert menu at the
// caret, the text after it filters, arrows and Enter pick. It reads the editor's selection rather
// than inserting an input node, so it needs no combobox package.

import { autoUpdate, flip, offset, shift, useFloating } from "@platejs/floating";
import type { TypstreamPlugin } from "@typstream/core";
import type { Point, TElement } from "platejs";
import { useEditorRef, useEditorSelector } from "platejs/react";
import { type MutableRefObject, useEffect, useMemo, useState } from "react";
import { filterGroups, insertGroups } from "./items";
import { MenuList, menuKeys } from "./ui";

/** Handles a key for the open slash menu; true if it did. */
export type SlashKeys = (event: KeyboardEvent | React.KeyboardEvent) => boolean;

/** The caret's box: a collapsed range in a short text can measure empty, so then its element's. */
const caretRect = (): DOMRect => {
  const selection = globalThis.getSelection?.();
  if (!selection || selection.rangeCount === 0) return new DOMRect();
  const range = selection.getRangeAt(0);
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
  if (rect.width || rect.height) return rect;
  const node = range.startContainer;
  return (node.nodeType === 1 ? (node as Element) : node.parentElement)?.getBoundingClientRect() ?? rect;
};

interface SlashState {
  query: string;
  /** Where the `/` is. */
  start: Point;
  /** Identifies this occurrence, so Escape keeps it closed until the text changes. */
  at: string;
}

export const SlashMenu = ({
  plugins,
  keys,
}: {
  plugins: readonly TypstreamPlugin[];
  keys: MutableRefObject<SlashKeys | null>;
}) => {
  const editor = useEditorRef();
  const state = useEditorSelector(
    (e): SlashState | null => {
      const selection = e.selection;
      if (!selection || !e.api.isCollapsed()) return null;
      const entry = e.api.block<TElement>();
      if (!entry || entry[0].type !== "p") return null;
      const start = e.api.start(entry[1]);
      if (!start) return null;
      const text = e.api.string({ anchor: start, focus: selection.anchor });
      const match = /^\/([^\s/]*)$/.exec(text);
      return match ? { query: match[1] ?? "", start, at: `${entry[1].join(".")}:${text}` } : null;
    },
    [],
    { equalityFn: (a, b) => a?.at === b?.at },
  );
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const open = state !== null && state.at !== dismissed;
  const groups = useMemo(
    () => (open ? filterGroups(insertGroups(editor, plugins, true), state.query) : []),
    [open, editor, plugins, state?.query],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new query starts at the first item
  useEffect(() => setActive(0), [state?.query]);

  const floating = useFloating({
    open,
    placement: "bottom-start",
    strategy: "fixed",
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  // Anchored to the caret, a virtual element.
  const { setPositionReference } = floating.refs;
  useEffect(() => {
    if (open) setPositionReference({ getBoundingClientRect: caretRect });
  }, [open, setPositionReference]);

  // Removes the `/query` before running the item.
  const run = useMemo(
    () =>
      groups.map((group) => ({
        ...group,
        items: group.items.map((item) => ({
          ...item,
          onSelect: () => {
            if (state && editor.selection)
              editor.tf.delete({ at: { anchor: state.start, focus: editor.selection.anchor } });
            item.onSelect();
          },
        })),
      })),
    [groups, state, editor],
  );

  keys.current = open
    ? (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setDismissed(state?.at ?? null);
          return true;
        }
        return menuKeys(event, run, active, setActive);
      }
    : null;

  if (!open) return null;
  return (
    <div ref={floating.refs.setFloating} className="ts-popover" style={floating.floatingStyles}>
      <MenuList groups={run} active={active} setActive={setActive} onDone={() => {}} />
    </div>
  );
};
