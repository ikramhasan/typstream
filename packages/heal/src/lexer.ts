// Port of typst-syntax 0.15.1's lexer (lexer.rs). Produces the same token
// boundaries and kinds; error tokens carry their message. Offsets are UTF-16
// indices. Nodes are not built: the recognizer only needs kinds and spans.

import {
  isAlphanumeric,
  isAsciiAlphanumeric,
  isAsciiDigit,
  isCjk,
  isGraphemeExtend,
  isIdContinue,
  isIdStart,
  isMathClosing,
  isMathIdContinue,
  isMathIdStart,
  isMathOpening,
  isNewline,
  isNumeric,
  isValidInLabelLiteral,
  isWhitespace,
} from "./chars";

/**
 * Typst's lexical modes: which grammar a token is read with. {@link ModeSpan} adds raw blocks and comments.
 * @internal Reached only through `Recognition.modes`; handlers see core's `SyntaxMode`.
 */
export type Mode = "markup" | "math" | "code";

export type Kind =
  | "End"
  | "Error"
  | "Shebang"
  | "LineComment"
  | "BlockComment"
  | "Space"
  | "Parbreak"
  // markup
  | "Text"
  | "Linebreak"
  | "Escape"
  | "Shorthand"
  | "SmartQuote"
  | "Raw"
  | "Link"
  | "Label"
  | "RefMarker"
  | "HeadingMarker"
  | "ListMarker"
  | "EnumMarker"
  | "TermMarker"
  | "Star"
  | "Underscore"
  | "Hash"
  | "LeftBracket"
  | "RightBracket"
  | "Dollar"
  | "Colon"
  // math
  | "MathText"
  | "MathIdent"
  | "MathFieldAccess"
  | "MathShorthand"
  | "MathAlignPoint"
  | "MathPrimes"
  | "Root"
  | "Bang"
  | "Hat"
  | "Slash"
  | "Dot"
  | "Comma"
  | "Semicolon"
  | "LeftBrace"
  | "RightBrace"
  | "LeftParen"
  | "RightParen"
  | "Str"
  // code
  | "Ident"
  | "Int"
  | "Float"
  | "Numeric"
  | "Plus"
  | "Minus"
  | "Eq"
  | "EqEq"
  | "ExclEq"
  | "Lt"
  | "LtEq"
  | "Gt"
  | "GtEq"
  | "PlusEq"
  | "HyphEq"
  | "StarEq"
  | "SlashEq"
  | "Dots"
  | "Arrow"
  | "Not"
  | "And"
  | "Or"
  | "None"
  | "Auto"
  | "Bool"
  | "Let"
  | "Set"
  | "Show"
  | "Context"
  | "If"
  | "Else"
  | "For"
  | "In"
  | "While"
  | "Break"
  | "Continue"
  | "Return"
  | "Import"
  | "Include"
  | "As";

export interface Token {
  kind: Kind;
  start: number;
  end: number;
  /** Error message for `Error` tokens. */
  error?: string;
  /** Unclosed raw: number of opening backticks. */
  rawTicks?: number;
  /** Unclosed string: whether it ends in an unfinished escape. */
  strEscaped?: boolean;
}

const KEYWORDS: Record<string, Kind> = {
  none: "None",
  auto: "Auto",
  true: "Bool",
  false: "Bool",
  not: "Not",
  and: "And",
  or: "Or",
  let: "Let",
  set: "Set",
  show: "Show",
  context: "Context",
  if: "If",
  else: "Else",
  for: "For",
  in: "In",
  while: "While",
  break: "Break",
  continue: "Continue",
  return: "Return",
  import: "Import",
  include: "Include",
  as: "As",
};

export const isKeyword = (k: Kind): boolean =>
  k === "Not" ||
  k === "And" ||
  k === "Or" ||
  k === "None" ||
  k === "Auto" ||
  k === "Let" ||
  k === "Set" ||
  k === "Show" ||
  k === "Context" ||
  k === "If" ||
  k === "Else" ||
  k === "For" ||
  k === "In" ||
  k === "While" ||
  k === "Break" ||
  k === "Continue" ||
  k === "Return" ||
  k === "Import" ||
  k === "Include" ||
  k === "As" ||
  k === "Bool";

export const isTrivia = (k: Kind): boolean =>
  k === "Space" || k === "Parbreak" || k === "LineComment" || k === "BlockComment" || k === "Shebang";

