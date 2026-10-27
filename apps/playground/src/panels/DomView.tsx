// The DOM renderer view: the same document's artifacts through @typstream/dom,
// the renderers apps use (HTML: sanitized and block-diffed; paged: changed pages
// only, visible first, with a text layer). Switching between this and the raw
// engine view shows the same artifact both ways, which tells renderer bugs
// from engine output. `<Typstream>` (#17) will wrap these renderers.
import type { CompileTarget, PagedArtifact } from "@typstream/core";
import {
  createHtmlRenderer,
  createPagedView,
  type DrawInfo,
  type HtmlRenderer,
  type PagedView,
  registerMathFont,
} from "@typstream/dom";
import { htmlCompat } from "@typstream/html-compat";
import { useLayoutEffect, useRef, useState } from "react";
import { MATH_FONT } from "../fonts";
import type { RawEngine } from "../rawEngine";
import { RenderStatus } from "./RenderStatus";
import { ms } from "./Section";

interface Props {
  engine: RawEngine;
  target: CompileTarget;
  compat: boolean;
  follow: boolean;
}

// MathML needs Typst's math font as a web font; the renderer leaves registering it to the app.
if (MATH_FONT) void registerMathFont(MATH_FONT);

export const DomView = ({ engine, target, compat, follow }: Props) => {
  /** What the renderer did last, for the status line. */
  const [report, setReport] = useState<string | null>(null);
  const { state } = engine;
  if (!state) return <div className="render-slot">Starting the engine…</div>;
  const { artifact, status } = state;

  return (
    <div className="raw-engine">
      <RenderStatus state={state} target={target}>
        {artifact && report ? <span className="render-report">{report}</span> : null}
      </RenderStatus>
      {!artifact ? (
        <div className="render-slot">{status === "compiling" ? "Compiling…" : "No output yet."}</div>
      ) : artifact.target === "html" ? (
        <DomHtml html={artifact.html} compat={compat} caret={!state.final} follow={follow} onReport={setReport} />
      ) : (
        <DomPages artifact={artifact} follow={follow} onReport={setReport} />
      )}
    </div>
  );
};

interface HtmlProps {
  html: string;
  compat: boolean;
  caret: boolean;
  follow: boolean;
  onReport: (report: string) => void;
}

const DomHtml = ({ html, compat, caret, follow, onReport }: HtmlProps) => {
  const scroller = useRef<HTMLDivElement>(null);
  const renderer = useRef<HtmlRenderer | null>(null);

  // A new renderer when html-compat toggles: its sanitizer allowances and stylesheet are fixed at creation.
  useLayoutEffect(() => {
    const root = document.createElement("div");
    scroller.current?.append(root);
    const created = createHtmlRenderer(root, {
      plugins: compat ? [htmlCompat] : [],
    });
    renderer.current = created;
    return () => {
      created.dispose();
      root.remove();
      renderer.current = null;
    };
  }, [compat]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `compat` is a trigger: a new renderer needs the HTML again.
  useLayoutEffect(() => {
    if (!renderer.current) return;
    const r = renderer.current.update(html, { caret });
    onReport(`dom: ${r.blocks} blocks, ${r.created} parsed, ${r.removed} removed, ${ms(r.ms)}`);
    if (follow && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [html, caret, compat, follow, onReport]);

  return <div ref={scroller} className="render-dom-html" />;
};

interface PagesProps {
  artifact: PagedArtifact;
  follow: boolean;
  onReport: (report: string) => void;
}

const describeDraw = (d: DrawInfo) =>
  `dom: drew ${d.pages.length} page${d.pages.length === 1 ? "" : "s"}, ${d.textLayers.length} text layer${
    d.textLayers.length === 1 ? "" : "s"
  } (${d.when}), ${ms(d.ms)}`;

const DomPages = ({ artifact, follow, onReport }: PagesProps) => {
  const scroller = useRef<HTMLDivElement>(null);
  const view = useRef<PagedView | null>(null);
  // The callback is fixed when the view is created; read the latest prop through a ref.
  const report = useRef(onReport);
  report.current = onReport;

  useLayoutEffect(() => {
    if (!scroller.current) return;
    const created = createPagedView(scroller.current, { onDraw: (d) => report.current(describeDraw(d)) });
    view.current = created;
    return () => {
      created.destroy();
      view.current = null;
    };
  }, []);

  // The client's artifact always has every page; the view redraws only those whose hash changed.
  useLayoutEffect(() => {
    view.current?.render(artifact);
    if (follow && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [artifact, follow]);

  return <div ref={scroller} className="render-dom-pages" />;
};
