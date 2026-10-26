import type { StreamChunk } from "@typstream/corpus/stream";
import { useEffect, useRef } from "react";
import type { Profile } from "../session";

const SPEEDS = [0.25, 1, 4, 16, Number.POSITIVE_INFINITY];

interface Props {
  at: number;
  chunks: readonly StreamChunk[];
  playing: boolean;
  speed: number;
  profile: Profile | null;
  onSeek: (at: number) => void;
  onPlay: (playing: boolean) => void;
  onSpeed: (speed: number) => void;
}

export const Scrubber = ({ at, chunks, playing, speed, profile, onSeek, onPlay, onSpeed }: Props) => {
  const n = chunks.length;
  const next = chunks[at];
  const t = at > 0 ? (chunks[at - 1] as StreamChunk).t : 0;
  return (
    <section className="scrubber">
      <div className="scrubber-controls">
        <button type="button" onClick={() => onSeek(0)} title="Start (Home)">
          ⏮
        </button>
        <button type="button" onClick={() => onSeek(at - 1)} title="Back one step (←, Shift+← for 10)">
          ◀
        </button>
        <button type="button" className="play" onClick={() => onPlay(!playing)} title="Play / pause (Space)">
          {playing ? "❚❚" : "▶"}
        </button>
        <button type="button" onClick={() => onSeek(at + 1)} title="Forward one step (→, Shift+→ for 10)">
          ▶|
        </button>
        <button type="button" onClick={() => onSeek(n)} title="End (End)">
          ⏭
        </button>
        <select
          value={speed}
          title="Playback speed"
          onChange={(e) => {
            onSpeed(Number(e.target.value));
            // Hand the keyboard back to scrubbing (Space, arrows).
            e.target.blur();
          }}
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {Number.isFinite(s) ? `${s}×` : "max"}
            </option>
          ))}
        </select>
        <span className="position">
          step <b>{at.toLocaleString()}</b> / {n.toLocaleString()} · t = {(t / 1000).toFixed(2)} s
        </span>
        <span className="next-chunk" title="The next chunk to arrive">
          next: <code>{next ? JSON.stringify(next.text) : "(end of stream)"}</code>
        </span>
      </div>
      <div className="scrubber-track">
        <input
          type="range"
          min={0}
          max={n}
          value={at}
          onChange={(e) => onSeek(Number(e.target.value))}
          aria-label="Stream position"
        />
        <TimingStrip profile={profile} at={at} n={n} onSeek={onSeek} />
      </div>
    </section>
  );
};

/** One bar per pixel column: the slowest push among the steps it covers (sqrt scale). */
const TimingStrip = ({
  profile,
  at,
  n,
  onSeek,
}: {
  profile: Profile | null;
  at: number;
  n: number;
  onSeek: (at: number) => void;
}) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const width = el.clientWidth * devicePixelRatio;
    const height = el.clientHeight * devicePixelRatio;
    el.width = width;
    el.height = height;
    ctx.clearRect(0, 0, width, height);
    if (!profile || n === 0) return;
    const top = Math.sqrt(Math.max(profile.max, 0.5));
    const style = getComputedStyle(el);
    for (let x = 0; x < width; x++) {
      const from = Math.floor((x / width) * n);
      const to = Math.max(from + 1, Math.floor(((x + 1) / width) * n));
      let worst = 0;
      for (let i = from; i < to && i < n; i++) worst = Math.max(worst, profile.pushMs[i] as number);
      const h = (Math.sqrt(worst) / top) * height;
      // PLAN.md §1: p95 < 0.5 ms per token; long tasks are > 50 ms.
      ctx.fillStyle = style.getPropertyValue(worst > 50 ? "--bad" : worst > 0.5 ? "--warn" : "--ok").trim();
      ctx.fillRect(x, height - h, 1, h);
    }
    ctx.fillStyle = style.getPropertyValue("--fg").trim();
    ctx.fillRect(Math.round((at / n) * width), 0, devicePixelRatio, height);
  }, [profile, at, n]);
  return (
    <canvas
      ref={canvas}
      className="timing-strip"
      title="Push time per step (sqrt scale; amber > 0.5 ms, red > 50 ms). Click to seek."
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onSeek(Math.round(((e.clientX - rect.left) / rect.width) * n));
      }}
    />
  );
};
