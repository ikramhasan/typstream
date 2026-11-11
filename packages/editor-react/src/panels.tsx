// What shows over a component on the page: a bar with its name, its settings (a form for the
// arguments its plugin lists, so nobody writes Typst) and Delete; for a table, buttons that add and
// remove rows and columns; for an equation, a field for the formula with keys for what is hard to
// type. Positioned from the component's box on the page (`EditorView.boxesOf`), inside the part of
// the window that shows the pages (`paneOf`).

import type { EditorParamSpec, TextEdit } from "@typstream/core";
import {
  addColumn,
  addRow,
  argumentOf,
  type Component,
  type ComponentSpec,
  deleteBlock,
  deleteColumn,
  deleteRow,
  deleteTable,
  type EditorState,
  type EditorView,
  EMPTY_LINE,
  escapeMarkup,
  mapSelection,
  readString,
  type Selection,
  setArgument,
  type Transaction,
  tableAt,
  typstString,
} from "@typstream/editor-core";
import { hasErrors, parse, type SyntaxNode } from "@typstream/syntax";
import { Plus } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Icon } from "./icons";
import { type Box, paneOf, placeBar, placePopover, registerBar, unionOf } from "./place";
import { Button, keepFocus, Layer, Popover } from "./ui";

/**
 * What `measure` says now: measured again after every render (the editor's state or layout
 * changed), on scroll and on resize, and kept while it says the same. `undefined` keeps the last
 * value: the thing is there but has no box yet (an equation emptied to be typed again).
 */
