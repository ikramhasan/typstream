// Character classes, matching the Rust predicates typst-syntax uses
// (unicode-ident, char::is_alphanumeric, char::is_whitespace, ...).

const XID_START = /\p{XID_Start}/u;
const XID_CONTINUE = /\p{XID_Continue}/u;
const ALPHANUMERIC = /[\p{Alphabetic}\p{N}]/u;
const NUMERIC = /\p{N}/u;
const ALPHABETIC = /\p{Alphabetic}/u;
const WHITESPACE = /\p{White_Space}/u;
const CJK_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const MARK = /\p{M}|\u200d|\ufe0f/u;

const isAsciiAlpha = (c: string): boolean => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
export const isAsciiDigit = (c: string | undefined): boolean => c !== undefined && c >= "0" && c <= "9";
export const isAsciiAlphanumeric = (c: string | undefined): boolean =>
  c !== undefined && (isAsciiAlpha(c) || isAsciiDigit(c));

export const isXidStart = (c: string): boolean => (c < "\x80" ? isAsciiAlpha(c) : XID_START.test(c));
export const isXidContinue = (c: string): boolean =>
  c < "\x80" ? isAsciiAlpha(c) || isAsciiDigit(c) || c === "_" : XID_CONTINUE.test(c);

export const isIdStart = (c: string | undefined): boolean => c !== undefined && (c === "_" || isXidStart(c));
export const isIdContinue = (c: string | undefined): boolean =>
  c !== undefined && (c === "_" || c === "-" || isXidContinue(c));
export const isMathIdStart = (c: string | undefined): boolean => c !== undefined && isXidStart(c);
export const isMathIdContinue = (c: string | undefined): boolean => c !== undefined && c !== "_" && isXidContinue(c);
export const isValidInLabelLiteral = (c: string | undefined): boolean =>
  c !== undefined && (isIdContinue(c) || c === ":" || c === ".");

export const isAlphanumeric = (c: string | undefined): boolean =>
  c !== undefined && (c < "\x80" ? isAsciiAlphanumeric(c) : ALPHANUMERIC.test(c));
export const isAlphabetic = (c: string | undefined): boolean =>
  c !== undefined && (c < "\x80" ? isAsciiAlpha(c) : ALPHABETIC.test(c));
export const isNumeric = (c: string | undefined): boolean =>
  c !== undefined && (c < "\x80" ? isAsciiDigit(c) : NUMERIC.test(c));
export const isWhitespace = (c: string | undefined): boolean =>
  c !== undefined &&
  (c === " " ||
    c === "\t" ||
    c === "\n" ||
    c === "\r" ||
    (c >= "\x80" && WHITESPACE.test(c)) ||
    c === "\x0b" ||
    c === "\x0c");
export const isNewline = (c: string | undefined): boolean =>
  c === "\n" || c === "\x0b" || c === "\x0c" || c === "\r" || c === "\u0085" || c === "\u2028" || c === "\u2029";
export const isCjk = (c: string): boolean => c >= "\u1100" && CJK_SCRIPT.test(c);
/** Combining marks / joiners that stay in the same grapheme as the previous char. */
export const isGraphemeExtend = (c: string | undefined): boolean => c !== undefined && c >= "\u0300" && MARK.test(c);

/** Math delimiters, per Unicode math class Opening / Closing (common subset). */
const MATH_OPENING = new Set([..."([{⌈⌊⌜⌞⟅⟦⟨⟪⟬⟮⦃⦅⦇⦉⦋⦍⦏⦑⦓⦕⦗⧘⧚⧼❨❪❬❮❰❲❴〈《「『【〔〖〘〚⁅⁽₍"]);
const MATH_CLOSING = new Set([...")]}⌉⌋⌝⌟⟆⟧⟩⟫⟭⟯⦄⦆⦈⦊⦌⦎⦐⦒⦔⦖⦘⧙⧛⧽❩❫❭❯❱❳❵〉》」』】〕〗〙〛⁆⁾₎"]);
export const isMathOpening = (c: string): boolean => MATH_OPENING.has(c);
export const isMathClosing = (c: string): boolean => MATH_CLOSING.has(c);
