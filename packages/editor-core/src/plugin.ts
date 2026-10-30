// The editor's plugins, after Plate's: each is one object adding any of shortcuts, toolbar items
// (the fixed toolbar and the floating one over a selection), insert-menu items, input rules
// (Markdown-like shortcuts typed at a line's start) and components (forms for their arguments).
// Everything the editor does beyond typing comes from plugins, its own basics included; a
// typstream plugin's `editor` facet (plain data, e.g. edu's components) becomes one too.

import type { EditorComponentSpec, EditorParamSpec, TypstreamPlugin } from "@typstream/core";
import { alignmentAt, blockType, indentItems, setAlignment, setBlockType, toggleList } from "./blocks";
import { DEFAULT_SCHEMA, type EditorSchema } from "./commands";
import { insertBlock, insertInline } from "./components";
import { isMarked, markValue, setMark, toggleMark } from "./marks";
import type { EditorState, Transaction } from "./state";
import { tableTemplate } from "./table";

/**
 * A command: what it does to a state, or `null` when it doesn't apply there.
 * @beta
 */
export type EditorCommand = (state: EditorState, schema: EditorSchema) => Transaction | null;

/**
 * An entry of a toolbar: a button (`run`), a toggle (`run` and `active`), a menu (`items`), or a
 * value picker (`picker`: colours, sizes). Icons are names the React toolbar draws (lucide's).
 * @beta
 */
export interface ToolbarItem {
  /** Unique among the toolbar's items. */
  key: string;
  /** What it does, for its tooltip and screen readers. */
  label: string;
  /** Icon name. */
  icon?: string;
  /** Items with one group sit together, between separators. */
  group?: string;
  /** Its keyboard shortcut, as the toolbar shows it: `Mod-b`. */
  shortcut?: string;
  /** What it does. */
  run?: EditorCommand;
  /** Whether it is on at the selection (a toggle). */
  active?: (state: EditorState, schema: EditorSchema) => boolean;
  /** Whether it can run (default: whether `run` returns a transaction). */
  enabled?: (state: EditorState, schema: EditorSchema) => boolean;
  /** A menu's entries. */
  items?: ToolbarItem[];
  /** A menu's label at the selection (the block type: `Heading 2`). */
  current?: (state: EditorState, schema: EditorSchema) => string | null;
  /** A value picker. */
  picker?: {
    kind: "color" | "select";
    options: { value: string | null; label: string; swatch?: string }[];
    value: (state: EditorState, schema: EditorSchema) => string | null;
    apply: (value: string | null) => EditorCommand;
  };
}

/**
 * An entry of the insert menu and the slash menu.
 * @beta
 */
export interface InsertItem {
  /** Unique among the insert items. */
  key: string;
  /** Its name in the menu. */
  label: string;
  /** One line under it. */
  description?: string;
  /** Icon name. */
  icon?: string;
  /** The menu's group. */
  group?: string;
  /** More words the slash menu finds it by. */
  keywords?: string[];
  /** What it inserts. */
  run: EditorCommand;
}

/**
 * Text typed at the start of a line that runs a command, as Markdown shortcuts do: `match` is
 * tested against the line's source up to the caret, after the typed text went in.
 * @beta
 */
export interface InputRule {
  /** The line's source before the caret, e.g. `^\\-[ ]$` for `- ` (the editor escapes what it types). */
  match: RegExp;
  /** The command, run on the state with the typed text in (it replaces `[lineStart, caret)` itself). */
  run: (
    state: EditorState,
    line: { from: number; to: number; match: RegExpExecArray },
    schema: EditorSchema,
  ) => Transaction | null;
}

/**
 * A component the editor edits with a form: a plugin's (from its `editor` facet) or the editor's own.
 * @beta
 */
export interface ComponentSpec extends Omit<EditorComponentSpec, "template"> {
  /** The Typst the insert menu writes. */
  template?: string;
  /** Built-in controls drawn over it on the page (`table`: rows and columns). */
  controls?: "table";
}

/**
 * An editor plugin.
 * @beta
 */
export interface EditorPlugin {
  /** Unique: `marks`, `edu`. */
  key: string;
  /** Functions that style text (stepped over like delimiters). */
  marks?: string[];
  /** Functions set inline in a paragraph. */
  inline?: string[];
  /** Keyboard shortcuts: `Mod-b` (Ctrl, or ⌘ on Apple), `Mod-Shift-x`, `Mod-Alt-1`. */
  shortcuts?: Record<string, EditorCommand>;
  /** Items of the fixed toolbar. */
  toolbar?: ToolbarItem[];
  /** Items of the floating toolbar over a text selection. */
  floating?: ToolbarItem[];
  /** Items of the insert and slash menus. */
  insert?: InsertItem[];
  /** Markdown-like shortcuts. */
  inputRules?: InputRule[];
  /** Components with forms. */
  components?: ComponentSpec[];
}

