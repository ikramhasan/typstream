// <TypstEditor>: a Typst document edited on its own pages (#36). It opens the document as
// <Typstream> does (the provider's engine and settings, the plugins' files, packages and
// preambles, a template), shows its pages as the page view does, and puts @typstream/editor-core's
// editor on them, with Plate's chrome around it: the fixed toolbar, the floating toolbar over a
// selection, the insert and slash menus, and bars over components (settings, table rows and
// columns, an equation's formula).

import type { FileDelta, TypstreamPlugin } from "@typstream/core";
import {
  basicPlugins,
  createEditor,
  type EditorPlugin,
  type EditorView,
  fromTypstreamPlugin,
} from "@typstream/editor-core";
import type { DocumentOptions, Engine, EngineDocument, ImageResolver } from "@typstream/engine";
import { acquireEngine, releaseEngine, useTypstreamDefaults } from "@typstream/react";
import { loadSyntax } from "@typstream/syntax";
import {
  type CSSProperties,
  forwardRef,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { SlashMenu } from "./insert";
import { ComponentBar, EquationPanel } from "./panels";
import { ensureEditorStyles } from "./styles";
import { FixedToolbar, FloatingToolbar } from "./toolbar";

/** Props of {@link TypstEditor}. @beta */
export interface TypstEditorProps {
  /** The document's Typst. Changing it from outside replaces the text (one edit, kept in the history). */
  source: string;
  /** Called with the new source after every change made in the editor. */
  onChange?: (source: string) => void;
  /**
   * typstream plugins: their engine facets (files, packages, preambles) and their `editor` facets
   * (components in the insert menu, with forms). Default: the provider's.
   */
  plugins?: readonly TypstreamPlugin[];
  /** Editor plugins added to the editor's own (`basicPlugins`: marks, blocks, inserts) and the typstream plugins'. */
  editorPlugins?: readonly EditorPlugin[];
  /** Typst evaluated before the document, after the plugins' and the template's. Default: the provider's. */
  preamble?: string;
  /** A template of the plugins', by name: its preamble and inputs apply. Default: the provider's. */
  template?: string;
  /** `sys.inputs`, over the template's. */
  inputs?: Record<string, string>;
  /** Files the document reads. */
  files?: FileDelta;
  /** Resolves images the document names but has no file for (as `<Typstream>`'s). */
  resolveImage?: DocumentOptions["resolveImage"];
  /** The engine; default the provider's, else the page's shared worker. */
  engine?: Engine;
  /** How the pages sit in the editor: as the page view's `layout`. Default `fixed`. */
  layout?: "fixed" | "fit-width";
  /** Show the fixed toolbar (default true). */
  toolbar?: boolean;
  /** Show the floating toolbar over a selection (default true). */
  floatingToolbar?: boolean;
  /** At the fixed toolbar's end: the app's own buttons (Done, Save). */
  toolbarEnd?: ReactNode;
  /** At the floating toolbar's start (an "Ask AI" button), given the editor. */
  floatingStart?: (view: EditorView) => ReactNode;
  /** Focus the document once it is laid out. */
  autoFocus?: boolean;
  /** Read-only: select and copy, no changes. */
  readOnly?: boolean;
  /** Class of the root element. */
  className?: string;
  /** Style of the root element. */
  style?: CSSProperties;
  /** Called once the editor is mounted, with its view (commands, selection, history). */
  onReady?: (view: EditorView) => void;
}

/** What a ref to {@link TypstEditor} holds. @beta */
export interface TypstEditorHandle {
  /** The editor, once mounted. */
  readonly view: EditorView | null;
  /** The engine document the editor compiles. */
  readonly document: EngineDocument | null;
  /** Focuses the document. */
  focus(): void;
}

const NO_PLUGINS: readonly TypstreamPlugin[] = [];
const NO_EDITOR_PLUGINS: readonly EditorPlugin[] = [];

/** A list of plugins as a key that changes only when their keys do. */
const keysOf = (plugins: readonly { key: string }[]): string => plugins.map((p) => p.key).join("\u0000");

/** Re-renders whenever the view changes (state, layout, focus). */
const useViewVersion = (view: EditorView | null): number => {
  const [version, setVersion] = useState(0);
  useEffect(() => view?.subscribe(() => setVersion((v) => v + 1)), [view]);
  return version;
};

/**
 * The typstream editor: `source` shown as its pages and edited on them.
 * @beta
 */
export const TypstEditor = forwardRef<TypstEditorHandle, TypstEditorProps>(function TypstEditor(props, ref) {
  const defaults = useTypstreamDefaults();
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<EditorView | null>(null);
  const [doc, setDoc] = useState<EngineDocument | null>(null);
  const [slash, setSlash] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const plugins = props.plugins ?? defaults.plugins ?? NO_PLUGINS;
  const template = props.template ?? defaults.template;
  const preamble = props.preamble ?? defaults.preamble;
  const inputs = props.inputs ?? defaults.inputs;
  const files = props.files ?? defaults.files;
  const resolveImage = props.resolveImage ?? defaults.resolveImage;
  const layout = props.layout ?? (defaults.layout === "fit-width" ? "fit-width" : "fixed");
  const latest = useRef(props);
  latest.current = props;
  /** The source the editor last reported, so the prop echoing it back changes nothing. */
  const emitted = useRef(props.source);

  // The document opens again when what it is opened with changes: its engine, plugins (by key, so
  // arrays written inline don't reopen it on every render), preamble, layout. Opening again drops the
  // caret and the history; the text is kept.
  const pluginKeys = keysOf(plugins);
  const editorPluginKeys = keysOf(props.editorPlugins ?? NO_EDITOR_PLUGINS);
  const opened = useRef({ plugins, editorPlugins: props.editorPlugins, resolveImage });
  opened.current = { plugins, editorPlugins: props.editorPlugins, resolveImage };
  const templateSpec = template
    ? plugins
        .flatMap((p) => p.templates ?? [])
        .filter((t) => t.name === template)
        .pop()
    : undefined;
  const fullPreamble = [templateSpec?.preamble, preamble].filter(Boolean).join("\n");
  const allInputs = useMemo(() => ({ ...templateSpec?.inputs, ...inputs }), [templateSpec, inputs]);
  const engineProp = props.engine ?? defaults.engine;

  useLayoutEffect(() => {
    if (host.current) ensureEditorStyles(host.current.ownerDocument);
  }, []);

  // Files, inputs and the source change the open document instead (below); plugins and
  // `resolveImage` are read through `opened` (their keys and presence say when to reopen).
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let cancelled = false;
    const engine = engineProp ?? acquireEngine();
    const shared = !engineProp;
    let document: EngineDocument | null = null;
    let mounted: EditorView | null = null;
    const { plugins, editorPlugins: extra } = opened.current;
    const editorPlugins = [
      ...basicPlugins,
      ...plugins.map(fromTypstreamPlugin).filter((p): p is EditorPlugin => p !== null),
      ...(extra ?? []),
    ];
    const images = !!opened.current.resolveImage;
    // Typst's parser (the commands' syntax tree) loads once, a few tens of KB.
    loadSyntax()
      .then(() => {
        if (cancelled) return;
        // The editor's text: what it last reported, or the source given since.
        const source = emitted.current;
        document = engine.open({
          target: "paged",
          pageFormat: "drawing",
          positions: true,
          text: source,
          files: files ?? {},
          ...(Object.keys(allInputs).length ? { inputs: allInputs } : {}),
          ...(plugins.length ? { plugins } : {}),
          ...(fullPreamble ? { preamble: fullPreamble } : {}),
          ...(images
            ? {
                resolveImage: ((path, o) => opened.current.resolveImage?.(path, o) ?? null) satisfies ImageResolver,
              }
            : {}),
        });
        mounted = createEditor(el, {
          doc: document,
          text: source,
          plugins: editorPlugins,
          layout,
          readOnly: latest.current.readOnly,
          onChange: (text) => {
            emitted.current = text;
            latest.current.onChange?.(text);
          },
        });
        emitted.current = source;
        setDoc(document);
        setView(mounted);
        latest.current.onReady?.(mounted);
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailed(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
      mounted?.destroy();
      document?.dispose();
      setView(null);
      setDoc(null);
      if (shared) releaseEngine();
    };
  }, [engineProp, pluginKeys, editorPluginKeys, fullPreamble, layout, !!resolveImage]);

  // A source from outside (an AI edit, a reload): one edit.
  useEffect(() => {
    if (!view || props.source === emitted.current) return;
    emitted.current = props.source;
    view.setText(props.source);
  }, [view, props.source]);
  useEffect(() => {
    if (doc && Object.keys(allInputs).length) doc.setInputs(allInputs);
  }, [doc, allInputs]);
  useEffect(() => {
    if (doc && files) doc.setFiles(files);
  }, [doc, files]);

  // Focus once the first pages are laid out.
  const version = useViewVersion(view);
  const focusedOnce = useRef(false);
  // `version` changes with the view's layout.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (!props.autoFocus || focusedOnce.current || !view?.layout) return;
    focusedOnce.current = true;
    view.focus();
  }, [props.autoFocus, view, version]);

  // `/` on an empty line opens the insert menu at the caret.
  useEffect(() => {
    if (!view || props.readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const { text, selection } = view.state;
      if (selection.anchor !== selection.head) return;
      const lineStart = text.lastIndexOf("\n", selection.head - 1) + 1;
      const lineEnd = text.indexOf("\n", selection.head);
      const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
      if (line.trim() !== "") return;
      e.preventDefault();
      e.stopPropagation();
      setSlash(true);
    };
    view.element.addEventListener("keydown", onKey, true);
    return () => view.element.removeEventListener("keydown", onKey, true);
  }, [view, props.readOnly]);

  useImperativeHandle(ref, () => ({ view, document: doc, focus: () => view?.focus() }), [view, doc]);

  const className = props.className ? `tse-root ${props.className}` : "tse-root";
  return (
    <div className={className} style={props.style} data-layout={layout}>
      {view && props.toolbar !== false && !props.readOnly && <FixedToolbar view={view} end={props.toolbarEnd} />}
      {!view && props.toolbar !== false && !props.readOnly && (
        <div className="tse-toolbar tse-fixed" aria-hidden="true" style={{ minHeight: 40 }} />
      )}
      <div ref={host} className="tse-pages" />
      {failed && (
        <p className="tse-status" role="alert">
          The editor couldn't start: {failed}
        </p>
      )}
      {view && !props.readOnly && (
        <>
          {props.floatingToolbar !== false && <FloatingToolbar view={view} extra={props.floatingStart?.(view)} />}
          <ComponentBar view={view} />
          <EquationPanel view={view} />
          {slash && <SlashMenu view={view} onClose={() => setSlash(false)} />}
        </>
      )}
    </div>
  );
});