const cpLen = (code: number): number => (code >= 0xd800 && code <= 0xdbff ? 2 : 1);

/** Cursor over a string, stepping by code points (unscanny::Scanner equivalent). */
export class Scanner {
  readonly s: string;
  cursor: number;

  constructor(s: string, cursor = 0) {
    this.s = s;
    this.cursor = cursor;
  }

  done(): boolean {
    return this.cursor >= this.s.length;
  }

  peek(): string | undefined {
    if (this.cursor >= this.s.length) return undefined;
    const c = this.s.charCodeAt(this.cursor);
    return this.s.slice(this.cursor, this.cursor + cpLen(c));
  }

  eat(): string | undefined {
    const c = this.peek();
    if (c !== undefined) this.cursor += c.length;
    return c;
  }

  /** Moves back one code point. */
  uneat(): void {
    if (this.cursor === 0) return;
    const lo = this.s.charCodeAt(this.cursor - 1);
    this.cursor -= lo >= 0xdc00 && lo <= 0xdfff && this.cursor >= 2 ? 2 : 1;
  }

  /** Char at relative code point offset: -1 is the char before the cursor, 0 at it, 1 after. */
  scout(n: number): string | undefined {
    const save = this.cursor;
    let c: string | undefined;
    if (n < 0) {
      for (let i = 0; i < -n; i++) {
        if (this.cursor === 0) {
          this.cursor = save;
          return undefined;
        }
        this.uneat();
      }
      c = this.peek();
    } else {
      for (let i = 0; i < n; i++) if (this.eat() === undefined) break;
      c = this.peek();
    }
    this.cursor = save;
    return c;
  }

  at(pat: string | ((c: string) => boolean)): boolean {
    if (typeof pat === "string") return this.s.startsWith(pat, this.cursor);
    const c = this.peek();
    return c !== undefined && pat(c);
  }

  eatIf(pat: string | ((c: string) => boolean)): boolean {
    if (typeof pat === "string") {
      if (this.s.startsWith(pat, this.cursor)) {
        this.cursor += pat.length;
        return true;
      }
      return false;
    }
    const c = this.peek();
    if (c !== undefined && pat(c)) {
      this.cursor += c.length;
      return true;
    }
    return false;
  }

  eatWhile(pred: (c: string) => boolean): string {
    const start = this.cursor;
    for (let c = this.peek(); c !== undefined && pred(c); c = this.peek()) this.cursor += c.length;
    return this.s.slice(start, this.cursor);
  }

  eatUntil(pred: (c: string) => boolean): string {
    return this.eatWhile((c) => !pred(c));
  }
}

const isSpace = (c: string, mode: Mode): boolean =>
  mode === "markup" ? c === " " || c === "\t" || isNewline(c) : isWhitespace(c);

const countNewlines = (text: string): number => {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (isNewline(c)) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      n++;
    }
  }
  return n;
};

// Characters that end a markup text run (see `text()` in lexer.rs).
const TEXT_STOP = new Set([..." \t\n\x0b\x0c\r\\/[]~-.'\"*_:h`$<>@#"]);

export class Lexer {
  readonly s: Scanner;
  mode: Mode;
  /** Whether the last token contained a newline. */
  newline = false;
  private error: string | undefined;

  constructor(text: string, mode: Mode) {
    this.s = new Scanner(text);
    this.mode = mode;
  }

  get cursor(): number {
    return this.s.cursor;
  }

  jump(index: number): void {
    this.s.cursor = index;
  }

  /** Characters between the most recent newline and `index`. */
  column(index: number): number {
    let col = 0;
    let i = index;
    while (i > 0) {
      const code = this.s.s.charCodeAt(i - 1);
      const unit = code >= 0xdc00 && code <= 0xdfff && i >= 2 ? 2 : 1;
      const c = this.s.s.slice(i - unit, i);
      if (isNewline(c)) break;
      col++;
      i -= unit;
    }
    return col;
  }

