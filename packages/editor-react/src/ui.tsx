// The toolbar's building blocks: buttons that don't take focus from the document, menus and
// popovers positioned against what opened them (fixed, in a layer on `document.body`, so the
// pages' stacking and scrolling don't clip them).

import { ChevronDown } from "lucide-react";
import {
  type CSSProperties,
  createContext,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";
import { type Box, placePopover } from "./place";

/** Keeps focus in the document: a mousedown on a toolbar would blur its input. */
export const keepFocus = (event: { preventDefault(): void }): void => event.preventDefault();

/** Whether shortcuts are the Mac's (⌘, ⌥). */
export const APPLE =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

/** `Mod-Shift-x` as the platform writes it: `Ctrl+Shift+X`, or `⇧⌘X` on Apple's. */
export const shortcutLabel = (shortcut: string | undefined): string | undefined => {
  if (!shortcut) return undefined;
  const parts = shortcut.split("-");
  const key = (parts.pop() ?? "").toUpperCase();
  if (APPLE) {
    const sym: Record<string, string> = { mod: "⌘", shift: "⇧", alt: "⌥", ctrl: "⌃" };
    return parts.map((p) => sym[p.toLowerCase()] ?? p).join("") + key;
  }
  const names: Record<string, string> = { mod: "Ctrl", shift: "Shift", alt: "Alt", ctrl: "Ctrl" };
  return [...parts.map((p) => names[p.toLowerCase()] ?? p), key].join("+");
};

export interface ButtonProps {
  label: string;
  icon?: string;
  active?: boolean;
  disabled?: boolean;
  /** Its shortcut, or a menu's entries' shortcuts, for the tooltip. */
  shortcut?: string | readonly string[];
  onClick?: () => void;
  children?: ReactNode;
  variant?: "primary" | "destructive";
  className?: string;
  /** Opens a popup: `aria-haspopup`, `aria-expanded`. */
  expanded?: boolean;
  /** What it opens (default a menu). */
  popup?: "menu" | "listbox" | "dialog";
  buttonRef?: RefObject<HTMLButtonElement | null>;
}

/** A ghost button with a tooltip that says what it does and its shortcut. */
export const Button = ({
  label,
  icon,
  active,
  disabled,
  shortcut,
  onClick,
  children,
  variant,
  className,
  expanded,
  popup = "menu",
  buttonRef,
}: ButtonProps) => {
  const keys = [shortcut ?? []].flat().map(shortcutLabel).join(", ");
  return (
    <button
      ref={buttonRef}
      type="button"
      className={className ? `tse-button ${className}` : "tse-button"}
      title={keys ? `${label} (${keys})` : label}
      aria-label={children ? undefined : label}
      aria-pressed={active === undefined || expanded !== undefined ? undefined : active}
      aria-haspopup={expanded === undefined ? undefined : popup}
      aria-expanded={expanded}
      // A button that opens a popup isn't a toggle, so it can't be pressed: it is only drawn as on.
      data-active={active && expanded !== undefined ? "" : undefined}
      data-variant={variant}
      disabled={disabled}
      onMouseDown={keepFocus}
      onClick={onClick}
    >
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
};

/** A vertical line between a toolbar's groups. */
export const Separator = () => <hr className="tse-separator" aria-orientation="vertical" />;

/** A layer on `document.body` for popovers: the editor's variables, above the page. */
export const Layer = ({ children }: { children: ReactNode }) =>
  typeof document === "undefined" ? null : createPortal(<div className="tse-layer">{children}</div>, document.body);

/**
 * The pane popovers stay inside: the editor's, from `<TypstEditor>` (a context passes through the
 * portal to the layer). Without one, the window.
 */
export const Bounds = createContext<(() => Box | null) | null>(null);

export interface PopoverProps {
  /** The anchor's rectangle, in client coordinates. */
  anchor: () => Box | null;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  prefer?: "below" | "above";
  /** Elements whose clicks don't close it (its button). */
  ignore?: RefObject<HTMLElement | null>;
  label?: string;
  /** Default a dialog; a menu or a list has its role on the list inside. */
  role?: "dialog" | "presentation";
  /** Placed again after every render: its anchor moves or grows while it is open (a component's form). */
  follow?: boolean;
}

/**
 * Says a popover is open on the toolbar around it, until what it returns is called: the floating
 * toolbar stays while its link field has the focus the document had.
 */
export const Held = createContext<(() => () => void) | null>(null);

/**
 * A button's popup (a menu, a field): whether it is open, and the focus, which goes back where it
 * was when the popup closes (to the document after a click, which leaves the focus there; to the
 * button from the keyboard), so the selection is as it was.
 */
export const usePopup = () => {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const before = useRef<HTMLElement | null>(null);
  const close = useCallback(() => {
    const el = before.current?.isConnected ? before.current : button.current;
    before.current = null;
    el?.focus({ preventScroll: true });
    setOpen(false);
  }, []);
  const toggle = () => {
    if (open) return close();
    const active = button.current?.ownerDocument.activeElement;
    before.current = active instanceof HTMLElement && active !== active.ownerDocument.body ? active : null;
    setOpen(true);
  };
  const anchor = useCallback(() => button.current?.getBoundingClientRect() ?? null, []);
  return { open, button, close, toggle, anchor };
};

/** A popover positioned at `anchor`, closed by Escape or a click outside. */
export const Popover = ({
  anchor,
  onClose,
  children,
  className,
  prefer,
  ignore,
  label,
  role,
  follow,
}: PopoverProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const hold = useContext(Held);
  const bounds = useContext(Bounds);
  useLayoutEffect(() => hold?.(), [hold]);
  // Unplaced until measured, but focusable (a hidden element isn't, and its fields autofocus).
  const [style, setStyle] = useState<CSSProperties>({ opacity: 0, top: 0, left: 0 });
  const placed = useRef("");
  const place = useCallback(() => {
    const a = anchor();
    const el = ref.current;
    if (!a || !el) return;
    const pane = bounds?.() ?? { left: 8, right: window.innerWidth - 8, top: 0, bottom: window.innerHeight };
    // Measured at the width it may take: a menu wider than a narrow editor wraps its entries.
    const maxWidth = Math.max(pane.right - pane.left, 0);
    el.style.maxWidth = `${maxWidth}px`;
    const next = { ...placePopover(a, { width: el.offsetWidth, height: el.offsetHeight }, pane, prefer), maxWidth };
    const key = JSON.stringify(next);
    if (key === placed.current) return;
    placed.current = key;
    setStyle(next);
  }, [anchor, prefer, bounds]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: every render when it follows its anchor
  useLayoutEffect(place, follow ? undefined : [place]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || ignore?.current?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // The popover's alone: not the document's (it would drop the selection), nor a dialog's around the editor.
      e.stopPropagation();
      e.preventDefault();
      onClose();
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [onClose, ignore, place]);
  return (
    <Layer>
      <div
        ref={ref}
        className={className ? `tse-popover ${className}` : "tse-popover"}
        style={style}
        {...(role === "presentation" ? { role } : { role: "dialog", "aria-label": label })}
      >
        {children}
      </div>
    </Layer>
  );
};

/**
 * Scrolls a list's highlighted entry into view once it is drawn: the arrow keys reach past what
 * the popover shows.
 */
export const revealHighlighted = (list: HTMLElement | null): void => {
  requestAnimationFrame(() => list?.querySelector("[data-highlighted]")?.scrollIntoView({ block: "nearest" }));
};

/** An entry of a {@link Menu}. */
export interface MenuEntry {
  key: string;
  label: string;
  description?: string;
  icon?: string;
  active?: boolean;
  disabled?: boolean;
  shortcut?: string;
  group?: string;
  /** A bigger icon in a box, as Plate's insert menu shows them. */
  large?: boolean;
  onSelect: () => void;
}

/** A list of entries, grouped under their group's label, moved through with the arrow keys. */
export const MenuList = ({
  entries,
  highlighted,
  onHighlight,
  label,
}: {
  entries: MenuEntry[];
  highlighted?: number;
  onHighlight?: (i: number) => void;
  label?: string;
}) => {
  let lastGroup: string | undefined;
  return (
    <div role="menu" aria-label={label}>
      {entries.length === 0 && <div className="tse-empty">Nothing found</div>}
      {entries.map((e, i) => {
        const header = e.group && e.group !== lastGroup ? e.group : null;
        lastGroup = e.group;
        return (
          <div key={e.key}>
            {header && <div className="tse-menu-label">{header}</div>}
            <button
              type="button"
              role="menuitem"
              className="tse-menu-item"
              tabIndex={-1}
              data-active={e.active ? "" : undefined}
              data-highlighted={highlighted === i ? "" : undefined}
              disabled={e.disabled}
              onMouseDown={keepFocus}
              onMouseEnter={() => onHighlight?.(i)}
              onClick={e.onSelect}
            >
              {e.icon &&
                (e.large ? (
                  <span className="tse-item-icon">
                    <Icon name={e.icon} />
                  </span>
                ) : (
                  <Icon name={e.icon} />
                ))}
              <span>
                {e.label}
                {e.description && <small>{e.description}</small>}
              </span>
              {e.shortcut && <span className="tse-kbd">{shortcutLabel(e.shortcut)}</span>}
            </button>
          </div>
        );
      })}
    </div>
  );
};

/**
 * A menu with the focus, as WAI-ARIA's menu button opens one: on its ticked entry or its first;
 * the arrows move through its entries (in a grid of `columns`, Left and Right too), Home and End
 * go to its ends, a letter to the next entry starting with it, Tab closes it. Enter and Space
 * press the entry as they press any button. No key reaches the document behind it.
 */
const MenuKeys = ({
  onClose,
  columns = 1,
  children,
}: {
  onClose: () => void;
  columns?: number;
  children: ReactNode;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const items = () => [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
  useLayoutEffect(() => {
    const all = ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [];
    ([...all].find((b) => b.hasAttribute("data-active")) ?? all[0])?.focus({ preventScroll: true });
  }, []);
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const all = items();
    const at = all.indexOf(e.target as HTMLButtonElement);
    const n = all.length;
    let to: number | undefined;
    if (e.key === "Tab") onClose();
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = n - 1;
    else if (e.key === "ArrowDown") to = columns > 1 ? at + columns : (at + 1) % n;
    else if (e.key === "ArrowUp") to = columns > 1 ? at - columns : (at + n - 1) % n;
    else if (e.key === "ArrowRight" && columns > 1) to = (at + 1) % n;
    else if (e.key === "ArrowLeft" && columns > 1) to = (at + n - 1) % n;
    else if (e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const starts = (b: HTMLButtonElement) =>
        (b.getAttribute("aria-label") ?? b.textContent ?? "").trim().toLowerCase().startsWith(e.key.toLowerCase());
      to = [...all.slice(at + 1), ...all.slice(0, at + 1)].findIndex(starts);
      if (to >= 0) to = (to + at + 1) % n;
    } else return;
    all[to ?? -1]?.focus();
    e.preventDefault();
  };
  // The pointer and the keys move one highlight: the focus.
  const onMouseOver = (e: ReactMouseEvent) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button:not(:disabled)");
    if (b && ref.current?.contains(b)) b.focus({ preventScroll: true });
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the keys of the menu's entries inside
    // biome-ignore lint/a11y/useKeyWithMouseEvents: the keys move the focus themselves
    <div ref={ref} onKeyDown={onKeyDown} onMouseOver={onMouseOver}>
      {children}
    </div>
  );
};

/** A button opening a menu of entries. */
export const Menu = ({
  label,
  icon,
  text,
  entries,
  disabled,
  wide,
  shortcut,
}: {
  label: string;
  icon?: string;
  text?: string;
  entries: MenuEntry[];
  disabled?: boolean;
  wide?: boolean;
  /** For its tooltip: its entries' shortcuts. */
  shortcut?: string | readonly string[];
}) => {
  const { open, button, close, toggle, anchor } = usePopup();
  return (
    <>
      <Button
        label={label}
        icon={icon}
        shortcut={shortcut}
        buttonRef={button}
        expanded={open}
        disabled={disabled}
        onClick={toggle}
      >
        {text && <span>{text}</span>}
        <ChevronDown className="tse-chevron" aria-hidden="true" />
      </Button>
      {open && (
        <Popover
          anchor={anchor}
          onClose={close}
          ignore={button}
          role="presentation"
          className={wide ? "tse-wide" : undefined}
        >
          <MenuKeys onClose={close}>
            <MenuList
              label={label}
              entries={entries.map((e) => ({
                ...e,
                onSelect: () => {
                  close();
                  e.onSelect();
                },
              }))}
            />
          </MenuKeys>
        </Popover>
      )}
    </>
  );
};

/** The swatches in a row (the grid's columns in the CSS). */
const SWATCH_COLUMNS = 5;

/** A button opening colour swatches; `none` takes the colour off. */
export const ColorMenu = ({
  label,
  icon,
  value,
  options,
  onSelect,
  disabled,
}: {
  label: string;
  icon?: string;
  value: string | null;
  options: { value: string | null; label: string; swatch?: string }[];
  onSelect: (value: string | null) => void;
  disabled?: boolean;
}) => {
  const { open, button, close, toggle, anchor } = usePopup();
  return (
    <>
      <Button label={label} buttonRef={button} expanded={open} popup="listbox" disabled={disabled} onClick={toggle}>
        <span className="tse-icon-stack">
          <Icon name={icon} />
          <span
            className="tse-swatch-dot"
            style={{ background: value ?? "transparent", outline: value ? undefined : "1px solid currentColor" }}
          />
        </span>
        <ChevronDown className="tse-chevron" aria-hidden="true" />
      </Button>
      {open && (
        <Popover anchor={anchor} onClose={close} ignore={button} role="presentation">
          <MenuKeys onClose={close} columns={SWATCH_COLUMNS}>
            <div className="tse-swatches" role="listbox" aria-label={label}>
              {options.map((o) => (
                <button
                  key={o.label}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={o.value === value}
                  title={o.label}
                  aria-label={o.label}
                  className={o.value === null ? "tse-swatch tse-swatch-none" : "tse-swatch"}
                  data-active={o.value === value ? "" : undefined}
                  style={o.swatch ? { background: o.swatch } : undefined}
                  onMouseDown={keepFocus}
                  onClick={() => {
                    close();
                    onSelect(o.value);
                  }}
                >
                  {o.value === null ? "×" : null}
                </button>
              ))}
            </div>
          </MenuKeys>
        </Popover>
      )}
    </>
  );
};