const usePlacement = <T,>(measure: () => T | null | undefined): T | null => {
  const [value, setValue] = useState<T | null>(null);
  const latest = useRef(measure);
  latest.current = measure;
  const last = useRef("null");
  const place = useCallback(() => {
    const next = latest.current();
    if (next === undefined) return;
    const key = JSON.stringify(next);
    if (key === last.current) return;
    last.current = key;
    setValue(next);
  }, []);
  useLayoutEffect(place);
  useEffect(() => {
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [place]);
  return value;
};

/** A component's spec from the plugins, by its function's name. */
export const specOf = (view: EditorView, name: string): ComponentSpec | undefined => {
  for (let i = view.plugins.length - 1; i >= 0; i--) {
    const spec = view.plugins[i]?.components?.find((c) => c.name === name);
    if (spec) return spec;
  }
  return undefined;
};

/** Deletes a component and the line it leaves. */
const remove = (view: EditorView, c: Component) => {
  view.run(deleteBlock(c.from, c.to));
  view.focus();
};

// ---------------------------------------------------------------------------
// Form fields

const NUMBER = /^-?(\d+(\.\d+)?|\.\d+)$/;
const LENGTH = /^(-?)(\d+(?:\.\d+)?|\.\d+)\s*(pt|mm|cm|in|em|%|fr)?$/;
/** A length on the way to one: a number, or a number and the first letter of a unit. */
const LENGTH_PARTIAL = /^-?(\d+\.?\d*|\.\d*)?\s*[pmcief]?$/;
/** Points in a unit (an em at the 11pt the documents are set in), for a size's upper bound. */
const POINTS: Record<string, number> = { pt: 1, mm: 2.835, cm: 28.35, in: 72, em: 11 };
/** The longest size a field writes: 20in, more than any page a worksheet is printed on. */
const MAX_POINTS = 1440;

/** `1,5` as `1.5`, `2,5cm` as `2.5cm`: a decimal comma is a decimal point. */
const decimal = (value: string): string => value.replace(/^(-?\d*),(?=\d*\s*[a-z%]*$)/, "$1.");

/** Whether a number field takes whole numbers only (its step is one). */
const whole = (param: EditorParamSpec): boolean => param.step !== undefined && Number.isInteger(param.step);

/** What a number field asks for, in words. */
const numberHint = (param: EditorParamSpec, max: number | undefined): string => {
  const what = whole(param) ? "A whole number" : "A number";
  if (param.min !== undefined && max !== undefined) return `${what} from ${param.min} to ${max}.`;
  if (param.min !== undefined) return `${what}, ${param.min} or more.`;
  if (max !== undefined) return `${what}, at most ${max}.`;
  return `${what}.`;
};

/** The unit a bare number takes in a length field: its default's, else centimetres. */
const unitOf = (param: EditorParamSpec): string => /(pt|mm|cm|in|em|%|fr)$/.exec(param.default ?? "")?.[1] ?? "cm";

/**
 * What a field's text is as Typst: its `source` (`null` leaves the argument out, its default), or
 * why it can't be written. `partial` says it is on the way to something valid (`-`, `2.`, `2c`):
 * no message yet, and nothing written.
 */
const check = (
  param: EditorParamSpec,
  raw: string,
  max: number | undefined = param.max,
): { source: string | null } | { error: string; partial?: boolean } => {
  if (raw === "") return { source: null };
  switch (param.type) {
    case "number": {
      const value = decimal(raw.trim());
      if (value === "") return { source: null };
      const error = numberHint(param, max);
      if (/^-?\.?$/.test(value) || (!whole(param) && /^-?\d+\.$/.test(value))) return { error, partial: true };
      if (!NUMBER.test(value) || (whole(param) && !/^-?\d+$/.test(value))) return { error };
      const n = Number(value);
      // Out of range (the fifth of three options, negative points): not written.
      if ((param.min !== undefined && n < param.min) || (max !== undefined && n > max)) return { error };
      return { source: value };
    }
    case "length": {
      const value = decimal(raw.trim());
      if (value === "") return { source: null };
      const m = LENGTH.exec(value);
      if (!m) {
        const error = `A size like ${param.default ?? `4${unitOf(param)}`}: a number and cm, mm, em, pt or %.`;
        return LENGTH_PARTIAL.test(value) && !value.startsWith("-") ? { error, partial: true } : { error };
      }
      const n = Number(m[2]);
      if (m[1] === "-" || n === 0) return { error: "More than 0." };
      const unit = m[3] ?? unitOf(param);
      const points = POINTS[unit];
      if (points === undefined ? n > 100 : n * points > MAX_POINTS)
        return { error: `At most ${points === undefined ? 100 : Math.floor(MAX_POINTS / points)}${unit}.` };
      return { source: `${m[2]}${unit}` };
    }
    case "text":
      return { source: typstString(raw) };
    case "content":
      return { source: `[${escapeMarkup(raw)}]` };
    case "color":
      return { source: `rgb("${raw}")` };
    case "list": {
      if (param.item === "number") {
        const value = raw.trim();
        if (value === "") return { source: null };
        if (/^none$/i.test(value)) return { source: "none" };
        const parts = value.split(/[\s,;]+/).filter(Boolean);
        if (parts.some((part) => !NUMBER.test(part))) {
          const error = "Numbers with commas between them: 4, 3, 2, 1.";
          const partial = /^[\d\s,;.-]*$/.test(value) || "none".startsWith(value.toLowerCase());
          return partial ? { error, partial } : { error };
        }
        return { source: `(${parts.join(", ")}${parts.length === 1 ? "," : ""})` };
      }
      const items = raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (items.length === 0) return { source: null };
      return {
        source: `(${items.map((item) => `[${escapeMarkup(item)}]`).join(", ")}${items.length === 1 ? "," : ""})`,
      };
    }
    default:
      return { source: raw };
  }
};

const NOT_ARGUMENTS = new Set(["LeftParen", "RightParen", "Comma", "Space", "LineComment", "BlockComment"]);

/**
 * A list argument's items, as Typst source: `[Good]` and `[Fair]` of `([Good], [Fair])`. `null`
 * when it isn't written as a list of values (`auto`, a variable, a spread).
 */
export const listItems = (source: string): string[] | null => {
  const text = `#${source}`;
  const node = parse(text).children[1];
  if (!node || node.to !== text.length || (node.kind !== "Array" && node.kind !== "Parenthesized")) return null;
  const items = node.children.filter((k) => !NOT_ARGUMENTS.has(k.kind));
  return items.some((k) => k.kind === "Named" || k.kind === "Spread")
    ? null
    : items.map((k) => text.slice(k.from, k.to));
};

/** A list's item as a parameter of its own, for what a content field does with one. */
const itemOf = (param: EditorParamSpec): EditorParamSpec => ({ ...param, type: "content" });

/** What the field shows for an argument's source. */
export const display = (param: EditorParamSpec, source: string | null): string => {
  if (source === null) return "";
  if (param.type === "list") {
    if (source === "auto" || source === "none") return source === "none" && param.item === "number" ? source : "";
    const items = listItems(source);
    if (!items) return source;
    return param.item === "number" ? items.join(", ") : items.map((item) => display(itemOf(param), item)).join("\n");
  }
  if ((param.type === "text" || param.type === "content") && (source === "none" || source === "auto")) return "";
  if (param.type === "text") return readString(source) ?? source;
  if (param.type === "content")
    return source.startsWith("[") && source.endsWith("]")
      ? source.slice(1, -1).replace(/\\(.)/g, "$1")
      : (readString(source) ?? source);
  if (param.type === "color") return /^rgb\("(#[0-9a-fA-F]{6})"\)$/.exec(source)?.[1] ?? source;
  return source;
};

/**
 * The source for what the field holds; `null` leaves the argument out (its default), `undefined`
 * says it isn't something the parameter takes (nothing is written).
 */
export const source = (
  param: EditorParamSpec,
  value: string,
  max: number | undefined = param.max,
): string | null | undefined => {
  const checked = check(param, value, max);
  return "source" in checked ? checked.source : undefined;
};

/** Markup a text field can show and write back as it is: words, spaces, escaped characters. */
const PLAIN_KINDS = new Set(["Text", "Space", "Escape", "SmartQuote", "Shorthand", "Parbreak"]);

/**
 * Whether an argument is more than a field's plain text: a formula (`ce("H2O")`), formatting
 * (`[*two* moles]`), an equation. Typing over it would flatten it, so the form shows it read-only.
 */
export const isRich = (param: EditorParamSpec, source: string | null): boolean => {
  if (param.type === "list") {
    if (source === null || source === "none" || source === "auto") return false;
    const items = listItems(source);
    if (!items) return true;
    return items.some((item) => (param.item === "number" ? !NUMBER.test(item) : isRich(itemOf(param), item)));
  }
  if (source === null || (param.type !== "text" && param.type !== "content")) return false;
  if (source === "none" || source === "auto" || readString(source) !== null) return false;
  if (param.type === "text" || !source.startsWith("[") || !source.endsWith("]")) return true;
  const inner = source.slice(1, -1);
  return parse(inner).children.some(
    (k) =>
      !PLAIN_KINDS.has(k.kind) ||
      (k.kind === "Escape" && k.to - k.from !== 2) ||
      (k.kind === "Shorthand" && inner.slice(k.from, k.to) === "~"),
  );
};

/** What a teacher reads in a rich argument: its words, without the Typst around them. */
const READ_KINDS = new Set(["Text", "Space", "Str", "Escape", "SmartQuote", "Shorthand", "MathText", "Int", "Float"]);
export const plainText = (source: string): string => {
  const text = source.startsWith("[") && source.endsWith("]") ? source.slice(1, -1) : `#${source}`;
  let out = "";
  const visit = (node: SyntaxNode) => {
    if (node.children.length) {
      for (const k of node.children) visit(k);
      return;
    }
    if (!READ_KINDS.has(node.kind)) return;
    const leaf = text.slice(node.from, node.to);
    out += node.kind === "Str" ? (readString(leaf) ?? "") : node.kind === "Escape" ? leaf.slice(1) : leaf;
  };
  visit(parse(text));
  return out.replace(/\s+/g, " ").trim();
};

const Field = ({
  param,
  value,
  read,
  max = param.max,
  onChange,
}: {
  param: EditorParamSpec;
  /** The argument's source at this render. */
  value: string | null;
  /** The argument's source now, in the editor's state (a render may be a frame behind it). */
  read: () => string | null;
  max?: number;
  onChange: (source: string | null) => void;
}) => {
  const shown = display(param, value);
  const [draft, setDraft] = useState(shown);
  const [error, setError] = useState<string | null>(null);
  /** Being typed in: the draft is the teacher's, and `good` what the argument was before. */
  const typing = useRef(false);
  const good = useRef<string | null>(value);
  // An undo or another change from outside: the field follows, unless it is being typed in.
  useEffect(() => {
    if (typing.current) return;
    setDraft(shown);
    setError(null);
  }, [shown]);
  /**
   * What is typed: written when the parameter takes it; left alone while it is on the way to
   * something it takes (`2c` of `2cm`); and when it takes it not (`2.5` columns, `31` lines of 30),
   * the argument goes back to what it was before the typing, with a line saying what fits.
   */
  const commit = (v: string) => {
    if (!typing.current) {
      typing.current = true;
      good.current = read();
    }
    setDraft(v);
    const checked = check(param, v, max);
    if ("source" in checked) {
      setError(null);
      if (checked.source !== read()) onChange(checked.source);
      return;
    }
    setError(checked.partial ? null : checked.error);
    if (!checked.partial && read() !== good.current) onChange(good.current);
  };
  const settle = () => {
    typing.current = false;
    setDraft(display(param, read()));
    setError(null);
  };
  const placeholder = param.default ? `${display(param, param.default)} (default)` : undefined;
  if (param.type === "boolean")
    return (
      <label className="tse-field-row">
        <input
          type="checkbox"
          checked={(value ?? param.default) === "true"}
          onChange={(e) => onChange(e.target.checked ? "true" : "false")}
        />
        {param.label}
      </label>
    );
  // A formula or formatted text: shown as its words, not typed over (that would flatten it).
  if (isRich(param, value))
    return (
      <div className="tse-field">
        <label className="tse-field">
          {param.label}
          <textarea readOnly value={plainText(value ?? "")} />
        </label>
        <small>This has a formula or formatting, so it can't be changed here.</small>
        <span className="tse-actions">
          <button
            type="button"
            className="tse-button"
            onClick={(e) => {
              const fields = e.currentTarget.closest(".tse-field");
              onChange(null);
              // The plain field that takes its place.
              requestAnimationFrame(() =>
                fields?.parentElement?.querySelector<HTMLElement>("textarea, input")?.focus(),
              );
            }}
          >
            Write it again as plain text
          </button>
        </span>
      </div>
    );
  let input: ReactNode;
  let help = param.help;
  if (param.type === "choice")
    input = (
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}>
        <option value="">
          {param.default
            ? `${param.options?.find((o) => o.value === param.default)?.label ?? param.default} (default)`
            : "Default"}
        </option>
        {param.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  else if (param.type === "color")
    input = <input type="color" value={draft || "#000000"} onChange={(e) => commit(e.target.value)} />;
  else if (param.type === "content" || (param.type === "list" && param.item !== "number")) {
    if (param.type === "list") help ??= "One on each line.";
    input = (
      <textarea
        value={draft}
        rows={param.type === "list" ? 4 : undefined}
        placeholder={placeholder}
        onChange={(e) => commit(e.target.value)}
        onBlur={settle}
      />
    );
  } else {
    const number = param.type === "number";
    if (param.type === "length")
      help ??= `A number and a unit: cm, mm, em, pt or %. A number alone is in ${unitOf(param)}.`;
    if (param.type === "list") help ??= "Numbers with commas between them.";
    /** Up and Down step a number, as a number field's arrows do. */
    const step = (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (!number || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      const from = Number(decimal(draft.trim()) || param.default || param.min || 0);
      if (Number.isNaN(from)) return;
      e.preventDefault();
      let to = from + (e.key === "ArrowUp" ? 1 : -1) * (param.step ?? 1);
      if (param.min !== undefined) to = Math.max(to, param.min);
      if (max !== undefined) to = Math.min(to, max);
      commit(String(Number(to.toFixed(6))));
    };
    input = (
      <input
        type="text"
        inputMode={number ? (whole(param) ? "numeric" : "decimal") : undefined}
        autoComplete="off"
        value={draft}
        placeholder={placeholder}
        aria-invalid={error !== null || undefined}
        onChange={(e) => commit(e.target.value)}
        onKeyDown={step}
        onBlur={settle}
      />
    );
  }
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is `input`, a field of the kind above
    <label className="tse-field">
      {param.label}
      {input}
      {error !== null ? (
        <small className="tse-invalid" role="alert">
          {error}
        </small>
      ) : (
        help && <small>{help}</small>
      )}
    </label>
  );
};

/** A call's positional arguments, in order (a multiple choice's options, a formula's text). */
const positionals = (component: Component): SyntaxNode[] => {
  const args = component.call.children.find((k) => k.kind === "Args");
  return args?.children.filter((k) => !NOT_ARGUMENTS.has(k.kind) && k.kind !== "Named") ?? [];
};

/** A parameter named by a number is the positional argument at that index (`0`: the first). */
const positionOf = (param: EditorParamSpec): number | null => (/^\d+$/.test(param.name) ? Number(param.name) : null);

/** A parameter's argument in the call, as Typst source; `null` when the call doesn't write it. */
const argumentIn = (state: EditorState, component: Component, param: EditorParamSpec): string | null => {
  const index = positionOf(param);
  if (index === null) return argumentOf(state, component, param.name);
  const node = positionals(component)[index];
  return node ? state.text.slice(node.from, node.to) : null;
};

/** The selection after an edit inside the component it is on or in: a selected component stays selected. */
const keep = (s: Selection, edit: TextEdit): Selection =>
  s.node
    ? {
        anchor: Math.min(s.anchor, s.head),
        head: Math.max(s.anchor, s.head) + edit.insert.length - (edit.to - edit.from),
        node: true,
      }
    : mapSelection(s, [edit]);

/**
 * A list that heads the columns of the component's rows (`columnsFrom`: a rubric's levels) set to
 * `value`: each row gets an empty cell for every column it lacks, where a caret can go, and loses
 * the empty ones past the last column. Cells with text stay (the function shows as many as it has
 * columns).
 */
const columnEdits = (
  state: EditorState,
  component: Component,
  param: EditorParamSpec,
  value: string | null,
): TextEdit[] => {
  const count = param.columnsFrom === undefined ? undefined : listItems(value ?? param.default ?? "")?.length;
  if (param.columnsFrom === undefined || !count) return [];
  const want = Math.max(param.columnsFrom + count, 2);
  const edits: TextEdit[] = [];
  for (const row of positionals(component)) {
    if (row.kind !== "Array") continue;
    const cells = row.children.filter((k) => !NOT_ARGUMENTS.has(k.kind));
    const last = cells[cells.length - 1];
    if (!last) continue;
    if (cells.length < want) {
      edits.push({ from: last.to, to: last.to, insert: `, [${EMPTY_LINE}]`.repeat(want - cells.length) });
      continue;
    }
    let keep = cells.length;
    const empty = (cell: SyntaxNode) => /^\[\s*~?\s*\]$/.test(state.text.slice(cell.from, cell.to));
    while (keep > want && empty(cells[keep - 1] as SyntaxNode)) keep--;
    if (keep < cells.length) edits.push({ from: (cells[keep - 1] as SyntaxNode).to, to: last.to, insert: "" });
  }
  return edits;
};

/**
 * Sets a parameter's argument to `value` (Typst source); `null` takes a named one out, and leaves
 * a positional one empty (`""`: the others keep their places).
 */
export const setValue =
  (component: Component, param: EditorParamSpec, value: string | null) =>
  (state: EditorState): Transaction | null => {
    const index = positionOf(param);
    if (index === null) {
      const tr = setArgument(component, param.name, value)(state);
      const cells = columnEdits(state, component, param, value);
      if (!tr || cells.length === 0) return tr;
      // The argument and the rows' cells in one step.
      const edits = [...tr.edits, ...cells].sort((a, b) => a.from - b.from);
      const s = state.selection;
      const grown = edits.reduce((d, e) => d + e.insert.length - (e.to - e.from), 0);
      return {
        edits,
        selection: s.node
          ? { anchor: Math.min(s.anchor, s.head), head: Math.max(s.anchor, s.head) + grown, node: true }
          : mapSelection(s, edits),
      };
    }
    const written = value ?? (param.type === "content" ? "[]" : '""');
    const node = positionals(component)[index];
    let edit: TextEdit;
    if (node) edit = { from: node.from, to: node.to, insert: written };
    else {
      // The first argument of a call that has none yet: after its `(`.
      const args = component.call.children.find((k) => k.kind === "Args");
      const open = args?.children.find((k) => k.kind === "LeftParen");
      if (!open || index !== 0) return null;
      const rest = args?.children.some((k) => k.kind === "Named");
      edit = { from: open.to, to: open.to, insert: rest ? `${written}, ` : written };
    }
    return { edits: [edit], selection: keep(state.selection, edit) };
  };

/** The form of a component's arguments. */
export const ComponentForm = ({
  view,
  component,
  spec,
}: {
  view: EditorView;
  component: Component;
  spec: ComponentSpec;
}) => {
  // The component as the state has it now (an edit before moved it).
  const current = () => view.components()[0] ?? component;
  return (
    <>
      {(spec.params ?? []).map((param) => (
        <Field
          key={param.name}
          param={param}
          max={param.maxPositional ? positionals(component).length : param.max}
          value={argumentIn(view.state, component, param)}
          read={() => argumentIn(view.state, current(), param)}
          onChange={(value) => {
            const tr = setValue(current(), param, value)(view.state);
            if (tr) view.dispatch(tr);
          }}
        />
      ))}
    </>
  );
};

/** A form's controls, in Tab order. */
const controlsIn = (el: Element | null): HTMLElement[] => [
  ...(el?.querySelectorAll<HTMLElement>("input, select, textarea:not([readonly]), button") ?? []),
];

/**
 * The settings form in its popover: the keyboard starts in its first field (its text selected, to
 * type over), Enter in a one-line field and Tab past its ends close it, back to the document.
 */
const SettingsForm = ({ view, onClose, children }: { view: EditorView; onClose: () => void; children: ReactNode }) => {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const all = controlsIn(ref.current);
    // A field before a button: one that only says what it holds (a formula) has a button first.
    const first = all.find((el) => !(el instanceof HTMLButtonElement)) ?? all[0];
    first?.focus({ preventScroll: true });
    if (first instanceof HTMLInputElement && first.type === "text") first.select();
  }, []);
  const done = () => {
    onClose();
    view.focus();
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (e.key === "Enter" && target instanceof HTMLInputElement) {
      e.preventDefault();
      done();
    } else if (e.key === "Tab") {
      const all = controlsIn(ref.current);
      if (target !== (e.shiftKey ? all[0] : all[all.length - 1])) return;
      e.preventDefault();
      done();
    }
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the keys of the fields inside
    <div
      ref={ref}
      className="tse-panel"
      style={{ position: "static", width: "auto", boxShadow: "none", border: 0, padding: 4, animation: "none" }}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
};

// ---------------------------------------------------------------------------
// The bar by a component

/**
 * The component at the selection's controls: its name as a teacher says it, settings, table
 * buttons, Delete. By its component on the page: above it, below it where there is no room above,
 * inside the pane; gone while its component is scrolled out of view.
 */
export const ComponentBar = ({ view }: { view: EditorView }) => {
  const component = view.components()[0] ?? null;
  const spec = component ? specOf(view, component.name) : undefined;
  const [settings, setSettings] = useState(false);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const closeSettings = useCallback(() => setSettings(false), []);
  const key = component ? `${component.name}@${component.from}` : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: another component closes the form
  useEffect(() => setSettings(false), [key]);
  /** Where the bar goes now, from the view as it is. */
  const measure = useCallback(() => {
    const c = view.components()[0];
    const el = bar.current;
    if (!c || !el) return null;
    const box = unionOf(view.boxesOf(c.from, c.to));
    if (!box) return undefined;
    const pane = paneOf(view);
    // Measured at the width it may take: a table's bar wraps in an editor narrower than its row.
    const maxWidth = Math.max(pane.right - pane.left, 0);
    el.style.maxWidth = `${maxWidth}px`;
    const size = { width: el.offsetWidth, height: el.offsetHeight };
    return { ...placeBar(box, size, pane), ...size, maxWidth };
  }, [view]);
  const placed = usePlacement(measure);
  // What must stay clear of the bar (the floating toolbar) asks where it is, whichever is placed first.
  useLayoutEffect(
    () =>
      registerBar(view, () => {
        const at = measure();
        return at && !at.hidden
          ? { left: at.left, top: at.top, right: at.left + at.width, bottom: at.top + at.height }
          : null;
      }),
    [view, measure],
  );
  // The form by the component, not over it: under it, or above the bar where there is no room under.
  const settingsAnchor = useCallback((): Box | null => {
    const c = view.components()[0];
    const at = bar.current?.getBoundingClientRect();
    return unionOf([...(c ? view.boxesOf(c.from, c.to) : []), ...(at ? [at] : [])]);
  }, [view]);
  if (!component) return null;
  const table = spec?.controls === "table" ? tableAt(view.state, view.state.selection.head, view.schema) : null;
  const run = (command: Parameters<EditorView["run"]>[0]) => {
    view.run(command);
    view.focus();
  };
  // The teacher's name for it; never the Typst function's.
  const label = spec?.label ?? "Component";
  const shown = placed && !placed.hidden;
  const style: CSSProperties = shown
    ? { left: placed.left, top: placed.top, maxWidth: placed.maxWidth }
    : { left: 0, top: 0, visibility: "hidden" };
  return (
    <Layer>
      <div ref={bar} className="tse-toolbar tse-bar" role="toolbar" aria-label={label} style={style}>
        <span className="tse-panel-title" style={{ padding: "0 6px" }}>
          <Icon name={spec?.icon ?? "square"} />
          {label}
        </span>
        {spec?.params?.length ? (
          <Button
            label="Settings"
            buttonRef={settingsButton}
            expanded={settings}
            popup="dialog"
            onClick={() => setSettings((s) => !s)}
          >
            Settings
          </Button>
        ) : null}
        {table && (
          <>
            <hr className="tse-separator" />
            <Button label="Add a row above" icon="arrow-up-to-line" onClick={() => run(addRow("above"))} />
            <Button label="Add a row below" icon="arrow-down-to-line" onClick={() => run(addRow("below"))} />
            <Button label="Add a column left" icon="arrow-left-to-line" onClick={() => run(addColumn("left"))} />
            <Button label="Add a column right" icon="arrow-right-to-line" onClick={() => run(addColumn("right"))} />
            <hr className="tse-separator" />
            <Button label="Delete the row" icon="rows" variant="destructive" onClick={() => run(deleteRow)} />
            <Button label="Delete the column" icon="columns" variant="destructive" onClick={() => run(deleteColumn)} />
          </>
        )}
        <hr className="tse-separator" />
        <Button
          label={`Delete the ${label.toLowerCase()}`}
          icon="trash"
          variant="destructive"
          onClick={() => (table ? run(deleteTable) : remove(view, component))}
        />
      </div>
      {settings && spec && shown && (
        <Popover
          anchor={settingsAnchor}
          onClose={closeSettings}
          ignore={settingsButton}
          label={`${label} settings`}
          className="tse-form"
          follow
        >
          <SettingsForm view={view} onClose={closeSettings}>
            <ComponentForm view={view} component={component} spec={spec} />
          </SettingsForm>
        </Popover>
      )}
      {table && shown && <TableEdges view={view} />}
    </Layer>
  );
};

/** ➕ at a table's bottom and right edges: a row after the last, a column after the last. */
const TableEdges = ({ view }: { view: EditorView }) => {
  const table = tableAt(view.state, view.state.selection.head, view.schema);
  const at = usePlacement(() => {
    if (!table) return null;
    // The table as it is drawn: its cells' box, not the line it stands on.
    const box = unionOf(view.boxesOf(table.from, table.to));
    if (!box) return null;
    const pane = paneOf(view);
    // Smaller in a narrow editor, where a full-size one covers a cell's text.
    const size = pane.right - pane.left < 420 ? 16 : 20;
    const inPane = (left: number, top: number) =>
      top >= pane.top && top + size <= pane.bottom && left >= pane.left - size && left + size <= pane.right + size;
    // On the table's bottom and right borders, not over the text after it.
    const row = { left: (box.left + box.right) / 2 - size / 2, top: box.bottom - size / 2 };
    const column = { left: box.right - size / 2, top: (box.top + box.bottom) / 2 - size / 2 };
    return {
      size,
      row: inPane(row.left, row.top) ? row : null,
      column: inPane(column.left, column.top) ? column : null,
    };
  });
  if (!table || !at) return null;
  const inLast = (row: number, column: number) => {
    const cell = table.ranges[row]?.[column];
    if (cell) view.select({ anchor: cell.from + 1, head: cell.from + 1 });
  };
  const edge = (label: string, place: { left: number; top: number } | null, add: () => void) =>
    place && (
      <button
        type="button"
        className="tse-edge"
        title={label}
        aria-label={label}
        style={{ ...place, width: at.size, height: at.size }}
        onMouseDown={keepFocus}
        onClick={() => {
          add();
          view.focus();
        }}
      >
        <Plus aria-hidden="true" />
      </button>
    );
  return (
    <>
      {edge("Add a row", at.row, () => {
        inLast(table.cells.length - 1, 0);
        view.run(addRow("below"));
      })}
      {edge("Add a column", at.column, () => {
        inLast(0, table.columns - 1);
        view.run(addColumn("right"));
      })}
    </>
  );
};

// ---------------------------------------------------------------------------
// Equations

/** Keys for what is hard to type in a formula, as Typst's math writes it. */
const MATH_KEYS: { label: string; insert: string; title: string }[] = [
  { label: "a/b", insert: "(a)/(b)", title: "Fraction" },
  { label: "√", insert: "sqrt(x)", title: "Square root" },
  { label: "xⁿ", insert: "x^(n)", title: "Power" },
  { label: "xₙ", insert: "x_(n)", title: "Subscript" },
  { label: "π", insert: "pi", title: "Pi" },
  { label: "θ", insert: "theta", title: "Theta" },
  { label: "α", insert: "alpha", title: "Alpha" },
  { label: "×", insert: "times", title: "Times" },
  { label: "÷", insert: "div", title: "Divided by" },
  { label: "±", insert: "plus.minus", title: "Plus or minus" },
  { label: "≤", insert: "<=", title: "Less or equal" },
  { label: "≥", insert: ">=", title: "Greater or equal" },
  { label: "≠", insert: "!=", title: "Not equal" },
  { label: "∞", insert: "infinity", title: "Infinity" },
  { label: "∑", insert: "sum_(i=1)^n", title: "Sum" },
  { label: "∫", insert: "integral_a^b", title: "Integral" },
  { label: "°", insert: "degree", title: "Degrees" },
  { label: "→", insert: "->", title: "Arrow" },
];

/**
 * Words math knows, shown on the page as soon as they are typed. Any other word waits for what
 * comes after it: `sq` on the way to `sqrt(2)` isn't one, and would be an error on the page.
 */
const MATH_WORDS = new Set(
  (
    "pi theta alpha beta gamma delta epsilon lambda mu sigma omega phi rho tau times div dot plus.minus infinity " +
    "sum integral degree sqrt root frac sin cos tan log ln lim max min mod vec abs binom approx angle"
  ).split(" "),
);

/**
 * Words the compiler didn't know in math: written as text or letters when they are typed again,
 * before it says so. And `at`, which it knows as @: no formula means that (`v = u + at`).
 */
const UNKNOWN_WORDS = new Set<string>(["at"]);

const UNKNOWN = /unknown variable: ([\p{L}_][\p{L}\p{N}_-]*)/u;

/**
 * Where a word of math starts: not in a longer one (`x2ab` is one word; in `2ab`, `ab` is), not
 * after a quote, and not as a symbol's part (`plus.minus`; `x.foo` is `x`, a dot and `foo`).
 */
const WORD_START = '(?<!\\p{L}\\p{N}*|"|[\\p{L}\\p{N}]{2}\\.)';
/** Where it ends: `_` and `^` end a word (`CO_2` is `CO` with a subscript), letters and digits don't. */
const WORD_END = '(?![\\p{L}\\p{N}"])';
const QUOTED = '"(?:[^"\\\\]|\\\\.)*"';

/**
 * Short words that are text, not letters multiplied: units, the words of a sentence, and the
 * molecules whose letters are both capitals.
 */
const SHORT_TEXT = new Set(
  (
    "km cm mm dm kg mg ml ms hr ft lb oz yd mi if is of to on so no vs CO NO OH HF CN SO PO NH CH " +
    "mph kph rpm pts hrs yrs lbs cms kms nth gcf hcf"
  ).split(" "),
);

/**
 * How a word math doesn't know is written. Letters a formula multiplies are set apart, as Typst
 * wants them (`mx` of `y = mx + b`, `IR`, `mgh`: two letters of one case, or three without a
 * vowel; `x2` is `x 2`); anything else is text, in quotes (`speed`, `km`, `Na`).
 */
const written = (word: string): string => {
  const numbered = /^([A-Za-z])(\d+)$/.exec(word);
  if (numbered) return `${numbered[1]} ${numbered[2]}`;
  const letters = /^([a-z]{2}|[A-Z]{2})$/.test(word) || (/^[A-Za-z]{3}$/.test(word) && !/[aeiou]/i.test(word));
  return letters && !SHORT_TEXT.has(word) ? [...word].join(" ") : `"${word}"`;
};

/**
 * `math` with the words the compiler doesn't know in math (`unknown variable: area`) written so
 * that it does: as text, quoted (`area = length times width` → `"area" = "length" times "width"`),
 * or as the letters they multiply (`2mx + b` → `2m x + b`). The word being typed waits. `done` is
 * `true` once typing is over (every word is written), `false` while it goes on at the end, or the
 * caret's offset in `math` (the word there waits).
 */
export const quoteUnknown = (math: string, errors: readonly string[], done: boolean | number): string => {
  const caret = typeof done === "number" ? done : done ? -1 : math.length;
  let out = math;
  let at = caret;
  for (const message of errors) {
    const word = UNKNOWN.exec(message)?.[1];
    if (!word || word.length < 2) continue;
    // What is in quotes already is text: matched first, and left as it is.
    const bare = new RegExp(`${QUOTED}|${WORD_START}${word}${WORD_END}`, "gu");
    const as = written(word);
    let shift = 0;
    out = out.replace(bare, (m: string, start: number) => {
      const end = start + m.length;
      // The word the caret is in or just after is still being typed.
      if (m !== word || (at > start && at <= end)) return m;
      if (end <= at) shift += as.length - word.length;
      return as;
    });
    at += shift;
  }
  return out;
};

/** Whether `word` is still in `math` as math, outside its quoted text: it couldn't be written as text. */
const stillBare = (math: string, word: string): boolean =>
  new RegExp(`${WORD_START}${word}${WORD_END}`, "u").test(math.replace(new RegExp(QUOTED, "g"), '""'));

/**
 * The word being typed at `caret` that math may not know yet (`sq` of `sqrt`) and where it is;
 * `null` for none.
 */
const typedWord = (math: string, caret: number): { word: string; from: number; to: number } | null => {
  const before = /[\p{L}][\p{L}\p{N}.]*$/u.exec(math.slice(0, caret))?.[0] ?? "";
  if (before === "" || math[caret - before.length - 1] === '"') return null;
  const word = before + (/^[\p{L}\p{N}.]*/u.exec(math.slice(caret))?.[0] ?? "");
  if (word.length < 2 || MATH_WORDS.has(word)) return null;
  return { word, from: caret - before.length, to: caret - before.length + word.length };
};

/**
 * `math` as the page shows it while the word at `caret` is being typed: that word as it would be
 * written if it ended there (text, or letters apart), until it is one math knows (`sq`, `sqr`, then
 * `sqrt` is the root), so the page has neither an error nor a formula without it.
 */
export const whileTyping = (math: string, caret: number): string => {
  const typed = typedWord(math, caret);
  return typed ? `${math.slice(0, typed.from)}${written(typed.word)}${math.slice(typed.to)}` : math;
};

/** Why a formula can't go on the page as it is, for the teacher; `null` when it can. */
export const formulaProblem = (math: string): string | null => {
  // LaTeX, which Typst's math isn't: `\frac{1}{2}` would be an error about "rac".
  if (/\\[A-Za-z]/.test(math)) return "No backslashes here: write a/b for a fraction, sqrt(x) for a root.";
  if (!hasErrors(parse(`$${math.trim()}$`))) return null;
  const bare = math.replace(/\\.|"(?:[^"\\]|\\.)*"/g, "");
  if (bare.includes('"')) return "A quote isn't closed.";
  const open = (bare.match(/[([{]/g)?.length ?? 0) - (bare.match(/[)\]}]/g)?.length ?? 0);
  if (open > 0) return "A bracket isn't closed.";
  return "Something is missing at the end.";
};