/** Identity function that type-checks an editor plugin. @beta */
export const createEditorPlugin = <P extends EditorPlugin>(plugin: P): P => plugin;

/** The schema plugins make together, over Typst's own. @beta */
export const schemaOf = (plugins: readonly EditorPlugin[]): EditorSchema => {
  const marks = new Set(DEFAULT_SCHEMA.marks);
  const inline = new Set(DEFAULT_SCHEMA.inline);
  for (const p of plugins) {
    for (const m of p.marks ?? []) {
      marks.add(m);
      inline.add(m);
    }
    for (const i of p.inline ?? []) inline.add(i);
    for (const c of p.components ?? []) if (c.inline) inline.add(c.name);
  }
  return { marks, inline };
};

/**
 * The editor plugin a typstream plugin's `editor` facet makes: its components in the insert menu
 * (by group) and with their forms. `null` without one.
 * @beta
 */
export const fromTypstreamPlugin = (plugin: TypstreamPlugin): EditorPlugin | null => {
  const facet = plugin.editor;
  if (!facet) return null;
  const components = facet.components ?? [];
  return {
    key: plugin.key,
    marks: facet.marks,
    inline: facet.inline,
    components,
    insert: components.map((c) => ({
      key: `${plugin.key}:${c.name}`,
      label: c.label,
      description: c.description,
      icon: c.icon,
      group: c.group ?? plugin.key,
      keywords: c.keywords,
      run: c.inline ? insertInline(c.template) : insertBlock(c.template),
    })),
  };
};

// ---------------------------------------------------------------------------
// The editor's own plugins

const mark = (name: string, label: string, icon: string, shortcut?: string): ToolbarItem => ({
  key: name,
  label,
  icon,
  group: "marks",
  shortcut,
  run: toggleMark({ name }),
  active: (s, schema) => isMarked(s, { name }, s.from, s.to, schema),
});

/** Colours of the colour pickers: Tailwind's 600s, which print well on white. @beta */
export const COLORS: { value: string; label: string }[] = [
  { value: "#dc2626", label: "Red" },
  { value: "#ea580c", label: "Orange" },
  { value: "#ca8a04", label: "Yellow" },
  { value: "#16a34a", label: "Green" },
  { value: "#0891b2", label: "Cyan" },
  { value: "#2563eb", label: "Blue" },
  { value: "#7c3aed", label: "Purple" },
  { value: "#db2777", label: "Pink" },
  { value: "#4b5563", label: "Gray" },
];

/** Highlight colours: light, for under text. @beta */
export const HIGHLIGHTS: { value: string; label: string }[] = [
  { value: "#fef08a", label: "Yellow" },
  { value: "#bbf7d0", label: "Green" },
  { value: "#bfdbfe", label: "Blue" },
  { value: "#fbcfe8", label: "Pink" },
  { value: "#fed7aa", label: "Orange" },
  { value: "#e5e7eb", label: "Gray" },
];

/** A colour as Typst source, and back. */
const rgb = (hex: string) => `rgb("${hex}")`;
const hexOf = (source: string | null): string | null =>
  /^rgb\("(#[0-9a-fA-F]{6})"\)$/.exec(source ?? "")?.[1] ?? source;

const colorPicker = (
  name: string,
  arg: string,
  options: { value: string; label: string }[],
  none: string,
): ToolbarItem["picker"] => ({
  kind: "color",
  options: [{ value: null, label: none }, ...options.map((o) => ({ ...o, swatch: o.value }))],
  value: (s, schema) => {
    const v = markValue(s, { name, arg }, s.from, s.to, schema);
    return typeof v === "string" ? hexOf(v) : null;
  },
  apply: (value) => setMark({ name, arg }, value === null ? null : rgb(value)),
});

const SIZES = ["8pt", "9pt", "10pt", "11pt", "12pt", "14pt", "16pt", "18pt", "20pt", "24pt", "28pt", "32pt"];

