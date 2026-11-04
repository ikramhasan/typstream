// The insert menu (the toolbar's ➕) and the slash menu (`/` on an empty line), from the plugins'
// insert items: tables, equations, page breaks, a plugin's components. Searchable, by label,
// description, group and keywords.

import type { EditorView, InsertItem } from "@typstream/editor-core";
import { Plus } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Button, type MenuEntry, MenuList, Popover } from "./ui";

const matches = (item: InsertItem, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [item.label, item.description, item.group, ...(item.keywords ?? [])].some((s) => s?.toLowerCase().includes(q));
};

/** A searchable list of insert items; Enter inserts the highlighted one. */
export const InsertList = ({ view, items, onDone }: { view: EditorView; items: InsertItem[]; onDone: () => void }) => {
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const found = useMemo(() => items.filter((i) => matches(i, query)), [items, query]);
  const insert = (item: InsertItem) => {
    onDone();
    view.run(item.run);
    view.focus();
  };
  const entries: MenuEntry[] = found.map((i) => ({
    key: i.key,
    label: i.label,
    description: i.description,
    icon: i.icon,
    group: i.group,
    large: true,
    onSelect: () => insert(i),
  }));
  return (
    <>
      <input
        className="tse-search"
        placeholder="Search…"
        aria-label="Search what to insert"
        // biome-ignore lint/a11y/noAutofocus: the menu opened to type into it
        autoFocus
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlighted(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setHighlighted((h) => Math.min(h + 1, found.length - 1));
          else if (e.key === "ArrowUp") setHighlighted((h) => Math.max(h - 1, 0));
          else if (e.key === "Enter") {
            const item = found[highlighted];
            if (item) insert(item);
          } else return;
          e.preventDefault();
        }}
      />
      <MenuList entries={entries} highlighted={highlighted} onHighlight={setHighlighted} />
    </>
  );
};

/** The toolbar's insert button and its menu. */
export const InsertMenu = ({ view, items }: { view: EditorView; items: InsertItem[] }) => {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const anchor = useCallback(() => button.current?.getBoundingClientRect() ?? null, []);
  return (
    <>
      <Button label="Insert" buttonRef={button} expanded={open} onClick={() => setOpen((o) => !o)}>
        <Plus aria-hidden="true" />
        <span>Insert</span>
      </Button>
      {open && (
        <Popover anchor={anchor} onClose={close} ignore={button} label="Insert">
          <InsertList view={view} items={items} onDone={close} />
        </Popover>
      )}
    </>
  );
};

/** The slash menu: the insert list at the caret. */
export const SlashMenu = ({ view, onClose }: { view: EditorView; onClose: () => void }) => {
  const items = view.plugins.flatMap((p) => p.insert ?? []);
  const anchor = useCallback(
    () => view.element.querySelector(".typstream-editor-caret")?.getBoundingClientRect() ?? null,
    [view],
  );
  const close = useCallback(() => {
    onClose();
    view.focus();
  }, [onClose, view]);
  return (
    <Popover anchor={anchor} onClose={close} label="Insert">
      <InsertList view={view} items={items} onDone={onClose} />
    </Popover>
  );
};
