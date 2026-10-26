// The render pane: a mode, a target, and the view for that mode. The default
// is `<Typstream>` from @typstream/react, as apps use it, on its own document.
// The raw engine and DOM views share another document, fed the healed source:
// the raw view shows its artifacts as the worker sent them, the DOM view
// through @typstream/dom's renderers. Switching between them tells a bug in the
// bindings from one in the renderers or in the engine's output.
import type { CompileTarget } from "@typstream/core";
import type { HealOptions } from "@typstream/heal";
import type { TypstreamInfo } from "@typstream/react";
import { useState } from "react";
import type { RenderMode, RenderSettings } from "../hash";
import type { RawEngine } from "../rawEngine";
import { DomView } from "./DomView";
import { RawEngineView } from "./RawEngineView";
import { TypstreamView } from "./TypstreamView";

const MODES: Record<RenderMode, { label: string; title: string }> = {
  typstream: {
    label: "<Typstream>",
    title: "@typstream/react's component, fed the raw input of the current step as an app would",
  },
  engine: { label: "Raw engine", title: "The engine's artifacts as they arrive, with no renderer in between" },
  dom: { label: "DOM renderer", title: "The same artifacts through @typstream/dom's HTML and paged renderers" },
  off: { label: "Off", title: "No engine worker: heal only" },
};

const TARGETS: readonly CompileTarget[] = ["html", "paged"];

interface Props {
  settings: RenderSettings;
  onChange: (settings: RenderSettings) => void;
  engine: RawEngine;
  /** The <Typstream> view's instance, read by the inspector too. */
  typstream: TypstreamInfo;
  /** The loaded stream: a new document when it changes. */
  docKey: string | null;
  /** Raw input of the current step, for <Typstream>. */
  input: string | null;
  final: boolean;
  heal: HealOptions;
  /** Keep the end of the output in view, like the source panes. */
  follow: boolean;
}

export const RenderPane = ({ settings, onChange, engine, typstream, docKey, input, final, heal, follow }: Props) => {
  /** Show the artifact's markup (HTML, or each page's SVG) instead of rendering it. */
  const [markup, setMarkup] = useState(false);
  const set = (patch: Partial<RenderSettings>) => onChange({ ...settings, ...patch });

  return (
    <section className="pane render-pane">
      <h2 className="render-header">
        Render
        <select
          value={settings.mode}
          onChange={(e) => set({ mode: e.target.value as RenderMode })}
          title={MODES[settings.mode].title}
        >
          {Object.entries(MODES).map(([mode, { label, title }]) => (
            <option key={mode} value={mode} title={title}>
              {label}
            </option>
          ))}
        </select>
        {settings.mode === "off" ? null : (
          <>
            <span className="segmented" title="Compile target">
              {TARGETS.map((target) => (
                <button
                  key={target}
                  type="button"
                  aria-pressed={settings.target === target}
                  className={settings.target === target ? "on" : ""}
                  onClick={() => set({ target })}
                >
                  {target}
                </button>
              ))}
            </span>
            <label title="Open the document with @typstream/html-compat's preamble and prelude, and style its HTML with html-compat's CSS">
              <input type="checkbox" checked={settings.compat} onChange={(e) => set({ compat: e.target.checked })} />
              html-compat
            </label>
            {settings.mode === "engine" ? (
              <label title="Show the artifact's markup instead of rendering it">
                <input type="checkbox" checked={markup} onChange={(e) => setMarkup(e.target.checked)} />
                markup
              </label>
            ) : null}
          </>
        )}
      </h2>
      {settings.mode === "typstream" ? (
        <TypstreamView
          typstream={typstream}
          docKey={docKey}
          input={input}
          final={final}
          target={settings.target}
          compat={settings.compat}
          heal={heal}
          follow={follow}
        />
      ) : settings.mode === "engine" ? (
        <RawEngineView
          engine={engine}
          target={settings.target}
          compat={settings.compat}
          markup={markup}
          follow={follow}
        />
      ) : settings.mode === "dom" ? (
        <DomView engine={engine} target={settings.target} compat={settings.compat} follow={follow} />
      ) : (
        <div className="render-slot">
          <p>Rendering is off; no engine worker runs.</p>
        </div>
      )}
    </section>
  );
};
