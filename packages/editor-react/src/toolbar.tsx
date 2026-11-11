// The fixed toolbar above the pages and the floating one over a text selection, from the plugins'
// items (Plate's `FixedToolbar` and `FloatingToolbar`): toggles show whether a mark is on at the
// selection, menus what the block is, pickers the colour, the size and the font.

import type { EditorState, EditorView, ToolbarItem } from "@typstream/editor-core";
import {
  type CSSProperties,
  Fragment,
  memo,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { FontMenu } from "./fonts";
import { useViewFrame } from "./hooks";
import { InsertMenu } from "./insert";
import { type Box, componentBarBox, overlaps, paneOf } from "./place";
import { Button, ColorMenu, Held, Layer, Menu, Popover, Separator, usePopup } from "./ui";

/** A view's prompt buttons by their item's key, in the order they were mounted: what opens their fields. */
const prompts = new WeakMap<EditorView, { key: string; button: () => HTMLElement | null; open: () => void }[]>();

/**
 * Opens a prompt item's field (the link's, on Ctrl+K) from the toolbar that shows it: the floating
 * one over a selection, else the fixed one. `false` when no toolbar has the item.
 */
export const openPrompt = (view: EditorView, key: string): boolean => {
  const shown = (prompts.get(view) ?? []).filter((p) => {
    const b = p.button();
    return p.key === key && !!b && getComputedStyle(b).visibility !== "hidden";
  });
  const one = shown.find((p) => p.button()?.closest(".tse-floating")) ?? shown[0];
  if (!one) return false;
  // In a narrow editor the fixed toolbar's button may be scrolled out of its row.
  one.button()?.scrollIntoView({ block: "nearest", inline: "nearest" });
  one.open();
  return true;
};

/** A button opening a text field (a link's URL); Enter applies it, Remove takes it off. */
const PromptButton = ({
  item,
  view,
}: {
  item: ToolbarItem & { prompt: NonNullable<ToolbarItem["prompt"]> };
  view: EditorView;
}) => {
  const { open, button, close, toggle, anchor } = usePopup();
  const [draft, setDraft] = useState("");
  /** What was typed isn't something the item takes (a link that would run code). */
  const [refused, setRefused] = useState(false);
  const current = item.prompt.value(view.state, view.schema);
  const apply = (value: string | null) => {
    const command = item.prompt.apply(value);
    // Refused: the field stays open and says so, rather than closing as if it had worked.
    if (value?.trim() && command(view.state, view.schema) === null) return setRefused(true);
    close();
    view.run(command);
    view.focus();
  };
  const show = () => {
    // Read now, not at the last render: the toolbars follow the view a frame late, and Ctrl+K may come sooner.
    setDraft(item.prompt.value(view.state, view.schema) ?? "");
    setRefused(false);
    toggle();
  };
  const latest = useRef({ open, show });
  latest.current = { open, show };
  useEffect(() => {
    const entry = {
      key: item.key,
      button: () => button.current,
      open: () => {
        if (!latest.current.open) latest.current.show();
      },
    };
    const list = prompts.get(view) ?? [];
    prompts.set(view, list);
    list.push(entry);
    return () => {
      list.splice(list.indexOf(entry), 1);
    };
  }, [view, item.key, button]);
  return (
    <>
      <Button
        label={item.label}
        icon={item.icon}
        shortcut={item.shortcut}
        buttonRef={button}
        expanded={open}
        popup="dialog"
        active={current !== null}
        onClick={show}
      />
      {open && (
        <Popover anchor={anchor} onClose={close} ignore={button} label={item.prompt.label}>
          <form
            className="tse-field"
            style={{ padding: 4, minWidth: 260 }}
            onSubmit={(e) => {
              e.preventDefault();
              apply(draft);
            }}
          >
            <label htmlFor={`tse-prompt-${item.key}`}>{item.prompt.label}</label>
            <input
              id={`tse-prompt-${item.key}`}
              type="text"
              value={draft}
              placeholder={item.prompt.placeholder}
              // biome-ignore lint/a11y/noAutofocus: the popover opened to type into it
              autoFocus
              aria-invalid={refused || undefined}
              onChange={(e) => {
                setDraft(e.target.value);
                setRefused(false);
              }}
            />
            {refused && (
              <small className="tse-invalid" role="alert">
                This address can't be used. Try one that starts with https://
              </small>
            )}
            <span className="tse-actions">
              <button type="submit" className="tse-button" data-variant="primary">
                Apply
              </button>
              {current !== null && (
                <button type="button" className="tse-button" data-variant="destructive" onClick={() => apply(null)}>
                  Remove
                </button>
              )}
            </span>
          </form>
        </Popover>
      )}
    </>
  );
};

const runnable = new WeakMap<EditorState, Map<ToolbarItem, boolean>>();

/**
 * Whether an item does anything at the view's state: what its `enabled` says, else whether its
 * command applies (Align in a list item doesn't). Worked out once per state.
 */
const canRun = (view: EditorView, item: ToolbarItem): boolean => {
  const { state, schema } = view;
  let known = runnable.get(state);
  if (!known) {
    known = new Map();
    runnable.set(state, known);
  }
  let can = known.get(item);
  if (can === undefined) {
    can = item.enabled ? item.enabled(state, schema) : item.run ? item.run(state, schema) !== null : false;
    known.set(item, can);
  }
  return can;
};

/** One toolbar item at the view's state. */
export const Item = ({ item, view }: { item: ToolbarItem; view: EditorView }) => {
  const { state, schema } = view;
  const run = (command: NonNullable<ToolbarItem["run"]>) => {
    view.run(command);
    view.focus();
  };
  if (item.prompt)
    return <PromptButton item={item as ToolbarItem & { prompt: NonNullable<ToolbarItem["prompt"]> }} view={view} />;
  if (item.picker) {
    const value = item.picker.value(state, schema);
    const apply = item.picker.apply;
    if (item.picker.kind === "color")
      return (
        <ColorMenu
          label={item.label}
          icon={item.icon}
          value={value}
          options={item.picker.options}
          onSelect={(v) => run(apply(v))}
        />
      );
    if (item.picker.kind === "font")
      return (
        <FontMenu
          view={view}
          label={item.label}
          value={value}
          options={item.picker.options}
          onSelect={(v) => run(apply(v))}
        />
      );
    const current = item.picker.options.find((o) => o.value === value)?.label ?? "Default";
    return (
      <Menu
        label={item.label}
        text={current}
        entries={item.picker.options.map((o) => ({
          key: o.label,
          label: o.label,
          active: o.value === value,
          onSelect: () => run(apply(o.value)),
        }))}
      />
    );
  }
  if (item.items) {
    const current = item.current?.(state, schema) ?? null;
    const shown = item.items.find((i) => i.active?.(state, schema));
    const icon = item.icon && shown?.icon ? shown.icon : item.icon;
    return (
      <Menu
        label={item.label}
        icon={icon}
        // An icon alone says little: its tooltip has the keys of what it opens.
        shortcut={item.shortcut ?? (item.icon ? item.items.flatMap((i) => i.shortcut ?? []) : undefined)}
        text={item.icon ? undefined : (current ?? item.label)}
        entries={item.items.map((i) => ({
          key: i.key,
          label: i.label,
          icon: i.icon,
          shortcut: i.shortcut,
          active: i.active?.(state, schema),
          // What the block already is stays readable; what can't be done here is greyed.
          disabled: !i.active?.(state, schema) && !canRun(view, i),
          onSelect: () => i.run && run(i.run),
        }))}
        disabled={!item.items.some((i) => canRun(view, i))}
      />
    );
  }
  const enabled = canRun(view, item);
  return (
    <Button
      label={item.label}
      icon={item.icon}
      shortcut={item.shortcut}
      active={item.active?.(state, schema) ?? undefined}
      disabled={!enabled}
      onClick={() => item.run && run(item.run)}
    />
  );
};

/** Items in groups, with separators between them; `order` sorts the groups. */
const grouped = (items: ToolbarItem[], order: readonly string[]): ToolbarItem[][] => {
  const groups = new Map<string, ToolbarItem[]>();
  for (const item of items) {
    const g = item.group ?? item.key;
    if (!groups.has(g)) groups.set(g, []);
    (groups.get(g) as ToolbarItem[]).push(item);
  }
  const rank = (g: string) => {
    const i = order.indexOf(g);
    return i < 0 ? order.length : i;
  };
  return [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0])).map(([, v]) => v);
};

