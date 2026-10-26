import { joinStream, type StreamChunk } from "@typstream/corpus/stream";
import { type HealOptions, normalize } from "@typstream/heal";
import { useTypstream } from "@typstream/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decodeState, encodeState, type PlaygroundState, type Source } from "./hash";
import { healedMarks, rawMarks } from "./marks";
import { Inspector } from "./panels/Inspector";
import { PasteDialog } from "./panels/PasteDialog";
import { RenderPane } from "./panels/RenderPane";
import { SaveDialog } from "./panels/SaveDialog";
import { Scrubber } from "./panels/Scrubber";
import { SourcePane } from "./panels/SourcePane";
import { Toolbar } from "./panels/Toolbar";
import { useRawEngine } from "./rawEngine";
import { HealSession, type Profile, profileStream } from "./session";
import { type Loaded, loadSource, sourceFromText, sourceKey } from "./source";
import { prefixLengths, splitStream } from "./stream";
import { useTypstreamEngine } from "./typstreamEngine";

/** Streams up to this many steps are profiled automatically; longer ones on request. */
const AUTO_PROFILE_STEPS = 20_000;

export const App = () => {
  const [state, setState] = useState<PlaygroundState | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profiling, setProfiling] = useState<number | null>(null);
  /** The (long) stream the user asked to profile, and how often (re-runs measure a warm JIT). */
  const [profileFor, setProfileFor] = useState<{ chunks: StreamChunk[]; run: number } | null>(null);
  const [dialog, setDialog] = useState<"paste" | "save" | null>(null);
  const [hoverPatch, setHoverPatch] = useState<number | null>(null);
  const [follow, setFollow] = useState(true);

  // URL hash → state, on load and when the user edits or pastes a link.
  const ownHash = useRef<string | null>(null);
  useEffect(() => {
    const read = () => {
      if (location.hash.replace(/^#/, "") === ownHash.current) return;
      void decodeState(location.hash).then(setState);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  // State → URL hash, debounced (playback changes `at` every frame).
  useEffect(() => {
    if (!state) return;
    const timer = setTimeout(() => {
      void encodeState(state).then((hash) => {
        ownHash.current = hash;
        if (location.hash.replace(/^#/, "") !== hash) history.replaceState(null, "", `#${hash}`);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [state]);

  const update = useCallback((patch: Partial<PlaygroundState>) => setState((s) => (s ? { ...s, ...patch } : s)), []);

  // Load the source's stream.
  const key = state ? sourceKey(state.source, state.seed) : null;
  useEffect(() => {
    if (!state || key === null || loaded?.key === key) return;
    let cancelled = false;
    setLoadError(null);
    loadSource(state.source, state.seed).then(
      (l) => !cancelled && setLoaded(l),
      (e: unknown) => !cancelled && setLoadError(String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [key, state, loaded?.key]);

  const ready = loaded && loaded.key === key ? loaded : null;
  const split = state?.split ?? "chunks";
  const chunks = useMemo(() => (ready ? splitStream(ready.chunks, split) : []), [ready, split]);
  const source = useMemo(() => (ready ? joinStream(ready.chunks) : ""), [ready]);
  const prefixes = useMemo(() => prefixLengths(chunks), [chunks]);

  const heal = state?.heal;
  const options = useMemo<HealOptions>(
    () => ({
      dropIncompleteRules: heal?.dropIncompleteRules ?? true,
      unwrapFences: heal?.unwrapFences ?? "auto",
      lint: heal?.lint ?? {},
    }),
    [heal],
  );
  const session = useMemo(
    () => new HealSession(chunks, source, prefixes, options),
    [chunks, source, prefixes, options],
  );

  const n = chunks.length;
  const at = state ? Math.min(state.at ?? Math.floor(n / 2), n) : 0;
  const final = state?.final ?? false;
  const step = useMemo(() => (ready ? session.goto(at, final) : null), [ready, session, at, final]);

  const norm = useMemo(
    () => (step ? normalize(step.input, { unwrapFences: options.unwrapFences, streaming: !final }) : null),
    [step, options.unwrapFences, final],
  );
  const raw = useMemo(() => (step && norm ? rawMarks(step.result, norm) : []), [step, norm]);
  const render = state?.render;
  // The raw engine and DOM views' document; <Typstream> opens its own.
  const rawEngine = useRawEngine({
    enabled: render?.mode === "engine" || render?.mode === "dom",
    docKey: ready?.key ?? null,
    source: step?.result.source ?? null,
    final,
    target: render?.target ?? "html",
    compat: render?.compat ?? true,
    heal: options,
  });
  const typstream = useTypstream();
  const typstreamEngine = useTypstreamEngine(typstream, step?.result.source ?? null);
  const engine = render?.mode === "typstream" ? typstreamEngine : rawEngine;
  const healed = useMemo(() => (step && norm ? healedMarks(step.result, norm) : []), [step, norm]);

  // Profile every push of the stream, for the timing strip and p50/p95/max.
  useEffect(() => {
    setProfile(null);
    setProfiling(null);
    if (n === 0 || (n > AUTO_PROFILE_STEPS && profileFor?.chunks !== chunks)) return;
    const controller = new AbortController();
    setProfiling(0);
    void profileStream(chunks, options, controller.signal, setProfiling).then((p) => {
      if (controller.signal.aborted) return;
      setProfile(p);
      setProfiling(null);
    });
    return () => controller.abort();
  }, [chunks, options, n, profileFor]);

  const seek = useCallback(
    (next: number) => setState((s) => (s ? { ...s, at: Math.max(0, Math.min(next, n)) } : s)),
    [n],
  );

  // Playback at the recorded timing × speed (Infinity: one step per frame). It reads
  // the position once, to start from; its own steps must not restart it.
  const atRef = useRef(0);
  atRef.current = at;
  useEffect(() => {
    if (!playing) return;
    // Playing at the end replays from the start.
    let current = atRef.current >= n ? 0 : atRef.current;
    const startWall = performance.now();
    const startT = current > 0 ? (chunks[current - 1] as StreamChunk).t : 0;
    let frame = 0;
    const tick = () => {
      if (Number.isFinite(speed)) {
        const target = startT + (performance.now() - startWall) * speed;
        while (current < n && (chunks[current] as StreamChunk).t <= target) current++;
      } else {
        current++;
      }
      seek(current);
      if (current >= n) setPlaying(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, chunks, n, seek]);

  // Keyboard scrubbing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (dialog || target.closest("input, textarea, select")) return;
      const by = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowRight") seek(at + by);
      else if (e.key === "ArrowLeft") seek(at - by);
      else if (e.key === "Home") seek(0);
      else if (e.key === "End") seek(n);
      else if (e.key === " ") setPlaying((p) => !p);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at, n, seek, dialog]);

  if (!state) return null;

  const setSource = (next: Source) => {
    setPlaying(false);
    setState((s) => (s ? { ...s, source: next, at: null, final: false } : s));
  };

  return (
    <div className="app">
      <Toolbar
        state={state}
        loaded={ready}
        onSource={setSource}
        onChange={update}
        onPaste={() => setDialog("paste")}
        onSave={() => setDialog("save")}
      />
      <Scrubber
        at={at}
        chunks={chunks}
        playing={playing}
        speed={speed}
        profile={profile}
        onSeek={seek}
        onPlay={setPlaying}
        onSpeed={setSpeed}
      />
      {loadError ? <div className="error-banner">Couldn't load the source: {loadError}</div> : null}
      <main className="panes">
        <SourcePane
          side="raw"
          title="Raw input"
          subtitle={step ? `${step.input.length.toLocaleString()} chars` : ""}
          text={step?.input ?? ""}
          marks={raw}
          settled={step ? step.result.map.toInput(step.result.stableOffset) : 0}
          hoverPatch={hoverPatch}
          onHoverPatch={setHoverPatch}
          follow={follow}
        />
        <SourcePane
          side="healed"
          title="Healed source"
          subtitle={step ? `${step.result.source.length.toLocaleString()} chars` : ""}
          text={step?.result.source ?? ""}
          marks={healed}
          settled={step?.result.stableOffset ?? 0}
          hoverPatch={hoverPatch}
          onHoverPatch={setHoverPatch}
          follow={follow}
        />
        <Inspector
          step={step}
          norm={norm}
          profile={profile}
          profiling={profiling}
          steps={n}
          at={at}
          final={final}
          follow={follow}
          onFinal={(f) => update({ final: f })}
          onFollow={setFollow}
          onProfile={() => setProfileFor((p) => ({ chunks, run: (p?.run ?? 0) + 1 }))}
          onSeek={seek}
          hoverPatch={hoverPatch}
          onHoverPatch={setHoverPatch}
          engine={state.render.mode === "off" ? null : engine}
        />
        <RenderPane
          settings={state.render}
          onChange={(next) => update({ render: next })}
          engine={rawEngine}
          typstream={typstream}
          docKey={ready?.key ?? null}
          input={step?.input ?? null}
          final={final}
          heal={options}
          follow={follow}
        />
      </main>
      {dialog === "paste" ? (
        <PasteDialog
          onClose={() => setDialog(null)}
          onLoad={(text) => {
            setSource(sourceFromText(text));
            setDialog(null);
          }}
        />
      ) : null}
      {dialog === "save" && ready ? (
        <SaveDialog state={state} loaded={ready} at={at} steps={n} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
};
