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
  deleteBlock,
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
import { hasErrors, parse } from "@typstream/syntax";
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
  view.run(deleteBlock(c.from, c.to));
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
export const source = (
  param: EditorParamSpec,
  value: string,
  max: number | undefined = param.max,
): string | null | undefined => {
  if (value === "") return null;
  switch (param.type) {
    case "number": {
      // Out of range (the fifth of three options, negative points): not written.
      if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(value)) return undefined;
      const n = Number(value);
      return (param.min !== undefined && n < param.min) || (max !== undefined && n > max) ? undefined : value;
    }
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
  max = param.max,
  onChange,
}: {
  param: EditorParamSpec;
  value: string | null;
  max?: number;
  onChange: (source: string | null) => void;
}) => {
  const shown = display(param, value);
  const [draft, setDraft] = useState(shown);
  // An undo or another change from outside: the field follows.
  useEffect(() => setDraft(shown), [shown]);
  const invalid = source(param, draft, max) === undefined;
  const commit = (v: string) => {
    setDraft(v);
    const s = source(param, v, max);
    if (s !== undefined) onChange(s);
  };
  const range =
    param.min !== undefined && max !== undefined
      ? `From ${param.min} to ${max}.`
      : param.min !== undefined
        ? `${param.min} or more.`
        : max !== undefined
          ? `At most ${max}.`
          : "Not valid here.";
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
        max={max}
        step={param.step}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        onChange={(e) => commit(e.target.value)}
      />
    );
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is `input`, a field of the kind above
    <label className="tse-field">
      {param.label}
      {input}
      {invalid ? <small className="tse-invalid">{range}</small> : param.help && <small>{param.help}</small>}
    </label>
  );
};

/** How many positional arguments a component's call has (a multiple choice's options). */
const positionalCount = (component: Component): number => {
  const args = component.call.children.find((k) => k.kind === "Args");
  const skip = new Set(["LeftParen", "RightParen", "Comma", "Space", "Named", "LineComment", "BlockComment"]);
  return args?.children.filter((k) => !skip.has(k.kind)).length ?? 0;
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
        max={param.maxPositional ? positionalCount(component) : param.max}
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

/**
 * The component at the selection's controls: its name, settings, table buttons, Delete. Docked in
 * the fixed toolbar (where it covers nothing on the page), or a bar over the component without one.
 */
export const ComponentBar = ({ view, docked = false }: { view: EditorView; docked?: boolean }) => {
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
    if (docked) return {};
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
  const controls = (
    <div
      className={docked ? "tse-toolbar tse-docked" : "tse-toolbar tse-floating"}
      role={docked ? "group" : "toolbar"}
      aria-label={label}
      style={docked ? undefined : style}
    >
      <span className="tse-panel-title" style={{ padding: "0 6px" }}>
        <Icon name={spec?.icon ?? "square"} />
        {label}
      </span>
      {spec?.params?.length ? (
        <Button label="Settings" buttonRef={settingsButton} expanded={settings} onClick={() => setSettings((s) => !s)}>
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
  );
  return (
    <>
      {docked ? controls : <Layer>{controls}</Layer>}
      <Layer>
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
    </>
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
  // With the equation selected, typing goes into its formula (the page can't take math), and Enter
  // opens the field; Backspace and Delete still delete the equation.
  const typing = useRef({ eq, draft });
  typing.current = { eq, draft };
  useEffect(() => {
    if (key === null) return;
    const onKey = (e: KeyboardEvent) => {
      const { eq: current, draft: text } = typing.current;
      if (!current || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      if (e.key.length !== 1 && e.key !== "Enter") return;
      e.preventDefault();
      e.stopPropagation();
      // A new equation's sample `x` is replaced by what is typed.
      const next = e.key === "Enter" ? text : text === "x" ? e.key : text + e.key;
      if (next !== text) edit(next, current.display);
      setDraft(next);
      requestAnimationFrame(() => {
        const el = field.current;
        el?.focus();
        el?.setSelectionRange(next.length, next.length);
      });
    };
    view.element.addEventListener("keydown", onKey, true);
    return () => view.element.removeEventListener("keydown", onKey, true);
  }, [key, view]);
  const style = usePlacement<CSSProperties>(() => {
    if (!eq) return null;
    const box = view.boxesOf(eq.from, eq.to)[0];
    if (!box) return undefined;
    return { left: Math.max(8, Math.min(box.left, window.innerWidth - 268)), top: box.bottom + 8 };
  });
  if (!eq || !style) return null;
  const incomplete = draft.trim() !== "" && hasErrors(parse(eq.display ? `$ ${draft} $` : `$${draft}$`));
  const write = (math: string, display = eq.display) => {
    setDraft(math);
    edit(math, display);
  };
  const close = () => {
    // An equation left empty shows nothing: it goes, rather than staying in the source as `$ $`.
    if (draft.trim() === "")
      view.dispatch({
        edits: [{ from: eq.from, to: eq.to, insert: "" }],
        selection: { anchor: eq.from, head: eq.from },
      });
    else view.select({ anchor: eq.to, head: eq.to });
    view.focus();
  };
  function edit(math: string, display: boolean) {
    if (!eq) return;
    const src = display ? `$ ${math} $` : `$${math}$`;
    // A formula half typed (`x + ((`) would fail the compile: it waits in the field until it is whole.
    if (hasErrors(parse(src))) return;
    view.dispatch({
      edits: [{ from: eq.from, to: eq.to, insert: src }],
      selection: { anchor: eq.from, head: eq.from + src.length, node: true },
    });
  }
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
          <Button label="Done" icon="x" onClick={close} />
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
                close();
              }
            }}
          />
          <small>
            {incomplete
              ? "Not finished yet: the page shows the formula as it was."
              : "Write it as you would say it: x^2, a/b, sqrt(x), pi."}
          </small>
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
