// Text as Typst's markup lexer reads it (typst-syntax lexer.rs, mirrored by heal's lexer.ts):
// what must be escaped for text to stay text, the shorthands and escapes to resolve, string
// literals and colours.

const ALPHANUMERIC = /[\p{Alphabetic}\p{N}]/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const ID_CONTINUE = /[\p{XID_Continue}-]/u;
const WHITESPACE = /\p{White_Space}/u;

/** lexer.rs `in_word`'s test: `*` and `_` between two such characters are text, not delimiters. */
export const isWordy = (c: string | undefined): boolean => c !== undefined && ALPHANUMERIC.test(c) && !CJK.test(c);

/** Whether `c` continues an identifier (`is_id_continue`, with `-`), so it would extend `#name`. */
export const isIdContinue = (c: string | undefined): boolean => c !== undefined && ID_CONTINUE.test(c);

export const isWhitespace = (c: string | undefined): boolean => c !== undefined && WHITESPACE.test(c);

const ch = (code: number): string => String.fromCharCode(code);

/** Markup shorthands (ast.rs `Shorthand::LIST`) and the characters they stand for. */
export const SHORTHANDS: Record<string, string> = {
  "...": ch(0x2026),
  "~": ch(0xa0),
  "-": ch(0x2212),
  "--": ch(0x2013),
  "---": ch(0x2014),
  "-?": ch(0xad),
};

/** The character an `Escape` token stands for: `\*` is `*`, `\u{1F600}` is 😀. */
export const escapedChar = (token: string): string => {
  if (token.startsWith("\\u{")) return String.fromCodePoint(Number.parseInt(token.slice(3, -1), 16));
  return token.slice(1);
};

// Characters that start markup anywhere in a line. `'` and `"` are smart quotes, which is what
// they mean in text, so they stay.
const ESCAPED = new Set(["\\", "*", "_", "`", "$", "#", "<", "@", "[", "]", "~"]);

/**
 * Escapes text so Typst's markup lexer reads it back as the same characters. Markers at the start
 * of a line (`- `, `= `, …) are the caller's to escape.
 */
export const escapeMarkup = (text: string): string => {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    const next = text[i + 1];
    if (ESCAPED.has(c)) out += `\\${c}`;
    // Shorthands: `--`, `-?`, `-` before a digit, `...`; comments `//` and `/*`.
    else if (c === "-" && (next === "-" || next === "?" || (next !== undefined && /\p{N}/u.test(next)))) out += "\\-";
    else if (c === "." && text.startsWith("..", i + 1)) out += "\\.";
    // A `/` at either end could meet a `*` delimiter (`*a/*` opens a comment, `*/a` closes one).
    else if (c === "/" && (next === "/" || next === "*" || next === undefined || i === 0)) out += "\\/";
    // `http://` and `https://` start a link: escape the first slash.
    else if (c === "h" && /^https?:\/\//.test(text.slice(i))) {
      const colon = text.indexOf(":", i);
      out += `${text.slice(i, colon + 1)}\\/`;
      i = colon + 1;
    } else out += c;
  }
  return out;
};

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

/** The value of a Typst string literal (`Str` token), or null if it isn't one. */
export const readString = (literal: string): string | null => {
  if (literal.length < 2 || !literal.startsWith('"') || !literal.endsWith('"')) return null;
  let out = "";
  const body = literal.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const c = body[i] as string;
    if (c !== "\\") {
      out += c;
      continue;
    }
    const e = body[++i];
    if (e === "n") out += "\n";
    else if (e === "r") out += "\r";
    else if (e === "t") out += "\t";
    else if (e === "u" && body[i + 1] === "{") {
      const end = body.indexOf("}", i);
      if (end < 0) return null;
      out += String.fromCodePoint(Number.parseInt(body.slice(i + 2, end), 16));
      i = end;
    } else if (e === "\\" || e === '"') out += e;
    else return null;
  }
  return out;
};

/** Typst's named colours (`red`, `blue`, …) as hex. */
export const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  gray: "#aaaaaa",
  silver: "#dddddd",
  white: "#ffffff",
  navy: "#001f3f",
  blue: "#0074d9",
  aqua: "#7fdbff",
  teal: "#39cccc",
  eastern: "#239dad",
  purple: "#b10dc9",
  fuchsia: "#f012be",
  maroon: "#85144b",
  red: "#ff4136",
  orange: "#ff851b",
  yellow: "#ffdc00",
  olive: "#3d9970",
  green: "#2ecc40",
  lime: "#01ff70",
};

/** A CSS hex colour (`#rgb`, `#rrggbb`, `#rrggbbaa`), lower-cased, or null. */
export const hexColor = (value: string): string | null =>
  /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) ? value.toLowerCase() : null;

/** The Typst expression for a hex colour. */
export const typstColor = (hex: string): string => `rgb(${typstString(hex)})`;
