// Shareable playground state, kept in the URL hash (PLAN.md §10.5). Corpus entries
// are referenced by id; pasted documents and streams travel deflated and base64url'd.
import type { CompileTarget } from "@typstream/core";
import type { LintRuleId, LintSeverity } from "@typstream/heal";
import { DEFAULT_LINT } from "@typstream/heal";
import { SPLITS, type Split } from "./stream";

export type Source =
  | { kind: "corpus"; id: string }
  /** A pasted document; its stream is synthesized with `seed`. */
  | { kind: "doc"; text: string }
  /** A pasted or opened `.stream.jsonl`. */
  | { kind: "stream"; jsonl: string; name?: string };

export interface HealSettings {
  dropIncompleteRules: boolean;
  unwrapFences: "auto" | "never";
  /** Only the rules that differ from `DEFAULT_LINT`. */
  lint: Partial<Record<LintRuleId, LintSeverity>>;
}

/**
 * What the render pane shows. `typstream` (default) is @typstream/react's
 * `<Typstream>`, fed the step's raw input as an app would. `engine` is the raw
 * engine view: the engine's artifacts as they come, with no renderer in
 * between. `dom` renders the same artifacts with @typstream/dom. `off` spawns
 * no worker.
 */
export type RenderMode = "typstream" | "engine" | "dom" | "off";

export const RENDER_MODES: readonly RenderMode[] = ["typstream", "engine", "dom", "off"];

export interface RenderSettings {
  mode: RenderMode;
  target: CompileTarget;
  /** Open the document with @typstream/html-compat's preamble and files, and style its HTML. */
  compat: boolean;
}

export interface PlaygroundState {
  source: Source;
  /** Seed for synthesized streams (pasted documents, corpus entries without a recording). */
  seed: number;
  split: Split;
  /** Steps applied; null means "pick a default for this stream". */
  at: number | null;
  /** Heal the prefix as a complete document (`healer.finish()`). */
  final: boolean;
  heal: HealSettings;
  render: RenderSettings;
}

export const DEFAULT_SOURCE: Source = { kind: "corpus", id: "edu/quiz-mcq-geography" };

export const defaultState = (): PlaygroundState => ({
  source: DEFAULT_SOURCE,
  seed: 1,
  split: "chunks",
  at: null,
  final: false,
  heal: { dropIncompleteRules: true, unwrapFences: "auto", lint: {} },
  render: { mode: "typstream", target: "html", compat: true },
});

const SEVERITIES: readonly LintSeverity[] = ["fix", "warn", "off"];

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

const fromBase64Url = (text: string): Uint8Array => {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};

const pipe = async (data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> =>
  new Uint8Array(await new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream)).arrayBuffer());

export const pack = async (text: string): Promise<string> =>
  toBase64Url(await pipe(new TextEncoder().encode(text), new CompressionStream("deflate-raw")));

export const unpack = async (packed: string): Promise<string> =>
  new TextDecoder().decode(await pipe(fromBase64Url(packed), new DecompressionStream("deflate-raw")));

/** The hash for a state, without the leading `#`. Defaults are left out to keep links short. */
export const encodeState = async (state: PlaygroundState): Promise<string> => {
  const p = new URLSearchParams();
  const { source } = state;
  if (source.kind === "corpus") p.set("corpus", source.id);
  else if (source.kind === "doc") p.set("doc", await pack(source.text));
  else {
    p.set("stream", await pack(source.jsonl));
    if (source.name) p.set("name", source.name);
  }
  if (state.seed !== 1) p.set("seed", String(state.seed));
  if (state.split !== "chunks") p.set("split", state.split);
  if (state.at !== null) p.set("at", String(state.at));
  if (state.final) p.set("final", "1");
  if (!state.heal.dropIncompleteRules) p.set("drop", "0");
  if (state.heal.unwrapFences !== "auto") p.set("fences", state.heal.unwrapFences);
  const lint = Object.entries(state.heal.lint).filter(([rule, sev]) => DEFAULT_LINT[rule as LintRuleId] !== sev);
  if (lint.length > 0) p.set("lint", lint.map(([rule, sev]) => `${rule}:${sev}`).join(","));
  if (state.render.mode !== "typstream") p.set("render", state.render.mode);
  if (state.render.target !== "html") p.set("target", state.render.target);
  if (!state.render.compat) p.set("compat", "0");
  return p.toString();
};

const int = (value: string | null, fallback: number): number => {
  const n = value === null ? Number.NaN : Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** Parses a hash (with or without `#`). Anything missing or malformed falls back to the default. */
export const decodeState = async (hash: string): Promise<PlaygroundState> => {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const state = defaultState();
  const corpus = p.get("corpus");
  const doc = p.get("doc");
  const stream = p.get("stream");
  try {
    if (corpus) state.source = { kind: "corpus", id: corpus };
    else if (doc) state.source = { kind: "doc", text: await unpack(doc) };
    else if (stream) {
      const name = p.get("name");
      state.source = { kind: "stream", jsonl: await unpack(stream), ...(name ? { name } : {}) };
    }
  } catch {
    // A truncated or mangled link: keep the default source rather than failing to load.
  }
  state.seed = int(p.get("seed"), 1);
  const split = p.get("split") as Split | null;
  if (split && SPLITS.includes(split)) state.split = split;
  state.at = p.has("at") ? int(p.get("at"), 0) : null;
  state.final = p.get("final") === "1";
  state.heal.dropIncompleteRules = p.get("drop") !== "0";
  if (p.get("fences") === "never") state.heal.unwrapFences = "never";
  for (const pair of (p.get("lint") ?? "").split(",")) {
    const [rule, sev] = pair.split(":") as [LintRuleId, LintSeverity];
    if (rule in DEFAULT_LINT && SEVERITIES.includes(sev)) state.heal.lint[rule] = sev;
  }
  const render = p.get("render") as RenderMode | null;
  if (render && RENDER_MODES.includes(render)) state.render.mode = render;
  if (p.get("target") === "paged") state.render.target = "paged";
  state.render.compat = p.get("compat") !== "0";
  return state;
};
