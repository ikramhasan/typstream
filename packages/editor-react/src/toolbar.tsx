// The fixed toolbar (above the document) and the floating toolbar (over a text selection), laid
// out as Plate UI's editor-ai kit lays them out, with what Typst can write: a button exists only
// when its result is Typst a teacher could have written (`#text(fill: …)`, `#align(center)`, …).

import { flip, offset, useFloatingToolbar, useFloatingToolbarState } from "@platejs/floating";
import type { TypstreamPlugin } from "@typstream/core";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  Baseline,
  Bold,
  Code,
  Eye,
  Highlighter,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link,
  List,
  ListOrdered,
  Minus,
  MoreHorizontal,
  PaintBucket,
  PenLine,
  Plus,
  Radical,
  Redo2,
  Sparkles,
  Strikethrough,
  Subscript,
  Superscript,
  Underline,
  Undo2,
} from "lucide-react";
import { useEditorRef, useEditorSelector, useEventEditorValue } from "platejs/react";
import { type ReactNode, useRef } from "react";
import {
  type Align,
  currentAlign,
  currentKind,
  currentLink,
  hasMark,
  indentBlocks,
  insertInlineEquation,
  markValue,
  outdentBlocks,
  setAlign,
  setLink,
  setMark,
  toggleMark,
  turnInto,
} from "./commands";
import { insertGroups, KINDS, kindOption } from "./items";
import { Dropdown, type MenuGroup, PopoverButton, Separator, SourceForm, Swatches, ToolbarButton } from "./ui";

const MOD = typeof navigator !== "undefined" && /Mac|iP(hone|ad)/.test(navigator.platform) ? "⌘" : "Ctrl+";

export const MarkButton = ({
  mark,
  label,
  shortcut,
  children,
}: {
  mark: string;
  label: string;
  shortcut?: string;
  children: ReactNode;
}) => {
  const editor = useEditorRef();
  const pressed = useEditorSelector((e) => hasMark(e, mark), [mark]);
  return (
    <ToolbarButton
      label={label}
      {...(shortcut ? { shortcut } : {})}
      pressed={pressed}
      onClick={() => toggleMark(editor, mark)}
    >
      {children}
    </ToolbarButton>
  );
};

const TurnIntoMenu = () => {
  const editor = useEditorRef();
  const kind = useEditorSelector((e) => currentKind(e), []);
  const option = kindOption(kind);
  const groups = (): MenuGroup[] => [
    {
      label: "Turn into",
      items: KINDS.map((k) => ({
        key: k.kind,
        label: k.label,
        icon: k.icon,
        checked: k.kind === (kind ?? "p"),
        onSelect: () => turnInto(editor, k.kind),
      })),
    },
  ];
  return (
    <Dropdown label="Turn into" trigger={<span className="ts-button-label">{option.label}</span>} groups={groups} />
  );
};

const InsertMenu = ({ plugins }: { plugins: readonly TypstreamPlugin[] }) => {
  const editor = useEditorRef();
  return <Dropdown label="Insert" trigger={<Plus />} groups={() => insertGroups(editor, plugins, false)} />;
};

const ALIGNS: { value: Align; label: string; icon: ReactNode }[] = [
  { value: "left", label: "Align left", icon: <AlignLeft /> },
  { value: "center", label: "Align center", icon: <AlignCenter /> },
  { value: "right", label: "Align right", icon: <AlignRight /> },
  { value: "justify", label: "Justify", icon: <AlignJustify /> },
];

const AlignMenu = () => {
  const editor = useEditorRef();
  const align = useEditorSelector((e) => currentAlign(e), []);
  const current = ALIGNS.find((a) => a.value === align) ?? (ALIGNS[0] as (typeof ALIGNS)[number]);
  return (
    <Dropdown
      label="Align"
      trigger={current.icon}
      groups={() => [
        {
          items: ALIGNS.map((a) => ({
            key: a.value,
            label: a.label,
            icon: a.icon,
            checked: a.value === align,
            onSelect: () => setAlign(editor, a.value),
          })),
        },
      ]}
    />
  );
};

