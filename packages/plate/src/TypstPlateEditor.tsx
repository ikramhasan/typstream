// <TypstPlateEditor>: a Typst document edited on Plate, looking as typstream's HTML target shows it. The document is
// compiled to HTML with source spans and laid out on pages by @typstream/dom's renderer, unseen; Plate renders that
// DOM over the same sheets, and every change is an edit of the Typst (session.ts, plugin.tsx).

import type { FileDelta, TypstreamPlugin } from "@typstream/core";
import type { TypstFont } from "@typstream/dom";
import type { DocumentOptions, Engine } from "@typstream/engine";
import { type TypstreamDefaults, useTypstreamDefaults, useTypstreamEngine } from "@typstream/react";
import type { SlateEditor } from "platejs";
import { Plate, PlateContent, useEditorRef, usePlateEditor } from "platejs/react";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { htmlCompat, typstFonts, universe } from "typstream";
import type { Mark } from "./commands";
import { AtomPlugin, ElementPlugin, sessions, TextView, TypstPlugin, toggleMark } from "./plugin";
import { Session } from "./session";
import { plateCss } from "./styles";
import { FixedToolbar, FloatingToolbar } from "./toolbar";

/** Props of {@link TypstPlateEditor}. @beta */
export interface TypstPlateEditorProps {
  /** The Typst document. A new one given (not the one `onChange` reported) starts the editor over with it. */
  value: string;
  /** The document after a change in the editor. */
  onChange?: (value: string) => void;
  /** The engine to compile with. Default: the provider's, else the page's shared engine (as `<Typstream>`'s). */
  engine?: Engine;
  /** Plugins after html-compat and universe (and the provider's): edu, its CSS and templates, for one. */
  plugins?: readonly TypstreamPlugin[];
  /** `sys.inputs`, over the provider's. */
  inputs?: Record<string, string>;
  /** Files the document reads. */
  files?: FileDelta;
  /** Gives the bytes of images the document names but `files` doesn't have, as `<Typstream>`'s `resolveImage`. */
  resolveImage?: DocumentOptions["resolveImage"];
  /** Typst evaluated before the document. */
  preamble?: string;
  /** Typst's fonts for the HTML (default: the engine's, `typstream`'s `typstFonts`). */
  fonts?: readonly TypstFont[];
  /** More CSS for the document, after the plugins'. */
  stylesheets?: readonly string[];
  /** `fit-width` (default): the pages scaled to the editor's width. `fixed`: at their size, scaled down to fit. */
  layout?: "fixed" | "fit-width";
  /** Show the fixed toolbar. Default true. */
  toolbar?: boolean;
  /** Show the floating toolbar over a selection. Default true. */
  floatingToolbar?: boolean;
  /** Classes of the editor's element (`.typstream-plate`), which holds the toolbar and the pages. */
  className?: string;
  /** Style of the editor's element. */
  style?: CSSProperties;
  /** Shown before the document's first compile. */
  fallback?: ReactNode;
}

const PLUGINS = [ElementPlugin, AtomPlugin, TypstPlugin];

const SHORTCUTS: Record<string, Mark> = { b: "bold", i: "italic", u: "underline", x: "strike" };

/**
 * A visual editor for Typst documents on Plate: the document as typstream's HTML target lays it out (pages, Typst's
 * fonts and spacing, plugins' components), edited in place. Typing, deleting, Enter, marks, headings and lists
 * become edits of the Typst, which compiles again; text a template or a numbering writes, equations and pictures show
 * but aren't edited. Needs a browser.
 *
 * @example
 * ```tsx
 * import { TypstPlateEditor } from "@typstream/plate";
 * import { edu } from "@typstream/edu";
 *
 * <TypstPlateEditor value={source} onChange={setSource} plugins={[edu]} />
 * ```
 * @beta
 */
