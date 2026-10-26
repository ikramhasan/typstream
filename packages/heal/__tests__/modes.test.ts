// Mode classification ≡ typst-syntax (PLAN.md §11.1): at every token of a
// document that parses, the recognizer's lexer mode (what lint rules and
// handlers see through `modeAt`) is the mode Typst's parser lexed it in.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { heal } from "../src";
import { modeAt } from "../src/lint";
import { recognize } from "../src/recognizer";
import { documentArb, prefixes, soupArb } from "./support/generators";
import { syntaxErrors, tokenModes } from "./support/oracle";

// Mutation runs (HEAL_PROPERTY_RUNS=10) keep at least 30: this test kills parser mutants the others can't.
const RUNS = Math.max(Number(process.env.HEAL_PROPERTY_RUNS ?? 150), 30);

const agree = (text: string): void => {
  const { modes } = recognize(text);
  const ours = tokenModes(text).map(({ start }) => ({ start, mode: modeAt(modes, start) }));
  expect(ours, JSON.stringify(text)).toEqual(tokenModes(text));
};

describe("recognizer modes ≡ typst-syntax", () => {
  it("on generated documents", () => {
    fc.assert(
      fc.property(documentArb, (doc) => agree(doc)),
      { numRuns: RUNS },
    );
  });

  it("on healed prefixes", () => {
    fc.assert(
      fc.property(documentArb, (doc) => {
        for (const p of prefixes(doc, 7)) agree(heal(p).source);
      }),
      { numRuns: Math.ceil(RUNS / 3) },
    );
  });

  it("on character soup that parses", () => {
    fc.assert(
      fc.property(
        soupArb.filter((s) => syntaxErrors(s).length === 0),
        (s) => agree(s),
      ),
      { numRuns: RUNS * 5 },
    );
  });
});