const ColorButton = ({ mark, label, icon }: { mark: "color" | "backgroundColor"; label: string; icon: ReactNode }) => {
  const editor = useEditorRef();
  const value = useEditorSelector((e) => markValue(e, mark), [mark]);
  return (
    <PopoverButton
      label={label}
      trigger={
        <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
          {icon}
          <span
            style={{
              width: 14,
              height: 3,
              borderRadius: 1,
              background: value ?? "currentColor",
              opacity: value ? 1 : 0.3,
            }}
          />
        </span>
      }
    >
      {(close) => (
        <Swatches
          value={value}
          onPick={(color) => {
            setMark(editor, mark, color);
            close();
          }}
          onClear={() => {
            setMark(editor, mark, undefined);
            close();
          }}
        />
      )}
    </PopoverButton>
  );
};

/** Font size in points (`#text(size: 14pt)`); Typst's default is 11pt. */
const FontSize = () => {
  const editor = useEditorRef();
  const value = useEditorSelector((e) => markValue(e, "fontSize"), []);
  const size = value ? Number.parseFloat(value) : 11;
  const set = (next: number) =>
    setMark(editor, "fontSize", next === 11 ? undefined : `${Math.max(4, Math.min(96, next))}pt`);
  return (
    <div className="ts-font-size">
      <ToolbarButton label="Decrease font size" onClick={() => set(size - 1)}>
        <Minus />
      </ToolbarButton>
      <input
        aria-label="Font size (pt)"
        title="Font size (pt)"
        value={Number.isFinite(size) ? size : 11}
        onChange={(event) => {
          const next = Number.parseFloat(event.target.value);
          if (Number.isFinite(next)) set(next);
        }}
      />
      <ToolbarButton label="Increase font size" onClick={() => set(size + 1)}>
        <Plus />
      </ToolbarButton>
    </div>
  );
};

const LinkButton = () => {
  const editor = useEditorRef();
  const url = useEditorSelector((e) => currentLink(e), []);
  const saved = useRef(editor.selection);
  return (
    <PopoverButton
      label="Link"
      trigger={<Link />}
      pressed={Boolean(url)}
      onOpen={() => (saved.current = editor.selection)}
    >
      {(close) => (
        <SourceForm
          label="Link"
          initial={url ?? "https://"}
          placeholder="https://"
          applyLabel={url ? "Update" : "Add link"}
          onCancel={close}
          onApply={(value) => {
            close();
            if (saved.current) editor.tf.select(saved.current);
            setLink(editor, value);
          }}
        />
      )}
    </PopoverButton>
  );
};

const EquationButton = () => {
  const editor = useEditorRef();
  const saved = useRef(editor.selection);
  return (
    <PopoverButton label="Inline equation" trigger={<Radical />} onOpen={() => (saved.current = editor.selection)}>
      {(close) => (
        <SourceForm
          label="Equation (Typst math)"
          initial={saved.current ? editor.api.string(saved.current) : ""}
          placeholder="a^2 + b^2 = c^2"
          applyLabel="Insert"
          onCancel={close}
          onApply={(value) => {
            close();
            if (saved.current) editor.tf.select(saved.current);
            if (editor.api.isExpanded()) editor.tf.delete();
            insertInlineEquation(editor, value.trim());
          }}
        />
      )}
    </PopoverButton>
  );
};

