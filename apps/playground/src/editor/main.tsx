// The editor playground (#36): <TypstEditor> on the real worker with the plugins an app uses, the
// source it writes beside it, and how long the pages take to catch up with a key. `window.typstreamEditor`
// holds the view and the document, for driving it from a browser's console or a test.

import type { EditorView } from "@typstream/editor-core";
import { TypstEditor, type TypstEditorHandle } from "@typstream/editor-react";
import { edu } from "@typstream/edu";
import type { EngineDocument } from "@typstream/engine";
import { htmlCompat } from "@typstream/html-compat";
import { mindmap } from "@typstream/mindmap";
import { TypstreamProvider } from "@typstream/react";
import { universe } from "@typstream/universe";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { sharedEngine } from "../engine";
import { SAMPLES } from "./samples";
import "./editor.css";

const PLUGINS = [htmlCompat, universe, edu, mindmap];

declare global {
  interface Window {
    typstreamEditor?: { view: EditorView; doc: EngineDocument | null; latencies: number[] };
  }
}

/** Keys pressed and when, until the pages show the text they made. */
const useLatency = (view: EditorView | null, handle: { current: TypstEditorHandle | null }) => {
  const [stats, setStats] = useState({ last: 0, median: 0, compiles: 0, compileMs: 0 });
  useEffect(() => {
    // The handle holds the document once the editor's render is committed: here.
    const doc = handle.current?.document;
    if (!view || !doc) return;
    const latencies: number[] = [];
    if (window.typstreamEditor) window.typstreamEditor.latencies = latencies;
    let pressed: number | null = null;
    let compiles = 0;
    const onKey = () => {
      pressed ??= performance.now();
    };
    view.element.addEventListener("keydown", onKey, true);
    let shown: unknown = null;
    const off = doc.subscribe((s) => {
      if (s.artifact === shown) return;
      shown = s.artifact;
      compiles++;
      const compileMs = s.lastCompile?.timings.totalMs ?? 0;
      if (pressed !== null && view.laidOut) {
        // The pages are painted at the next frame.
        const start = pressed;
        pressed = null;
        requestAnimationFrame(() => {
          latencies.push(performance.now() - start);
          const sorted = [...latencies].sort((a, b) => a - b);
          setStats({
            last: latencies[latencies.length - 1] ?? 0,
            median: sorted[sorted.length >> 1] ?? 0,
            compiles,
            compileMs,
          });
        });
      } else setStats((x) => ({ ...x, compiles, compileMs }));
    });
    return () => {
      off();
      view.element.removeEventListener("keydown", onKey, true);
    };
  }, [view, handle]);
  return stats;
};

const App = () => {
  const [sample, setSample] = useState(() => new URLSearchParams(location.search).get("sample") ?? "worksheet");
  const [source, setSource] = useState(SAMPLES[sample] ?? "");
  const handle = useRef<TypstEditorHandle>(null);
  const [view, setView] = useState<EditorView | null>(null);
  const stats = useLatency(view, handle);

  return (
    <TypstreamProvider engine={sharedEngine()} plugins={PLUGINS}>
      <div className="ed-shell">
        <header className="ed-header">
          <strong>typstream editor</strong>
          <select
            value={sample}
            onChange={(e) => {
              setSample(e.target.value);
              setSource(SAMPLES[e.target.value] ?? "");
              history.replaceState(null, "", `?sample=${e.target.value}`);
            }}
          >
            {Object.keys(SAMPLES).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          <span className="ed-stats" data-testid="stats">
            key → pages: last {stats.last.toFixed(0)} ms, median {stats.median.toFixed(0)} ms · compiles{" "}
            {stats.compiles} · last compile {stats.compileMs.toFixed(1)} ms
          </span>
        </header>
        <main className="ed-main">
          <TypstEditor
            key={sample}
            ref={handle}
            className="ed-editor"
            source={source}
            onChange={setSource}
            layout="fit-width"
            autoFocus
            onReady={(v) => {
              window.typstreamEditor = {
                view: v,
                get doc() {
                  return handle.current?.document ?? null;
                },
                latencies: [],
              };
              setView(v);
            }}
          />
          <pre className="ed-source" data-testid="source">
            {source}
          </pre>
        </main>
      </div>
    </TypstreamProvider>
  );
};

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