/** Bold, italic, underline, strikethrough, sub- and superscript, colours and sizes. @beta */
export const marksPlugin: EditorPlugin = createEditorPlugin({
  key: "marks",
  shortcuts: {
    "Mod-b": toggleMark({ name: "strong" }),
    "Mod-i": toggleMark({ name: "emph" }),
    "Mod-u": toggleMark({ name: "underline" }),
    "Mod-Shift-x": toggleMark({ name: "strike" }),
    "Mod-,": toggleMark({ name: "sub" }),
    "Mod-.": toggleMark({ name: "super" }),
  },
  toolbar: [
    mark("strong", "Bold", "bold", "Mod-b"),
    mark("emph", "Italic", "italic", "Mod-i"),
    mark("underline", "Underline", "underline", "Mod-u"),
    mark("strike", "Strikethrough", "strikethrough", "Mod-Shift-x"),
    mark("sub", "Subscript", "subscript", "Mod-,"),
    mark("super", "Superscript", "superscript", "Mod-."),
    {
      key: "color",
      label: "Text colour",
      icon: "baseline",
      group: "color",
      picker: colorPicker("text", "fill", COLORS, "Default"),
    },
    {
      key: "highlight",
      label: "Highlight",
      icon: "highlighter",
      group: "color",
      picker: colorPicker("highlight", "fill", HIGHLIGHTS, "None"),
    },
    {
      key: "size",
      label: "Font size",
      group: "size",
      picker: {
        kind: "select",
        options: [{ value: null, label: "Default" }, ...SIZES.map((s) => ({ value: s, label: s.replace("pt", "") }))],
        value: (s, schema) => {
          const v = markValue(s, { name: "text", arg: "size" }, s.from, s.to, schema);
          return typeof v === "string" ? v : null;
        },
        apply: (value) => setMark({ name: "text", arg: "size" }, value),
      },
    },
  ],
  floating: [
    mark("strong", "Bold", "bold", "Mod-b"),
    mark("emph", "Italic", "italic", "Mod-i"),
    mark("underline", "Underline", "underline", "Mod-u"),
    mark("strike", "Strikethrough", "strikethrough", "Mod-Shift-x"),
    {
      key: "color",
      label: "Text colour",
      icon: "baseline",
      group: "color",
      picker: colorPicker("text", "fill", COLORS, "Default"),
    },
    {
      key: "highlight",
      label: "Highlight",
      icon: "highlighter",
      group: "color",
      picker: colorPicker("highlight", "fill", HIGHLIGHTS, "None"),
    },
  ],
});

const BLOCK_TYPES: { label: string; icon: string; type: Parameters<typeof setBlockType>[0]; shortcut?: string }[] = [
  { label: "Text", icon: "pilcrow", type: { kind: "paragraph" }, shortcut: "Mod-Alt-0" },
  { label: "Heading 1", icon: "heading-1", type: { kind: "heading", level: 1 }, shortcut: "Mod-Alt-1" },
  { label: "Heading 2", icon: "heading-2", type: { kind: "heading", level: 2 }, shortcut: "Mod-Alt-2" },
  { label: "Heading 3", icon: "heading-3", type: { kind: "heading", level: 3 }, shortcut: "Mod-Alt-3" },
  { label: "Heading 4", icon: "heading-4", type: { kind: "heading", level: 4 } },
  { label: "Bulleted list", icon: "list", type: { kind: "list" }, shortcut: "Mod-Shift-8" },
  { label: "Numbered list", icon: "list-ordered", type: { kind: "enum" }, shortcut: "Mod-Shift-7" },
];

const sameType = (a: ReturnType<typeof blockType>, b: Parameters<typeof setBlockType>[0]) =>
  !!a && a.kind === b.kind && (a.kind !== "heading" || (b.kind === "heading" && a.level === b.level));

const turnInto: ToolbarItem = {
  key: "turn-into",
  label: "Turn into",
  group: "block",
  current: (s, schema) => BLOCK_TYPES.find((t) => sameType(blockType(s, schema), t.type))?.label ?? null,
  items: BLOCK_TYPES.map((t) => ({
    key: `block-${t.label}`,
    label: t.label,
    icon: t.icon,
    shortcut: t.shortcut,
    run: setBlockType(t.type),
    active: (s, schema) => sameType(blockType(s, schema), t.type),
  })),
};

const align = (value: "left" | "center" | "right", label: string, icon: string): ToolbarItem => ({
  key: `align-${value}`,
  label,
  icon,
  run: setAlignment(value),
  active: (s) => alignmentAt(s) === value,
});

