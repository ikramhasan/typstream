import type { CompileTarget } from "@typstream/core";
import type { DocumentState } from "@typstream/engine";
import type { ReactNode } from "react";

interface Props {
  state: DocumentState;
  target: CompileTarget;
  /** What the view itself reports (renderer timings), after the engine's status. */
  children?: ReactNode;
}

/** The line above a render view: the document's status, its fallback, and what's shown. */
export const RenderStatus = ({ state, target, children }: Props) => {
  const { artifact, status, failure } = state;
  return (
    <div className={`render-status ${status}`}>
      <b>{status}</b>
      {failure ? <span title={failure.message}>{failure.message}</span> : null}
      {artifact && artifact.target !== target ? (
        <span>
          Showing the last {artifact.target} output until the first {target} compile.
        </span>
      ) : null}
      {artifact && (status === "stale" || status === "error") ? <span>Showing the last good output.</span> : null}
      {children}
    </div>
  );
};
