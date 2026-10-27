"use client";
// @typstream/heal in the browser, on its own: pick an example (or type), scrub through it as if it
// were streaming, and see what the healer closes, cuts and fixes at each prefix. No engine needed.

import { type HealResult, heal } from "@typstream/heal";
import { Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";

const EXAMPLES: { label: string; text: string }[] = [
  {
    label: "A table",
    text: "#table(\n  columns: 2,\n  [*Planet*], [*Moons*],\n  [Earth], [1],\n  [Mars], [2],\n)\n\nThe sun is $1.99 times 10^30$ kg.",
  },
  {
    label: "A question",
    text: "= Fractions\n\n#question(points: 2)[\n  What is $1/2 + 1/4$? #blank(answer: $3/4$)\n]\n\n*Remember:* add the _numerators_.",
  },
  {
    label: "Markdown habits",
    text: "## Shopping list\n\nBring **two** apples, email me@school.org, and read [the guide](https://typst.app).",
  },
  {
    label: "Half-written rules",
    text: '#set text(size: 12pt, font: "Libertinus Serif")\n#let total = 3 + 4\n\nTotal: #total apples.',
  },
];

export function HealPlayground() {
  const [text, setText] = useState(EXAMPLES[0]?.text ?? "");
  const [cut, setCut] = useState(Math.floor(text.length * 0.42));
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);

  const input = text.slice(0, cut);
  const result = useMemo(() => heal(input), [input]);

  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => {
      setCut((c) => {
        if (c >= text.length) {
          setPlaying(false);
          return c;
        }
        return Math.min(text.length, c + 2);
      });
    }, 60);
    return () => clearInterval(timer.current);
  }, [playing, text.length]);

  const choose = (next: string) => {
    setPlaying(false);
    setText(next);
    setCut(Math.floor(next.length * 0.42));
  };

  const play = () => {
    if (playing) return setPlaying(false);
    if (cut >= text.length) setCut(0);
    setPlaying(true);
  };

  return (
    <div className="not-prose my-6 overflow-hidden rounded-xl border bg-fd-card text-sm">
      <div className="flex flex-wrap items-center gap-1.5 border-b bg-fd-muted/60 px-3 py-2">
        {EXAMPLES.map((example) => (
          <button
            key={example.label}
            type="button"
            onClick={() => choose(example.text)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
              text === example.text
                ? "border-fd-primary/40 bg-fd-primary/10 text-fd-primary"
                : "text-fd-muted-foreground hover:text-fd-foreground",
            )}
          >
            {example.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 border-b px-3 py-2.5">
        <button
          type="button"
          onClick={play}
          aria-label={playing ? "Pause" : "Stream it"}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-fd-primary text-fd-primary-foreground"
        >
          {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5 translate-x-px" />}
        </button>
        <input
          type="range"
          min={0}
          max={text.length}
          value={cut}
          onChange={(e) => {
            setPlaying(false);
            setCut(Number(e.target.value));
          }}
          aria-label="How much of the text has arrived"
          className="w-full accent-fd-primary"
        />
        <span className="w-20 shrink-0 text-right font-mono text-xs text-fd-muted-foreground tabular-nums">
          {cut}/{text.length}
        </span>
      </div>

      <div className="grid md:grid-cols-2">
        <Pane title="What the model has written so far" note={<Settled result={result} input={input} />}>
          <InputView input={input} result={result} />
        </Pane>
        <Pane
          title="What gets compiled"
          note={<Frames result={result} />}
          className="border-t md:border-t-0 md:border-l"
        >
          <SourceView result={result} />
        </Pane>
      </div>

      <div className="border-t px-3 py-2.5">
        {result.patches.length === 0 ? (
          <p className="text-xs text-fd-muted-foreground">No changes: this prefix already parses.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {result.patches.map((patch) => (
              <li
                key={`${patch.original.from}-${patch.reason}`}
                className="rounded-md bg-fd-muted px-2 py-0.5 font-mono text-[11px] text-fd-muted-foreground"
              >
                {patch.reason}
              </li>
            ))}
          </ul>
        )}
      </div>

      <label className="block border-t">
        <span className="sr-only">Edit the example</span>
        <textarea
          value={text}
          onChange={(e) => {
            setPlaying(false);
            setText(e.target.value);
            setCut(e.target.value.length);
          }}
          rows={4}
          spellCheck={false}
          className="block w-full resize-y bg-transparent px-3 py-2.5 font-mono text-xs outline-none placeholder:text-fd-muted-foreground"
          placeholder="Type some Typst…"
        />
      </label>
    </div>
  );
}

function Pane({
  title,
  note,
  className,
  children,
}: {
  title: string;
  note?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-baseline justify-between gap-2 px-3 pt-2.5 text-xs">
        <span className="font-medium">{title}</span>
        <span className="text-fd-muted-foreground">{note}</span>
      </div>
      <pre className="m-0 min-h-36 overflow-x-auto whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-[12.5px] leading-relaxed">
        {children}
      </pre>
    </div>
  );
}

/** The input, its unsettled tail tinted and what healing cut struck through. */
function InputView({ input, result }: { input: string; result: HealResult }) {
  const settled = result.map.toInput(result.stableOffset, -1);
  const cuts = result.patches
    .filter((p) => p.original.to > p.original.from && p.result.to === p.result.from)
    .map((p) => p.original);
  const marks = new Set<number>();
  for (const c of cuts) for (let i = c.from; i < c.to; i++) marks.add(i);
  const parts: { text: string; cut: boolean; tail: boolean }[] = [];
  for (let i = 0; i < input.length; i++) {
    const cut = marks.has(i);
    const tail = i >= settled;
    const last = parts[parts.length - 1];
    if (last && last.cut === cut && last.tail === tail) last.text += input[i];
    else parts.push({ text: input[i] ?? "", cut, tail });
  }
  return (
    <>
      {parts.map((part, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional.
          key={i}
          className={cn(
            part.tail && "bg-fd-primary/8",
            part.cut && "text-fd-muted-foreground line-through decoration-red-500/70",
          )}
        >
          {part.text}
        </span>
      ))}
      <span className="stream-caret ml-px inline-block h-[1.1em] w-[2px] translate-y-[3px] bg-fd-primary" />
    </>
  );
}

/** The healed source, with what healing added highlighted. */
function SourceView({ result }: { result: HealResult }) {
  const added = result.patches.filter((p) => p.result.to > p.result.from).map((p) => p.result);
  const out: React.ReactNode[] = [];
  let at = 0;
  for (const range of added) {
    if (range.from > at) out.push(result.source.slice(at, range.from));
    out.push(
      <mark key={range.from} className="rounded-sm bg-fd-primary/20 px-px text-fd-primary">
        {result.source.slice(range.from, range.to)}
      </mark>,
    );
    at = range.to;
  }
  out.push(result.source.slice(at));
  return <>{out}</>;
}

function Settled({ result, input }: { result: HealResult; input: string }) {
  const settled = result.map.toInput(result.stableOffset, -1);
  return (
    <>
      {settled} of {input.length} settled
    </>
  );
}

function Frames({ result }: { result: HealResult }) {
  const frame = result.openFrames[0]?.frame;
  return <>{frame ? `writing ${frame}…` : "nothing open"}</>;
}