/** Groups in the order Plate's fixed toolbar has them. */
const FIXED_ORDER = ["block", "font", "size", "marks", "color", "align", "list"];

/**
 * What a toolbar shows at the view's state, as a string: it renders again only when this changes,
 * not on every key.
 */
const stampOf = (view: EditorView, items: readonly ToolbarItem[]): string => {
  const { state, schema } = view;
  const parts: unknown[] = [view.history.canUndo, view.history.canRedo];
  const visit = (item: ToolbarItem) => {
    if (item.prompt) parts.push(item.prompt.value(state, schema));
    else if (item.picker) parts.push(item.picker.value(state, schema));
    else if (item.items) {
      parts.push(item.current?.(state, schema) ?? null);
      for (const i of item.items) parts.push(i.active?.(state, schema) ?? null, canRun(view, i));
    } else parts.push(item.active?.(state, schema) ?? null, canRun(view, item));
  };
  for (const item of items) visit(item);
  return JSON.stringify(parts);
};

/** The fixed toolbar's controls: its own row's, then the app's at its end. */
const CONTROLS = ":scope > .tse-fixed-items button, :scope > .tse-fixed-end button";

/**
 * The toolbar above the pages: undo and redo, the insert menu, then the plugins' items, in one row
 * that scrolls sideways where the editor is narrower than it (its height, and so the pages under
 * it, never move with the selection). A WAI-ARIA toolbar: one Tab stop, the arrows between its
 * controls, Escape back to the document.
 */
