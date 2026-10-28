"use client";
// The landing page's hero: real Claude streams from corpus/llm, replayed at their recorded timing
// into <Typstream>, the way an app would feed it. The left pane is the raw text the model has
// written, with what heal did to its last line for this frame; the right is what typstream renders
// from it, every step.

import { ArrowCounterClockwiseIcon, BandaidsIcon, PauseIcon, PlayIcon } from "@phosphor-icons/react";
import { edu } from "@typstream/edu";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type DocumentState, type RenderedEvent, Typstream, useTypstream } from "typstream";
import { cn } from "@/lib/cn";
import { healedSegments } from "@/lib/heal-segments";

export interface Recording {
  id: string;
  label: string;
  /** What the teacher asked for. */
  request: string;
  dir?: "rtl";
  chunks: { t: number; text: string }[];
}

const PLUGINS = [edu];

/** Page headers and footers sit in the margins; the text being written never does. */
const MARGIN = 0.08;

/**
 * Where the text being written is: the last run, in reading order, on the last page with text in its
 * body. `y` is in the page's points, from its top.
 */
function streamPosition(state: DocumentState | null): { page: number; y: number; height: number } | null {
  const artifact = state?.artifact;
  if (artifact?.target !== "paged") return null;
  for (let i = artifact.pages.length - 1; i >= 0; i--) {
    const page = artifact.pages[i];
    const body = page?.text?.filter((run) => run.y > page.height * MARGIN && run.y < page.height * (1 - MARGIN));
    const run = body?.[body.length - 1];
    if (page && run) return { page: page.index, y: run.y, height: page.height };
  }
  return null;
}

