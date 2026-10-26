// One oracle document through heal and the compiler, classified.
import { heal } from "@typstream/heal";
import { classify } from "./classify";
import type { OracleDocument } from "./documents";
import { setFiles } from "./documents";
import type { Diagnostic, Engine } from "./engine";
import { compileErrors, compilePrefixes, type Target } from "./measure";
import { OracleServer } from "./server";
import type { ClassifiedPrefix } from "./stats";

export interface RunOptions {
  target: Target;
  /** `stream`: after every chunk (what production sees). `char`: after every code point. */
  step?: "stream" | "char";
  /** Which chunk indices to compile. Default: all. */
  sample?: (index: number) => boolean;
  /** Research measurements for failing prefixes (slower): whether the settled part compiles alone (§5.6 level 2). */
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

export const runDocument = async (
  engine: Engine,
  doc: OracleDocument,
  options: RunOptions,
): Promise<ClassifiedPrefix[]> => {
  const { target, step = "stream", sample, research = false } = options;
  setFiles(engine, doc);
  const server = await OracleServer.open(engine);
  const chunks = step === "char" ? Array.from(doc.source) : doc.chunks;
  const out: ClassifiedPrefix[] = [];
  for (const r of compilePrefixes(engine, chunks, target, sample)) {
    const p: ClassifiedPrefix = {
      doc: doc.id,
      cut: r.cut,
      errors: r.errors.map((e) => ({
        cls: classify(e, doc.source),
        message: e.message,
        inTail: e.span !== null && e.span.from >= r.stableOffset,
        atCut: atCut(r.healed, e),
      })),
    };
    if (step === "stream") p.t = doc.times[r.index] as number;
    const [first] = r.errors;
    if (first) {
      const prefix = doc.source.slice(0, r.cut);
      p.example = `${code(prefix.slice(-28))} → ${first.message}`;
      // Layer 3: the engine server's fix loop, as the worker runs it on this prefix.
      const fixed = await server.compile(r.healed, r.stableOffset, target);
      p.fixRounds = fixed.compiles - 1;
      p.fixMs = fixed.result.timings.fixMs ?? 0;
      p.fixedIn = fixed.result.status === "ok" ? p.fixRounds : null;
      if (p.fixedIn === null) {
        // Layer 4 (#21), as the client asks once its last good render is stale.
        const fallback = await server.compile(r.healed, r.stableOffset, target, {
          fallback: { isolate: true, stablePrefix: true },
        });
        const f = fallback.result.fallback;
        p.fallback =
          fallback.result.status !== "ok"
            ? null
            : f?.plainFrom != null
              ? "stable-prefix"
              : f?.isolated.length
                ? "isolated"
                : "fixed";
      }
      if (research) {
        const settled = prefix.slice(0, heal(prefix).map.toInput(r.stableOffset));
        p.stableOk = compileErrors(engine, heal(settled).source, target).length === 0;
      }
    }
    out.push(p);
  }
  return out;
};
