// What shows over a component on the page: a bar with its name, its settings (a form for the
// arguments its plugin lists, so nobody writes Typst) and Delete; for a table, buttons that add and
// remove rows and columns; for an equation, a field for the formula with keys for what is hard to
// type. Positioned from the component's box on the page (`EditorView.boxesOf`).

import type { EditorParamSpec } from "@typstream/core";
import {
  addColumn,
  addRow,
  argumentOf,
  type Component,
  type ComponentSpec,
  deleteColumn,
  deleteRow,
  deleteTable,
  type EditorView,
  escapeMarkup,
  readString,
  setArgument,
  tableAt,
  typstString,
} from "@typstream/editor-core";
import { Plus } from "lucide-react";
import { type CSSProperties, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./icons";
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
  const text = view.state.text;
  let to = c.to;
  const after = /^[ \t]*\n?/.exec(text.slice(to));
  if (after) to += after[0].length;
  view.dispatch({ edits: [{ from: c.from, to, insert: "" }], selection: { anchor: c.from, head: c.from } });
  view.focus();
};

// ---------------------------------------------------------------------------
// Form fields

const LENGTH = /^-?(\d+(\.\d*)?|\.\d+)(pt|mm|cm|in|em|%|fr)$/;

/** What the field shows for an argument's source. */
export const display = (param: EditorParamSpec, source: string | null): string => {
  if (source === null) return "";
  if (param.type === "text") return readString(source) ?? source;
  if (param.type === "content")
    return source.startsWith("[") && source.endsWith("]")
      ? source.slice(1, -1).replace(/\\(.)/g, "$1")
      : (readString(source) ?? source);
  if (param.type === "color") return /^rgb\("(#[0-9a-fA-F]{6})"\)$/.exec(source)?.[1] ?? source;
  return source;
};

/** The source for what the field holds; `null` leaves the argument out (its default). */
export const source = (param: EditorParamSpec, value: string): string | null | undefined => {
  if (value === "") return null;
  switch (param.type) {
    case "number":
      return /^-?(\d+(\.\d*)?|\.\d+)$/.test(value) ? value : undefined;
    case "text":
      return typstString(value);
    case "content":
      return `[${escapeMarkup(value)}]`;
    case "length":
      return LENGTH.test(value) ? value : undefined;
    case "color":
      return `rgb("${value}")`;
    default:
      return value;
  }
};

const Field = ({
  param,
  value,
  onChange,
}: {
  param: EditorParamSpec;
  value: string | null;
  onChange: (source: string | null) => void;
}) => {
  const shown = display(param, value);
  const [draft, setDraft] = useState(shown);
  // An undo or another change from outside: the field follows.
  useEffect(() => setDraft(shown), [shown]);
  const commit = (v: string) => {
    setDraft(v);
    const s = source(param, v);
    if (s !== undefined) onChange(s);
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
  let input: ReactNode;
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
  else if (param.type === "content")
    input = <textarea value={draft} placeholder={placeholder} onChange={(e) => commit(e.target.value)} />;
  else
    input = (
      <input
        type={param.type === "number" ? "number" : "text"}
        value={draft}
        min={param.min}
        max={param.max}
        step={param.step}
        placeholder={placeholder}
        onChange={(e) => commit(e.target.value)}
      />
    );
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is `input`, a field of the kind above
    <label className="tse-field">
      {param.label}
      {input}
      {param.help && <small>{param.help}</small>}
    </label>
  );
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
}) => (
  <>
    {(spec.params ?? []).map((param) => (
      <Field
        key={param.name}
        param={param}
        value={argumentOf(view.state, component, param.name)}
        onChange={(value) => {
          // The component as the state has it now (an edit before moved it).
          const current = view.components()[0] ?? component;
          const tr = setArgument(current, param.name, value)(view.state);
          if (tr) view.dispatch(tr);
        }}
      />
    ))}
  </>
);

// ---------------------------------------------------------------------------
// The bar over a component

const BAR_HEIGHT = 36;