// A small Typst highlighter for the source pane: headings, `#calls`, strings, `key:` arguments (at a
// line's start or after `(` or `,`, so prose like "Take the root: ..." stays plain) and math. Close
// enough for a model's output; the engine, not this, decides what it means.
const TOKEN =
  /(#[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*)|("(?:[^"\\]|\\.)*"?)|((?<=^\s*|[(,]\s*)[A-Za-z_][\w-]*(?=: ))|(\$[^$]*\$?)/g;

function highlight(line: string): ReactNode {
  if (/^\s*=+ /.test(line)) return <span className="lp-tok-head">{line}</span>;
  const out: ReactNode[] = [];
  let at = 0;
  for (const match of line.matchAll(TOKEN)) {
    const i = match.index ?? 0;
    if (i > at) out.push(line.slice(at, i));
    const kind = match[1] ? "lp-tok-fn" : match[2] ? "lp-tok-str" : "lp-tok-key";
    out.push(
      <span key={i} className={kind}>
        {match[0]}
      </span>,
    );
    at = i + match[0].length;
  }
  if (at < line.length) out.push(line.slice(at));
  return out;
}

export function LiveDemo({ recordings }: { recordings: Recording[] }) {
  const [index, setIndex] = useState(0);
  const recording = recordings[index] as Recording;
  const t = useTypstream();
  const [count, setCount] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [stats, setStats] = useState<{ renders: number; last?: RenderedEvent }>({ renders: 0 });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const root = useRef<HTMLDivElement>(null);
  const raw = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  // A new run remounts <Typstream>, so the preview starts blank instead of showing the last run's pages.
  const [run, setRun] = useState(0);
  // The preview follows the text being written until the reader scrolls it themselves.
  const follow = useRef(true);

  const text = recording.chunks
    .slice(0, count)
    .map((c) => c.text)
    .join("");
  const done = count >= recording.chunks.length;
  const streaming = !done;
  const lines = text.split("\n");

  // Each chunk at its recorded time after the previous one, as the API delivered it.
  useEffect(() => {
    if (!playing || done) return;
    const prev = recording.chunks[count - 1]?.t ?? 0;
    const next = recording.chunks[count]?.t ?? prev;
    timer.current = setTimeout(() => setCount((c) => c + 1), Math.max(0, next - prev));
    return () => clearTimeout(timer.current);
  }, [playing, done, count, recording]);

  useEffect(() => {
    if (done) setPlaying(false);
  }, [done]);

  // Start the first time the demo scrolls into view.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && !started.current) {
        started.current = true;
        setPlaying(true);
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the text as it grows.
  useEffect(() => {
    const el = raw.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);

  // Keep the part being written in view: about two thirds of the way down, with what came before above it.
  const state = t.state;
  useEffect(() => {
    const el = preview.current;
    const position = streaming ? streamPosition(state) : null;
    if (!el || !position || !follow.current) return;
    const page = el.querySelector<HTMLElement>(`.typstream-page[data-page="${position.page + 1}"]`);
    if (!page) return;
    const rect = page.getBoundingClientRect();
    const y = rect.top - el.getBoundingClientRect().top + el.scrollTop + (position.y / position.height) * rect.height;
    const top = Math.max(0, y - el.clientHeight * 0.65);
    if (Math.abs(top - el.scrollTop) < 12) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
  }, [state, streaming]);

  // Only the reader's own scrolling stops the follow: scrollTo above fires `scroll` too, but not these.
  useEffect(() => {
    const el = preview.current;
    if (!el) return;
    const stop = () => {
      follow.current = false;
    };
    const events = ["wheel", "touchmove", "keydown", "pointerdown"] as const;
    for (const type of events) el.addEventListener(type, stop, { passive: true });
    return () => {
      for (const type of events) el.removeEventListener(type, stop);
    };
  }, []);

  // What heal did to the line being written, for this frame: the healed tail with its patches marked.
  const heal = state?.heal;
  const healed = useMemo(() => {
    if (!heal || !streaming || heal.source === text) return null;
    const lineStart = text.lastIndexOf("\n", text.length - 2) + 1;
    return healedSegments(text, heal.source, heal.patches, heal.map.toSource(lineStart));
  }, [heal, streaming, text]);

  const restart = () => {
    clearTimeout(timer.current);
    setCount(0);
    setStats({ renders: 0 });
    setRun((r) => r + 1);
    follow.current = true;
    preview.current?.scrollTo({ top: 0 });
    setPlaying(true);
  };

  const choose = (i: number) => {
    setIndex(i);
    restart();
  };

  const toggle = () => {
    if (done) restart();
    else setPlaying((p) => !p);
  };

  const onRendered = useCallback(
    (event: RenderedEvent) => setStats((s) => ({ renders: s.renders + 1, last: event })),
    [],
  );

  const frame = t.openFrames[0]?.frame;
  const status = done ? (t.status === "done" ? "finished" : t.status) : frame ? `writing ${frame}…` : "streaming";

  return (
    <div ref={root} className="flex flex-col gap-4 text-left">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-4 hidden text-xs font-semibold tracking-[0.15em] text-lp-accent uppercase sm:inline">
            Replay a real stream
          </span>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Recorded streams">
            {recordings.map((r, i) => (
              <button
                key={r.id}
                type="button"
                role="tab"
                aria-selected={i === index}
                onClick={() => choose(i)}
                dir={r.dir}
                className={cn(
                  "lp-focus rounded-full border px-4 py-2 text-sm leading-5 font-medium transition duration-300 ease-lp active:scale-[0.98]",
                  i === index
                    ? "border-lp-ink bg-lp-ink text-lp-bg"
                    : "border-lp-line bg-lp-card text-lp-muted hover:border-lp-strong-line hover:text-lp-ink",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={toggle}
          className="lp-focus inline-flex items-center gap-2 rounded-full px-2 py-2 text-sm font-medium text-lp-muted transition-colors duration-300 ease-lp hover:text-lp-ink"
        >
          {done ? (
            <ArrowCounterClockwiseIcon className="size-4" />
          ) : playing ? (
            <PauseIcon className="size-4" />
          ) : (
            <PlayIcon className="size-4" />
          )}
          {done ? "Replay" : playing ? "Pause" : "Play"}
        </button>
      </div>

      <div className="grid overflow-hidden rounded-2xl bg-lp-night shadow-[0_24px_64px_rgb(20_20_18/0.12)] lg:h-160 lg:grid-cols-[minmax(0,13fr)_minmax(0,17fr)] lg:grid-rows-[minmax(0,1fr)]">
        <div className="flex h-120 min-h-0 min-w-0 flex-col gap-4 p-6 text-lp-night-ink lg:h-auto">
          <div className="flex items-center justify-between gap-4 font-lp-mono text-xs text-lp-night-muted">
            <span className="inline-flex items-center gap-2">
              <span
                className={cn("size-2 rounded-full", streaming ? "stream-caret bg-[#10a37f]" : "bg-lp-night-muted")}
                aria-hidden
              />
              claude sonnet · {streaming ? "streaming" : "finished"}
            </span>
            <span className="tabular-nums">
              {count} / {recording.chunks.length} chunks
            </span>
          </div>
          <p className="text-sm text-lp-night-muted">“{recording.request}”</p>
          <div
            ref={raw}
            dir="ltr"
            className="min-h-0 flex-1 overflow-auto font-lp-mono text-sm leading-6 [scrollbar-color:#313131_transparent]"
          >
            {lines.map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: lines are their positions.
              <div key={i} className="flex gap-4">
                <span className="w-6 shrink-0 text-right text-xs leading-6 text-[#57544b] tabular-nums select-none">
                  {i + 1}
                </span>
                <span className="min-w-0 whitespace-pre-wrap break-words">
                  {highlight(line)}
                  {streaming && i === lines.length - 1 && (
                    <span className="stream-caret ml-px inline-block h-4 w-2 translate-y-0.5 bg-lp-night-accent" />
                  )}
                </span>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-3 rounded-xl border border-lp-night-line bg-lp-night-2 p-4">
            <span className="inline-flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-lp-night-accent uppercase">
              <BandaidsIcon className="size-4" aria-hidden />
              Healed before compiling
            </span>
            <div className="flex min-h-6 items-baseline justify-between gap-4 font-lp-mono text-sm">
              {healed ? (
                <span className="min-w-0 truncate whitespace-pre">
                  {healed.segments.map((s, i) =>
                    s.added ? (
                      // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional.
                      <mark key={i} className="rounded bg-lp-night-accent/15 px-0.5 text-lp-night-accent">
                        {s.text}
                      </mark>
                    ) : (
                      // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional.
                      <span key={i}>{s.text.replace(/\n/g, " ↵ ")}</span>
                    ),
                  )}
                </span>
              ) : (
                <span className="text-lp-night-muted">
                  {streaming
                    ? "Nothing to heal: this prefix compiles as written."
                    : "The finished document compiles as written."}
                </span>
              )}
              {healed && healed.dropped.length > 0 && (
                <span className="shrink-0 truncate font-lp text-xs text-lp-night-muted">
                  held back “{healed.dropped.at(-1)}”
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="relative h-120 min-h-0 min-w-0 bg-lp-desk lg:h-auto">
          <div ref={preview} className="h-full overflow-auto px-6 pt-8 pb-24 sm:px-12">
            <div className="demo-sheets mx-auto max-w-125">
              <Typstream
                key={`${recording.id}-${run}`}
                ref={t.ref}
                source={text}
                isStreaming={streaming}
                target="paged"
                layout="fit-width"
                plugins={PLUGINS}
                lazy={false}
                onRendered={onRendered}
              />
            </div>
          </div>
          <div
            className="absolute bottom-4 left-1/2 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-4 overflow-hidden rounded-full bg-lp-night/90 px-4 py-2 font-lp-mono text-xs whitespace-nowrap text-lp-night-muted tabular-nums backdrop-blur"
            aria-live="off"
          >
            <span className="inline-flex items-center gap-2 text-lp-night-ink">
              <span
                className={cn("size-2 rounded-full", streaming ? "stream-caret bg-[#e5c07b]" : "bg-[#10a37f]")}
                aria-hidden
              />
              {status}
            </span>
            <span>{stats.renders} renders</span>
            {stats.last && (
              <>
                <span>compile {stats.last.compileMs.toFixed(0)} ms</span>
                <span className="hidden sm:inline">heal {stats.last.healMs.toFixed(2)} ms</span>
                <span className="hidden sm:inline">{stats.last.patches} patches</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
