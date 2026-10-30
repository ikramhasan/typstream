// Small UI pieces shaped like Plate UI's (shadcn/ui): toolbar buttons, dropdown menus and
// popovers on Floating UI (through @platejs/floating, which Plate already brings), so the
// package needs no Radix. Toolbar buttons don't take focus on mousedown, so the editor keeps its
// selection while a mark is toggled.

import {
  autoUpdate,
  flip,
  offset,
  type Placement,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
} from "@platejs/floating";
import { Check, ChevronDown } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

const keepFocus = (event: { preventDefault(): void }) => event.preventDefault();

export interface ToolbarButtonProps {
  label: string;
  /** Shown in the tooltip after the label, e.g. `⌘B`. */
  shortcut?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  /** Show the label next to the icon. */
  showLabel?: boolean;
}

export const ToolbarButton = ({
  label,
  shortcut,
  pressed,
  disabled,
  onClick,
  children,
  className,
  showLabel,
}: ToolbarButtonProps) => (
  <button
    type="button"
    className={`ts-button${className ? ` ${className}` : ""}`}
    aria-label={label}
    title={shortcut ? `${label} (${shortcut})` : label}
    aria-pressed={pressed === undefined ? undefined : pressed}
    disabled={disabled}
    onMouseDown={keepFocus}
    onClick={onClick}
  >
    {children}
    {showLabel ? <span className="ts-button-label">{label}</span> : null}
  </button>
);

export const Separator = () => <hr className="ts-separator" aria-orientation="vertical" />;

/** A popover anchored to an element, closed by Escape or a click outside. */
const usePopover = (placement: Placement = "bottom-start") => {
  const [open, setOpen] = useState(false);
  const floating = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    strategy: "fixed",
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const dismiss = useDismiss(floating.context);
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);
  return { open, setOpen, floating, getReferenceProps, getFloatingProps };
};

export interface MenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  hint?: string;
  checked?: boolean;
  /** Words the slash menu also matches. */
  keywords?: readonly string[];
  onSelect: () => void;
}

export interface MenuGroup {
  label?: string;
  items: MenuItem[];
}

/** A list of grouped items with one active, moved by the arrow keys (the slash menu drives it from outside). */
export const MenuList = ({
  groups,
  active,
  setActive,
  onDone,
  id,
}: {
  groups: MenuGroup[];
  active: number;
  setActive: (index: number) => void;
  onDone: () => void;
  id?: string;
}) => {
  let index = -1;
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  if (total === 0) return <div className="ts-menu-empty">No results</div>;
  return (
    <div role="menu" id={id}>
      {groups.map((group, g) =>
        group.items.length === 0 ? null : (
          // biome-ignore lint/a11y/useSemanticElements: WAI-ARIA's menu pattern groups items with role="group"
          <div key={group.label ?? g} role="group" aria-label={group.label}>
            {g > 0 && group.label ? <div className="ts-menu-separator" /> : null}
            {group.label ? <div className="ts-menu-label">{group.label}</div> : null}
            {group.items.map((item) => {
              index++;
              const i = index;
              return (
                // biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-checked is set only for menuitemcheckbox
                <button
                  key={item.key}
                  type="button"
                  role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                  aria-checked={item.checked}
                  className="ts-menu-item"
                  data-active={i === active}
                  onMouseDown={keepFocus}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => {
                    onDone();
                    item.onSelect();
                  }}
                >
                  {item.icon}
                  {item.hint ? (
                    <span className="ts-menu-item-text">
                      <span>{item.label}</span>
                      <span className="ts-menu-item-hint">{item.hint}</span>
                    </span>
                  ) : (
                    <span>{item.label}</span>
                  )}
                  {item.checked ? <Check className="ts-check" /> : null}
                </button>
              );
            })}
          </div>
        ),
      )}
    </div>
  );
};

