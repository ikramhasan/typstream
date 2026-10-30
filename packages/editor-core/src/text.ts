// Text as Typst's markup lexer reads it (typst-syntax lexer.rs): what to escape so typed text stays
// the characters typed, and Typst string literals. The teacher never sees the source, so whatever
// they type must come out on the page as typed: `*` is a star, not bold.

const ALPHANUMERIC = /[\p{Alphabetic}\p{N}]/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const WHITESPACE = /\p{White_Space}/u;
const DIGIT = /\p{N}/u;

/** lexer.rs `in_word`'s test: `*` and `_` between two such characters are text, not delimiters. */
export const isWordy = (c: string | undefined): boolean => c !== undefined && ALPHANUMERIC.test(c) && !CJK.test(c);

/** Whitespace as Typst's lexer reads it. */
export const isWhitespace = (c: string | undefined): boolean => c !== undefined && WHITESPACE.test(c);

// Characters that start markup anywhere in a line. `'` and `"` are smart quotes, which is what
// they mean in text, so they stay.
const ESCAPED = new Set(["\\", "*", "_", "`", "$", "#", "<", ">", "@", "[", "]", "~"]);

/**
 * Escapes `text` for markup, to be inserted between `before` and `after` (the source around the
 * insertion point), so Typst reads it back as the same characters: delimiters, shorthands (`--`,
 * `...`, `-?`), comments (`//`), links (`https://`), and at the start of a line the markers of
 * headings, lists and terms.
 */
export const escapeMarkup = (text: string, before = "", after = ""): string => {
  let out = "";
  const full = text + after;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    const prev = i === 0 ? before.at(-1) : text[i - 1];
    const next = full[i + 1];
    const lineStart = i === 0 ? atLineStart(before) : /\n[ \t]*$/.test(text.slice(0, i));
    if (ESCAPED.has(c)) out += `\\${c}`;
    else if (
      lineStart &&
      (c === "=" || c === "/" || ((c === "-" || c === "+") && (next === " " || next === undefined)))
    )
      out += `\\${c}`;
    else if (lineStart && DIGIT.test(c) && /^\p{N}+\./u.test(full.slice(i))) {
      // `1.` starts a numbered item: escape the dot.
      const digits = /^\p{N}+/u.exec(full.slice(i))?.[0] ?? c;
      const own = Math.min(digits.length, text.length - i);
      out += text.slice(i, i + own);
      i += own - 1;
      if (i + 1 < text.length && text[i + 1] === ".") {
        out += "\\.";
        i++;
      }
    }
    // Shorthands: `--`, `-?`, `-` before a digit (a minus sign), `...`.
    else if (c === "-" && (next === "-" || next === "?" || prev === "-" || (next !== undefined && DIGIT.test(next))))
      out += "\\-";
    else if (c === "." && dots(before + text.slice(0, i), full.slice(i + 1))) out += "\\.";
    // Comments: `//`, `/*`, and a `*/` closing one.
    else if (c === "/" && (next === "/" || next === "*" || prev === "/" || prev === "*")) out += "\\/";
    // `http://` and `https://` start a link: escape the first slash.
    else if (
      c === ":" &&
      /^\/\//.test(full.slice(i + 1)) &&
      /https?$/.test((before + text.slice(0, i)).slice(-5)) &&
      i + 2 < text.length
    ) {
      out += ":\\//";
      i += 2;
    } else out += c;
  }
  return out;
};

/** Whether a `.` between `left` and `right` would be part of `...` (an ellipsis). Escaped dots don't count. */
const dots = (left: string, right: string): boolean => {
  const l = /(?<!\\)\.{0,2}$/.exec(left)?.[0].length ?? 0;
  const r = /^\.{0,2}/.exec(right)?.[0].length ?? 0;
  return l + r >= 2;
};

/** Whether `before` ends at the start of a line (only spaces since its last newline, or nothing). */
export const atLineStart = (before: string): boolean => /(^|\n)[ \t]*$/.test(before);

/** A Typst string literal for `value`. */
export const typstString = (value: string): string => {
  let out = '"';
  for (const c of value) {
    if (c === '"' || c === "\\") out += `\\${c}`;
    else if (c === "\n") out += "\\n";
    else if (c === "\r") out += "\\r";
    else if (c === "\t") out += "\\t";
    else out += c;
  }
  return `${out}"`;
};

/** The value of a Typst string literal, or null if `literal` isn't a simple one. */
export const readString = (literal: string): string | null => {
  if (literal.length < 2 || !literal.startsWith('"') || !literal.endsWith('"')) return null;
  let out = "";
  for (let i = 1; i < literal.length - 1; i++) {
    const c = literal[i] as string;
    if (c !== "\\") {
      out += c;
      continue;
    }
    const n = literal[++i];
    if (n === "n") out += "\n";
    else if (n === "r") out += "\r";
    else if (n === "t") out += "\t";
    else if (n === "u") {
      const close = literal.indexOf("}", i);
      out += String.fromCodePoint(Number.parseInt(literal.slice(i + 2, close), 16));
      i = close;
    } else out += n ?? "";
  }
  return out;
};
