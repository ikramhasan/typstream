// The visual editor (#36) beside the live paged preview: what a teacher sees. The source pane
// shows the Typst the editor writes, and the last edit, so a change can be checked to touch only
// what it should. Any corpus document can be loaded into it.
import type { TextEdit } from "@typstream/core";
import { TypstEditor } from "@typstream/editor-react";
import { edu } from "@typstream/edu";
import { mindmap } from "@typstream/mindmap";
import { Typstream, TypstreamProvider } from "@typstream/react";
import { useState } from "react";
import { CORPUS, loadCorpusSource } from "../corpus";
import { sharedEngine } from "../engine";
import { MATH_FONT } from "../fonts";
import { SAMPLE } from "./sample";

const PLUGINS = [edu, mindmap];

export const EditorPage = () => {
  const [source, setSource] = useState(SAMPLE);
  const [edit, setEdit] = useState<TextEdit | null>(null);
  const [pane, setPane] = useState<"pages" | "source">("pages");
  const [docKey, setDocKey] = useState(0);
  const engine = sharedEngine();
  return (
    <TypstreamProvider engine={engine} plugins={PLUGINS} {...(MATH_FONT ? { mathFont: MATH_FONT } : {})}>
      <div className="editor-page">
        <header className="editor-header">
          <strong>typstream editor</strong>
          <select
            aria-label="Load a corpus document"
            value=""
            onChange={async (event) => {
              const id = event.target.value;
              if (!id) return;
              setSource(id === "sample" ? SAMPLE : await loadCorpusSource(id));
              setEdit(null);
              setDocKey((k) => k + 1);
            }}
          >
            <option value="">Open…</option>
            <option value="sample">Sample worksheet</option>
            {CORPUS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id}
              </option>
            ))}
          </select>
          <div className="editor-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={pane === "pages"} onClick={() => setPane("pages")}>
              Pages
            </button>
            <button type="button" role="tab" aria-selected={pane === "source"} onClick={() => setPane("source")}>
              Typst
            </button>
          </div>
        </header>
        <main className="editor-main">
          <TypstEditor
            key={docKey}
            className="editor-pane"
            source={source}
            onChange={(next, change) => {
              setSource(next);
              setEdit(change);
            }}
            onAskAI={(request) => alert(`Ask AI about ${JSON.stringify(request.range)}:\n\n${request.text}`)}
            autoFocus
          />
          <section className="preview-pane" aria-label={pane === "pages" ? "Pages" : "Typst source"}>
            {pane === "pages" ? (
              <Typstream source={source} target="paged" layout="fit-width" />
            ) : (
              <div className="source-pane">
                {edit ? (
                  <p className="last-edit">
                    Last edit: [{edit.from}, {edit.to}) → <code>{JSON.stringify(edit.insert)}</code>
                  </p>
                ) : null}
                <pre>{source}</pre>
              </div>
            )}
          </section>
        </main>
      </div>
    </TypstreamProvider>
  );
};