const MoreMenu = () => {
  const editor = useEditorRef();
  const groups = (): MenuGroup[] => [
    {
      items: [
        {
          key: "subscript",
          label: "Subscript",
          icon: <Subscript />,
          checked: hasMark(editor, "subscript"),
          onSelect: () => toggleMark(editor, "subscript"),
        },
        {
          key: "superscript",
          label: "Superscript",
          icon: <Superscript />,
          checked: hasMark(editor, "superscript"),
          onSelect: () => toggleMark(editor, "superscript"),
        },
        {
          key: "highlight",
          label: "Highlight",
          icon: <Highlighter />,
          checked: hasMark(editor, "highlight"),
          onSelect: () => toggleMark(editor, "highlight"),
        },
      ],
    },
  ];
  return <Dropdown label="More" trigger={<MoreHorizontal />} groups={groups} chevron={false} />;
};

const ListButtons = () => {
  const editor = useEditorRef();
  const kind = useEditorSelector((e) => currentKind(e), []);
  return (
    <>
      <ToolbarButton
        label="Bulleted list"
        pressed={kind === "ul"}
        onClick={() => turnInto(editor, kind === "ul" ? "p" : "ul")}
      >
        <List />
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        pressed={kind === "ol"}
        onClick={() => turnInto(editor, kind === "ol" ? "p" : "ol")}
      >
        <ListOrdered />
      </ToolbarButton>
      <ToolbarButton label="Outdent" onClick={() => outdentBlocks(editor)}>
        <IndentDecrease />
      </ToolbarButton>
      <ToolbarButton label="Indent" onClick={() => indentBlocks(editor)}>
        <IndentIncrease />
      </ToolbarButton>
    </>
  );
};

/** What the toolbars can do besides editing, from the editor component. */
export interface ToolbarActions {
  plugins: readonly TypstreamPlugin[];
  onAskAI?: (() => void) | undefined;
  exports?: MenuGroup | undefined;
  onImport?: (() => void) | undefined;
  readOnly: boolean;
  setReadOnly?: ((readOnly: boolean) => void) | undefined;
}

export const FixedToolbar = ({ plugins, onAskAI, exports, onImport, readOnly, setReadOnly }: ToolbarActions) => {
  const editor = useEditorRef();
  const canUndo = useEditorSelector((e) => e.history.undos.length > 0, []);
  const canRedo = useEditorSelector((e) => e.history.redos.length > 0, []);
  return (
    <div className="ts-toolbar ts-fixed-toolbar" role="toolbar" aria-label="Formatting">
      {!readOnly ? (
        <>
          <div className="ts-toolbar-group">
            <ToolbarButton label="Undo" shortcut={`${MOD}Z`} disabled={!canUndo} onClick={() => editor.tf.undo()}>
              <Undo2 />
            </ToolbarButton>
            <ToolbarButton label="Redo" shortcut={`${MOD}Shift+Z`} disabled={!canRedo} onClick={() => editor.tf.redo()}>
              <Redo2 />
            </ToolbarButton>
          </div>
          <Separator />
          {onAskAI ? (
            <>
              <ToolbarButton label="Ask AI" className="ts-button-ai" showLabel onClick={onAskAI}>
                <Sparkles />
              </ToolbarButton>
              <Separator />
            </>
          ) : null}
        </>
      ) : null}
      {exports || onImport ? (
        <div className="ts-toolbar-group">
          {exports ? <Dropdown label="Export" trigger={<ArrowDownToLine />} groups={[exports]} /> : null}
          {onImport && !readOnly ? (
            <ToolbarButton label="Import a Typst file" onClick={onImport}>
              <ArrowUpToLine />
            </ToolbarButton>
          ) : null}
        </div>
      ) : null}
      {!readOnly ? (
        <>
          <Separator />
          <div className="ts-toolbar-group">
            <InsertMenu plugins={plugins} />
            <TurnIntoMenu />
            <FontSize />
          </div>
          <Separator />
          <div className="ts-toolbar-group">
            <MarkButton mark="bold" label="Bold" shortcut={`${MOD}B`}>
              <Bold />
            </MarkButton>
            <MarkButton mark="italic" label="Italic" shortcut={`${MOD}I`}>
              <Italic />
            </MarkButton>
            <MarkButton mark="underline" label="Underline" shortcut={`${MOD}U`}>
              <Underline />
            </MarkButton>
            <MarkButton mark="strikethrough" label="Strikethrough" shortcut={`${MOD}Shift+X`}>
              <Strikethrough />
            </MarkButton>
            <MarkButton mark="code" label="Code" shortcut={`${MOD}E`}>
              <Code />
            </MarkButton>
            <ColorButton mark="color" label="Text color" icon={<Baseline />} />
            <ColorButton mark="backgroundColor" label="Highlight color" icon={<PaintBucket />} />
          </div>
          <Separator />
          <div className="ts-toolbar-group">
            <AlignMenu />
            <ListButtons />
          </div>
          <Separator />
          <div className="ts-toolbar-group">
            <LinkButton />
            <EquationButton />
            <MoreMenu />
          </div>
        </>
      ) : null}
      <div className="ts-spacer" />
      {setReadOnly ? (
        <Dropdown
          label="Mode"
          trigger={
            <>
              {readOnly ? <Eye /> : <PenLine />}
              <span className="ts-button-label">{readOnly ? "Viewing" : "Editing"}</span>
            </>
          }
          placement="bottom-end"
          groups={[
            {
              items: [
                {
                  key: "editing",
                  label: "Editing",
                  icon: <PenLine />,
                  hint: "Edit the document",
                  checked: !readOnly,
                  onSelect: () => setReadOnly(false),
                },
                {
                  key: "viewing",
                  label: "Viewing",
                  icon: <Eye />,
                  hint: "Read only",
                  checked: readOnly,
                  onSelect: () => setReadOnly(true),
                },
              ],
            },
          ]}
        />
      ) : null}
    </div>
  );
};

