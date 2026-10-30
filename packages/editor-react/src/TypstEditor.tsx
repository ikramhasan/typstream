// <TypstEditor>: a Typst document edited as rich text with Plate (PLAN §10.3, #36). The source is
// the document; Plate's value is derived from it by @typstream/editor-core, and every change in
// the editor comes back out as one `TextEdit` of the source (`onChange`). Blocks the teacher
// doesn't touch keep their source exactly. Code the editor can't show as rich text shows
// compiled, from a hidden `<Typstream>` of the whole document (preview.tsx).

import type { Range, TextEdit, TypstreamPlugin } from "@typstream/core";
import { TypstDocument, type TypstValue } from "@typstream/editor-core";
import { type TypstreamHandle, type TypstreamProps, useTypstreamDefaults } from "@typstream/react";
import { isSyntaxLoaded, loadSyntax, type SyntaxWasmInput } from "@typstream/syntax";
import { Braces, FileDown, FileText, Globe } from "lucide-react";
import type { Value } from "platejs";
import { Plate, PlateContent, type PlateEditor, usePlateEditor } from "platejs/react";
import {
  type CSSProperties,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { selectionSourceRange } from "./commands";
import { editorPlugins } from "./plugins";
import { PreviewProvider, PreviewStore } from "./preview";
import { type SlashKeys, SlashMenu } from "./slash";
import { injectEditorCss } from "./styles";
import { FixedToolbar, FloatingToolbar } from "./toolbar";
import type { MenuGroup } from "./ui";

/**
 * What "Ask AI" passes to the app: the selected text and the source range of the blocks it is in,
 * which `@typstream/ai`'s edit session can stream into.
 * @beta
 */
export interface AskAIRequest {
  /** The selected text (empty when nothing is selected). */
  text: string;
  /** The source range of the selected top-level blocks, or null without a selection. */
  range: Range | null;
  /** The whole source. */
  source: string;
}

/**
 * Props of {@link TypstEditor}.
 * @beta
 */
export interface TypstEditorProps {
  /** The document, controlled: a new value that isn't the editor's own replaces what it shows. */
  source?: string;
  /** The document to start with when `source` isn't controlled. */
  defaultSource?: string;
  /** Called with the new source and the edit that made it, after each change in the editor. */
  onChange?: (source: string, edit: TextEdit) => void;
  /**
   * Plugins: their `editor` facets add to the insert and slash menus; the previews compile with
   * them. Default: the nearest `TypstreamProvider`'s.
   */
  plugins?: readonly TypstreamPlugin[];
  /**
   * Settings of the hidden compile the previews come from (`engine`, `mathFont`, …, as
   * `<Typstream>`'s), or `false` to show code as source. Default: the provider's settings.
   */
  preview?: Omit<TypstreamProps, "source" | "ref" | "plugins" | "target"> | false;
  /** Which toolbars to show. Default `"both"`, as Plate's editor. */
  toolbar?: "both" | "fixed" | "floating" | "none";
  /** Read only. With `modeSwitch`, the initial mode. */
  readOnly?: boolean;
  /** Show the Editing / Viewing switch at the end of the fixed toolbar. Default true. */
  modeSwitch?: boolean;
  /** Shows "Ask AI" in both toolbars, which calls this. */
  onAskAI?: (request: AskAIRequest) => void;
  /** Shown in an empty document. */
  placeholder?: string;
  /** Focus the editor when it opens. */
  autoFocus?: boolean;
  /** Where Typst's parser comes from (`@typstream/syntax`'s `loadSyntax`). Default: next to its module. */
  syntaxWasm?: SyntaxWasmInput | Promise<SyntaxWasmInput>;
  /** Of the editor's root element. */
  className?: string;
  /** Of the editor's root element. */
  style?: CSSProperties;
  /** Receives the editor's {@link TypstEditorHandle}. */
  ref?: Ref<TypstEditorHandle>;
}

/**
 * A `<TypstEditor>` instance.
 * @beta
 */
export interface TypstEditorHandle {
  /** The current source. */
  readonly source: string;
  /** The Plate editor, once the parser has loaded. */
  readonly editor: PlateEditor | null;
  /** Replaces the document (an edit from outside the editor), keeping unchanged blocks. */
  setSource(source: string): void;
  /** Focuses the editor. */
  focus(): void;
}

const useSyntax = (wasm: TypstEditorProps["syntaxWasm"]): boolean => {
  const [ready, setReady] = useState(isSyntaxLoaded);
  useEffect(() => {
    if (ready) return;
    let live = true;
    loadSyntax(wasm).then(
      () => live && setReady(true),
      (error: unknown) => globalThis.reportError?.(error),
    );
    return () => {
      live = false;
    };
  }, [ready, wasm]);
  return ready;
};

/**
 * The visual editor: Typst edited as rich text, with Plate's fixed and floating toolbars, a slash
 * menu and compiled previews of code.
 *
 * @example
 * ```tsx
 * const [source, setSource] = useState("= Fractions\n\nAdd $1/2 + 1/4$.");
 * <TypstEditor source={source} onChange={setSource} plugins={[edu]} />
 * <Typstream source={source} target="paged" plugins={[edu]} />
 * ```
 * @beta
 */
export const TypstEditor = (props: TypstEditorProps) => {
  const ready = useSyntax(props.syntaxWasm);
  const inject = useCallback((node: HTMLDivElement | null) => {
    if (node) injectEditorCss(node);
  }, []);
  if (!ready) {
    return (
      <div ref={inject} className={`ts-editor${props.className ? ` ${props.className}` : ""}`} style={props.style}>
        <div className="ts-loading">Loading the editor…</div>
      </div>
    );
  }
  return <Editor {...props} />;
};

const download = (data: Uint8Array | string, type: string, name: string): void => {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const Editor = (props: TypstEditorProps) => {
  const defaults = useTypstreamDefaults();
  const plugins = props.plugins ?? defaults.plugins ?? [];
  // Parsed once: later sources come through `replace`, which keeps unchanged blocks.
  const [doc] = useState(() => new TypstDocument(props.source ?? props.defaultSource ?? ""));
  const [source, setSource] = useState(doc.source);
  const [readOnly, setReadOnly] = useState(props.readOnly ?? false);
  useEffect(() => setReadOnly(props.readOnly ?? false), [props.readOnly]);
  const store = useMemo(() => new PreviewStore(), []);
  const handle = useRef<TypstreamHandle | null>(null);
  const slashKeys = useRef<SlashKeys | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const onChange = useRef(props.onChange);
  onChange.current = props.onChange;

  // Normalized at once, so Plate numbers list items (its `listStart`, which is never written).
  const editor = usePlateEditor({
    plugins: editorPlugins(),
    value: doc.value as unknown as Value,
    shouldNormalizeEditor: true,
  });
  // Normalizing isn't the teacher's edit: nothing to undo yet.
  useState(() => {
    editor.history.undos = [];
    editor.history.redos = [];
  });

  const replace = useCallback(
    (next: string) => {
      if (next === doc.source) return;
      const value = doc.setSource(next);
      editor.tf.setValue(value as unknown as Value);
      setSource(doc.source);
    },
    [doc, editor],
  );

  // A controlled `source` that isn't the editor's own is an edit from outside.
  useEffect(() => {
    if (props.source !== undefined) replace(props.source);
  }, [props.source, replace]);

  useImperativeHandle(
    props.ref,
    () => ({
      get source() {
        return doc.source;
      },
      editor,
      setSource: replace,
      focus: () => editor.tf.focus(),
    }),
    [doc, editor, replace],
  );

  const askAI = props.onAskAI
    ? () =>
        props.onAskAI?.({
          text: editor.selection ? editor.api.string(editor.selection) : "",
          range: selectionSourceRange(editor, doc),
          source: doc.source,
        })
    : undefined;

  const previewOptions = props.preview === false ? null : (props.preview ?? {});
  const exports: MenuGroup | undefined = previewOptions
    ? {
        label: "Export",
        items: [
          {
            key: "pdf",
            label: "PDF",
            icon: <FileDown />,
            onSelect: () =>
              void handle.current
                ?.exportPdf()
                .then((pdf) => download(pdf, "application/pdf", "document.pdf"), reportError),
          },
          {
            key: "docx",
            label: "Word (.docx)",
            icon: <FileText />,
            onSelect: () =>
              void handle.current
                ?.exportDocx()
                .then(
                  (docx) =>
                    download(
                      docx,
                      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                      "document.docx",
                    ),
                  reportError,
                ),
          },
          {
            key: "html",
            label: "HTML",
            icon: <Globe />,
            onSelect: () =>
              void handle.current
                ?.exportHtml()
                .then((html) => download(html, "text/html", "document.html"), reportError),
          },
          {
            key: "typst",
            label: "Typst (.typ)",
            icon: <Braces />,
            onSelect: () => download(doc.source, "text/plain", "document.typ"),
          },
        ],
      }
    : {
        label: "Export",
        items: [
          {
            key: "typst",
            label: "Typst (.typ)",
            icon: <Braces />,
            onSelect: () => download(doc.source, "text/plain", "document.typ"),
          },
        ],
      };

  const toolbar = props.toolbar ?? "both";
  const inject = useCallback((node: HTMLDivElement | null) => {
    if (node) injectEditorCss(node);
  }, []);

  return (
    <div ref={inject} className={`ts-editor${props.className ? ` ${props.className}` : ""}`} style={props.style}>
      <Plate
        editor={editor}
        readOnly={readOnly}
        onValueChange={({ value }) => {
          const edit = doc.update(value as unknown as TypstValue);
          if (!edit) return;
          setSource(doc.source);
          onChange.current?.(doc.source, edit);
        }}
      >
        <PreviewProvider
          store={store}
          doc={doc}
          source={source}
          value={() => editor.children as unknown as TypstValue}
          typstream={{ ...(previewOptions ?? {}), plugins }}
          enabled={previewOptions !== null}
          onHandle={(h) => {
            handle.current = h;
          }}
        >
          {toolbar === "both" || toolbar === "fixed" ? (
            <FixedToolbar
              plugins={plugins}
              onAskAI={askAI}
              exports={exports}
              onImport={() => fileInput.current?.click()}
              readOnly={readOnly}
              setReadOnly={props.modeSwitch === false ? undefined : setReadOnly}
            />
          ) : null}
          <div className="ts-scroll">
            <PlateContent
              className="ts-content"
              placeholder={props.placeholder ?? "Type / for blocks, or start writing…"}
              autoFocus={props.autoFocus}
              spellCheck
              onKeyDown={(event) => {
                if (slashKeys.current?.(event)) event.stopPropagation();
              }}
            />
          </div>
          {!readOnly && (toolbar === "both" || toolbar === "floating") ? <FloatingToolbar onAskAI={askAI} /> : null}
          {!readOnly ? <SlashMenu plugins={plugins} keys={slashKeys} /> : null}
        </PreviewProvider>
      </Plate>
      <input
        ref={fileInput}
        type="file"
        accept=".typ,text/plain"
        hidden
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          const text = await file.text();
          const before = doc.source;
          replace(text);
          const edit = { from: 0, to: before.length, insert: doc.source, origin: "user" as const };
          onChange.current?.(doc.source, edit);
        }}
      />
    </div>
  );
};

const reportError = (error: unknown): void => {
  globalThis.reportError?.(error);
};