  next(): Token {
    this.error = undefined;
    const start = this.s.cursor;
    this.newline = false;
    const c = this.s.eat();
    let kind: Kind;
    let extra: Partial<Token> | undefined;
    if (c === undefined) {
      kind = "End";
    } else if (isSpace(c, this.mode)) {
      kind = this.whitespace(start, c);
    } else if (c === "#" && start === 0 && this.s.eatIf("!")) {
      this.s.eatUntil(isNewline);
      kind = "Shebang";
    } else if (c === "/" && this.s.eatIf("/")) {
      this.s.eatUntil(isNewline);
      kind = "LineComment";
    } else if (c === "/" && this.s.eatIf("*")) {
      kind = this.blockComment();
    } else if (c === "*" && this.s.eatIf("/")) {
      kind = this.err("unexpected end of block comment");
    } else if (c === "`" && this.mode !== "math") {
      const raw = this.raw(start);
      kind = raw.kind;
      extra = raw;
    } else if (this.mode === "markup") {
      kind = this.markup(start, c);
    } else if (this.mode === "math") {
      kind = this.math(start, c);
    } else {
      kind = this.code(start, c);
    }
    const tok: Token = { kind, start, end: this.s.cursor };
    if (this.error !== undefined) {
      tok.error = this.error;
      if (this.error === "unclosed string") tok.strEscaped = this.lastStringEscaped;
    }
    if (extra) Object.assign(tok, extra);
    return tok;
  }

  private err(message: string): Kind {
    this.error = message;
    return "Error";
  }

  private whitespace(start: number, c: string): Kind {
    const more = this.s.eatWhile((x) => isSpace(x, this.mode));
    const newlines = c === " " && more === "" ? 0 : countNewlines(this.s.s.slice(start, this.s.cursor));
    this.newline = newlines > 0;
    return this.mode === "markup" && newlines >= 2 ? "Parbreak" : "Space";
  }

  private blockComment(): Kind {
    let state = "_";
    let depth = 1;
    let closed = false;
    for (let c = this.s.eat(); c !== undefined; c = this.s.eat()) {
      if (state === "*" && c === "/") {
        depth--;
        if (depth === 0) {
          closed = true;
          break;
        }
        state = "_";
      } else if (state === "/" && c === "*") {
        depth++;
        state = "_";
      } else {
        state = c;
      }
    }
    this.blockCommentUnclosed = !closed;
    return "BlockComment";
  }

  /** Set by the last block comment token: whether it ran to the end of the text. */
  blockCommentUnclosed = false;

  private raw(start: number): Token {
    let ticks = 1;
    while (this.s.eatIf("`")) ticks++;
    if (ticks === 2) return { kind: "Raw", start, end: this.s.cursor };
    let found = 0;
    while (found < ticks) {
      const c = this.s.eat();
      if (c === "`") found++;
      else if (c !== undefined) found = 0;
      else {
        this.error = "unclosed raw text";
        return { kind: "Error", start, end: this.s.cursor, rawTicks: ticks };
      }
    }
    return { kind: "Raw", start, end: this.s.cursor };
  }

  // --- markup ---------------------------------------------------------------

  private markup(start: number, c: string): Kind {
    const s = this.s;
    switch (c) {
      case "\\":
        return this.backslash();
      case "h":
        if (s.eatIf("ttp://") || s.eatIf("ttps://")) return this.link();
        return this.text();
      case "<":
        if (s.at(isIdContinue)) return this.label();
        return this.text();
      case "@":
        if (s.at(isIdContinue)) return this.refMarker();
        return this.text();
      case ".":
        if (s.eatIf("..")) return "Shorthand";
        return this.text();
      case "-":
        if (s.eatIf("--") || s.eatIf("-") || s.eatIf("?")) return "Shorthand";
        if (s.at(isNumeric)) return "Shorthand";
        if (this.spaceOrEnd()) return "ListMarker";
        return this.text();
      case "*":
        return this.inWord() ? this.text() : "Star";
      case "_":
        return this.inWord() ? this.text() : "Underscore";
      case "#":
        return "Hash";
      case "[":
        return "LeftBracket";
      case "]":
        return "RightBracket";
      case "'":
      case '"':
        return "SmartQuote";
      case "$":
        return "Dollar";
      case "~":
        return "Shorthand";
      case ":":
        return "Colon";
      case "=":
        s.eatWhile((x) => x === "=");
        return this.spaceOrEnd() ? "HeadingMarker" : this.text();
      case "+":
        return this.spaceOrEnd() ? "EnumMarker" : this.text();
      case "/":
        return this.spaceOrEnd() ? "TermMarker" : this.text();
      default:
        if (isAsciiDigit(c)) return this.numbering(start);
        return this.text();
    }
  }

