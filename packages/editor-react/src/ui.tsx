// The toolbar's building blocks: buttons that don't take focus from the document, menus and
// popovers positioned against what opened them (fixed, in a layer on `document.body`, so the
// pages' stacking and scrolling don't clip them).

import { ChevronDown } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";

/** Keeps focus in the document: a mousedown on a toolbar would blur its input. */
export const keepFocus = (event: { preventDefault(): void }): void => event.preventDefault();

const APPLE = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

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
  shortcut?: string;
  onClick?: () => void;
  children?: ReactNode;
  variant?: "primary" | "destructive";
  className?: string;
  /** Opens a menu: `aria-haspopup`, `aria-expanded`. */
  expanded?: boolean;
  buttonRef?: RefObject<HTMLButtonElement | null>;
}

/** A ghost button with a tooltip that says what it does and its shortcut. */
export const Button = ({ label, icon, active, disabled, shortcut, onClick, children, variant, className, expanded, buttonRef }: ButtonProps) => {
  const keys = shortcutLabel(shortcut);
  return (
    <button
      ref={buttonRef}
      type="button"
      className={className ? `tse-button ${className}` : "tse-button"}
      title={keys ? `${label} (${keys})` : label}
      aria-label={children ? undefined : label}
      aria-pressed={active === undefined || expanded !== undefined ? undefined : active}
      aria-haspopup={expanded === undefined ? undefined : "menu"}
      aria-expanded={expanded}
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

/** Where a popover goes: below its anchor (or above it if the window has no room), kept on screen. */
const placeAt = (anchor: DOMRect, size: { width: number; height: number }, prefer: "below" | "above" = "below"): CSSProperties => {
  const margin = 6;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top = prefer === "below" ? anchor.bottom + margin : anchor.top - size.height - margin;
  if (prefer === "below" && top + size.height > vh - 8 && anchor.top - size.height - margin > 8) top = anchor.top - size.height - margin;
  if (prefer === "above" && top < 8) top = anchor.bottom + margin;
  const left = Math.max(8, Math.min(anchor.left, vw - size.width - 8));
  return { top, left };
};

export interface PopoverProps {
  /** The anchor's rectangle, in client coordinates. */
  anchor: () => DOMRect | null;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  prefer?: "below" | "above";
  /** Elements whose clicks don't close it (its button). */
  ignore?: RefObject<HTMLElement | null>;
  label?: string;
}

/** A popover positioned at `anchor`, closed by Escape or a click outside. */
export const Popover = ({ anchor, onClose, children, className, prefer, ignore, label }: PopoverProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden", top: 0, left: 0 });
  const place = useCallback(() => {
    const a = anchor();
    const el = ref.current;
    if (!a || !el) return;
    setStyle(placeAt(a, { width: el.offsetWidth, height: el.offsetHeight }, prefer));
  }, [anchor, prefer]);
  useLayoutEffect(place, [place]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || ignore?.current?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
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
      <div ref={ref} className={className ? `tse-popover ${className}` : "tse-popover"} style={style} role="dialog" aria-label={label}>
        {children}
      </div>
    </Layer>
  );
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
export const MenuList = ({ entries, highlighted, onHighlight }: { entries: MenuEntry[]; highlighted?: number; onHighlight?: (i: number) => void }) => {
  let lastGroup: string | undefined;
  return (
    <div role="menu">
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
              data-active={e.active ? "" : undefined}
              data-highlighted={highlighted === i ? "" : undefined}
              disabled={e.disabled}
              onMouseDown={keepFocus}
              onMouseEnter={() => onHighlight?.(i)}
              onClick={e.onSelect}
            >
              {e.icon && (e.large ? <span className="tse-item-icon"><Icon name={e.icon} /></span> : <Icon name={e.icon} />)}
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

/** A button opening a menu of entries. */
export const Menu = ({
  label,
  icon,
  text,
  entries,
  disabled,
  wide,
}: {
  label: string;
  icon?: string;
  text?: string;
  entries: MenuEntry[];
  disabled?: boolean;
  wide?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const anchor = useCallback(() => button.current?.getBoundingClientRect() ?? null, []);
  return (
    <>
      <Button label={label} icon={icon} buttonRef={button} expanded={open} disabled={disabled} onClick={() => setOpen((o) => !o)}>
        {text && <span>{text}</span>}
        <ChevronDown className="tse-chevron" aria-hidden="true" />
      </Button>
      {open && (
        <Popover anchor={anchor} onClose={close} ignore={button} label={label} className={wide ? "tse-wide" : undefined}>
          <MenuList
            entries={entries.map((e) => ({
              ...e,
              onSelect: () => {
                setOpen(false);
                e.onSelect();
              },
            }))}
          />
        </Popover>
      )}
    </>
  );
};

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
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const anchor = useCallback(() => button.current?.getBoundingClientRect() ?? null, []);
  return (
    <>
      <Button label={label} buttonRef={button} expanded={open} disabled={disabled} onClick={() => setOpen((o) => !o)}>
        <span className="tse-icon-stack">
          <Icon name={icon} />
          <span className="tse-swatch-dot" style={{ background: value ?? "transparent", outline: value ? undefined : "1px solid currentColor" }} />
        </span>
        <ChevronDown className="tse-chevron" aria-hidden="true" />
      </Button>
      {open && (
        <Popover anchor={anchor} onClose={close} ignore={button} label={label}>
          <div className="tse-swatches" role="listbox" aria-label={label}>
            {options.map((o) => (
              <button
                key={o.label}
                type="button"
                role="option"
                aria-selected={o.value === value}
                title={o.label}
                aria-label={o.label}
                className={o.value === null ? "tse-swatch tse-swatch-none" : "tse-swatch"}
                data-active={o.value === value ? "" : undefined}
                style={o.swatch ? { background: o.swatch } : undefined}
                onMouseDown={keepFocus}
                onClick={() => {
                  setOpen(false);
                  onSelect(o.value);
                }}
              >
                {o.value === null ? "×" : null}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
};
