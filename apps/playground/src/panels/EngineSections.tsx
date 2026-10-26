// The inspector's engine sections, for the render pane's document (<Typstream>'s,
// or the one the raw engine and DOM views share): its status and fallback,
// compile timings from the worker, diagnostics and the engine's events. All of
// it straight from DocumentState and the engine's event stream.
import type { CompileResult, Diagnostic } from "@typstream/core";
import type { EngineEvent } from "@typstream/engine";
import type { RawEngine } from "../rawEngine";
import { ms, Section } from "./Section";

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const mib = (bytes: number) => `${(bytes / 2 ** 20).toFixed(1)} MiB`;

const span = (d: Diagnostic) => (d.span ? `@${d.span.from}–${d.span.to}` : "no position");

const describeEvent = (event: EngineEvent): string => {
  switch (event.type) {
    case "ready":
      return `ready: ${event.info.serverInfo.name}, Typst ${event.info.serverInfo.typstVersion}`;
    case "watchdog":
      return `watchdog: rev ${event.rev} ran past ${event.budgetMs} ms; worker replaced`;
    case "crash":
      return `crash: ${event.error instanceof Error ? event.error.message : String(event.error)}`;
    case "recycle":
      return `recycle: worker at ${mib(event.memoryBytes)}, swapped for the spare`;
    case "log":
      return `${event.level}: ${event.message}`;
    case "failed":
      return `failed: ${event.error.message}`;
  }
};

const Timings = ({ compiles }: { compiles: readonly CompileResult[] }) => {
  const last = compiles.at(-1);
  if (!last) return <p className="empty">No compile has finished yet.</p>;
  const totals = compiles.map((c) => c.timings.totalMs);
  const { totalMs, compileMs, exportMs, fixMs } = last.timings;
  return (
    <dl>
      <dt>Last compile</dt>
      <dd>
        {ms(totalMs)}{" "}
        <small>
          ({last.target}, rev {last.rev}, {last.status})
        </small>
      </dd>
      <dt>Typst / export / fix</dt>
      <dd>
        {compileMs === undefined ? "–" : ms(compileMs)} / {exportMs === undefined ? "–" : ms(exportMs)} /{" "}
        {fixMs === undefined ? "–" : ms(fixMs)}
      </dd>
      <dt>Compiles</dt>
      <dd>
        {compiles.length.toLocaleString()}{" "}
        <small>
          (p50 {ms(median(totals))}, max {ms(Math.max(...totals))})
        </small>
      </dd>
      {last.memoryBytes === undefined ? null : (
        <>
          <dt>Worker memory</dt>
          <dd>{mib(last.memoryBytes)}</dd>
        </>
      )}
    </dl>
  );
};

export const EngineSections = ({ engine }: { engine: RawEngine }) => {
  const { state, sent, compiles, log } = engine;
  const info = log.info?.serverInfo;
  return (
    <>
      <Section title="Engine">
        {state ? (
          <dl>
            <dt>Status</dt>
            <dd className={`engine-status ${state.status}`}>
              {state.status}
              {state.live ? null : <small> (live compiling stopped)</small>}
            </dd>
            {state.failure ? (
              <>
                <dt>Fallback</dt>
                <dd className="over">
                  {state.failure.reason}: <small>{state.failure.message}</small>
                </dd>
              </>
            ) : null}
            <dt>Showing</dt>
            <dd>
              {state.artifact ? (
                <>
                  {state.artifact.target} of rev {state.artifactRev}
                  {state.status === "stale" || state.status === "error" ? <small> (last good)</small> : null}
                </>
              ) : (
                "nothing yet"
              )}
            </dd>
            <dt>Re-heal</dt>
            <dd
              className={sent === null || state.heal.source === sent ? "" : "over"}
              title="The document heals what it's given: the healed source (raw and DOM views; healing is idempotent) or the raw input (<Typstream>, healing incrementally). Either way it should compile what the healed pane shows."
            >
              {sent === null
                ? "–"
                : state.heal.source === sent
                  ? "compiles the healed pane's source"
                  : `changed it (${sent.length.toLocaleString()} → ${state.heal.source.length.toLocaleString()} chars)`}
            </dd>
          </dl>
        ) : (
          <p className="empty">Starting…</p>
        )}
        <p className="hint">
          {info ? `${info.name} · Typst ${info.typstVersion}` : "Worker starting (downloading the wasm)…"}
        </p>
      </Section>

      <Section title="Compile timings">
        <Timings compiles={compiles} />
        <p className="hint">Measured in the worker, request to response.</p>
      </Section>

      <Section title="Engine diagnostics" count={state?.diagnostics.length ?? 0}>
        {!state || state.diagnostics.length === 0 ? <p className="empty">None.</p> : null}
        <ul className="issues">
          {state?.diagnostics.map((d, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: diagnostics can repeat exactly; the list is replaced whole.
            <li key={i} className={d.severity === "error" ? "bad" : d.severity === "warning" ? "warn" : ""}>
              {d.message} <small>{span(d)}</small>
              {d.file ? <small> in {d.file.path}</small> : null}
              {d.hints.map((hint) => (
                <div key={hint} className="diag-hint">
                  hint: {hint}
                </div>
              ))}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Engine events" count={log.events.length}>
        {log.events.length === 0 ? <p className="empty">None.</p> : null}
        <ul className="issues">
          {log.events.map(({ at, event }) => (
            <li key={at} className={event.type === "log" ? "" : "warn"}>
              {describeEvent(event)} <small>{(at / 1000).toFixed(1)} s</small>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
};
