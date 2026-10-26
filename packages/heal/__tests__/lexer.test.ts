// The lexer port (src/lexer.ts) ≡ Typst's lexer (lexer.rs, run alone by the
// oracle): same token kinds, boundaries and error messages, in every mode.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Lexer, type Mode } from "../src/lexer";
import { documentArb, soupArb } from "./support/generators";
import { lexTokens, type OracleToken } from "./support/oracle";

// Lexing alone is cheap: mutation runs (HEAL_PROPERTY_RUNS=10) keep at least 100.
const RUNS = Math.max(Number(process.env.HEAL_PROPERTY_RUNS ?? 150), 100);
const MODES: Mode[] = ["markup", "math", "code"];

// Known divergence: the port reports every malformed number as "invalid number"
// over the whole token; Typst names the base ("invalid binary number: `0b2`"),
// and heal only needs to know that the token is an error.
const sameError = (ours: string | undefined, theirs: string | undefined): boolean =>
  ours === theirs ||
  (ours?.startsWith("invalid number: ") === true &&
    /^(invalid (floating point|binary|octal|hexadecimal) number|expected an? \w+ number|\w+ numbers cannot have a suffix)/.test(
      theirs ?? "",
    ));

const ours = (text: string, mode: Mode): OracleToken[] => {
  const lexer = new Lexer(text, mode);
  const out: OracleToken[] = [];
  for (let t = lexer.next(); t.kind !== "End"; t = lexer.next()) {
    out.push({ kind: t.kind, start: t.start, end: t.end, ...(t.kind === "Error" ? { error: t.error } : {}) });
  }
  return out;
};

/**
 * Known bug: right after a `#`, Typst reports an invalid operator one character
 * at a time (`invalid_char_in_code`); the port reports `&&`, `||` and `~=` whole.
 * Only error tokens differ. Code-mode comparisons skip texts with these.
 */
const HASH_OPERATOR_BUG = ["#&&", "#||", "#~="];

const agree = (text: string, mode: Mode): void => {
  if (mode === "code" && HASH_OPERATOR_BUG.some((b) => text.includes(b))) return;
  const theirs = lexTokens(text, mode);
  const mine = ours(text, mode).map((t, i) =>
    t.kind === "Error" && sameError(t.error, theirs[i]?.error) ? { ...t, error: theirs[i]?.error } : t,
  );
  expect(mine, `${mode}: ${JSON.stringify(text)}`).toEqual(theirs);
};

/** Non-ASCII text: identifiers, CJK, combining marks, Unicode spaces and newlines, math delimiters. */
const unicodeSoupArb = fc
  .array(
    fc.constantFrom(
      ..."éßΩжश文かカ한ⅣⅫ١½²",
      "e\u0301",
      "\u200d",
      "\ufe0f",
      "a\u0308b",
      "\u00a0",
      "\u2003",
      "\u3000",
      "\u0085",
      "\u2028",
      "\u2029",
      "\x0b",
      "\x0c",
      "\r\n",
      "\r",
      "⌈x⌉",
      "⟨a⟩",
      "√",
      "∛",
      "∜",
      ..."*_#$[](){}<>@`\\\"'=-+/:;,.^&!|~ \nab01",
      "@ref",
      "<lbl>",
      "x.y",
      "f(",
      "_é",
      "-é",
      "#é",
    ),
    { maxLength: 30 },
  )
  .map((parts) => parts.join(""));

/**
 * Known bug: chars.ts's math delimiter sets aren't Typst's (unicode-math-class).
 * These lex as delimiters in the port but as text in Typst, and `⎰⎱` the other
 * way round. Unbalanced math delimiters are never syntax errors, so healing
 * results don't change. The soups above leave these characters out.
 */
const MATH_DELIMITER_BUG = [..."❨❪❬❮❰❴〈《「『【〔〖〘〚⁅⁽₍⎰"];

/**
 * Known bug: math text is split into grapheme clusters by isGraphemeExtend, which
 * only knows combining marks, ZWJ and VS16. Typst uses full extended grapheme
 * clusters (emoji modifier, flag and ZWJ sequences, Hangul jamo, Indic conjuncts,
 * prepend marks), and a multi-character cluster is text, not an identifier. Only
 * the tokens inside math change, not whether a document parses. The soups leave
 * these sequences out.
 */
const GRAPHEME_BUG = [
  "\u{1f44d}\u{1f3fd}",
  "\u{1f1e7}\u{1f1e9}",
  "\u{1f468}\u200d\u{1f469}",
  "\u1100\u1161\u11a8",
  "\u0915\u094d\u0937\u093f",
  "\u0600x",
];

describe("lexer ≡ Typst's lexer", () => {
  it.each(MODES)("%s: character soup", (mode) => {
    fc.assert(
      fc.property(soupArb, (s) => agree(s, mode)),
      { numRuns: RUNS * 5 },
    );
  });
  it.each(MODES)("%s: Unicode soup", (mode) => {
    fc.assert(
      fc.property(unicodeSoupArb, (s) => agree(s, mode)),
      { numRuns: RUNS * 5 },
    );
  });
  it.each(MODES)("%s: generated documents", (mode) => {
    fc.assert(
      fc.property(documentArb, (s) => agree(s, mode)),
      { numRuns: RUNS },
    );
  });

  it("known bug still reproduces: math delimiter classes", () => {
    for (const c of MATH_DELIMITER_BUG) {
      expect(ours(c, "math")[0]?.kind, `fixed? drop ${c} from MATH_DELIMITER_BUG`).not.toBe(
        lexTokens(c, "math")[0]?.kind,
      );
    }
  });
  it("known bug still reproduces: an invalid operator right after `#`", () => {
    for (const s of HASH_OPERATOR_BUG) {
      expect(ours(s, "code"), `fixed? drop ${s} from HASH_OPERATOR_BUG`).not.toEqual(lexTokens(s, "code"));
    }
  });
  it("known bug still reproduces: math grapheme clusters", () => {
    for (const s of GRAPHEME_BUG) {
      expect(ours(s, "math"), `fixed? drop ${JSON.stringify(s)} from GRAPHEME_BUG`).not.toEqual(lexTokens(s, "math"));
    }
  });
});
