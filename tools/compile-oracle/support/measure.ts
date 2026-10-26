// Heals stream prefixes and compiles each healed source with the real compiler.
import { createHealer, type HealResult } from "@typstream/heal";
import type { Diagnostic, Engine } from "./engine";

export type Target = "html" | "paged";

export interface PrefixResult {
  /** Index of the last chunk in the prefix. */
  index: number;
  /** Input length (UTF-16 units) of the prefix. */
  cut: number;
  healed: string;
  stableOffset: number;
  errors: Diagnostic[];
}

/** Compiles a source and returns its errors (warnings dropped). */
export const compileErrors = (engine: Engine, source: string, target: Target): Diagnostic[] => {
  engine.set_source("/main.typ", source);
  const result = target === "html" ? engine.compile_html() : engine.compile_svg_changed();
  return result.diagnostics.filter((d) => d.severity === "error");
};

/**
 * Pushes `chunks` through one incremental healer, as a stream arrives, and
 * compiles the healed source after every chunk whose index `sample` accepts.
 */
export const compilePrefixes = (
  engine: Engine,
  chunks: readonly string[],
  target: Target,
  sample: (index: number) => boolean = () => true,
): PrefixResult[] => {
  const healer = createHealer();
  const out: PrefixResult[] = [];
  let cut = 0;
  chunks.forEach((chunk, i) => {
    const healed: HealResult = healer.push(chunk);
    cut += chunk.length;
    if (!sample(i)) return;
    out.push({
      index: i,
      cut,
      healed: healed.source,
      stableOffset: healed.stableOffset,
      errors: compileErrors(engine, healed.source, target),
    });
  });
  return out;
};