/** Moves a menu's active item with the arrow keys and picks it with Enter; true if it handled the key. */
export const menuKeys = (
  event: KeyboardEvent | globalThis.KeyboardEvent,
  groups: MenuGroup[],
  active: number,
  setActive: (i: number) => void,
): boolean => {
  const items = groups.flatMap((g) => g.items);
  if (items.length === 0) return false;
  if (event.key === "ArrowDown") setActive((active + 1) % items.length);
  else if (event.key === "ArrowUp") setActive((active - 1 + items.length) % items.length);
  else if (event.key === "Home") setActive(0);
  else if (event.key === "End") setActive(items.length - 1);
  else if (event.key === "Enter") items[active]?.onSelect();
  else return false;
  event.preventDefault();
  return true;
};

export interface DropdownProps {
  label: string;
  /** What the button shows: an icon, or the current choice's name. */
  trigger: ReactNode;
  groups: MenuGroup[] | (() => MenuGroup[]);
  placement?: Placement;
  /** Show a chevron after the trigger, as Plate UI's dropdown buttons do. */
  chevron?: boolean;
  className?: string;
}

/** A toolbar button that opens a menu. */
export const Dropdown = ({ label, trigger, groups, placement, chevron = true, className }: DropdownProps) => {
  const { open, setOpen, floating, getReferenceProps, getFloatingProps } = usePopover(placement);
  const [active, setActive] = useState(0);
  const id = useId();
  const resolved = useMemo(() => (open ? (typeof groups === "function" ? groups() : groups) : []), [open, groups]);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (open) {
      setActive(0);
      menuRef.current?.focus();
    }
  }, [open]);
  return (
    <>
      <button
        type="button"
        ref={floating.refs.setReference}
        className={`ts-button${className ? ` ${className}` : ""}`}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onMouseDown={keepFocus}
        {...getReferenceProps({ onClick: () => setOpen(!open) })}
      >
        {trigger}
        {chevron ? <ChevronDown className="ts-chevron" /> : null}
      </button>
      {open ? (
        // biome-ignore lint/a11y/noStaticElementInteractions: the menu's arrow keys, Home, End and Enter
        <div
          ref={(node) => {
            floating.refs.setFloating(node);
            menuRef.current = node;
          }}
          className="ts-popover"
          style={floating.floatingStyles}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (menuKeys(event, resolved, active, setActive) && event.key === "Enter") setOpen(false);
          }}
          {...getFloatingProps()}
        >
          <MenuList id={id} groups={resolved} active={active} setActive={setActive} onDone={() => setOpen(false)} />
        </div>
      ) : null}
    </>
  );
};

/** A toolbar button that opens a panel (a form, a palette). */
export const PopoverButton = ({
  label,
  trigger,
  pressed,
  children,
  onOpen,
  placement,
  chevron,
}: {
  label: string;
  trigger: ReactNode;
  pressed?: boolean;
  children: (close: () => void) => ReactNode;
  onOpen?: () => void;
  placement?: Placement;
  chevron?: boolean;
}) => {
  const { open, setOpen, floating, getReferenceProps, getFloatingProps } = usePopover(placement);
  const close = useCallback(() => setOpen(false), [setOpen]);
  return (
    <>
      <button
        type="button"
        ref={floating.refs.setReference}
        className="ts-button"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-pressed={pressed}
        onMouseDown={keepFocus}
        {...getReferenceProps({
          onClick: () => {
            if (!open) onOpen?.();
            setOpen(!open);
          },
        })}
      >
        {trigger}
        {chevron ? <ChevronDown className="ts-chevron" /> : null}
      </button>
      {open ? (
        <div
          ref={floating.refs.setFloating}
          className="ts-popover"
          role="dialog"
          aria-label={label}
          style={floating.floatingStyles}
          {...getFloatingProps()}
        >
          {children(close)}
        </div>
      ) : null}
    </>
  );
};

