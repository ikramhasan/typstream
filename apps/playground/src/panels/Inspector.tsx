import type { Normalized } from "@typstream/heal";
import type { ReactNode } from "react";
import { describePatch } from "../marks";
import type { Profile, Step } from "../session";

/** PLAN.md §1: main-thread time per token, p95 < 0.5 ms (50 KB docs); no task > 50 ms. */
const P95_BUDGET_MS = 0.5;
const LONG_TASK_MS = 50;

interface Props {
  step: Step | null;
  norm: Normalized | null;
  profile: Profile | null;
  /** Steps profiled so far while profiling, else null. */
  profiling: number | null;
  steps: number;
  at: number;
  final: boolean;
  follow: boolean;
  onFinal: (final: boolean) => void;
  onFollow: (follow: boolean) => void;
  onProfile: () => void;
  onSeek: (at: number) => void;
  hoverPatch: number | null;
  onHoverPatch: (patch: number | null) => void;
}

const ms = (value: number) => `${value < 1 ? value.toFixed(3) : value.toFixed(1)} ms`;

const Section = ({ title, count, children }: { title: string; count?: number; children: ReactNode }) => (
  <details className="section" open>
    <summary>
      {title}
      {count === undefined ? null : <span className="count">{count}</span>}
    </summary>
    {children}
  </details>
);

/** The line of `text` around `offset`, for showing where a frame opened. */
const lineAt = (text: string, offset: number): string => {
  const start = text.lastIndexOf("\n", offset - 1) + 1;
  const end = text.indexOf("\n", offset);
  const line = text.slice(start, end === -1 ? undefined : end);
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
};

export const Inspector = (props: Props) => {
  const { step, norm, profile, profiling, steps, at, final, follow, hoverPatch, onHoverPatch } = props;
  if (!step || !norm) return <aside className="pane inspector">Loading…</aside>;
  const { result } = step;
  const longTasks = profile ? profile.pushMs.filter((t) => t > LONG_TASK_MS).length : 0;

  return (
    <aside className="pane inspector">
      <Section title="Status">
        <dl>
          <dt>Step</dt>
          <dd>
            {at.toLocaleString()} / {steps.toLocaleString()}
          </dd>
          <dt>Stable offset</dt>
          <dd title="Source offset; text before it is settled and never changes meaning as more arrives">
            {result.stableOffset.toLocaleString()}{" "}
            <small>(input {result.map.toInput(result.stableOffset).toLocaleString()})</small>
          </dd>
          <dt>Tail</dt>
          <dd>{(result.source.length - result.stableOffset).toLocaleString()} chars unsettled</dd>
        </dl>
        <label>
          <input type="checkbox" checked={final} onChange={(e) => props.onFinal(e.target.checked)} />
          <span>
            Final mode (<code>finish()</code>: lint everything, report what's still broken)
          </span>
        </label>
        <label>
          <input type="checkbox" checked={follow} onChange={(e) => props.onFollow(e.target.checked)} />
          <span>Follow the stream (scroll panes to the end)</span>
        </label>
      </Section>

      <Section title="Timings">
        <dl>
          <dt>This step</dt>
          <dd>
            {ms(step.ms)} <small>({step.op})</small>
          </dd>
          <dt>Stateless heal()</dt>
          <dd>{ms(step.statelessMs)}</dd>
          {profile ? (
            <>
              <dt>Whole stream</dt>
              <dd>
                {ms(profile.totalMs)} <small>over {steps.toLocaleString()} pushes</small>{" "}
                <button
                  type="button"
                  className="link"
                  onClick={props.onProfile}
                  title="The first run includes JIT warm-up"
                >
                  re-run
                </button>
              </dd>
              <dt>Push p50 / p95</dt>
              <dd>
                {ms(profile.p50)} /{" "}
                <span className={profile.p95 > P95_BUDGET_MS ? "over" : "ok"}>{ms(profile.p95)}</span>{" "}
                <small>(budget p95 &lt; {P95_BUDGET_MS} ms)</small>
              </dd>
              <dt>Push max</dt>
              <dd>
                <span className={profile.max > LONG_TASK_MS ? "over" : ""}>{ms(profile.max)}</span>{" "}
                <button type="button" className="link" onClick={() => props.onSeek(profile.maxAt + 1)}>
                  at step {(profile.maxAt + 1).toLocaleString()}
                </button>
              </dd>
              <dt>Long tasks</dt>
              <dd className={longTasks > 0 ? "over" : "ok"}>
                {longTasks} <small>(&gt; {LONG_TASK_MS} ms)</small>
              </dd>
            </>
          ) : profiling !== null ? (
            <>
              <dt>Profiling</dt>
              <dd>
                {profiling.toLocaleString()} / {steps.toLocaleString()}
              </dd>
            </>
          ) : (
            <>
              <dt>Whole stream</dt>
              <dd>
                <button type="button" onClick={props.onProfile}>
                  Profile {steps.toLocaleString()} pushes
                </button>
              </dd>
            </>
          )}
        </dl>
        <p className="hint">
          Main thread of this tab; dev builds are slower than <code>vite build</code>.
          {crossOriginIsolated ? null : " Not cross-origin isolated, so the timer only resolves 0.1 ms."}
        </p>
      </Section>

      <Section title="Open frames" count={result.openFrames.length}>
        {result.openFrames.length === 0 ? (
          <p className="empty">Nothing open.</p>
        ) : (
          <ol className="frames">
            {result.openFrames.map((f) => (
              <li key={`${f.frame}@${f.open}`}>
                <b>{f.frame}</b> <small>@{f.open}</small> <code>{lineAt(step.input, f.open)}</code>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title="Patches" count={result.patches.length + norm.patches.length}>
        {result.patches.length + norm.patches.length === 0 ? <p className="empty">Source is the input.</p> : null}
        <ul className="patches">
          {norm.patches.map((p) => (
            <li key={`n${p.original.from}`} className="normalize">
              normalize · {p.reason} <small>@{p.original.from}</small>
            </li>
          ))}
          {result.patches.map((p, i) => (
            <li
              key={`${p.original.from}:${p.result.from}:${p.reason}`}
              className={hoverPatch === i ? "focus" : ""}
              onMouseEnter={() => onHoverPatch(i)}
              onMouseLeave={() => onHoverPatch(null)}
            >
              {describePatch(p, norm.text, result.source)} <small>@{p.result.from}</small>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Syntax errors" count={result.errors.length}>
        {result.errors.length === 0 ? <p className="empty">None.</p> : null}
        <ul className="issues">
          {result.errors.map((e) => (
            <li key={`${e.start}:${e.message}`}>
              {e.message} <small>@{e.start}</small>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Lint findings" count={result.findings.length}>
        {result.findings.length === 0 ? <p className="empty">None.</p> : null}
        <ul className="issues">
          {result.findings.map((f) => (
            <li key={`${f.start}:${f.rule}`} className={f.severity}>
              <b>{f.rule}</b> ({f.severity}) {f.message} <small>@{f.start}</small>
            </li>
          ))}
        </ul>
      </Section>
    </aside>
  );
};
