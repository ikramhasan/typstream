// One oracle document through heal and the compiler, classified.
import { heal } from "@typstream/heal";
import { classify } from "./classify";
import type { OracleDocument } from "./documents";
import { setFiles } from "./documents";
import type { Diagnostic, Engine } from "./engine";
import { compileErrors, compilePrefixes, type Target } from "./measure";
import type { ClassifiedPrefix } from "./stats";

export interface RunOptions {
  target: Target;
  /** `stream`: after every chunk (what production sees). `char`: after every code point. */
  step?: "stream" | "char";
  /** Which chunk indices to compile. Default: all. */
  sample?: (index: number) => boolean;
  /**
   * Research measurements for failing prefixes (slower): whether the settled part
   * compiles alone (§5.6 level 2), and whether the simulated fixers fix it.
   */
  research?: boolean;
}

/** Inline code for a Markdown table cell. */
const code = (s: string) => {
  const json = JSON.stringify(s).slice(1, -1);
  return json.includes("`") ? `\`\` ${json} \`\`` : `\`${json}\``;
};

/** Only closers healing appends (and whitespace) follow the error: it is at the cut. */
const atCut = (healed: string, error: Diagnostic) =>
  error.span !== null && /^[\s)\]}$"*_`]*$/.test(healed.slice(error.span.to));

const CITATION = /^label `<(.+)>` does not exist/;

/**
 * Where an error can be cut: its own span if that is in the unsettled tail, else
 * the innermost call site in the tail it came through (a settled function
 * called with a half-typed argument), else nowhere.
 */
const cutPoint = (error: Diagnostic, stable: number): number | undefined => {
  if (error.span && error.span.from >= stable) return error.span.from;
  return error.trace.find((t) => t.span && t.span.from >= stable)?.span?.from;
};

/**
 * A sketch of the generic Layer 3 fixers #13 recommends, to measure what they
 * would reach; not the real thing (#20). Each round: references to missing
 * labels become placeholder text, and the healed source is cut at the first
 * other error in the unsettled tail (or call site there) and healed again.
 */
export const simulateFixers = (
  engine: Engine,
  healed: string,
  stableOffset: number,
  target: Target,
  rounds: number,
): boolean => {
  let source = healed;
  let stable = stableOffset;
  for (let round = 0; round < rounds; round++) {
    const errors = compileErrors(engine, source, target);
    if (errors.length === 0) return true;
    const refs = errors.filter((e) => e.span && CITATION.test(e.message));
    const cuts = errors.filter((e) => !CITATION.test(e.message)).map((e) => cutPoint(e, stable));
    if (cuts.some((c) => c === undefined) || refs.length + cuts.length < errors.length) return false;
    // Cut first: healing a prefix leaves the text before the cut alone.
    const cut = Math.min(source.length, ...(cuts as number[]));
    if (cut < source.length) source = heal(source.slice(0, cut)).source;
    // Then the references before the cut, last first so earlier spans stay valid.
    for (const e of refs.sort((a, b) => (b.span?.from ?? 0) - (a.span?.from ?? 0))) {
      const { from, to } = e.span as { from: number; to: number };
      if (to > cut) continue;
      source = `${source.slice(0, from)}[${source.slice(from + 1, to)}]${source.slice(to)}`;
      if (from < stable) stable += 1;
    }
  }
  return compileErrors(engine, source, target).length === 0;
};

export const runDocument = (engine: Engine, doc: OracleDocument, options: RunOptions): ClassifiedPrefix[] => {
  const { target, step = "stream", sample, research = false } = options;
  setFiles(engine, doc);
  const chunks = step === "char" ? Array.from(doc.source) : doc.chunks;
  return compilePrefixes(engine, chunks, target, sample).map((r) => {
    const out: ClassifiedPrefix = {
      doc: doc.id,
      cut: r.cut,
      errors: r.errors.map((e) => ({
        cls: classify(e, doc.source),
        message: e.message,
        inTail: e.span !== null && e.span.from >= r.stableOffset,
        atCut: atCut(r.healed, e),
      })),
    };
    if (step === "stream") out.t = doc.times[r.index] as number;
    const [first] = r.errors;
    if (first) {
      const prefix = doc.source.slice(0, r.cut);
      out.example = `${code(prefix.slice(-28))} → ${first.message}`;
      if (research) {
        const settled = prefix.slice(0, heal(prefix).map.toInput(r.stableOffset));
        out.stableOk = compileErrors(engine, heal(settled).source, target).length === 0;
        out.fixedIn = [1, 2, 3].find((n) => simulateFixers(engine, r.healed, r.stableOffset, target, n)) ?? null;
      }
    }
    return out;
  });
};