/** A popover attached to an element of the document (a code block, an equation) rather than a button. */
export const AnchoredPopover = ({
  anchor,
  label,
  onClose,
  children,
  placement = "bottom-start",
}: {
  anchor: RefObject<HTMLElement | null>;
  label: string;
  onClose: () => void;
  children: ReactNode;
  placement?: Placement;
}) => {
  const floating = useFloating({
    open: true,
    onOpenChange: (open) => {
      if (!open) onClose();
    },
    placement,
    strategy: "fixed",
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
    elements: { reference: anchor.current },
  });
  const dismiss = useDismiss(floating.context);
  const { getFloatingProps } = useInteractions([dismiss]);
  return (
    <div
      ref={floating.refs.setFloating}
      className="ts-popover"
      role="dialog"
      aria-label={label}
      contentEditable={false}
      style={floating.floatingStyles}
      {...getFloatingProps()}
    >
      {children}
    </div>
  );
};

/** A text field with Apply and Cancel, for a URL, an equation's math or a block's Typst source. */
export const SourceForm = ({
  label,
  initial,
  multiline,
  placeholder,
  onApply,
  onCancel,
  applyLabel = "Apply",
  extra,
}: {
  label: string;
  initial: string;
  multiline?: boolean;
  placeholder?: string;
  onApply: (value: string) => void;
  onCancel: () => void;
  applyLabel?: string;
  extra?: ReactNode;
}) => {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    } else if (event.key === "Enter" && (!multiline || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onApply(value);
    }
  };
  return (
    <div className="ts-field">
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea
          id={id}
          ref={ref}
          className="ts-textarea"
          value={value}
          spellCheck={false}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
        />
      ) : (
        <input
          id={id}
          ref={ref}
          className="ts-input"
          value={value}
          spellCheck={false}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
        />
      )}
      {extra}
      <div className="ts-field-actions">
        <button type="button" className="ts-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="ts-button ts-button-primary" onClick={() => onApply(value)}>
          {applyLabel}
        </button>
      </div>
    </div>
  );
};

/** Plate UI's text colours, as hex (Typst writes `rgb("#…")`). */
export const COLORS = [
  "#000000",
  "#434343",
  "#666666",
  "#999999",
  "#b7b7b7",
  "#cccccc",
  "#d9d9d9",
  "#efefef",
  "#f3f3f3",
  "#ffffff",
  "#980100",
  "#fe0000",
  "#fe9900",
  "#feff00",
  "#00ff00",
  "#00ffff",
  "#4a86e8",
  "#0000ff",
  "#9900ff",
  "#ff00ff",
  "#e6b8af",
  "#f4cccc",
  "#fce5cd",
  "#fff2cc",
  "#d9ead3",
  "#d0e0e3",
  "#c9daf8",
  "#cfe2f3",
  "#d9d2e9",
  "#ead1dc",
  "#dd7e6b",
  "#ea9999",
  "#f9cb9c",
  "#ffe599",
  "#b6d7a8",
  "#a2c4c9",
  "#a4c2f4",
  "#9fc5e8",
  "#b4a7d6",
  "#d5a6bd",
  "#a61c00",
  "#cc0000",
  "#e69138",
  "#f1c232",
  "#6aa84f",
  "#45818e",
  "#3c78d8",
  "#3d85c6",
  "#674ea7",
  "#a64d79",
];

export const Swatches = ({
  value,
  onPick,
  onClear,
}: {
  value?: string;
  onPick: (color: string) => void;
  onClear: () => void;
}) => (
  <div>
    <div className="ts-swatches">
      {COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className="ts-swatch"
          title={color}
          aria-label={color}
          aria-pressed={value?.toLowerCase() === color}
          style={{ background: color }}
          onMouseDown={keepFocus}
          onClick={() => onPick(color)}
        />
      ))}
    </div>
    <div className="ts-menu-separator" />
    <button type="button" className="ts-menu-item" onMouseDown={keepFocus} onClick={onClear}>
      Clear
    </button>
  </div>
);
