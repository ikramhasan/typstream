// The <Typstream> view (default): @typstream/react's component as an app uses
// it, fed the raw input of the current step (it heals it itself) with
// `isStreaming` until final mode. It compiles on the playground's engine, so
// the inspector's engine events cover it too. The raw engine and DOM views
// beside it show one artifact without the component, for telling a bug in the
// bindings from one in the renderers or the engine. It loads @typstream/mindmap
// and its island (#28), so a document can write `#mindmap[…]` (corpus/islands)
// and the map is interactive; the other views show its drawing.
import type { CompileTarget } from "@typstream/core";
import type { HealOptions } from "@typstream/heal";
import { htmlCompat } from "@typstream/html-compat";
import { mindmap } from "@typstream/mindmap";
import { mindmapIslands } from "@typstream/mindmap/react";
import { type RenderedEvent, Typstream, type TypstreamInfo } from "@typstream/react";
import { useCallback, useRef, useState } from "react";
import { sharedEngine } from "../engine";
import { MATH_FONT } from "../fonts";
import { RenderStatus } from "./RenderStatus";
import { ms } from "./Section";

interface Props {
  typstream: TypstreamInfo;
  /** A new <Typstream> (and document) whenever this changes: the loaded stream. */
  docKey: string | null;
  /** Raw input of the current step. */
  input: string | null;
  final: boolean;
  target: CompileTarget;
  compat: boolean;
  heal: HealOptions;
  follow: boolean;
}

const PLUGINS = [mindmap];
const COMPAT_PLUGINS = [htmlCompat, mindmap];

const describe = (info: RenderedEvent) =>
  info.target === "html"
    ? `typstream: ${info.blocks ?? 0} blocks, ${ms(info.renderMs)}`
    : `typstream: ${info.pages ?? 0} pages, ${ms(info.renderMs)}`;

export const TypstreamView = ({ typstream, docKey, input, final, target, compat, heal, follow }: Props) => {
  const [report, setReport] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const followRef = useRef(follow);
  followRef.current = follow;
  const onRendered = useCallback((info: RenderedEvent) => {
    setReport(describe(info));
    const el = scroller.current;
    if (followRef.current && el) el.scrollTop = el.scrollHeight;
  }, []);

  if (docKey === null || input === null) return <div className="render-slot">Loading…</div>;
  const { state } = typstream;
  return (
    <div className="raw-engine">
      {state ? (
        <RenderStatus state={state} target={target}>
          {state.artifact && report ? <span className="render-report">{report}</span> : null}
        </RenderStatus>
      ) : null}
      {state?.artifact ? null : (
        <div className="render-slot">{state?.status === "compiling" ? "Compiling…" : "No output yet."}</div>
      )}
      {/* Always mounted, so the document survives while there is nothing to show. */}
      <div
        ref={scroller}
        className={target === "html" ? "render-dom-html" : "render-dom-pages"}
        hidden={!state?.artifact}
      >
        <Typstream
          key={docKey}
          ref={typstream.ref}
          engine={sharedEngine()}
          source={input}
          isStreaming={!final}
          target={target}
          heal={heal}
          plugins={compat ? COMPAT_PLUGINS : PLUGINS}
          islands={mindmapIslands}
          {...(MATH_FONT ? { mathFont: MATH_FONT } : {})}
          animated
          caret
          lazy={false}
          onRendered={onRendered}
        />
      </div>
    </div>
  );
};