/** Headings, lists, indentation and alignment, with Markdown-like shortcuts. @beta */
export const blocksPlugin: EditorPlugin = createEditorPlugin({
  key: "blocks",
  shortcuts: {
    ...Object.fromEntries(
      BLOCK_TYPES.filter((t) => t.shortcut).map((t) => [t.shortcut as string, setBlockType(t.type)]),
    ),
    "Mod-Shift-8": toggleList("list"),
    "Mod-Shift-7": toggleList("enum"),
    "Mod-Shift-e": setAlignment("center"),
    "Mod-Shift-l": setAlignment("left"),
    "Mod-Shift-r": setAlignment("right"),
  },
  toolbar: [
    turnInto,
    {
      key: "list",
      label: "Bulleted list",
      icon: "list",
      group: "list",
      run: toggleList("list"),
      active: (s, schema) => blockType(s, schema)?.kind === "list",
    },
    {
      key: "enum",
      label: "Numbered list",
      icon: "list-ordered",
      group: "list",
      run: toggleList("enum"),
      active: (s, schema) => blockType(s, schema)?.kind === "enum",
    },
    {
      key: "outdent",
      label: "Outdent",
      icon: "indent-decrease",
      group: "list",
      shortcut: "Shift-Tab",
      run: indentItems(-1),
    },
    { key: "indent", label: "Indent", icon: "indent-increase", group: "list", shortcut: "Tab", run: indentItems(1) },
    {
      key: "align",
      label: "Align",
      group: "align",
      icon: "align-left",
      items: [
        align("left", "Align left", "align-left"),
        align("center", "Center", "align-center"),
        align("right", "Align right", "align-right"),
      ],
      current: (s) => alignmentAt(s),
    },
  ],
  floating: [turnInto],
  inputRules: [
    // The editor escapes what it types (`- ` comes in as `\- `): these make it Typst's markers.
    { match: /^(\s*)\\-[ ~]$/, run: marker(() => "- ") },
    { match: /^(\s*)\\\+[ ~]$/, run: marker(() => "+ ") },
    // `# ` and `## ` as in Markdown, `= ` and `== ` as in Typst: headings.
    { match: /^(\s*)((?:\\#)+)[ ~]$/, run: marker((m) => `${"=".repeat((m[2] as string).length / 2)} `) },
    { match: /^(\s*)\\(=+)[ ~]$/, run: marker((m) => `${"=".repeat((m[2] as string).length)} `) },
  ],
});

/** An input rule's command: the typed shortcut becomes a heading's or list's marker. */
function marker(insert: (match: RegExpExecArray) => string): InputRule["run"] {
  return (_state, line) => {
    const indent = line.match[1] ?? "";
    const at = line.from + indent.length;
    const text = insert(line.match);
    return {
      edits: [{ from: at, to: line.to, insert: text }],
      selection: { anchor: at + text.length, head: at + text.length },
    };
  };
}

/** Tables, equations, page breaks and dividers in the insert menu. @beta */
export const insertPlugin: EditorPlugin = createEditorPlugin({
  key: "insert",
  components: [{ name: "table", label: "Table", icon: "table", controls: "table" }],
  insert: [
    {
      key: "table",
      label: "Table",
      description: "A table with a header row",
      icon: "table",
      group: "Basic",
      keywords: ["grid"],
      run: insertBlock(tableTemplate(3, 3)),
    },
    {
      key: "equation",
      label: "Equation",
      description: "A formula on its own line",
      icon: "radical",
      group: "Basic",
      keywords: ["math", "formula"],
      run: insertBlock("$ x = {{cursor}} $"),
    },
    {
      key: "inline-equation",
      label: "Inline equation",
      description: "A formula in the text",
      icon: "sigma",
      group: "Basic",
      keywords: ["math"],
      run: insertInline("$x$"),
    },
    {
      key: "divider",
      label: "Divider",
      description: "A horizontal line",
      icon: "minus",
      group: "Basic",
      keywords: ["line", "rule", "hr"],
      run: insertBlock("#line(length: 100%)"),
    },
    {
      key: "page-break",
      label: "Page break",
      description: "Start a new page",
      icon: "file-plus",
      group: "Basic",
      keywords: ["new page"],
      run: insertBlock("#pagebreak()"),
    },
  ],
});

/** The editor's own plugins, in toolbar order. @beta */
export const basicPlugins: readonly EditorPlugin[] = [blocksPlugin, marksPlugin, insertPlugin];

/** Shortcut names as event keys match them: `Mod-b` against a keydown. @beta */
export const matchesShortcut = (shortcut: string, event: KeyboardEvent, apple: boolean): boolean => {
  const parts = shortcut.split("-");
  let key = parts.pop() as string;
  if (key === "" && shortcut.endsWith("--")) key = "-";
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  const mod = apple ? event.metaKey : event.ctrlKey;
  if (mods.has("mod") !== mod) return false;
  if (mods.has("shift") !== event.shiftKey) return false;
  if (mods.has("alt") !== event.altKey) return false;
  if (!mods.has("mod") && (apple ? event.ctrlKey : event.metaKey)) return false;
  const k = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (k === key.toLowerCase()) return true;
  // Shift and Alt change `event.key` (Shift-8 is `*`, Alt-1 on a Mac `¡`): compare the physical key.
  const code = event.code;
  if (/^[0-9]$/.test(key)) return code === `Digit${key}`;
  if (/^[a-z]$/i.test(key)) return code === `Key${key.toUpperCase()}`;
  if (key === ",") return code === "Comma";
  if (key === ".") return code === "Period";
  return false;
};

/** A component's form fields as the plugin wrote them. @beta */
export type { EditorParamSpec };