export const FixedToolbar = ({ view, end }: { view: EditorView; end?: ReactNode }) => {
  useViewFrame(view);
  const stamp = stampOf(
    view,
    view.plugins.flatMap((p) => p.toolbar ?? []),
  );
  const bar = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  /** The control that is the toolbar's Tab stop: the one last focused. */
  const stop = useRef<HTMLButtonElement | null>(null);
  const controls = () => [...(bar.current?.querySelectorAll<HTMLButtonElement>(CONTROLS) ?? [])];
  const rove = (to?: HTMLButtonElement) => {
    const all = controls();
    const enabled = all.filter((b) => !b.disabled);
    const next = to ?? (stop.current && enabled.includes(stop.current) ? stop.current : (enabled[0] ?? null));
    stop.current = next;
    for (const b of all) {
      const index = b === next ? 0 : -1;
      if (b.tabIndex !== index) b.tabIndex = index;
    }
    // A control disabled under the focus (Undo, with nothing left to undo) would keep it, and take no keys.
    const active = bar.current?.ownerDocument.activeElement as HTMLButtonElement | null;
    if (active?.disabled && all.includes(active)) next?.focus();
  };
  // After every render: a selection enables and disables controls.
  useLayoutEffect(rove);
  // Which ends of the row have more: they fade out there. A wheel over the row scrolls it sideways.
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const mark = () => {
      const more = el.scrollWidth - el.clientWidth - el.scrollLeft;
      el.dataset.more = `${el.scrollLeft > 1 ? "start" : ""} ${more > 1 ? "end" : ""}`;
    };
    const wheel = (e: WheelEvent) => {
      if (e.deltaX || e.ctrlKey) return;
      const before = el.scrollLeft;
      el.scrollLeft += e.deltaY;
      if (el.scrollLeft !== before) e.preventDefault();
    };
    mark();
    const sizes = new ResizeObserver(mark);
    sizes.observe(el);
    el.addEventListener("scroll", mark);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      sizes.disconnect();
      el.removeEventListener("scroll", mark);
      el.removeEventListener("wheel", wheel);
    };
  }, []);
  // A popover's keys and focus come here too, through React's tree: only the toolbar's own controls count.
  const own = (target: EventTarget) => controls().includes(target as HTMLButtonElement);
  const onFocus = (e: ReactFocusEvent) => {
    if (own(e.target)) rove(e.target as HTMLButtonElement);
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (!own(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const enabled = controls().filter((b) => !b.disabled);
    const at = enabled.indexOf(e.target as HTMLButtonElement);
    const n = enabled.length;
    if (e.key === "ArrowRight") enabled[(at + 1) % n]?.focus();
    else if (e.key === "ArrowLeft") enabled[(at + n - 1) % n]?.focus();
    else if (e.key === "Home") enabled[0]?.focus();
    else if (e.key === "End") enabled[n - 1]?.focus();
    else if (e.key === "Escape") view.focus();
    else return;
    e.preventDefault();
  };
  return (
    <div
      ref={bar}
      className="tse-toolbar tse-fixed"
      role="toolbar"
      aria-label="Formatting"
      aria-orientation="horizontal"
      onFocus={onFocus}
      onKeyDown={onKeyDown}
    >
      <div ref={row} className="tse-fixed-items">
        <FixedToolbarItems view={view} stamp={stamp} />
      </div>
      {end && <div className="tse-fixed-end">{end}</div>}
    </div>
  );
};

const FixedToolbarItems = memo(function FixedToolbarItems({ view }: { view: EditorView; stamp: string }) {
  const items = view.plugins.flatMap((p) => p.toolbar ?? []);
  const inserts = view.plugins.flatMap((p) => p.insert ?? []);
  return (
    <>
      <Button label="Undo" icon="undo" shortcut="Mod-z" disabled={!view.history.canUndo} onClick={() => view.undo()} />
      <Button
        label="Redo"
        icon="redo"
        shortcut="Mod-Shift-z"
        disabled={!view.history.canRedo}
        onClick={() => view.redo()}
      />
      <Separator />
      {inserts.length > 0 && (
        <>
          <InsertMenu view={view} items={inserts} />
          <Separator />
        </>
      )}
      {grouped(items, FIXED_ORDER).map((group, i) => (
        <Fragment key={group[0]?.key ?? i}>
          {i > 0 && <Separator />}
          {group.map((item) => (
            <Item key={item.key} item={item} view={view} />
          ))}
        </Fragment>
      ))}
    </>
  );
});

/** Between the floating toolbar and the selection's line. */
const GAP = 10;

/**
 * The toolbar over a text selection (Plate's floating toolbar), while the editor has focus: above
 * its first line and clear of it, centred on it; below its last line where there is no room above,
 * under the fixed toolbar; never over the bar of the component the selection is in. It comes once
 * the pointer is released (not under a drag going up), is hidden while the selection is scrolled
 * out of view, and stays inside the editor's box.
 */
export const FloatingToolbar = ({ view, extra }: { view: EditorView; extra?: ReactNode }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties | null>(null);
  // A popover of its own open (the link's field has the focus the document had).
  const [held, setHeld] = useState(0);
  const hold = useCallback(() => {
    setHeld((n) => n + 1);
    return () => setHeld((n) => n - 1);
  }, []);
  // The pointer down in the document: a selection being dragged out.
  const [pressed, setPressed] = useState(false);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (e.button === 0) setPressed(true);
    };
    const up = () => setPressed(false);
    view.element.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    return () => {
      view.element.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
  }, [view]);
  const { selection } = view.state;
  const show = (view.focused || held > 0) && !pressed && selection.anchor !== selection.head && !selection.node;
  const items = view.plugins.flatMap((p) => p.floating ?? []);
  // Placed again when the selection or the layout under it changes.
  useLayoutEffect(() => {
    if (!show) {
      setStyle(null);
      return;
    }
    const place = () => {
      const rects = view.selectionRects();
      const first = rects[0];
      const last = rects[rects.length - 1];
      const el = ref.current;
      if (!first || !last || !el) return setStyle(null);
      const pane = paneOf(view);
      // Measured at the width it may take: it wraps in an editor narrower than its row.
      const maxWidth = Math.max(pane.right - pane.left, 0);
      el.style.maxWidth = `${maxWidth}px`;
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      const left = Math.min(...rects.map((r) => r.left));
      const right = Math.max(...rects.filter((r) => Math.abs(r.top - first.top) < 2).map((r) => r.right));
      const x = Math.max(pane.left, Math.min((left + right) / 2 - width / 2, pane.right - width));
      const at = (top: number): Box => ({ left: x, right: x + width, top, bottom: top + height });
      // The bar of the component the selection is in has its place by the component: not over it.
      const bar = componentBarBox(view);
      const fits = (top: number) =>
        top >= pane.top + 4 && top + height <= pane.bottom - 4 && !(bar && overlaps(at(top), bar));
      // Above the selection; below it; then clear of the bar, above or below that.
      const y =
        [
          first.top - height - GAP,
          last.bottom + GAP,
          ...(bar ? [bar.top - height - GAP, bar.bottom + GAP] : []),
          // A selection taller than what shows: at the top of it, over the selection.
        ].find(fits) ?? pane.top + 4;
      // The selection scrolled out of view: not over the fixed toolbar, nor over what is around the pages.
      const out = last.bottom <= pane.top || first.top >= pane.bottom;
      setStyle({ left: x, top: y, maxWidth, ...(out ? { visibility: "hidden" } : {}) });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [show, view, view.state, view.layout]);
  if (!show || items.length === 0) return null;
  return (
    <Layer>
      <Held.Provider value={hold}>
        <div
          ref={ref}
          className="tse-toolbar tse-floating"
          role="toolbar"
          aria-label="Selection"
          style={style ?? { visibility: "hidden", left: 0, top: 0 }}
        >
          {extra}
          {grouped(items, FIXED_ORDER).map((group, i) => (
            <Fragment key={group[0]?.key ?? i}>
              {(i > 0 || extra) && <Separator />}
              {group.map((item) => (
                <Item key={item.key} item={item} view={view} />
              ))}
            </Fragment>
          ))}
        </div>
      </Held.Provider>
    </Layer>
  );
};

/**
 * The plugins' switches (edu's "Show answers"), at the fixed toolbar's end: each sets an input of
 * the document while it is on, so what it shows (the answers) is on the pages, to edit there.
 */
export const Switches = ({
  view,
  on,
  onChange,
}: {
  view: EditorView;
  /** The inputs set now, by name. */
  on: Record<string, string>;
  onChange: (on: Record<string, string>) => void;
}) => {
  const switches = view.plugins.flatMap((p) => p.switches ?? []);
  return (
    <>
      {switches.map((s) => {
        const value = s.value ?? "true";
        const active = on[s.input] === value;
        return (
          // An icon where it has one, its name in the tooltip: the fixed toolbar's row has little room.
          <Button
            key={s.input}
            label={s.label}
            icon={s.icon}
            active={active}
            onClick={() => {
              const next = { ...on };
              if (active) delete next[s.input];
              else next[s.input] = value;
              onChange(next);
            }}
          >
            {s.icon ? undefined : s.label}
          </Button>
        );
      })}
    </>
  );
};
