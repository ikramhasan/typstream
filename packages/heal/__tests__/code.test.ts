// The oracle properties on documents with real code in them (codeDocumentArb):
// every operator, closures, patterns, rules, control flow and code newlines.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { heal } from "../src";
import { modeAt } from "../src/lint";
import { effectiveRequirements, recognize } from "../src/recognizer";
import { codeDocumentArb, prefixes } from "./support/generators";
import { knownBug } from "./support/known-bugs";
import { syntaxErrors, syntaxTree, tokenModes } from "./support/oracle";

// Mutation runs (HEAL_PROPERTY_RUNS=10) keep at least 30: the only generator with real code in it.
const RUNS = Math.max(Number(process.env.HEAL_PROPERTY_RUNS ?? 150), 30);

const clean = (text: string): boolean => {
  const r = recognize(text);
  return (
    r.errors.length === 0 && effectiveRequirements(r.requirements).every((q) => q.type === "cut" && q.soft === true)
  );
};

describe("documents with code", () => {
  it("recognizer ≡ typst-syntax on the document and its prefixes", () => {
    fc.assert(
      fc.property(codeDocumentArb, (doc) => {
        for (const p of prefixes(doc, 3)) {
          const theirs = syntaxErrors(p).length === 0;
          if (clean(p) !== theirs) {
            throw new Error(
              `disagreement (oracle clean=${theirs}) on ${JSON.stringify(p)}\n${syntaxTree(p).slice(0, 2000)}`,
            );
          }
        }
      }),
      { numRuns: RUNS },
    );
  });

  it("modes ≡ typst-syntax on documents that parse", () => {
    fc.assert(
      fc.property(
        codeDocumentArb.filter((d) => syntaxErrors(d).length === 0),
        (doc) => {
          const { modes } = recognize(doc);
          const theirs = tokenModes(doc);
          expect(
            theirs.map(({ start }) => ({ start, mode: modeAt(modes, start) })),
            JSON.stringify(doc),
          ).toEqual(theirs);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("every healed prefix parses", () => {
    fc.assert(
      fc.property(
        codeDocumentArb.filter((d) => syntaxErrors(d).length === 0),
        (doc) => {
          for (const p of prefixes(doc, 2)) {
            const out = heal(p).source;
            const errors = syntaxErrors(out);
            if (errors.length > 0 && !knownBug(p, errors)) {
              throw new Error(
                `input:  ${JSON.stringify(p)}\noutput: ${JSON.stringify(out)}\n${JSON.stringify(syntaxErrors(out))}`,
              );
            }
          }
          expect(heal(doc).source).toBe(doc);
        },
      ),
      { numRuns: Math.ceil(RUNS / 2) },
    );
  });
});
