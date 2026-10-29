// A plugin's conformance suite (#135): the examples its paged view, Typst's PDF and its DOCX export must agree on. The
// plugin's own tests call `pagedConformance` (./paged, in a browser) and `docxConformance` (./docx, in Node) with it.
import type { TypstreamPlugin } from "@typstream/core";

/** A document the suite checks. */
export interface ConformanceExample {
  /** Unique in the suite: the test's name. */
  name: string;
  /** Typst, as a model writes it: the plugins' preambles go before it. */
  source: string;
  /** Files it reads, by path relative to it. */
  files?: Record<string, string | Uint8Array>;
  /** `sys.inputs` (edu's `showAnswers`). */
  inputs?: Record<string, string>;
}

/** The plugins documents are written with, and the examples. */
export interface ConformanceSuite {
  /** Names the suite's tests and its output folder. */
  name: string;
  /** As an app passes them: the suite's plugin and those it needs. */
  plugins: TypstreamPlugin[];
  examples: ConformanceExample[];
}

/** Each example once per set of inputs, named after them: `name (key=value)`. */
export const withInputs = (examples: ConformanceExample[], variants: Record<string, string>[]): ConformanceExample[] =>
  variants.flatMap((inputs) =>
    examples.map((e) => ({
      ...e,
      name: `${e.name} (${Object.entries(inputs)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")})`,
      inputs: { ...e.inputs, ...inputs },
    })),
  );