/** The bar over the component at the selection: its name, settings, table buttons, Delete. */
export const ComponentBar = ({ view }: { view: EditorView }) => {
  const component = view.components()[0] ?? null;
  const spec = component ? specOf(view, component.name) : undefined;
  const [settings, setSettings] = useState(false);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const closeSettings = useCallback(() => setSettings(false), []);
  const settingsAnchor = useCallback(() => settingsButton.current?.getBoundingClientRect() ?? null, []);
  const key = component ? `${component.name}@${component.from}` : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: another component closes the form
  useEffect(() => setSettings(false), [key]);
  const style = usePlacement<CSSProperties>(() => {
    if (!component) return null;
    const box = view.boxesOf(component.from, component.to)[0];
    if (!box) return undefined;
    // Above the component, below the fixed toolbar (sticky over the pages), or under the component.
    const toolbar = view.element.closest(".tse-root")?.querySelector(".tse-fixed")?.getBoundingClientRect();
    const floor = Math.max(4, (toolbar?.bottom ?? 0) + 4);
    let top = box.top - BAR_HEIGHT - 6;
    if (top < floor) top = box.bottom - BAR_HEIGHT > floor ? floor : box.bottom + 6;
    return { left: Math.max(8, box.left), top };
  });
  if (!component || !style) return null;
  const table = spec?.controls === "table" ? tableAt(view.state, view.state.selection.head, view.schema) : null;
  const run = (command: Parameters<EditorView["run"]>[0]) => {
    view.run(command);
    view.focus();
  };
  const label = spec?.label ?? component.name;
  return (
    <Layer>
      <div className="tse-toolbar tse-floating" role="toolbar" aria-label={label} style={style}>
        <span className="tse-panel-title" style={{ padding: "0 6px" }}>
          <Icon name={spec?.icon ?? "square"} />
          {label}
        </span>
        {spec?.params?.length ? (
          <Button
            label="Settings"
            buttonRef={settingsButton}
            expanded={settings}
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
      {settings && spec && (
        <Popover
          anchor={settingsAnchor}
          onClose={closeSettings}
          ignore={settingsButton}
          label={`${label} settings`}
          className="tse-form"
        >
          <div
            className="tse-panel"
            style={{ position: "static", boxShadow: "none", border: 0, padding: 4, animation: "none" }}
          >
            <ComponentForm view={view} component={component} spec={spec} />
          </div>
        </Popover>
      )}
      {table && <TableEdges view={view} />}
    </Layer>
  );
};

/** ➕ at a table's bottom and right edges: a row after the last, a column after the last. */
const TableEdges = ({ view }: { view: EditorView }) => {
  const table = tableAt(view.state, view.state.selection.head, view.schema);
  const at = usePlacement(() => {
    if (!table) return null;
    const boxes = view.boxesOf(table.from, table.to);
    const first = boxes[0];
    const last = boxes[boxes.length - 1];
    if (!first || !last) return null;
    return {
      row: { left: (last.left + last.right) / 2 - 10, top: last.bottom + 4 },
      column: { left: first.right + 4, top: (first.top + first.bottom) / 2 - 10 },
    };
  });
  if (!table || !at) return null;
  const inLast = (row: number, column: number) => {
    const cell = table.ranges[row]?.[column];
    if (cell) view.select({ anchor: cell.from + 1, head: cell.from + 1 });
  };
  return (
    <>
      <button
        type="button"
        className="tse-edge"
        title="Add a row"
        aria-label="Add a row"
        style={at.row}
        onMouseDown={keepFocus}
        onClick={() => {
          inLast(table.cells.length - 1, 0);
          view.run(addRow("below"));
          view.focus();
        }}
      >
        <Plus aria-hidden="true" />
      </button>
      <button
        type="button"
        className="tse-edge"
        title="Add a column"
        aria-label="Add a column"
        style={at.column}
        onMouseDown={keepFocus}
        onClick={() => {
          inLast(0, table.columns - 1);
          view.run(addColumn("right"));
          view.focus();
        }}
      >
        <Plus aria-hidden="true" />
      </button>
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

/** A field for the selected equation's formula, under it on the page. */
export const EquationPanel = ({ view }: { view: EditorView }) => {
  const eq = equationAt(view);
  const [draft, setDraft] = useState(eq?.math ?? "");
  const field = useRef<HTMLTextAreaElement>(null);
  const key = eq ? `${eq.from}` : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: another equation, another draft
  useEffect(() => setDraft(eq?.math ?? ""), [key]);
  const style = usePlacement<CSSProperties>(() => {
    if (!eq) return null;
    const box = view.boxesOf(eq.from, eq.to)[0];
    if (!box) return undefined;
    return { left: Math.max(8, Math.min(box.left, window.innerWidth - 268)), top: box.bottom + 8 };
  });
  if (!eq || !style) return null;
  const write = (math: string, display = eq.display) => {
    setDraft(math);
    const src = display ? `$ ${math} $` : `$${math}$`;
    view.dispatch({
      edits: [{ from: eq.from, to: eq.to, insert: src }],
      selection: { anchor: eq.from, head: eq.from + src.length, node: true },
    });
  };
  const insertKey = (insert: string) => {
    const el = field.current;
    const at = el ? el.selectionStart : draft.length;
    const end = el ? el.selectionEnd : draft.length;
    const sep = at > 0 && /\w$/.test(draft.slice(0, at)) && /^\w/.test(insert) ? " " : "";
    const next = draft.slice(0, at) + sep + insert + draft.slice(end);
    write(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + sep.length + insert.length, at + sep.length + insert.length);
    });
  };
  return (
    <Layer>
      <div className="tse-panel" style={style} role="dialog" aria-label="Equation">
        <div className="tse-panel-title">
          <Icon name="radical" />
          Equation
          <Button label="Done" icon="x" onClick={() => view.select({ anchor: eq.to, head: eq.to })} />
        </div>
        <label className="tse-field">
          Formula
          <textarea
            ref={field}
            value={draft}
            spellCheck={false}
            onChange={(e) => write(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
                e.preventDefault();
                view.select({ anchor: eq.to, head: eq.to });
                view.focus();
              }
            }}
          />
          <small>Write it as you would say it: x^2, a/b, sqrt(x), pi.</small>
        </label>
        <div className="tse-math-keys">
          {MATH_KEYS.map((k) => (
            <Button key={k.label} label={k.title} onClick={() => insertKey(k.insert)}>
              {k.label}
            </Button>
          ))}
        </div>
        <label className="tse-field-row">
          <input type="checkbox" checked={eq.display} onChange={(e) => write(draft, e.target.checked)} />
          On its own line
        </label>
      </div>
    </Layer>
  );
};