  private backslash(): Kind {
    const s = this.s;
    if (s.eatIf("u{")) {
      const hex = s.eatWhile(isAsciiAlphanumeric);
      if (!s.eatIf("}")) return this.err("unclosed Unicode escape sequence");
      const value = /^[0-9a-fA-F]+$/.test(hex) ? Number.parseInt(hex, 16) : Number.NaN;
      if (!(value <= 0x10ffff) || (value >= 0xd800 && value <= 0xdfff)) {
        return this.err(`invalid Unicode codepoint: ${hex}`);
      }
      return "Escape";
    }
    if (s.done() || s.at(isWhitespace)) return "Linebreak";
    s.eat();
    return "Escape";
  }

  private link(): Kind {
    const { length, balanced } = linkPrefix(this.s.s, this.s.cursor);
    this.s.cursor += length;
    if (!balanced) {
      return this.err("automatic links cannot contain unbalanced brackets, use the `link` function instead");
    }
    return "Link";
  }

  private numbering(start: number): Kind {
    const s = this.s;
    s.eatWhile(isAsciiDigit);
    const read = s.s.slice(start, s.cursor);
    if (s.eatIf(".") && this.spaceOrEnd() && read.length <= 19 && fitsU64(read)) return "EnumMarker";
    return this.text();
  }

  private refMarker(): Kind {
    const s = this.s;
    s.eatWhile(isValidInLabelLiteral);
    for (let c = s.scout(-1); c === "." || c === ":"; c = s.scout(-1)) s.uneat();
    return "RefMarker";
  }

  private label(): Kind {
    const label = this.s.eatWhile(isValidInLabelLiteral);
    if (label === "") return this.err("label cannot be empty");
    if (!this.s.eatIf(">")) return this.err("unclosed label");
    return "Label";
  }

  private text(): Kind {
    const s = this.s;
    for (;;) {
      s.eatUntil((c) => (c < "\x80" ? TEXT_STOP.has(c) : isWhitespace(c)));
      const save = s.cursor;
      const c = s.eat();
      let cont = false;
      if (c === " ") cont = s.at(isAlphanumeric);
      else if (c === "/") cont = !s.at("/") && !s.at("*");
      else if (c === "-") cont = !s.at("-") && !s.at("?");
      else if (c === ".") cont = !s.at("..");
      else if (c === "h") cont = !s.at("ttp://") && !s.at("ttps://");
      else if (c === "@") cont = !s.at(isValidInLabelLiteral);
      if (!cont) {
        s.cursor = save;
        break;
      }
    }
    return "Text";
  }

  private inWord(): boolean {
    const wordy = (c: string | undefined): boolean => c !== undefined && isAlphanumeric(c) && !isCjk(c);
    return wordy(this.s.scout(-2)) && wordy(this.s.peek());
  }

  spaceOrEnd(): boolean {
    const s = this.s;
    return s.done() || s.at(isWhitespace) || s.at("//") || s.at("/*");
  }

  // --- math -----------------------------------------------------------------