export const TypstPlateEditor = (props: TypstPlateEditorProps) => {
  const defaults: TypstreamDefaults = useTypstreamDefaults();
  const engine = useTypstreamEngine(props.engine ?? defaults.engine);
  const editor = usePlateEditor(
    {
      plugins: PLUGINS,
      value: [],
      chunking: false,
      nodeId: false,
      affinity: false,
      navigationFeedback: false,
    },
    [],
  );
  const host = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [, update] = useReducer((n: number) => n + 1, 0);
  const latest = useRef(props);
  latest.current = props;

  const plugins = useMemo(
    () => [htmlCompat, universe, ...(defaults.plugins ?? []), ...(props.plugins ?? [])],
    [defaults.plugins, props.plugins],
  );
  const inputs = useMemo(() => ({ ...defaults.inputs, ...props.inputs }), [defaults.inputs, props.inputs]);
  const stylesheets = useMemo(
    () => [plateCss, ...(defaults.stylesheets ?? []), ...(props.stylesheets ?? [])],
    [defaults.stylesheets, props.stylesheets],
  );
  const fonts = props.fonts ?? defaults.fonts ?? typstFonts;
  const key = JSON.stringify([
    plugins.map((p) => p.key),
    inputs,
    props.preamble ?? defaults.preamble ?? "",
    props.layout ?? "fit-width",
    stylesheets.length,
  ]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the session starts over when what `key` names changes
  useEffect(() => {
    const el = host.current;
    if (!engine || !el) return;
    const s = new Session({
      engine,
      host: el,
      editor: editor as never,
      source: latest.current.value,
      plugins,
      inputs,
      ...(latest.current.files ? { files: latest.current.files } : {}),
      ...((latest.current.resolveImage ?? defaults.resolveImage)
        ? { resolveImage: latest.current.resolveImage ?? defaults.resolveImage }
        : {}),
      ...((props.preamble ?? defaults.preamble) ? { preamble: props.preamble ?? defaults.preamble } : {}),
      fonts,
      stylesheets,
      layout: props.layout ?? "fit-width",
      onSource: (source) => latest.current.onChange?.(source),
      onUpdate: update,
    });
    sessions.set(editor, s);
    setSession(s);
    return () => {
      sessions.delete(editor);
      s.dispose();
      setSession(null);
    };
  }, [engine, editor, key]);

  // A document from outside: the editor starts over with it.
  useEffect(() => {
    if (session && props.value !== session.source) session.reset(props.value);
  }, [session, props.value]);

  return (
    <Plate editor={editor}>
      <div className={["typstream-plate", props.className].filter(Boolean).join(" ")} style={props.style}>
        {session && props.toolbar !== false && <FixedToolbar session={session} />}
        <div className="typstream-plate-pages" ref={host}>
          {!session?.state.artifact && props.fallback}
        </div>
        {session && createPortal(<Content session={session} />, session.root)}
        {session && props.floatingToolbar !== false && <FloatingToolbar session={session} />}
      </div>
    </Plate>
  );
};

/** The editable flow, over the sheets where the renderer's flow is. */
const Content = ({ session }: { session: Session }) => {
  const editor = useEditorRef() as unknown as SlateEditor;
  const root = session.root;
  // Placed and scaled as the renderer's flow, which the pages set on every layout.
  useLayoutEffect(() => {
    const el = root.querySelector<HTMLElement>(":scope > .typstream-plate-flow");
    if (!el) return;
    el.style.cssText = session.flowStyle.cssText;
    el.style.visibility = "";
  });
  const onKeyDown = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();
    const mark = SHORTCUTS[key];
    // Strikethrough is ⌘⇧X: ⌘X cuts.
    if (!mark || (key === "x") !== event.shiftKey) return;
    event.preventDefault();
    toggleMark(editor, session, mark);
  };
  return (
    <PlateContent
      className="typstream-flow typstream-plate-flow"
      disableDefaultStyles
      aria-label="Document"
      renderText={TextView as never}
      onKeyDown={onKeyDown}
      onCompositionStart={() => session.setComposing(true)}
      onCompositionEnd={() => session.setComposing(false)}
      onDrop={(e) => e.preventDefault()}
      // Atoms aren't selectable: a click on one leaves the caret where the browser put it, not in the atom.
      onClick={(e) => {
        if ((e.target as Element).closest?.("[data-slate-void]")) e.preventDefault();
      }}
    />
  );
};
