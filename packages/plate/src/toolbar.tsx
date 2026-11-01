// The editor's toolbars, after Plate UI's: a fixed one above the pages (undo, block type, marks, lists, the
// document's status) and a floating one over a selection (marks). Their buttons run the plugin's commands, which edit
// the Typst.

import type { SlateEditor } from "platejs";
import { useEditorRef, useEditorSelector } from "platejs/react";
import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { BlockKind, Mark } from "./commands";
import { activeBlock, activeMarks, setBlockKind, toggleMark } from "./plugin";
import type { Session } from "./session";

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

const ICONS = {
  undo: "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  redo: "m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13",
  bold: "M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8",
  italic: "M19 4h-9M14 20H5M15 4 9 20",
  underline: "M6 4v6a6 6 0 0 0 12 0V4M4 20h16",
  strike: "M16 4H9a3 3 0 0 0-2.83 4M14 12a4 4 0 0 1 0 8H6M4 12h16",
  bullet: "M3 12h.01M3 18h.01M3 6h.01M8 12h13M8 18h13M8 6h13",
  numbered: "M10 12h11M10 18h11M10 6h11M4 10h2M4 6h1v4M6 18H4c0-1 2-2 2-3s-1-1.5-2-1",
};

const MARKS: { mark: Mark; label: string; keys: string }[] = [
  { mark: "bold", label: "Bold", keys: "⌘B" },
  { mark: "italic", label: "Italic", keys: "⌘I" },
  { mark: "underline", label: "Underline", keys: "⌘U" },
  { mark: "strike", label: "Strikethrough", keys: "⌘⇧X" },
];

const BLOCKS: { kind: BlockKind; label: string }[] = [
  { kind: "paragraph", label: "Text" },
  { kind: "h1", label: "Heading 1" },
  { kind: "h2", label: "Heading 2" },
  { kind: "h3", label: "Heading 3" },
  { kind: "bullet", label: "Bulleted list" },
  { kind: "numbered", label: "Numbered list" },
];

const Button = ({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) => (
  <button
    type="button"
    className="typstream-plate-button"
    title={label}
    aria-label={label}
    {...(pressed !== undefined ? { "aria-pressed": pressed } : {})}
    disabled={disabled}
    // The selection stays in the document.
    onMouseDown={(e) => e.preventDefault()}
    onClick={onClick}
  >
    {children}
  </button>
);

/** Re-renders with the selection, the value and the session's state. */
const useActive = (session: Session) => {
  const editor = useEditorRef() as unknown as SlateEditor;
  useEditorSelector((e) => e.selection, []);
  useEditorSelector((e) => e.children, []);
  return { editor, marks: activeMarks(editor, session), block: activeBlock(editor, session) };
};

const MarkButtons = ({ session }: { session: Session }) => {
  const { editor, marks } = useActive(session);
  return (
    <>
      {MARKS.map(({ mark, label, keys }) => (
        <Button
          key={mark}
          label={`${label} (${keys})`}
          pressed={marks.has(mark)}
          onClick={() => toggleMark(editor, session, mark)}
        >
          <Icon d={ICONS[mark]} />
        </Button>
      ))}
    </>
  );
};

/** The fixed toolbar. @internal */
export const FixedToolbar = ({ session }: { session: Session }) => {
  const { editor, block } = useActive(session);
  const state = session.state;
  const error = state.status === "error";
  return (
    <div className="typstream-plate-toolbar" role="toolbar" aria-label="Formatting">
      <Button label="Undo (⌘Z)" disabled={!session.canUndo} onClick={() => session.undo()}>
        <Icon d={ICONS.undo} />
      </Button>
      <Button label="Redo (⌘⇧Z)" disabled={!session.canRedo} onClick={() => session.redo()}>
        <Icon d={ICONS.redo} />
      </Button>
      <span className="typstream-plate-sep" />
      <select
        className="typstream-plate-select"
        aria-label="Block type"
        value={block ?? "paragraph"}
        disabled={block === null}
        onChange={(e) => setBlockKind(editor, session, e.target.value as BlockKind)}
      >
        {BLOCKS.map(({ kind, label }) => (
          <option key={kind} value={kind}>
            {label}
          </option>
        ))}
      </select>
      <span className="typstream-plate-sep" />
      <MarkButtons session={session} />
      <span className="typstream-plate-sep" />
      <Button
        label="Bulleted list"
        pressed={block === "bullet"}
        onClick={() => setBlockKind(editor, session, "bullet")}
      >
        <Icon d={ICONS.bullet} />
      </Button>
      <Button
        label="Numbered list"
        pressed={block === "numbered"}
        onClick={() => setBlockKind(editor, session, "numbered")}
      >
        <Icon d={ICONS.numbered} />
      </Button>
      <span className="typstream-plate-status" {...(error ? { "data-error": "" } : {})} aria-live="polite">
        {error
          ? `Doesn't compile: ${state.diagnostics.find((d) => d.severity === "error")?.message ?? "error"}`
          : state.status === "compiling" || session.stale
            ? "Updating…"
            : ""}
      </span>
    </div>
  );
};

/** The floating toolbar, over a selection in the document. @internal */
export const FloatingToolbar = ({ session }: { session: Session }) => {
  const editor = useEditorRef();
  const selection = useEditorSelector((e) => e.selection, []);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    const collapsed =
      !selection ||
      (selection.anchor.offset === selection.focus.offset &&
        selection.anchor.path.join() === selection.focus.path.join());
    const dom = session.root.ownerDocument.getSelection();
    if (collapsed || !dom || dom.rangeCount === 0 || !editor.api.isFocused()) {
      setAt(null);
      return;
    }
    const rect = dom.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) {
      setAt(null);
      return;
    }
    setAt({ left: rect.left + rect.width / 2, top: rect.top - 44 });
  }, [selection, editor, session]);
  if (!at) return null;
  return createPortal(
    <div
      className="typstream-plate-floating"
      role="toolbar"
      aria-label="Selection"
      style={{ left: at.left, top: Math.max(4, at.top), transform: "translateX(-50%)" }}
    >
      <MarkButtons session={session} />
    </div>,
    session.root.ownerDocument.body,
  );
};
