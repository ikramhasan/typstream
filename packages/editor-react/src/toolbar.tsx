// The fixed toolbar above the pages and the floating one over a text selection, from the plugins'
// items (Plate's `FixedToolbar` and `FloatingToolbar`): toggles show whether a mark is on at the
// selection, menus what the block is, pickers the colour.

import type { EditorView, ToolbarItem } from "@typstream/editor-core";
import { type CSSProperties, Fragment, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { InsertMenu } from "./insert";
import { Button, ColorMenu, Layer, Menu, Separator } from "./ui";

/** One toolbar item at the view's state. */
export const Item = ({ item, view }: { item: ToolbarItem; view: EditorView }) => {
  const { state, schema } = view;
  const run = (command: NonNullable<ToolbarItem["run"]>) => {
    view.run(command);
    view.focus();
  };
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
        text={item.icon ? undefined : (current ?? item.label)}
        entries={item.items.map((i) => ({
          key: i.key,
          label: i.label,
          icon: i.icon,
          shortcut: i.shortcut,
          active: i.active?.(state, schema),
          onSelect: () => i.run && run(i.run),
        }))}
      />
    );
  }
  const enabled = item.enabled ? item.enabled(state, schema) : !!item.run;
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
const FIXED_ORDER = ["block", "size", "marks", "color", "align", "list"];

/** The toolbar above the pages: undo and redo, the insert menu, then the plugins' items. */
export const FixedToolbar = ({ view, end }: { view: EditorView; end?: ReactNode }) => {
  const items = view.plugins.flatMap((p) => p.toolbar ?? []);
  const inserts = view.plugins.flatMap((p) => p.insert ?? []);
  return (
    <div className="tse-toolbar tse-fixed" role="toolbar" aria-label="Formatting" aria-orientation="horizontal">
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
      {end && (
        <>
          <span style={{ flex: 1 }} />
          {end}
        </>
      )}
    </div>
  );
};

/**
 * The toolbar over a text selection (Plate's floating toolbar): above its first line, centred on
 * it, while the editor has focus.
 */
export const FloatingToolbar = ({ view, extra }: { view: EditorView; extra?: ReactNode }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties | null>(null);
  const { selection } = view.state;
  const show = view.focused && selection.anchor !== selection.head && !selection.node;
  const items = view.plugins.flatMap((p) => p.floating ?? []);
  // Placed again when the selection or the layout under it changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useLayoutEffect(() => {
    if (!show) {
      setStyle(null);
      return;
    }
    const place = () => {
      const rects = view.selectionRects();
      const first = rects[0];
      const el = ref.current;
      if (!first || !el) return setStyle(null);
      const left = Math.min(...rects.map((r) => r.left));
      const right = Math.max(...rects.filter((r) => Math.abs(r.top - first.top) < 2).map((r) => r.right));
      const width = el.offsetWidth;
      const x = Math.max(8, Math.min((left + right) / 2 - width / 2, window.innerWidth - width - 8));
      const y = first.top - el.offsetHeight - 8;
      setStyle({ left: x, top: y < 8 ? (rects[rects.length - 1]?.bottom ?? first.bottom) + 8 : y });
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
    </Layer>
  );
};
