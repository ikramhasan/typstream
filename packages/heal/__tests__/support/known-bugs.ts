// Apart from corpus.ts, which loads the parse oracle, so tools/compile-oracle can
// tolerate the same bugs without it.
import type { OracleError } from "./oracle";

/**
 * Heal bugs the corpus found and that are not fixed yet. A failing prefix that
 * matches one of these is tolerated; anything else fails the test. Each bug's
 * `repro` must keep failing: when a fix lands, the "still reproduces" test
 * fails, and the entry moves to a row in constructs.test.ts.
 */
export const KNOWN_HEAL_BUGS: {
  name: string;
  repro: string;
  matches: (prefix: string, errors: OracleError[]) => boolean;
}[] = [
  {
    // `#let f(x) = if c { a } el…` or `… else i…`: the cut lands inside a keyword.
    // The partial keyword is kept, and the let statement then needs a semicolon or
    // line break before it (or, after `else`, a block).
    name: "partial `else` / `else if` after an if-expression in a #let",
    repro: "#let f(x) = if x { 1 } el",
    matches: (prefix, errors) =>
      /\}\s*(e|el|els|else\s+i)$/.test(prefix) &&
      errors.every((e) => e.message === "expected semicolon or line break" || e.message === "expected block"),
  },
  {
    // `fill: (_, y) => …` cut before `=>`: closing the group makes it an array,
    // where the `_` placeholder is not an expression.
    name: "`_` placeholder in a parenthesized group closed before `=>`",
    repro: "#f(fill: (_, y",
    matches: (prefix, errors) =>
      /\(_,[^()]*(\)\s*)?$/.test(prefix) && errors.every((e) => e.message.includes("found underscore")),
  },
];

export const knownBug = (prefix: string, errors: OracleError[]) =>
  KNOWN_HEAL_BUGS.find((b) => b.matches(prefix, errors));
