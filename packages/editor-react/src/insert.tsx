// The insert menu (the toolbar's ➕) and the slash menu (`/` where a word could start), from the plugins'
// insert items: tables, equations, page breaks, a plugin's components. Searchable, by label,
// description, group and keywords.

import { diffEdit } from "@typstream/core";
import {
  canType,
  type EditorState,
  type EditorView,
  type InsertItem,
  isEmptyLine,
  type Selection,
} from "@typstream/editor-core";
import { Plus } from "lucide-react";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, type MenuEntry, MenuList, Popover, revealHighlighted, usePopup } from "./ui";

/**
 * How well an item matches what was typed after `/`, lower first, `null` for no match: its name's
 * start, a word of its name, its name, its keywords, its group, its description. "num" finds
 * Number line before a question "numbered" in its description.
 */
export const rank = (item: InsertItem, query: string): number | null => {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  // Numbers alone name nothing (not Heading 2): `/2 = 0.5` is a sum.
  if (!/\p{L}/u.test(q)) return null;
  const label = item.label.toLowerCase();
  if (label.startsWith(q)) return 0;
  if (label.split(/\s+/).some((w) => w.startsWith(q))) return 1;
  if (label.includes(q)) return 2;
  if ((item.keywords ?? []).some((k) => k.toLowerCase().includes(q))) return 3;
  if (item.group?.toLowerCase().includes(q)) return 4;
  if (item.description?.toLowerCase().includes(q)) return 5;
  return null;
};

/**
 * The item a list's key moves the highlight to, of `count`: Down and Up go round at the ends, Home
 * and End to the first and the last. `null` for another key.
 */
export const moveHighlight = (key: string, index: number, count: number): number | null => {
  if (count === 0) return null;
  if (key === "ArrowDown") return (index + 1) % count;
  if (key === "ArrowUp") return (index + count - 1) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
};

/** The items a query finds, best first. */
const search = (items: readonly InsertItem[], query: string): InsertItem[] =>
  items
    .map((item, i) => ({ item, i, r: rank(item, query) }))
    .filter((x): x is { item: InsertItem; i: number; r: number } => x.r !== null)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.item);

/** A searchable list of insert items; Enter inserts the highlighted one. */
export const InsertList = ({ view, items, onDone }: { view: EditorView; items: InsertItem[]; onDone: () => void }) => {
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const found = useMemo(() => search(items, query), [items, query]);
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
          const to = moveHighlight(e.key, Math.min(highlighted, found.length - 1), found.length);
          if (to !== null) setHighlighted(to);
          else if (e.key === "Enter") {
            const item = found[highlighted];
            if (item) insert(item);
          } else if (e.key === "Tab") onDone();
          else return;
          revealHighlighted(list.current);
          e.preventDefault();
        }}
      />
      <div ref={list} className="tse-scroll">
        <MenuList entries={entries} highlighted={highlighted} onHighlight={setHighlighted} />
      </div>
    </>
  );
};

/** The toolbar's insert button and its menu. */
export const InsertMenu = ({ view, items }: { view: EditorView; items: InsertItem[] }) => {
  const { open, button, close, toggle, anchor } = usePopup();
  // The caret stays drawn where the item will go while the search has the keyboard.
  useEffect(() => {
    const root = view.element.closest(".tse-root");
    if (!open || !root) return;
    root.setAttribute("data-inserting", "");
    return () => root.removeAttribute("data-inserting");
  }, [open, view]);
  return (
    <>
      <Button label="Insert" buttonRef={button} expanded={open} popup="dialog" onClick={toggle}>
        <Plus aria-hidden="true" />
        <span>Insert</span>
      </Button>
      {open && (
        <Popover anchor={anchor} onClose={close} ignore={button} label="Insert" className="tse-searchable">
          <InsertList view={view} items={items} onDone={close} />
        </Popover>
      )}
    </>
  );
};

/**
 * A slash menu's line as it was before its `/` was typed: what the item chosen is inserted into,
 * in place of the `/` and what was typed after it.
 */
export interface SlashSession {
  /** Where the line starts. */
  lineStart: number;
  /** The line: empty, an empty line's `~`, or the text the `/` is typed into. */
  line: string;
  /** How much text follows the line: its end moves as the filter is typed. */
  after: number;
  selection: Selection;
  /** In a line of text: how much of the line is before the `/`, and how much after the caret. */
  within?: { before: number; after: number };
}

/** Whether a caret at `at` is in the document's text: not in a formula, raw text or code. */
const inText = (state: EditorState, at: number): boolean => {
  if (!canType(state, at)) return false;
  for (let node: EditorState["tree"] | undefined = state.tree; node; ) {
    if (node.kind === "Raw" || node.kind === "Equation") return false;
    node = node.children.find((k) => k.from < at && at < k.to);
  }
  return true;
};

/**
 * The session a `/` typed at the caret starts: on an empty line, or where a word could start in a
 * line of text (at its start, after a space, at the start of a cell or a list item). Inside a word
 * (`1/2`, `and/or`), an address or a formula the `/` is text.
 */