/** What the compiler said about a formula, as the panel says it. */
const explain = (error: string): string => {
  if (/missing argument/.test(error)) return "Something is missing inside the brackets.";
  if (/unexpected argument/.test(error)) return "There is one thing too many inside the brackets.";
  if (UNKNOWN.test(error)) return 'A word here isn\'t one math knows. Put it in "quotes" to show it as text.';
  return "This formula can't be shown as it is.";
};

/** The equation selected (`$…$` as a node), its formula and whether it is set on its own line. */
const equationAt = (view: EditorView): { from: number; to: number; math: string; display: boolean } | null => {
  const { selection, text } = { selection: view.state.selection, text: view.state.text };
  if (!selection.node) return null;
  const from = Math.min(selection.anchor, selection.head);
  const to = Math.max(selection.anchor, selection.head);
  const src = text.slice(from, to);
  if (!src.startsWith("$") || !src.endsWith("$") || src.length < 2) return null;
  const inner = src.slice(1, -1);
  return { from, to, math: inner.trim(), display: /^\s/.test(inner) && /\s$/.test(inner) };
};

const equationSource = (math: string, display: boolean): string =>
  display ? `$ ${math.trim()} $` : `$${math.trim()}$`;

/** What the panel keeps about the equation it is open on, between renders. */
interface EquationSession {
  key: string | null;
  /** Where the equation is, and its source, as last seen. */
  from: number;
  src: string;
  /** The formula the document has, as the panel last wrote or read it. */
  wrote: string;
  /** The field's text now (the render's may be a keystroke behind). */
  draft: string;
  /** The document's errors when the panel opened: not this formula's. */
  baseline: readonly string[];
  /** The last formula the page showed without a new error, to go back to. */
  good: string | null;
  /** A draft the compiler refused: not written again. */
  rejected: string | null;
  /** The field's own undo: drafts before and after this one. */
  past: string[];
  future: string[];
  stamp: number;
  /** The field's undo or redo was used: past its ends there is nothing, not the document's. */
  stepped: boolean;
  /** The panel's left edge, kept while it is open (the equation moves as it is typed). */
  left: number | null;
  /** The caret to put in the field once it shows the draft. */
  caret: number | null;
  /** The field wants the keyboard (a new equation), its text selected. */
  select: boolean;
  /** The keyboard is in the panel. */
  focused: boolean;
}