  private math(start: number, c: string): Kind {
    const s = this.s;
    switch (c) {
      case "\\":
        return this.backslash();
      case '"':
        return this.string();
      case "-":
        if (s.eatIf(">>") || s.eatIf(">") || s.eatIf("->")) return "MathShorthand";
        return "MathShorthand";
      case ":":
        if (s.eatIf("=") || s.eatIf(":=")) return "MathShorthand";
        break;
      case "!":
        if (s.eatIf("=")) return "MathShorthand";
        return "Bang";
      case ".":
        if (s.eatIf("..")) return "MathShorthand";
        return "Dot";
      case "<":
        for (const t of ["==>", "-->", "--", "-<", "->", "<-", "<<", "=>", "==", "~~", "=", "<", "-", "~"]) {
          if (s.eatIf(t)) return "MathShorthand";
        }
        break;
      case ">":
        if (s.eatIf("->") || s.eatIf(">>") || s.eatIf("=") || s.eatIf(">")) return "MathShorthand";
        break;
      case "=":
        if (s.eatIf("=>") || s.eatIf(">") || s.eatIf(":")) return "MathShorthand";
        break;
      case "|":
        if (s.eatIf("->") || s.eatIf("=>") || s.eatIf("|")) return "MathShorthand";
        if (s.eatIf("]")) return "RightBrace";
        break;
      case "~":
        if (s.eatIf("~>") || s.eatIf(">")) return "MathShorthand";
        return "MathShorthand";
      case "*":
        return "MathShorthand";
      case ",":
        return "Comma";
      case ";":
        return "Semicolon";
      case "#":
        return "Hash";
      case "_":
        return "Underscore";
      case "$":
        return "Dollar";
      case "/":
        return "Slash";
      case "^":
        return "Hat";
      case "&":
        return "MathAlignPoint";
      case "√":
      case "∛":
      case "∜":
        return "Root";
      case "'":
        s.eatWhile((x) => x === "'");
        return "MathPrimes";
      case "(":
        return "LeftParen";
      case ")":
        return "RightParen";
      case "[":
        if (s.eatIf("|")) return "LeftBrace";
        return "LeftBrace";
    }
    if (isMathOpening(c)) return "LeftBrace";
    if (isMathClosing(c)) return "RightBrace";
    if (isMathIdStart(c) && s.at(isMathIdContinue)) {
      s.eatWhile(isMathIdContinue);
      // A single grapheme (letter + combining marks) is plain math text.
      let multi = false;
      for (let i = start + c.length; i < s.cursor; ) {
        const ch = s.s.slice(i, i + cpLen(s.s.charCodeAt(i)));
        if (!isGraphemeExtend(ch)) {
          multi = true;
          break;
        }
        i += ch.length;
      }
      if (!multi) return "MathText";
      let kind: Kind = "MathIdent";
      while (isMathIdStart(s.scout(1)) && s.eatIf(".")) {
        s.eat();
        s.eatWhile(isMathIdContinue);
        kind = "MathFieldAccess";
      }
      return kind;
    }
    return this.mathText(c);
  }

  private mathText(c: string): Kind {
    const s = this.s;
    if (isNumeric(c)) {
      s.eatWhile(isNumeric);
      const save = s.cursor;
      if (s.eatIf(".") && s.eatWhile(isNumeric) !== "") return "MathText";
      s.cursor = save;
    } else {
      s.eatWhile(isGraphemeExtend);
    }
    return "MathText";
  }

  /** `maybe_math_named_arg`: an identifier directly followed by `:` (not `:=`/`::=`). */
  maybeMathNamedArg(start: number): { end: number; underscore: boolean } | null {
    const s = this.s;
    const cursor = s.cursor;
    s.cursor = start;
    if (s.eatIf(isIdStart)) {
      s.eatWhile(isIdContinue);
      if (s.at(":") && !s.at(":=") && !s.at("::=")) {
        const end = s.cursor;
        const underscore = s.s.slice(start, end) === "_";
        return { end, underscore };
      }
    }
    s.cursor = cursor;
    return null;
  }

  /** `maybe_math_spread_arg`: `..` followed by something spreadable. */
  maybeMathSpreadArg(start: number): number | null {
    const s = this.s;
    const cursor = s.cursor;
    s.cursor = start;
    if (s.eatIf("..")) {
      if (!this.spaceOrEnd() && !s.at(".") && !s.at(",") && !s.at(";") && !s.at(")") && !s.at("$")) {
        return s.cursor;
      }
    }
    s.cursor = cursor;
    return null;
  }

  // --- code -----------------------------------------------------------------

  private code(start: number, c: string): Kind {
    const s = this.s;
    switch (c) {
      case "<":
        if (s.at(isIdContinue)) return this.label();
        if (s.eatIf("=")) return "LtEq";
        return "Lt";
      case '"':
        return this.string();
      case "=":
        if (s.eatIf("=")) return "EqEq";
        if (s.eatIf(">")) return "Arrow";
        return "Eq";
      case "!":
        if (s.eatIf("=")) return "ExclEq";
        break;
      case ">":
        if (s.eatIf("=")) return "GtEq";
        return "Gt";
      case "+":
        if (s.eatIf("=")) return "PlusEq";
        return "Plus";
      case "-":
      case "−":
        if (s.eatIf("=")) return "HyphEq";
        return "Minus";
      case "*":
        if (s.eatIf("=")) return "StarEq";
        return "Star";
      case "/":
        if (s.eatIf("=")) return "SlashEq";
        return "Slash";
      case ".":
        if (s.at(isAsciiDigit)) return this.number(start, c);
        if (s.eatIf(".")) return "Dots";
        return "Dot";
      case "{":
        return "LeftBrace";
      case "}":
        return "RightBrace";
      case "[":
        return "LeftBracket";
      case "]":
        return "RightBracket";
      case "(":
        return "LeftParen";
      case ")":
        return "RightParen";
      case "$":
        return "Dollar";
      case ",":
        return "Comma";
      case ";":
        return "Semicolon";
      case ":":
        return "Colon";
    }
    if (isAsciiDigit(c)) return this.number(start, c);
    if (isIdStart(c)) return this.ident(start);
    if (c === "&" && s.eatIf("&")) return this.err("`&&` is not valid in code");
    if (c === "|" && s.eatIf("|")) return this.err("`||` is not valid in code");
    if (c === "~" && s.eatIf("=")) return this.err("`~=` is not valid in code");
    return this.err(`the character \`${c}\` is not valid in code`);
  }