export const slashSession = (state: EditorState): SlashSession | null => {
  const { text, selection } = state;
  if (selection.anchor !== selection.head) return null;
  const at = selection.head;
  const lineStart = text.lastIndexOf("\n", at - 1) + 1;
  const end = text.indexOf("\n", at);
  const lineEnd = end < 0 ? text.length : end;
  const line = text.slice(lineStart, lineEnd);
  const session = { lineStart, line, after: text.length - lineEnd, selection };
  // An empty line, or one holding only an empty line's `~`.
  if (line.trim() === "" || (line.trim() === "~" && isEmptyLine(text, lineStart + line.indexOf("~")))) return session;
  const before = text[at - 1];
  // A cell's or a content's start is its `[` (not an escaped one, which is text).
  const starts = at === lineStart || before === " " || before === "\t" || (before === "[" && text[at - 2] !== "\\");
  if (!starts || !inText(state, at)) return null;
  return { ...session, within: { before: at - lineStart, after: lineEnd - at } };
};

/**
 * What is typed after a session's `/`, as the teacher typed it (the editor escapes it in the
 * source): the menu's filter. `null` once the line isn't the `/` and a filter with the caret in it.
 */
export const slashQuery = (state: EditorState, session: SlashSession): string | null => {
  const { text, selection } = state;
  const lineEnd = text.length - session.after;
  const from = session.lineStart + (session.within?.before ?? 0);
  const to = lineEnd - (session.within?.after ?? 0);
  if (selection.anchor !== selection.head || selection.head <= from || selection.head > to) return null;
  // What is before the `/` in its line is as it was.
  if (session.within && text.slice(session.lineStart, from) !== session.line.slice(0, session.within.before))
    return null;
  const typed = (session.within ? /^\\?\/(.*)$/ : /^[ \t]*\\?\/(.*)$/).exec(text.slice(from, to));
  return typed ? (typed[1] as string).replace(/\\(.)/g, "$1") : null;
};

/**
 * The slash menu: the insert items at the caret, filtered by what is typed after the `/`. The
 * typing is the document's, so a `/` that wasn't meant for the menu stays as typed: the menu goes
 * when nothing matches (for good at a space, `/2 = 0.5`), and on Escape. Up, Down, Home, End and
 * Enter are the menu's while it shows: `keys` is where the editor's keys ask it.
 */
export const SlashMenu = ({
  view,
  session,
  keys,
  onClose,
}: {
  view: EditorView;
  session: SlashSession;
  keys: RefObject<((event: KeyboardEvent) => boolean) | null>;
  onClose: () => void;
}) => {
  const items = useMemo(() => view.plugins.flatMap((p) => p.insert ?? []), [view]);
  const list = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ query: "", index: 0 });
  const shown = useRef(at);
  shown.current = at;
  const query = slashQuery(view.state, session);
  const found = query === null ? [] : search(items, query);
  const over = !view.focused || query === null || /^\s/.test(query) || (found.length === 0 && /\s/.test(query));
  useEffect(() => {
    if (over) onClose();
  }, [over, onClose]);

  /** The item in place of the `/` and its filter, as one change: one undo brings back what was typed. */
  const insert = useCallback(
    (item: InsertItem) => {
      onClose();
      const { state } = view;
      const before = state.apply({
        edits: [{ from: session.lineStart, to: state.text.length - session.after, insert: session.line }],
        selection: session.selection,
      }).state;
      const tr = item.run(before, view.schema);
      const next = tr ? before.apply(tr).state : before;
      const edit = diffEdit(state.text, next.text);
      view.dispatch({ edits: edit ? [edit] : [], selection: next.selection });
      view.focus();
    },
    [view, session, onClose],
  );

  // The keys read the view, not the last render: Enter comes right after a filter's last letter.
  useLayoutEffect(() => {
    keys.current = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
      const q = slashQuery(view.state, session);
      const matches = q === null || /^\s/.test(q) ? [] : search(items, q);
      const n = matches.length;
      // Nothing shown: the keys are the document's, and Escape says the `/` was text.
      if (n === 0) {
        if (e.key === "Escape") onClose();
        return false;
      }
      const index = shown.current.query === q ? Math.min(shown.current.index, n - 1) : 0;
      const move = (to: number) => {
        shown.current = { query: q as string, index: to };
        setAt(shown.current);
        revealHighlighted(list.current);
      };
      const to = moveHighlight(e.key, index, n);
      if (to !== null) move(to);
      else if (e.key === "Enter") insert(matches[index] as InsertItem);
      else if (e.key === "Escape") onClose();
      else return false;
      return true;
    };
    return () => {
      keys.current = null;
    };
  }, [keys, view, session, items, insert, onClose]);

  // At the caret's line, and where the `/` is: the menu stays put as the filter is typed.
  const left = useRef<number | null>(null);
  const anchor = () => {
    const caret = view.element.querySelector(".typstream-editor-caret")?.getBoundingClientRect();
    // No caret drawn (the document lost the focus): where it was.
    if (!caret?.height) return null;
    const host = view.element.getBoundingClientRect().left;
    left.current ??= caret.left - host;
    return new DOMRect(host + left.current, caret.top, 0, caret.height);
  };
  if (over || found.length === 0) return null;
  const index = at.query === query ? Math.min(at.index, found.length - 1) : 0;
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
    <Popover anchor={anchor} onClose={onClose} role="presentation" className="tse-searchable">
      <div ref={list} className="tse-scroll">
        <MenuList
          label="Insert"
          entries={entries}
          highlighted={index}
          onHighlight={(i) => setAt({ query: query as string, index: i })}
        />
      </div>
    </Popover>
  );
};