/** How long a burst of typing in the field is one undo step (ms between keys). */
const BURST_MS = 700;

/**
 * A field for the selected equation's formula, under it on the page. What is typed goes onto the
 * page when it is a formula the page can show: an unfinished one (an open bracket, a word half
 * typed) waits in the field, and the page keeps the last one that worked.
 */
export const EquationPanel = ({ view }: { view: EditorView }) => {
  const eq = equationAt(view);
  const [draft, setDraft] = useState(eq?.math ?? "");
  /** What is wrong, said when Done is asked for or the compiler refused the formula. */
  const [message, setMessage] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const key = eq ? `${eq.from}` : null;
  const s = useRef<EquationSession>({
    key: null,
    from: 0,
    src: "",
    wrote: "",
    draft: "",
    baseline: [],
    good: null,
    rejected: null,
    past: [],
    future: [],
    stamp: 0,
    stepped: false,
    left: null,
    caret: null,
    select: false,
    focused: false,
  }).current;
  /** An equation the panel left, whose last word the compiler hasn't seen yet. */
  const pending = useRef<{ from: number; src: string; until: number } | null>(null);
  const lastText = useRef(view.state.text);

  /** Writes a formula into the document, if it parses; the equation stays selected. */
  const edit = (math: string, display: boolean) => {
    // The equation as the state has it now: a write before this one may have moved its end.
    const now = equationAt(view);
    if (!now) return;
    const src = equationSource(math, display);
    if (hasErrors(parse(src))) return;
    s.wrote = math.trim();
    if (view.state.text.slice(now.from, now.to) === src) return;
    view.dispatch({
      edits: [{ from: now.from, to: now.to, insert: src }],
      selection: { anchor: now.from, head: now.from + src.length, node: true },
    });
  };

  /**
   * The field's formula becomes `next`, and the page's too when it can show it: not while a
   * bracket is open. A word being typed at `caret` is text on the page until it is finished
   * (`force` writes it as it is: a key's `pi`).
   */
  const set = (
    next: string,
    o: { caret?: number; force?: boolean; step?: boolean; burst?: boolean; display?: boolean } = {},
  ) => {
    let caret = o.caret ?? next.length;
    // Words known to be unknown are text: quoted before the compiler has to say so again.
    const known = [...UNKNOWN_WORDS].map((w) => `unknown variable: ${w}`);
    const quoted = quoteUnknown(next, known, caret);
    if (quoted !== next) {
      caret = quoteUnknown(next.slice(0, caret), known, caret).length;
      s.caret = caret;
    }
    if (o.step !== false && quoted !== s.draft) {
      const now = Date.now();
      if (o.burst === false || now - s.stamp > BURST_MS) s.past.push(s.draft);
      if (s.past.length > 100) s.past.shift();
      s.stamp = o.burst === false ? 0 : now;
      s.future = [];
    }
    s.draft = quoted;
    s.rejected = null;
    setDraft(quoted);
    setMessage(null);
    if (quoted.trim() === "" || formulaProblem(quoted)) return;
    edit(o.force ? quoted : whileTyping(quoted, caret), o.display ?? equationAt(view)?.display ?? false);
  };

  /**
   * The field's Undo and Redo: its own drafts. With none (nothing typed here yet) the document's;
   * but not past the ends of its own, where the document's would bring back what it just undid.
   */
  const step = (from: string[], to: string[], fallback: () => void) => {
    const next = from.pop();
    if (next === undefined) {
      if (!s.stepped && to.length === 0) fallback();
      return;
    }
    to.push(s.draft);
    s.stamp = 0;
    s.stepped = true;
    set(next, { step: false });
  };

  /**
   * Leaves the equation, the caret after it. `insist` (Done, Enter) stays on a formula the page
   * can't show, saying why; without it (Escape, a click on the page) the page keeps the last
   * formula it could show.
   */
  const close = (insist: boolean, focus = true) => {
    const open = equationAt(view);
    if (!open) return;
    const text = s.draft;
    if (text.trim() !== "") {
      const problem = formulaProblem(text) ?? (text === s.rejected ? (message ?? explain("")) : null);
      if (problem && insist) {
        setMessage(problem);
        field.current?.focus();
        return;
      }
      // The last word too, now that typing is over. A formula nothing was typed into stays as it is.
      if (!problem && text.trim() !== s.wrote)
        edit(
          quoteUnknown(text, [...view.errors, ...[...UNKNOWN_WORDS].map((w) => `unknown variable: ${w}`)], true),
          open.display,
        );
    }
    // The equation as it is now: a word just quoted made it longer.
    const now = equationAt(view) ?? open;
    s.key = null;
    // An equation left empty shows nothing: it goes, rather than staying in the source as `$ $`.
    if (text.trim() === "")
      view.dispatch({
        edits: [{ from: now.from, to: now.to, insert: "" }],
        selection: { anchor: now.from, head: now.from },
      });
    else {
      pending.current = { from: now.from, src: view.state.text.slice(now.from, now.to), until: Date.now() + 5000 };
      view.select({ anchor: now.to, head: now.to });
    }
    if (focus) view.focus();
  };

  /**
   * The selection left the equation some other way (an arrow key, a click the view took): what
   * the field held goes onto the page as Done would put it, where the equation still is.
   */
  const leave = () => {
    const { from, src, wrote } = s;
    const text = s.draft;
    s.key = null;
    const state = view.state;
    if (state.text.slice(from, from + src.length) !== src) return;
    const display = /^\$\s/.test(src) && /\s\$$/.test(src);
    let insert = src;
    if (text.trim() === "") insert = "";
    else if (text.trim() !== wrote && text !== s.rejected && !formulaProblem(text))
      insert = equationSource(text, display);
    if (insert !== src) {
      const change = { from, to: from + src.length, insert };
      view.dispatch({ edits: [change], selection: mapSelection(state.selection, [change]) });
    }
    if (insert !== "") pending.current = { from, src: insert, until: Date.now() + 5000 };
    if (s.focused) view.focus();
  };

  // The session: another equation, or this one changed from outside, and the field follows.
  useLayoutEffect(() => {
    const before = lastText.current;
    const text = view.state.text;
    lastText.current = text;
    if (!eq || s.key !== key) {
      if (s.key !== null) leave();
      if (!eq) return;
      Object.assign(s, { key, wrote: eq.math, draft: eq.math, baseline: view.errors, good: null, rejected: null });
      Object.assign(s, { past: [], future: [], stamp: 0, stepped: false, left: null, caret: null });
      // A new equation (this change put it there): the keyboard goes to its formula, the sample
      // selected, so what is typed replaces it. One the caret came to keeps the keys on the page.
      s.select = eq.math === "x" && before !== text && before.slice(eq.from, eq.to) !== text.slice(eq.from, eq.to);
      setDraft(eq.math);
      setMessage(null);
    } else if (eq.math !== s.wrote) {
      // Changed from outside (Undo): the field shows what the document has, not what it held.
      Object.assign(s, { wrote: eq.math, draft: eq.math, rejected: null, past: [], future: [], stamp: 0 });
      s.stepped = false;
      setDraft(eq.math);
      setMessage(null);
    }
    s.from = eq.from;
    s.src = text.slice(eq.from, eq.to);
  });
  // The keyboard and the caret the session asked for, once the field shows its draft.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el || el.value !== s.draft) return;
    if (s.select) {
      s.select = false;
      el.focus({ preventScroll: true });
      el.select();
    } else if (s.caret !== null) el.setSelectionRange(s.caret, s.caret);
    s.caret = null;
  });

  // What the compiler says about the formula. A word it doesn't know in math (`area`, `length`) is
  // set as text, quoted: the compiler says which words those are, so `pi`, `sin` and `times` stay
  // math. Anything else it refuses doesn't stay on the page: the last formula that worked does.
  const errors = view.errors;
  const laidOut = view.laidOut;
  // biome-ignore lint/correctness/useExhaustiveDependencies: on what the compiler said, for this render's draft
  useEffect(() => {
    for (const e of errors) {
      const word = UNKNOWN.exec(e)?.[1];
      if (word && word.length > 1) UNKNOWN_WORDS.add(word);
    }
    const left = pending.current;
    if (left && !eq) {
      const inner = left.src.slice(1, -1);
      if (Date.now() > left.until || view.state.text.slice(left.from, left.from + left.src.length) !== left.src)
        pending.current = null;
      else {
        const fixed = quoteUnknown(inner.trim(), errors, true);
        if (fixed !== inner.trim()) {
          const insert = equationSource(fixed, /^\s/.test(inner) && /\s$/.test(inner));
          // The compiler names the first word it doesn't know: the next is waited for as this one was.
          pending.current = { from: left.from, src: insert, until: Date.now() + 5000 };
          const change = { from: left.from, to: left.from + left.src.length, insert };
          view.dispatch({ edits: [change], selection: mapSelection(view.state.selection, [change]) });
        }
      }
    }
    if (!eq || s.key !== key || draft !== s.draft) return;
    const el = field.current;
    const caret = el && document.activeElement === el ? el.selectionStart : draft.length;
    // Only words typed to their end: `le` of `length` being typed isn't one.
    const fixed = quoteUnknown(draft, errors, caret);
    if (fixed !== draft) {
      // The caret stays after what it was after.
      const at = quoteUnknown(draft.slice(0, caret), errors, caret).length;
      set(fixed, { step: false, caret: at });
      s.caret = at;
      return;
    }
    if (!laidOut || eq.math !== s.wrote) return;
    // A word math doesn't know is quoted above; one that is still there (quoting couldn't reach it) is refused.
    const fresh = errors.filter((e) => {
      if (s.baseline.includes(e)) return false;
      const word = UNKNOWN.exec(e)?.[1];
      return !word || stillBare(draft, word);
    });
    if (fresh.length === 0) {
      if (errors.every((e) => s.baseline.includes(e))) s.good = eq.math;
      return;
    }
    s.rejected = draft;
    setMessage(explain(fresh[0] ?? ""));
    if (s.good !== null && s.good !== eq.math) edit(s.good, eq.display);
  }, [errors.join("\n"), key, draft, laidOut]);

  // With the equation selected and the keyboard on the page, what is typed goes into its formula
  // (the page can't take math): keys, and text that comes without one (an input method, the
  // character picker, a paste). Enter opens the field; Backspace and Delete still delete the equation.
  const live = useRef({ set, close });
  live.current = { set, close };
  useEffect(() => {
    if (key === null) return;
    const el = view.element;
    // Not the panel's own, and not once the equation was left (Done, then the next key before the
    // panel is gone): those are the document's.
    const own = (e: Event) => !equationAt(view) || (e.target instanceof Node && panel.current?.contains(e.target));
    const toField = () =>
      requestAnimationFrame(() => {
        const input = field.current;
        input?.focus({ preventScroll: true });
        input?.setSelectionRange(s.draft.length, s.draft.length);
      });
    const type = (text: string) => {
      // A new equation's sample `x` is replaced by what is typed.
      live.current.set(s.draft === "x" ? text : s.draft + text);
      toField();
    };
    const take = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const onKey = (e: KeyboardEvent) => {
      if (own(e) || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      if (e.key.length !== 1 && e.key !== "Enter") return;
      take(e);
      if (e.key === "Enter") toField();
      else type(e.key);
    };
    const onBeforeInput = (e: InputEvent) => {
      if (own(e) || e.isComposing || !e.data || !e.inputType.startsWith("insert")) return;
      take(e);
      type(e.data);
    };
    // A composition is the formula's from its start: the page never sees it.
    const onComposition = (e: CompositionEvent) => {
      if (own(e)) return;
      e.stopPropagation();
      if (e.type !== "compositionend") return;
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) e.target.value = "";
      if (e.data) type(e.data);
    };
    const onInput = (e: Event) => {
      if (!own(e) && (e as InputEvent).isComposing) e.stopPropagation();
    };
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text/plain").replace(/\s+/g, " ").trim();
      if (own(e) || !text) return;
      take(e);
      type(text);
    };
    // A click anywhere else is done with the formula, as Escape is; the click then does its own.
    const onDown = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target || target.closest(".tse-layer, .tse-fixed")) return;
      live.current.close(false, false);
    };
    el.addEventListener("keydown", onKey, true);
    el.addEventListener("beforeinput", onBeforeInput, true);
    el.addEventListener("compositionstart", onComposition, true);
    el.addEventListener("compositionupdate", onComposition, true);
    el.addEventListener("compositionend", onComposition, true);
    el.addEventListener("input", onInput, true);
    el.addEventListener("paste", onPaste, true);
    document.addEventListener("mousedown", onDown, true);
    return () => {
      el.removeEventListener("keydown", onKey, true);
      el.removeEventListener("beforeinput", onBeforeInput, true);
      el.removeEventListener("compositionstart", onComposition, true);
      el.removeEventListener("compositionupdate", onComposition, true);
      el.removeEventListener("compositionend", onComposition, true);
      el.removeEventListener("input", onInput, true);
      el.removeEventListener("paste", onPaste, true);
      document.removeEventListener("mousedown", onDown, true);
    };
  }, [key, view, s]);

  const placed = usePlacement(() => {
    const el = panel.current;
    if (!eq || !el) return null;
    const box = unionOf(view.boxesOf(eq.from, eq.to));
    // Between a change and its layout the equation has no box yet: the panel stays where it was.
    if (!box && !view.laidOut) return undefined;
    const pane = paneOf(view);
    // An equation the page can't show (an error where it would be) has no box: at the pane's corner.
    if (!box) return { left: pane.left + 12, top: pane.top + 12 };
    // Under the equation, at the place it had when the panel opened: it moves as it is typed, and
    // across the page when it goes on its own line, and the panel doesn't jump after it.
    s.left ??= box.left;
    return placePopover({ ...box, left: s.left }, { width: el.offsetWidth, height: el.offsetHeight }, pane);
  });
  if (!eq) return null;
  const problem = draft.trim() === "" ? null : formulaProblem(draft);
  // An equation that came with an error is said to have one, until it is changed.
  const broken = placed !== null && laidOut && draft === eq.math && view.boxesOf(eq.from, eq.to).length === 0;
  const alert =
    message ??
    (problem?.startsWith("No backslashes") ? problem : null) ??
    (broken ? "The page can't show this formula. Change it here, or delete it." : null);
  const insertKey = (insert: string) => {
    const el = field.current;
    const at = el ? el.selectionStart : draft.length;
    const end = el ? el.selectionEnd : draft.length;
    const sep = at > 0 && /\w$/.test(draft.slice(0, at)) && /^\w/.test(insert) ? " " : "";
    const caret = at + sep.length + insert.length;
    set(draft.slice(0, at) + sep + insert + draft.slice(end), { caret, force: true, burst: false });
    s.caret ??= caret;
    el?.focus();
  };
  const toggle = (display: boolean) => {
    // The formula the page has moves, when the field's can't go there yet.
    if (draft.trim() !== "" && !formulaProblem(draft) && draft !== s.rejected) edit(draft, display);
    else edit(s.wrote, display);
    // The keyboard back in the formula: a space typed next is the formula's, not the box's.
    field.current?.focus();
  };
  return (
    <Layer>
      <div
        ref={panel}
        className="tse-panel"
        style={placed ? { left: placed.left, top: placed.top } : { left: 0, top: 0, opacity: 0, pointerEvents: "none" }}
        role="dialog"
        aria-label="Equation"
        onFocus={() => {
          s.focused = true;
        }}
        onBlur={() => {
          s.focused = false;
        }}
      >
        <div className="tse-panel-title">
          <Icon name="radical" />
          Equation
          <Button label="Done" icon="x" onClick={() => close(true)} />
        </div>
        <label className="tse-field">
          Formula
          <textarea
            ref={field}
            value={draft}
            spellCheck={false}
            aria-invalid={alert !== null || undefined}
            onChange={(e) => set(e.target.value, { caret: e.target.selectionStart })}
            onKeyDown={(e) => {
              const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
              const k = e.key.toLowerCase();
              if (e.key === "Escape") close(false);
              else if (e.key === "Enter" && !e.shiftKey) close(true);
              else if (mod && k === "z" && !e.shiftKey) step(s.past, s.future, () => view.undo());
              else if (mod && (k === "y" || k === "z")) step(s.future, s.past, () => view.redo());
              else return;
              e.preventDefault();
            }}
          />
          {alert !== null ? (
            <small className="tse-invalid" role="alert">
              {alert}
            </small>
          ) : (
            <small>
              {problem
                ? "Not finished yet: the page shows the formula as it was."
                : "Write it as you would say it: x^2, a/b, sqrt(x), pi."}
            </small>
          )}
        </label>
        <div className="tse-math-keys">
          {MATH_KEYS.map((k) => (
            <Button key={k.label} label={k.title} onClick={() => insertKey(k.insert)}>
              {k.label}
            </Button>
          ))}
        </div>
        <label className="tse-field-row">
          <input
            type="checkbox"
            checked={eq.display}
            onChange={(e) => toggle(e.target.checked)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== "Escape") return;
              e.preventDefault();
              close(e.key === "Enter");
            }}
          />
          On its own line
        </label>
      </div>
    </Layer>
  );
};
