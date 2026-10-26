// The raw engine view: the engine's last good artifact exactly as the worker
// sent it, with no @typstream/dom renderer or sanitizer in between. HTML goes
// into a sandboxed iframe (no scripts), page SVGs into <img>s, which run no
// scripts and load nothing. It's for watching documents render while scrubbing
// and for telling renderer bugs from engine output.
import type { Artifact, CompileTarget, PageUpdate } from "@typstream/core";
import { baseFonts } from "@typstream/engine-wasm/fonts";
import { htmlCompatCss } from "@typstream/html-compat";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RawEngine } from "../rawEngine";

interface Props {
  engine: RawEngine;
  target: CompileTarget;
  compat: boolean;
  markup: boolean;
  follow: boolean;
}

/** Typst points to CSS pixels. */
const PX_PER_PT = 96 / 72;

/** Markup longer than this is cut: a long paged document is megabytes of SVG. */
const MAX_MARKUP = 1_000_000;

export const RawEngineView = ({ engine, target, compat, markup, follow }: Props) => {
  const { state } = engine;
  if (!state) return <div className="render-slot">Starting the engine…</div>;
  const { artifact, status, failure } = state;

  return (
    <div className="raw-engine">
      <div className={`render-status ${status}`}>
        <b>{status}</b>
        {failure ? <span title={failure.message}>{failure.message}</span> : null}
        {artifact && artifact.target !== target ? (
          <span>
            Showing the last {artifact.target} output until the first {target} compile.
          </span>
        ) : null}
        {artifact && (status === "stale" || status === "error") ? <span>Showing the last good output.</span> : null}
      </div>
      {!artifact ? (
        <div className="render-slot">{status === "compiling" ? "Compiling…" : "No output yet."}</div>
      ) : markup ? (
        <Markup artifact={artifact} />
      ) : artifact.target === "html" ? (
        <HtmlFrame html={artifact.html} compat={compat} follow={follow} />
      ) : (
        <Pages pages={artifact.pages} follow={follow} />
      )}
    </div>
  );
};

const Markup = ({ artifact }: { artifact: Artifact }) => {
  const text = useMemo(
    () =>
      artifact.target === "html"
        ? artifact.html
        : artifact.pages
            .map((p) => `<!-- page ${p.index + 1} · ${p.width}×${p.height} pt · hash ${p.hash} -->\n${p.svg}`)
            .join("\n\n"),
    [artifact],
  );
  return (
    <pre className="render-markup">
      {text.length > MAX_MARKUP
        ? `${text.slice(0, MAX_MARKUP)}\n\n… ${(text.length - MAX_MARKUP).toLocaleString()} more chars`
        : text}
    </pre>
  );
};

// html-compat's CSS sets New Computer Modern Math for <math>; without it as a web
// font browsers can't stretch delimiters (PLAN.md §6.5). It's the engine's own file.
const mathFont = baseFonts.find((url) => url.pathname.includes("NewCMMath"));
const COMPAT_CSS = `${
  mathFont ? `@font-face { font-family: "New Computer Modern Math"; src: url("${mathFont.href}"); }\n` : ""
}${htmlCompatCss}`;

// The page around the engine's HTML: a white sheet, and the `typstream` root
// html-compat's rules are scoped to. Nothing else styles the output.
const SHELL = `<!doctype html><html><head><meta charset="utf-8"><style>
html { background: #fff; color: #000; }
body { margin: 0; padding: 16px 24px; }
</style><style id="compat"></style></head><body><div class="typstream"></div></body></html>`;

/**
 * Typst's HTML in an iframe with `sandbox="allow-same-origin"`: scripts and
 * event handlers never run, but this page may write into it. Each artifact
 * replaces the iframe's content in place rather than reloading the frame, so
 * updates don't flash and the reader's scroll position survives.
 */
const HtmlFrame = ({ html, compat, follow }: { html: string; compat: boolean; follow: boolean }) => {
  const frame = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  /** What we added to the frame's <head> for the previous artifact. */
  const headNodes = useRef<Node[]>([]);

  useLayoutEffect(() => {
    const doc = frame.current?.contentDocument;
    const root = doc?.querySelector(".typstream");
    if (!loaded || !doc || !root) return;
    // Parsing in a DOMParser document runs nothing and loads nothing.
    const parsed = new DOMParser().parseFromString(html, "text/html");
    for (const node of headNodes.current) node.parentNode?.removeChild(node);
    headNodes.current = [...parsed.head.childNodes].map((node) => doc.head.appendChild(doc.adoptNode(node)));
    root.replaceChildren(...[...parsed.body.childNodes].map((node) => doc.adoptNode(node)));
    if (follow) doc.defaultView?.scrollTo(0, doc.documentElement.scrollHeight);
  }, [html, loaded, follow]);

  useLayoutEffect(() => {
    const style = frame.current?.contentDocument?.getElementById("compat");
    if (loaded && style) style.textContent = compat ? COMPAT_CSS : "";
  }, [compat, loaded]);

  return (
    <iframe
      ref={frame}
      className="render-html"
      title="Engine HTML"
      sandbox="allow-same-origin"
      srcDoc={SHELL}
      onLoad={() => setLoaded(true)}
    />
  );
};

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** Every page as an <img>, at its size in points. Pages are replaced on every update. */
const Pages = ({ pages, follow }: { pages: readonly PageUpdate[]; follow: boolean }) => {
  const scroller = useRef<HTMLDivElement>(null);
  // Data URLs by page hash, so pages that didn't change aren't re-encoded or re-decoded.
  const urls = useRef(new Map<string, string>());
  const shown = useMemo(() => {
    const next = new Map<string, string>();
    for (const page of pages) next.set(page.hash, urls.current.get(page.hash) ?? svgUrl(page.svg));
    urls.current = next;
    return pages.map((page) => ({ ...page, url: next.get(page.hash) as string }));
  }, [pages]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: new pages are the trigger, not an input.
  useLayoutEffect(() => {
    if (follow && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [shown, follow]);

  return (
    <div ref={scroller} className="render-pages">
      {shown.map((page) => (
        <figure key={page.index}>
          <img
            src={page.url}
            alt={`Page ${page.index + 1}`}
            width={Math.round(page.width * PX_PER_PT)}
            height={Math.round(page.height * PX_PER_PT)}
          />
          <figcaption>
            {page.index + 1} / {pages.length}
          </figcaption>
        </figure>
      ))}
    </div>
  );
};
