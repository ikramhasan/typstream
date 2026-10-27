"use client";
// The landing page's hero: real Claude streams from corpus/llm, replayed at their recorded timing
// into <Typstream>, the way an app would feed it. The left pane is the raw text the model has
// written; the right is what typstream renders from it, every step.

import { edu } from "@typstream/edu";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type DocumentState, type RenderedEvent, Typstream, useTypstream } from "typstream";
import { cn } from "@/lib/cn";

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

export function LiveDemo({ recordings }: { recordings: Recording[] }) {
  const [index, setIndex] = useState(0);
  const recording = recordings[index] as Recording;
  const t = useTypstream();
  const [count, setCount] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [stats, setStats] = useState<{ renders: number; last?: RenderedEvent }>({ renders: 0 });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const root = useRef<HTMLDivElement>(null);
  const raw = useRef<HTMLPreElement>(null);
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
    <div ref={root} className="overflow-hidden rounded-2xl border bg-fd-card shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Recorded streams">
          {recordings.map((r, i) => (
            <button
              key={r.id}
              type="button"
              role="tab"
              aria-selected={i === index}
              onClick={() => choose(i)}
              dir={r.dir}
              className={cn(
                "rounded-full px-3 py-1 text-xs transition-colors",
                i === index
                  ? "bg-fd-primary text-fd-primary-foreground"
                  : "text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-foreground",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={toggle}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium hover:bg-fd-accent"
        >
          {done ? (
            <RotateCcw className="size-3.5" />
          ) : playing ? (
            <Pause className="size-3.5" />
          ) : (
            <Play className="size-3.5" />
          )}
          {done ? "Replay" : playing ? "Pause" : "Play"}
        </button>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex min-w-0 flex-col border-b bg-[oklch(0.2_0.02_255)] text-[oklch(0.9_0.01_85)] lg:border-r lg:border-b-0">
          <div className="flex items-center justify-between gap-2 px-4 pt-3 text-[11px] uppercase tracking-wider text-[oklch(0.7_0.02_255)]">
            <span>Model output · claude-sonnet</span>
            <span className="font-mono normal-case tracking-normal tabular-nums">
              {count}/{recording.chunks.length} chunks
            </span>
          </div>
          <p className="px-4 pt-2 text-xs italic text-[oklch(0.75_0.02_255)]">“{recording.request}”</p>
          <pre
            ref={raw}
            dir="ltr"
            className="m-0 h-72 overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-[11.5px] leading-relaxed [scrollbar-color:oklch(0.4_0.02_255)_transparent] lg:h-[30rem]"
          >
            {text}
            {streaming && (
              <span className="stream-caret ml-px inline-block h-[1.1em] w-[7px] translate-y-[2px] bg-teal" />
            )}
          </pre>
        </div>

        <div className="relative min-w-0 bg-fd-muted/60">
          <div ref={preview} className="h-[26rem] overflow-auto p-4 sm:p-6 lg:h-[34.5rem]">
            <div className="demo-sheets mx-auto max-w-[44rem]">
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
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2 font-mono text-[11px] text-fd-muted-foreground tabular-nums">
        <span className="inline-flex items-center gap-1.5">
          <span
            className={cn("size-1.5 rounded-full", streaming ? "bg-amber-500 stream-caret" : "bg-emerald-500")}
            aria-hidden
          />
          {status}
        </span>
        <span>{stats.renders} renders</span>
        {stats.last && (
          <>
            <span>compile {stats.last.compileMs.toFixed(0)} ms</span>
            <span>heal {stats.last.healMs.toFixed(2)} ms</span>
            <span>{stats.last.patches} patches</span>
            {stats.last.pages ? <span>{stats.last.pages} pages</span> : null}
          </>
        )}
      </div>
    </div>
  );
}