  private ident(start: number): Kind {
    const s = this.s;
    s.eatWhile(isIdContinue);
    const ident = s.s.slice(start, s.cursor);
    const prev = s.s.slice(Math.max(0, start - 2), start);
    if ((!prev.endsWith(".") && !prev.endsWith("@")) || prev.endsWith("..")) {
      const kw = KEYWORDS[ident];
      if (kw !== undefined) return kw;
    }
    return ident === "_" ? "Underscore" : "Ident";
  }

  private number(start: number, first: string): Kind {
    const s = this.s;
    let base = 10;
    if (first === "0" && s.eatIf("b")) base = 2;
    else if (first === "0" && s.eatIf("o")) base = 8;
    else if (first === "0" && s.eatIf("x")) base = 16;
    if (base === 16) s.eatWhile(isAsciiAlphanumeric);
    else s.eatWhile(isAsciiDigit);
    let isFloat = false;
    if (base === 10) {
      if (first === ".") {
        isFloat = true;
      } else if (!s.at("..") && !isIdStart(s.scout(1)) && s.eatIf(".")) {
        isFloat = true;
        s.eatWhile(isAsciiDigit);
      }
      if (!s.at("em") && (s.eatIf("e") || s.eatIf("E"))) {
        isFloat = true;
        if (!s.eatIf("+")) s.eatIf("-");
        s.eatWhile(isAsciiDigit);
      }
    }
    const number = s.s.slice(start, s.cursor);
    const suffix = s.eatWhile((c) => isAsciiAlphanumeric(c) || c === "%");
    const suffixOk = suffix === "" || ["pt", "mm", "cm", "in", "deg", "rad", "em", "fr", "%"].includes(suffix);
    let numberOk: boolean;
    if (base === 10) {
      numberOk = !isFloat || /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(number);
    } else {
      const digits = number.slice(2);
      const re = base === 2 ? /^[01]+$/ : base === 8 ? /^[0-7]+$/ : /^[0-9a-fA-F]+$/;
      numberOk = re.test(digits) && suffix === "";
    }
    if (!numberOk) return this.err(`invalid number: \`${number}${suffix}\``);
    if (!suffixOk) return this.err(`invalid number suffix: \`${suffix}\``);
    if (suffix !== "") return "Numeric";
    return isFloat ? "Float" : "Int";
  }

  private string(): Kind {
    const s = this.s;
    let escaped = false;
    s.eatUntil((c) => {
      const stop = c === '"' && !escaped;
      escaped = c === "\\" && !escaped;
      return stop;
    });
    if (!s.eatIf('"')) {
      this.lastStringEscaped = escaped;
      return this.err("unclosed string");
    }
    return "Str";
  }

  /** Set by an unclosed string: whether it ended in a pending `\`. */
  lastStringEscaped = false;
}

const fitsU64 = (digits: string): boolean =>
  digits.length < 20 || (digits.length === 20 && digits <= "18446744073709551615");

/** `link_prefix` from lexer.rs: the URL part of an automatic link and whether its brackets balance. */
export const linkPrefix = (text: string, from: number): { length: number; balanced: boolean } => {
  const brackets: string[] = [];
  let i = from;
  for (; i < text.length; i++) {
    const c = text[i] as string;
    if (isAsciiAlphanumeric(c) || "!#$%&*+,-./:;=?@_~'".includes(c)) continue;
    if (c === "[" || c === "(") {
      brackets.push(c);
      continue;
    }
    if (c === "]") {
      if (brackets.pop() === "[") continue;
      break;
    }
    if (c === ")") {
      if (brackets.pop() === "(") continue;
      break;
    }
    break;
  }
  while (i > from && "!,.:;?'".includes(text[i - 1] as string)) i--;
  return { length: i - from, balanced: brackets.length === 0 };
};
