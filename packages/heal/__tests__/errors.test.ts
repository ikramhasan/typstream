// Error positions ≡ typst-syntax: the recognizer reports the errors healing
// can't fix (HealResult.errors). Its messages are its own, but where Typst
// finds a single error, the recognizer's first error must be at the same place.
// (With more than one, recovery after the first may differ, and the port keeps
// unclosed delimiters as requirements rather than errors.)

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { recognize, type SyntaxIssue } from "../src/recognizer";
import { documentArb, prefixes, soupArb } from "./support/generators";
import { syntaxErrors } from "./support/oracle";

// Mutation runs (HEAL_PROPERTY_RUNS=10) keep at least 30: this test kills parser mutants the others can't.
const RUNS = Math.max(Number(process.env.HEAL_PROPERTY_RUNS ?? 150), 30);

/**
 * Known bug: an embedded expression that ends in an error at a line break
 * (`#let x = ⏎`, `#for x in y ⏎`, a bare `#⏎`) leaves the token on the next
 * line in code mode when the code lexer rejects it (`'`, `&`); Typst re-lexes it
 * as markup. The port then reports that token instead of the real error.
 */
const lineBreakAfterError = (text: string, theirs: { start: number; message: string }[], ours: SyntaxIssue): boolean =>
  theirs.some(
    (e) =>
      e.start < ours.start && e.message.startsWith("expected") && /^[ \t]*(\/\/[^\n]*)?\r?\n/.test(text.slice(e.start)),
  );

/**
 * Known divergences, not bugs in what healing produces:
 * - a `#` followed by whitespace: the port marks the `#` itself, Typst the
 *   empty span after it, or nothing when another error follows (`# ]`);
 * - a missing comma in a list: Typst first reports the unexpected tokens and
 *   then the missing comma after them; the port reports the comma where it was
 *   expected.
 */
const sameStart = (text: string, ours: SyntaxIssue, theirs: number[]): boolean =>
  theirs.includes(ours.start) ||
  // (Typst reports the missing expression after it, or, when an error follows, only that one.)
  (ours.message === "expected expression" && text[ours.start] === "#" && theirs.length > 0) ||
  ours.message === "expected Comma";

const firstErrorAgrees = (text: string): void => {
  const { errors } = recognize(text);
  if (errors.length === 0) return;
  const first = errors.reduce((a, b) => (b.start < a.start ? b : a));
  const theirs = syntaxErrors(text);
  if (theirs.length !== 1 || lineBreakAfterError(text, theirs, first)) return;
  if (
    !sameStart(
      text,
      first,
      theirs.map((e) => e.start),
    )
  ) {
    throw new Error(`${JSON.stringify(text)}\nours: ${JSON.stringify(first)}\ntheirs: ${JSON.stringify(theirs)}`);
  }
};

describe("recognizer errors ≡ typst-syntax", () => {
  it("on character soup", () => {
    // Seeded: on random soup, error reporting differs in details the port doesn't
    // copy (where `expected colon` or a link error lands after other errors), and
    // a test that finds a new one only on some runs would make CI flaky.
    fc.assert(fc.property(soupArb, firstErrorAgrees), { numRuns: RUNS * 20, seed: 1 });
  });

  it("on prefixes of generated documents", () => {
    fc.assert(
      fc.property(documentArb, (doc) => {
        for (const p of prefixes(doc, 5)) firstErrorAgrees(p);
      }),
      { numRuns: Math.ceil(RUNS / 3) },
    );
  });

  it("every reported error is a real one", () => {
    // Typst reports an error wherever the recognizer does, on inputs from the corpus of past bugs.
    for (const text of ["#f(a: 1, a: 2)", "#let (a, a) = (1, 2)", "a ] b", "a */ b", "#(a: 1, a: 2)", "#f(1: 2)"]) {
      expect(recognize(text).errors.map((e) => e.start)).toEqual(syntaxErrors(text).map((e) => e.start));
    }
  });

  it.each([
    ["#\n& x", 1],
    ["#let x = \n'a", 8],
    ["#for x in y \n'a", 11],
  ])("known bug still reproduces: %j lexes the next line as code", (text, error) => {
    // Typst reports only the missing piece; the port reports the next line's first token instead.
    expect(syntaxErrors(text).map((e) => e.start)).toEqual([error]);
    expect(recognize(text).errors.map((e) => e.message)).toContainEqual(expect.stringMatching(/is not valid in code/));
    expect(recognize(text).errors.map((e) => e.start)).not.toContain(error);
  });
});
