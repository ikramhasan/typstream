"use client";
// A docs example rendered by typstream itself, as PLAN §10.5 asks: the code block below it is the
// document (remarkTypstPreview copies its text into `source`), so a page whose example stops
// compiling shows it. "Replay as a stream" feeds the same text a few characters at a time.

import { edu } from "@typstream/edu";
import { mindmap } from "@typstream/mindmap";
import { mindmapIslands } from "@typstream/mindmap/react";
import { FileText, LayoutTemplate, Play, Square } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Typstream, useTypstream } from "typstream";
import { cn } from "@/lib/cn";

export interface TypstPreviewProps {
  /** The document; filled from the child code block at build time. */
  source?: string;
  /** Load `@typstream/edu` (worksheets, questions, answers). */
  edu?: boolean;
  /** Show a toggle for edu's answers (`sys.inputs.showAnswers`). */
  answers?: boolean;
  /** Load `@typstream/mindmap`, with its interactive island. */
  mindmap?: boolean;
  /** Initial target. */
  target?: "html" | "paged";
  /** Height of the preview, in pixels. */
  height?: number;
  children?: ReactNode;
}

const EDU = [edu];
const MINDMAP = [mindmap];
const BOTH = [edu, mindmap];

export function TypstPreview({
  source = "",
  edu: withEdu = false,
  answers = false,
  mindmap: withMindmap = false,
  target: initialTarget = "html",
  height = 360,
  children,
}: TypstPreviewProps) {
  const t = useTypstream();
  const [target, setTarget] = useState(initialTarget);
  const [showAnswers, setShowAnswers] = useState(false);
  const [shown, setShown] = useState(source);
  const [streaming, setStreaming] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => () => clearInterval(timer.current), []);
  useEffect(() => {
    if (!streaming) setShown(source);
  }, [source, streaming]);

  const replay = () => {
    clearInterval(timer.current);
    if (streaming) {
      setStreaming(false);
      setShown(source);
      return;
    }
    let at = 0;
    setShown("");
    setStreaming(true);
    timer.current = setInterval(() => {
      at = Math.min(source.length, at + 3 + Math.floor(Math.random() * 6));
      setShown(source.slice(0, at));
      if (at >= source.length) {
        clearInterval(timer.current);
        setStreaming(false);
      }
    }, 45);
  };

  const frame = t.openFrames[0]?.frame;
  const status = streaming && frame ? `writing ${frame}…` : t.status;

  return (
    <figure className="not-prose my-6 overflow-hidden rounded-xl border bg-fd-card">
      <div className="flex flex-wrap items-center gap-1.5 border-b bg-fd-muted/60 px-3 py-2 text-xs">
        <Segmented
          value={target}
          onChange={setTarget}
          options={[
            { value: "html", label: "HTML", icon: <LayoutTemplate className="size-3.5" /> },
            { value: "paged", label: "Pages", icon: <FileText className="size-3.5" /> },
          ]}
        />
        {answers && (
          <label className="ml-1 inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-fd-muted-foreground hover:text-fd-foreground">
            <input
              type="checkbox"
              className="accent-fd-primary"
              checked={showAnswers}
              onChange={(e) => setShowAnswers(e.target.checked)}
            />
            Show answers
          </label>
        )}
        <button
          type="button"
          onClick={replay}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-fd-primary hover:bg-fd-accent"
        >
          {streaming ? <Square className="size-3.5" /> : <Play className="size-3.5" />}
          {streaming ? "Stop" : "Replay as a stream"}
        </button>
        <span className="font-mono text-[11px] text-fd-muted-foreground tabular-nums" aria-live="polite">
          {status}
        </span>
      </div>
      <div
        className={cn("demo-sheets overflow-auto", target === "paged" ? "bg-fd-muted/50 p-4" : "bg-paper p-5 text-ink")}
        style={{ maxHeight: height, minHeight: Math.min(height, 180) }}
      >
        <Typstream
          ref={t.ref}
          source={shown}
          isStreaming={streaming}
          target={target}
          layout="fit-width"
          theme="light"
          animated
          caret
          plugins={withEdu ? (withMindmap ? BOTH : EDU) : withMindmap ? MINDMAP : undefined}
          islands={withMindmap ? mindmapIslands : undefined}
          inputs={showAnswers ? { showAnswers: "true" } : undefined}
        />
      </div>
      {children && (
        <div className="border-t [&_figure]:my-0 [&_figure]:rounded-none [&_figure]:border-0">{children}</div>
      )}
    </figure>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: ReactNode }[];
}) {
  return (
    <div className="inline-flex rounded-lg border bg-fd-background p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-0.5 transition-colors",
            value === option.value
              ? "bg-fd-primary text-fd-primary-foreground"
              : "text-fd-muted-foreground hover:text-fd-foreground",
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}
