// The render slot. Heal-only for now: rendering needs the engine's worker half and
// adapter (#10); the real pane will use the React bindings (#17).
//
// TODO(#10): once @typstream/engine can spawn its worker, open one document here
// (`createEngine({ spawn }).open({ target })`), `set()` the healed input on every
// step, and show `state.artifact` (HTML, or the paged SVGs), `state.diagnostics`,
// `state.failure` (the fallback level) and compile timings. Offer both targets.
// TODO(#17): replace that stopgap with `<Typstream>` from @typstream/react.

interface Props {
  source: string | null;
}

export const RenderPane = ({ source }: Props) => (
  <section className="pane render-pane">
    <h2>
      Render <small>html · paged</small>
    </h2>
    <div className="render-slot">
      <p>
        <b>Not wired up yet.</b> Rendering waits on the engine worker (#10) and the React bindings (#17).
      </p>
      <p>
        Diagnostics, fallback level and compile timings will show here. Until then the healed source (
        {source === null ? "…" : `${source.length.toLocaleString()} chars`}) is what the engine would compile.
      </p>
    </div>
  </section>
);