/** Plate UI's floating toolbar: over a non-empty selection, while the editor has focus. */
export const FloatingToolbar = ({ onAskAI }: { onAskAI?: (() => void) | undefined }) => {
  const editor = useEditorRef();
  const focusedEditorId = useEventEditorValue("focus");
  const state = useFloatingToolbarState({
    editorId: editor.id,
    focusedEditorId,
    floatingOptions: {
      placement: "top",
      strategy: "fixed",
      middleware: [
        offset(12),
        flip({ fallbackPlacements: ["top-start", "top-end", "bottom-start", "bottom-end"], padding: 12 }),
      ],
    },
  });
  const { clickOutsideRef, hidden, props, ref } = useFloatingToolbar(state);
  if (hidden) return null;
  return (
    <div ref={clickOutsideRef}>
      <div
        ref={ref}
        {...props}
        className="ts-toolbar ts-floating-toolbar"
        role="toolbar"
        aria-label="Selection formatting"
      >
        {onAskAI ? (
          <>
            <ToolbarButton label="Ask AI" className="ts-button-ai" showLabel onClick={onAskAI}>
              <Sparkles />
            </ToolbarButton>
            <Separator />
          </>
        ) : null}
        <TurnIntoMenu />
        <Separator />
        <MarkButton mark="bold" label="Bold" shortcut={`${MOD}B`}>
          <Bold />
        </MarkButton>
        <MarkButton mark="italic" label="Italic" shortcut={`${MOD}I`}>
          <Italic />
        </MarkButton>
        <MarkButton mark="underline" label="Underline" shortcut={`${MOD}U`}>
          <Underline />
        </MarkButton>
        <MarkButton mark="strikethrough" label="Strikethrough" shortcut={`${MOD}Shift+X`}>
          <Strikethrough />
        </MarkButton>
        <MarkButton mark="code" label="Code" shortcut={`${MOD}E`}>
          <Code />
        </MarkButton>
        <Separator />
        <LinkButton />
        <EquationButton />
        <ColorButton mark="color" label="Text color" icon={<Baseline />} />
        <MoreMenu />
      </div>
    </div>
  );
};
