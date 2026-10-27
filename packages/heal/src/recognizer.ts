// Port of typst-syntax 0.15.1's parser (parser.rs) as a *recognizer*: it walks
// the same grammar with the same lookahead, newline modes and mode switches,
// but instead of building a tree it records
//
// - requirements: what the text needs at its very end to parse without errors
//   (`close` a delimiter, or `cut` an incomplete construct),
// - settled errors: syntax errors that appending text cannot fix,
// - root checkpoints: positions where parsing can resume after an edit,
// - lint events and mode spans for the lint rules.
//
// Function names mirror parser.rs so the two can be compared side by side.

import { isAlphabetic, isWhitespace } from "./chars";
import { isKeyword, isTrivia, type Kind, Lexer, type Mode, type Token } from "./lexer";

/**
 * The kind of construct a delimiter opened, e.g. `content` for a `[…]` block, `args` for a call's arguments,
 * `text-bracket` for a `[` in markup that opens no block. Close requirements and `HealResult.openFrames` carry it.
 */
export type FrameKind =
  | "content"
  | "code-block"
  | "args"
  | "params"
  | "parens"
  | "math"
  | "math-args"
  | "math-delimited"
  | "strong"
  | "emph"
  | "string"
  | "raw"
  | "term"
  | "text-bracket";

/**
 * What the end of a recognized text needs to parse without errors: `close` appends `text` to close the
 * construct opened at `open`; `cut` drops the text from `at`, a construct that can't be completed yet
 * (`reason` says why). Offsets are into the recognized text.
 */
export type Requirement =
  | {
      type: "close";
      text: string;
      open: number;
      frame: FrameKind;
      /**
       * A display equation (whitespace after its `$`): its closer needs whitespace before it too, or
       * Typst makes it inline (`Equation::block` in typst-syntax's ast.rs wants a Space at both ends).
       */
      display?: boolean;
    }
  | {
      type: "cut";
      at: number;
      reason: string;
      /** A streaming heuristic (a word that may still grow), not a syntax error. */
      soft?: boolean;
    };

/** A syntax error appending text can't fix: recognized text's offsets, or the input's in `HealResult.errors`. */
export interface SyntaxIssue {
  /** Start of the erroneous text (UTF-16 offset). */
  start: number;
  /** End of the erroneous text, exclusive. */
  end: number;
  /** What is wrong, e.g. `unclosed delimiter`. */
  message: string;
}

/** A root-level position where the parser can resume. */
export interface Checkpoint {
  /** Start of the first token on a root-level line (or of the text), in the recognized text. */
  offset: number;
  /** Text brackets (`[` in markup that opens no block) still open here: resuming needs them to match a `]`. */
  nesting: number;
}

/** @internal What the recognizer saw that a lint rule needs (lint.ts). */
export type LintEvent =
  | { type: "ref"; start: number; end: number }
  | { type: "bare-hash"; at: number }
  | { type: "stray-closer"; at: number }
  | { type: "unclosed-delim"; at: number; delim: "*" | "_" }
  | { type: "equation"; start: number; end: number }
  | { type: "unclosed-comment"; at: number };

/**
 * Requirements that actually apply. An open text bracket (`[` in markup) is
 * harmless on its own; it only needs a `]` when an enclosing content block
 * will append its own `]`, which the open bracket would otherwise swallow.
 */
export const effectiveRequirements = (reqs: readonly Requirement[]): Requirement[] => {
  const out: Requirement[] = [];
  let bracketFollows = false;
  for (let i = reqs.length - 1; i >= 0; i--) {
    const r = reqs[i] as Requirement;
    if (r.type === "close" && r.frame === "text-bracket") {
      if (!bracketFollows) continue;
    } else if (r.type === "close") {
      bracketFollows = r.text === "]";
    }
    out.push(r);
  }
  return out.reverse();
};

/** Lexical context starting at `at`, until the next span. */
export interface ModeSpan {
  /** Offset in the recognized text where this span starts. */
  at: number;
  /** Mode of the tokens from `at` on; lint rules leave `raw` and `comment` text alone. */
  mode: Mode | "raw" | "comment";
}

/** What {@link recognize} records about a text: what its end needs, settled errors, and where to resume. */
export interface Recognition {
  /** Root checkpoints, ascending. */
  checkpoints: Checkpoint[];
  /** What the end of the text needs, innermost construct first. */
  requirements: Requirement[];
  /** Syntax errors not at the end of the text. */
  errors: SyntaxIssue[];
  /** @internal */
  events: LintEvent[];
  /** @internal Mode changes, ascending; resolved with `modeAt`. */
  modes: ModeSpan[];
  /** @internal Start of the last non-trivia token. */
  lastTokenStart: number;
  /**
   * @internal Root checkpoint where `stopAt` ended recognition, if it did. Checkpoints,
   * errors, events and modes then cover only text before it, and
   * `requirements` and `lastTokenStart` don't describe the end of the text.
   */
  stoppedAt?: number;
}

/** Options for {@link recognize}. */
export interface RecognizeOptions {
  /** Turn any requirement inside a set/show/import/include statement into a cut of the whole statement. */
  dropIncompleteRules?: boolean;
  /** @internal Asked at each root checkpoint before it's recorded; `true` stops recognition there (resync after an edit). */
  stopAt?: (cp: Checkpoint) => boolean;
}

// --- newline modes (AtNewline) ------------------------------------------------

const CONTINUE = -1;
const STOP = -2;
const CONTEXTUAL = -3;
const PARBREAK = -4;
// >= 0: RequireColumn(n)

interface Newline {
  column: number | null;
  parbreak: boolean;
}

const stopAt = (mode: number, nl: Newline, kind: Kind): boolean => {
  if (mode === CONTINUE) return false;
  if (mode === STOP) return true;
  if (mode === CONTEXTUAL) return !(kind === "Else" || kind === "Dot");
  if (mode === PARBREAK) return nl.parbreak;
  return nl.column !== null && nl.column <= mode;
};

interface PTok {
  /** Kind as seen by the parser (`End` at a newline the newline mode stops at). */
  kind: Kind;
  /** Kind the lexer produced. */
  actual: Kind;
  start: number;
  end: number;
  prevEnd: number;
  nTrivia: number;
  newline: Newline | null;
  mode: Mode;
  lex: Token;
}

// --- syntax sets ----------------------------------------------------------------

const set = (...kinds: Kind[]): ReadonlySet<Kind> => new Set(kinds);
const ATOMIC_CODE_EXPR = set(
  "Ident",
  "LeftBrace",
  "LeftBracket",
  "LeftParen",
  "Dollar",
  "Let",
  "Set",
  "Show",
  "Context",
  "If",
  "While",
  "For",
  "Import",
  "Include",
  "Break",
  "Continue",
  "Return",
  "None",
  "Auto",
  "Int",
  "Float",
  "Bool",
  "Numeric",
  "Str",
  "Label",
  "Raw",
);
const UNARY_OP = set("Plus", "Minus", "Not");
const CODE_EXPR = new Set<Kind>([...ATOMIC_CODE_EXPR, ...UNARY_OP, "Underscore"]);
const STMT = set("Let", "Set", "Show", "Import", "Include", "Return");
const MATH_EXPR = set(
  "Hash",
  "MathIdent",
  "MathFieldAccess",
  "Dot",
  "Comma",
  "Semicolon",
  "LeftBrace",
  "RightBrace",
  "LeftParen",
  "RightParen",
  "MathText",
  "MathShorthand",
  "Linebreak",
  "MathAlignPoint",
  "MathPrimes",
  "Escape",
  "Str",
  "Root",
  "Bang",
);
const BINARY_OP: ReadonlyMap<Kind, [prec: number, right: boolean]> = new Map([
  ["Star", [6, false]],
  ["Slash", [6, false]],
  ["Plus", [5, false]],
  ["Minus", [5, false]],
  ["EqEq", [4, false]],
  ["ExclEq", [4, false]],
  ["Lt", [4, false]],
  ["LtEq", [4, false]],
  ["Gt", [4, false]],
  ["GtEq", [4, false]],
  ["In", [4, false]],
  ["And", [3, false]],
  ["Or", [2, false]],
  ["Eq", [1, true]],
  ["PlusEq", [1, true]],
  ["HyphEq", [1, true]],
  ["StarEq", [1, true]],
  ["SlashEq", [1, true]],
]);
const NOT_IN_PREC = 4;
const ARG = new Set<Kind>([...CODE_EXPR, "Dots"]);
const PATTERN_LEAF = ATOMIC_CODE_EXPR;
const PATTERN = new Set<Kind>([...ATOMIC_CODE_EXPR, "LeftParen", "Underscore"]);
const PARAM = new Set<Kind>([...PATTERN, "Dots"]);
const OPENERS = set("LeftBracket", "LeftBrace", "LeftParen");
const CLOSERS = set("RightBracket", "RightBrace", "RightParen");

const ROOT_STOP = set("End");
const STRONG_STOP = set("Star", "RightBracket", "End");
const EMPH_STOP = set("Underscore", "RightBracket", "End");
const HEADING_STOP = set("Label", "RightBracket", "End");
const ITEM_STOP = set("RightBracket", "End");
const TERM_STOP = set("Colon", "RightBracket", "End");
const EQUATION_STOP = set("Dollar", "End");
const DELIMITED_STOP = set("Dollar", "End", "RightBrace", "RightParen");
const MATH_ARGS_STOP = set("End", "Dollar", "RightParen");
const MATH_ARG_STOP = set("End", "Dollar", "Comma", "Semicolon", "RightParen");
const CODE_BLOCK_STOP = set("RightBrace", "RightBracket", "RightParen", "End");
const EMPTY = set();

const isTerminator = (k: Kind): boolean =>
  k === "End" || k === "Semicolon" || k === "RightBrace" || k === "RightParen" || k === "RightBracket";

const MAX_DEPTH = 256;
const MATH_FUNC_PREC = 2;
const MATH_ROOT_PREC = 2;

const CLOSER: Partial<Record<Kind, string>> = {
  RightBracket: "]",
  RightBrace: "}",
  RightParen: ")",
  Star: "*",
  Underscore: "_",
  Dollar: "$",
};

/** Identifier-like tokens that may still grow when more text arrives. */
const isWordToken = (k: Kind): boolean => k === "Ident" || k === "Underscore" || isKeyword(k);

const isMathAlphabetic = (text: string): boolean => {
  const chars = [...text];
  return chars.length === 1 ? isAlphabetic(chars[0]) : chars.every((c) => isAlphabetic(c));
};

interface Snapshot {
  cursor: number;
  mode: Mode;
  token: PTok;
  reqs: number;
  errors: number;
  events: number;
  modes: number;
  lastTokenStart: number;
}

class Parser {
  readonly text: string;
  readonly len: number;
  readonly lexer: Lexer;
  readonly opts: RecognizeOptions;
  nlMode = CONTINUE;
  token: PTok;
  depth = 0;
  /** Math argument lists open in the innermost equation. */
  mathArgsOpen = 0;

  readonly reqs: Requirement[] = [];
  readonly errors: SyntaxIssue[] = [];
  readonly events: LintEvent[] = [];
  readonly modes: ModeSpan[] = [];
  readonly checkpoints: Checkpoint[] = [];
  stoppedAt: number | undefined;
  lastTokenStart = 0;
  /** Start offsets of constructs a dangling end can be cut back to, innermost last. */
  readonly scopes: number[] = [];
  /** Start offsets of set/show/import/include statements being parsed. */
  readonly rules: number[] = [];

  constructor(text: string, offset: number, mode: Mode, opts: RecognizeOptions) {
    this.text = text;
    this.len = text.length;
    this.opts = opts;
    this.lexer = new Lexer(text, mode);
    this.lexer.jump(offset);
    this.lastTokenStart = offset;
    this.token = this.lex();
  }

  // --- token machinery ----------------------------------------------------------

  private noteMode(at: number, mode: ModeSpan["mode"]): void {
    const modes = this.modes;
    while (modes.length > 0 && (modes[modes.length - 1] as ModeSpan).at >= at) modes.pop();
    const last = modes[modes.length - 1];
    if (!last || last.mode !== mode) modes.push({ at, mode });
  }

  lex(): PTok {
    const lexer = this.lexer;
    const prevEnd = lexer.cursor;
    let start = prevEnd;
    let tok = lexer.next();
    let nTrivia = 0;
    let hadNewline = false;
    let parbreak = false;
    while (isTrivia(tok.kind)) {
      hadNewline ||= lexer.newline;
      parbreak ||= tok.kind === "Parbreak";
      nTrivia++;
      if (tok.kind === "BlockComment" || tok.kind === "LineComment") {
        this.noteMode(tok.start, "comment");
        if (tok.kind === "BlockComment" && lexer.blockCommentUnclosed) {
          this.events.push({ type: "unclosed-comment", at: tok.start });
        }
      }
      start = lexer.cursor;
      tok = lexer.next();
    }
    this.noteMode(start, tok.kind === "Raw" || tok.rawTicks ? "raw" : lexer.mode);
    let newline: Newline | null = null;
    let kind = tok.kind;
    if (hadNewline) {
      newline = { column: lexer.mode === "markup" ? lexer.column(start) : null, parbreak };
      if (stopAt(this.nlMode, newline, kind)) kind = "End";
    }
    return { kind, actual: tok.kind, start, end: tok.end, prevEnd, nTrivia, newline, mode: lexer.mode, lex: tok };
  }

  current(): Kind {
    return this.token.kind;
  }
  at(k: Kind): boolean {
    return this.token.kind === k;
  }
  atSet(s: ReadonlySet<Kind>): boolean {
    return s.has(this.token.kind);
  }
  end(): boolean {
    return this.token.kind === "End";
  }
  /** At the real end of the text (not a newline the current mode stops at). */
  atRealEnd(): boolean {
    return this.token.kind === "End" && this.token.actual === "End";
  }
  hadTrivia(): boolean {
    return this.token.nTrivia > 0;
  }
  hadNewline(): boolean {
    return this.token.newline !== null;
  }
  directlyAt(k: Kind): boolean {
    return this.token.kind === k && !this.hadTrivia();
  }
  currentColumn(): number {
    return this.token.newline?.column ?? this.lexer.column(this.token.start);
  }
  currentText(): string {
    return this.text.slice(this.token.start, this.token.end);
  }

  eat(): void {
    this.consume(this.token);
    this.token = this.lex();
  }

  eatIf(k: Kind): boolean {
    if (this.token.kind !== k) return false;
    this.eat();
    return true;
  }

  flushTrivia(): void {
    this.token.nTrivia = 0;
    this.token.prevEnd = this.token.start;
  }

  enterModes(mode: Mode, nl: number, f: () => void): void {
    const previous = this.lexer.mode;
    this.lexer.mode = mode;
    this.withNlMode(nl, f);
    if (mode !== previous) {
      this.lexer.mode = previous;
      this.lexer.jump(this.token.prevEnd);
      this.token = this.lex();
    }
  }

  withNlMode(mode: number, f: () => void): void {
    const previous = this.nlMode;
    this.nlMode = mode;
    f();
    this.nlMode = previous;
    if (this.token.newline && mode !== previous) {
      this.token.kind = stopAt(this.nlMode, this.token.newline, this.token.actual) ? "End" : this.token.actual;
    }
  }

  checkpoint(): Snapshot {
    return {
      cursor: this.lexer.cursor,
      mode: this.lexer.mode,
      token: { ...this.token },
      reqs: this.reqs.length,
      errors: this.errors.length,
      events: this.events.length,
      modes: this.modes.length,
      lastTokenStart: this.lastTokenStart,
    };
  }

  restore(s: Snapshot): void {
    this.lexer.jump(s.cursor);
    this.lexer.mode = s.mode;
    this.token = s.token;
    this.reqs.length = s.reqs;
    this.errors.length = s.errors;
    this.events.length = s.events;
    this.modes.length = s.modes;
    this.lastTokenStart = s.lastTokenStart;
  }

  // --- recording ------------------------------------------------------------------

  /** Processes a token as it is eaten: lexer errors and possibly incomplete words at the end. */
  private consume(t: PTok): void {
    this.lastTokenStart = t.start;
    const lex = t.lex;
    const atEnd = t.end >= this.len;
    if (lex.kind === "Error") {
      if (!atEnd) {
        this.errors.push({ start: t.start, end: t.end, message: lex.error ?? "error" });
      } else if (lex.error === "unclosed string") {
        if (lex.strEscaped) this.require({ type: "cut", at: t.end - 1, reason: "string-escape" });
        else this.require({ type: "close", text: '"', open: t.start, frame: "string" });
      } else if (lex.rawTicks !== undefined) {
        const ticks = lex.rawTicks;
        if (t.end - t.start <= ticks) {
          this.require({ type: "cut", at: t.start, reason: "empty-raw" });
        } else {
          let trailing = 0;
          while (trailing < ticks && this.text[t.end - 1 - trailing] === "`") trailing++;
          this.require({ type: "close", text: "`".repeat(ticks - trailing), open: t.start, frame: "raw" });
        }
      } else {
        this.require({ type: "cut", at: t.start, reason: "partial-token" });
      }
      return;
    }
    if (atEnd) {
      if (t.mode === "code" && isWordToken(lex.kind)) {
        this.require({ type: "cut", at: t.start, reason: "partial-word", soft: true });
      } else if (t.mode === "math" && (lex.kind === "MathIdent" || lex.kind === "MathFieldAccess")) {
        this.require({ type: "cut", at: t.start, reason: "partial-word", soft: true });
      }
    }
  }

  private require(r: Requirement): void {
    const rule = this.rules[0];
    if (this.opts.dropIncompleteRules && rule !== undefined) {
      const soft = r.type === "cut" && r.soft === true;
      this.reqs.push({ type: "cut", at: rule, reason: "incomplete-rule", soft });
    } else {
      this.reqs.push(r);
    }
  }

  private scope(): number {
    return this.scopes[this.scopes.length - 1] ?? this.lastTokenStart;
  }

  private withScope(at: number, f: () => void): void {
    this.scopes.push(at);
    try {
      f();
    } finally {
      this.scopes.pop();
    }
  }

  private error(start: number, end: number, message: string): void {
    this.errors.push({ start, end, message });
  }

  /**
   * An error on a token that may still grow (a keyword or `_` at the very end):
   * cut it while streaming, but it is a real error as written.
   */
  private invalidAsIs(start: number, end: number, message: string): void {
    if (end >= this.len) this.require({ type: "cut", at: start, reason: message });
    else this.error(start, end, message);
  }

  /** `expected`: an error at the end of the text means the enclosing construct is incomplete. */
  expected(thing: string): void {
    if (this.token.lex.kind === "Error") {
      this.eat();
    } else if (this.atRealEnd()) {
      this.require({ type: "cut", at: this.scope(), reason: `expected ${thing}` });
    } else {
      const at = this.token.prevEnd;
      this.error(at, at, `expected ${thing}`);
    }
  }

  expect(k: Kind): boolean {
    if (this.at(k)) {
      this.eat();
      return true;
    }
    if (k === "Ident" && isKeyword(this.token.kind)) {
      this.invalidAsIs(this.token.start, this.token.end, "expected identifier");
      this.eat();
    } else {
      this.expected(k);
    }
    return false;
  }

  expectClosingDelimiter(open: number, k: Kind, frame: FrameKind, display = false): boolean {
    if (this.eatIf(k)) return true;
    if (this.atRealEnd()) {
      this.require({ type: "close", text: CLOSER[k] as string, open, frame, ...(display ? { display } : {}) });
    } else {
      this.error(open, open + 1, "unclosed delimiter");
      if (k === "Star" || k === "Underscore") {
        this.events.push({ type: "unclosed-delim", at: open, delim: k === "Star" ? "*" : "_" });
      }
    }
    return false;
  }

  unexpected(): void {
    const t = this.token;
    if (this.atRealEnd()) {
      this.require({ type: "cut", at: this.scope(), reason: "unexpected end" });
    } else if (t.lex.kind !== "Error") {
      if (t.end >= this.len) this.require({ type: "cut", at: t.start, reason: `unexpected ${t.kind}` });
      else this.error(t.start, t.end, `unexpected ${t.kind}`);
    }
    this.eat();
  }

  private enter(): boolean {
    if (this.depth < MAX_DEPTH) {
      this.depth++;
      return true;
    }
    this.depthCheckError(null);
    return false;
  }

  private checkDepthUntil(stop: ReadonlySet<Kind>): boolean {
    if (this.depth < MAX_DEPTH) return true;
    this.depthCheckError(stop);
    return false;
  }

  private depthCheckError(stop: ReadonlySet<Kind> | null): void {
    const start = this.token.start;
    let balance = 0;
    this.withNlMode(CONTINUE, () => {
      for (;;) {
        if (this.atSet(OPENERS)) balance++;
        else if (this.atSet(CLOSERS)) balance = Math.max(0, balance - 1);
        this.eat();
        const atStop = stop === null || this.atSet(stop);
        if ((balance === 0 && atStop) || this.end()) break;
      }
    });
    this.error(start, this.token.prevEnd, "maximum parsing depth exceeded");
  }

  // --- markup -----------------------------------------------------------------------

  markup(atStart: boolean, wrapTrivia: boolean, stop: ReadonlySet<Kind>): void {
    this.markupExprs(atStart, stop, false, 0);
    if (wrapTrivia) this.flushTrivia();
  }

  markupExprs(atStart: boolean, stop: ReadonlySet<Kind>, root: boolean, initialNesting: number): void {
    if (!this.checkDepthUntil(stop)) return;
    let start = atStart || this.hadNewline();
    // Offsets of open text brackets (`[` in markup that isn't a content block).
    const nesting: number[] = new Array(initialNesting).fill(0);
    while (!this.atSet(stop) || (nesting.length > 0 && this.at("RightBracket"))) {
      if (root && start) {
        const cp = { offset: this.token.start, nesting: nesting.length };
        if (this.opts.stopAt?.(cp)) {
          this.stoppedAt = cp.offset;
          return;
        }
        this.checkpoints.push(cp);
      }
      this.markupExpr(start, nesting);
      start = this.hadNewline();
    }
    // Text brackets inside a nested markup must balance before its closer counts.
    if (!root && this.atRealEnd()) {
      for (let i = nesting.length - 1; i >= 0; i--) {
        this.require({ type: "close", text: "]", open: nesting[i] as number, frame: "text-bracket" });
      }
    }
  }

  markupExpr(atStart: boolean, nesting: number[]): void {
    if (!this.enter()) return;
    try {
      switch (this.current()) {
        case "LeftBracket":
          nesting.push(this.token.start);
          this.eat();
          return;
        case "RightBracket":
          if (nesting.length > 0) {
            nesting.pop();
            this.eat();
          } else {
            this.events.push({ type: "stray-closer", at: this.token.start });
            this.unexpected();
          }
          return;
        case "Shebang":
        case "Text":
        case "Linebreak":
        case "Escape":
        case "Shorthand":
        case "SmartQuote":
        case "Link":
        case "Label":
        case "Raw":
          this.eat();
          return;
        case "Hash":
          this.embeddedCodeExpr();
          return;
        case "Star":
          this.strong();
          return;
        case "Underscore":
          this.emph();
          return;
        case "HeadingMarker":
          if (atStart) this.heading();
          else this.eat();
          return;
        case "ListMarker":
          if (atStart) this.listItem("ListMarker");
          else this.eat();
          return;
        case "EnumMarker":
          if (atStart) this.listItem("EnumMarker");
          else this.eat();
          return;
        case "TermMarker":
          if (atStart) this.termItem();
          else this.eat();
          return;
        case "RefMarker":
          this.reference();
          return;
        case "Dollar":
          this.equation();
          return;
        case "Colon":
          this.eat();
          return;
        default:
          this.unexpected();
      }
    } finally {
      this.depth--;
    }
  }

  strong(): void {
    this.delimited("Star", STRONG_STOP, "strong");
  }

  emph(): void {
    this.delimited("Underscore", EMPH_STOP, "emph");
  }

  private delimited(delim: Kind, stop: ReadonlySet<Kind>, frame: FrameKind): void {
    this.withNlMode(PARBREAK, () => {
      const m = this.token.start;
      this.eat();
      this.markup(false, true, stop);
      this.expectClosingDelimiter(m, delim, frame);
    });
  }

  heading(): void {
    this.withNlMode(STOP, () => {
      this.eat();
      this.markup(false, false, HEADING_STOP);
    });
  }

  listItem(_marker: Kind): void {
    this.withNlMode(this.currentColumn(), () => {
      this.eat();
      this.markup(true, false, ITEM_STOP);
    });
  }

  termItem(): void {
    this.withNlMode(this.currentColumn(), () => {
      this.withNlMode(STOP, () => {
        this.eat();
        this.markup(false, false, TERM_STOP);
      });
      if (!this.eatIf("Colon")) {
        if (this.atRealEnd()) {
          this.require({ type: "close", text: ":", open: this.lastTokenStart, frame: "term" });
        } else {
          this.error(this.token.prevEnd, this.token.prevEnd, "expected colon");
        }
      }
      this.markup(true, false, ITEM_STOP);
    });
  }

  reference(): void {
    this.events.push({ type: "ref", start: this.token.start, end: this.token.end });
    this.eat();
    if (this.directlyAt("LeftBracket")) this.contentBlock();
  }

  equation(): void {
    const m = this.token.start;
    const display = isWhitespace(this.text[m + 1]);
    // An equation in an argument (`$sqrt(#box[$(x$`) closes its own groups.
    const outerArgs = this.mathArgsOpen;
    this.mathArgsOpen = 0;
    this.enterModes("math", CONTINUE, () => {
      this.eat();
      this.math(EQUATION_STOP);
      this.expectClosingDelimiter(m, "Dollar", "math", display);
    });
    this.mathArgsOpen = outerArgs;
    this.events.push({ type: "equation", start: m, end: this.token.prevEnd });
  }

  // --- math ---------------------------------------------------------------------------

  math(stop: ReadonlySet<Kind>): void {
    this.mathExprs(stop);
  }

  mathExprs(stop: ReadonlySet<Kind>): number {
    if (!this.checkDepthUntil(stop)) return 1;
    let count = 0;
    while (!this.atSet(stop)) {
      if (this.atSet(MATH_EXPR)) this.mathExprPrec(0, EMPTY);
      else this.unexpected();
      count++;
    }
    return count;
  }

  mathExprPrec(minPrec: number, stop: ReadonlySet<Kind>): void {
    if (!this.enter()) return;
    try {
      const m = this.token.start;
      let continuable = false;
      switch (this.current()) {
        case "Hash":
          this.embeddedCodeExpr();
          break;
        case "MathIdent":
        case "MathFieldAccess":
          continuable = true;
          this.eat();
          if (MATH_FUNC_PREC >= minPrec && this.directlyAt("LeftParen")) {
            this.mathArgs();
            continuable = false;
          }
          break;
        case "LeftBrace":
        case "LeftParen":
          this.mathDelimited();
          break;
        case "Dot":
        case "Bang":
        case "Comma":
        case "Semicolon":
        case "RightBrace":
        case "RightParen":
          this.eat();
          break;
        case "MathText":
          continuable = isMathAlphabetic(this.currentText());
          this.eat();
          break;
        case "Linebreak":
        case "MathAlignPoint":
        case "MathShorthand":
          this.eat();
          break;
        case "MathPrimes":
        case "Escape":
        case "Str":
          continuable = true;
          this.eat();
          break;
        case "Root":
          this.eat();
          this.withScope(m, () => this.mathExprPrec(MATH_ROOT_PREC, EMPTY));
          break;
        default:
          this.expected("expression");
      }

      if (
        continuable &&
        MATH_FUNC_PREC >= minPrec &&
        !this.hadTrivia() &&
        (this.at("LeftBrace") || this.at("LeftParen"))
      ) {
        this.mathDelimited();
      }

      while (!this.atSet(stop)) {
        const op = this.current();
        const trivia = this.hadTrivia();
        let infix: "left" | "right" | null;
        let prec: number;
        let attach = false;
        if (op === "Slash") [infix, prec] = ["left", 1];
        else if (op === "Underscore" || op === "Hat") [infix, prec, attach] = ["right", 2, true];
        else if (op === "MathPrimes" && !trivia) [infix, prec, attach] = [null, 2, true];
        else if (op === "Bang" && !trivia) [infix, prec] = [null, 3];
        else break;
        if (prec < minPrec) break;

        let chain = new Set<Kind>(attach ? ["Hat", "Underscore"] : []);
        chain.delete(op);
        const opStart = this.token.start;
        this.eat();
        if (infix !== null) {
          const rhsPrec = infix === "left" ? prec + 1 : prec;
          const c = chain;
          this.withScope(opStart, () => this.mathExprPrec(rhsPrec, c));
        }
        if (!(op === "MathPrimes" && this.atSet(stop))) {
          while (this.atSet(chain)) {
            chain = new Set(chain);
            chain.delete(this.current());
            const cs = this.token.start;
            this.eat();
            const c = chain;
            this.withScope(cs, () => this.mathExprPrec(prec, c));
          }
        }
      }
    } finally {
      this.depth--;
    }
  }

  mathDelimited(): void {
    const m = this.token.start;
    this.eat();
    this.mathExprs(DELIMITED_STOP);
    if (this.at("RightBrace") || this.at("RightParen")) this.eat();
    // An unclosed group is fine in math (math_delimited in parser.rs), except in a call's arguments,
    // whose `)` it would take: `$sqrt((x` needs `))`, not `)`.
    else if (this.mathArgsOpen > 0 && this.atRealEnd()) {
      this.require({ type: "close", text: this.text[m] === "{" ? "}" : ")", open: m, frame: "math-delimited" });
    }
  }

  mathArgs(): void {
    const m = this.token.start;
    const seen = new Set<string>();
    this.eat();
    this.mathArgsOpen++;
    try {
      while (!this.atSet(MATH_ARGS_STOP)) {
        this.mathArg(seen);
        const k = this.current();
        if (k === "End" || k === "Dollar" || k === "RightParen") {
          // done
        } else if (k === "Semicolon" || k === "Comma") {
          this.eat();
        } else {
          this.expected("comma or semicolon");
        }
      }
    } finally {
      this.mathArgsOpen--;
    }
    this.expectClosingDelimiter(m, "RightParen", "math-args");
  }

  mathArg(seen: Set<string>): void {
    const start = this.token.start;
    let named = false;
    const spreadEnd = this.lexer.maybeMathSpreadArg(start);
    if (spreadEnd !== null) {
      this.token.end = spreadEnd;
      this.token.lex = { kind: "Dots", start, end: spreadEnd };
      this.eat();
    } else {
      const arg = this.lexer.maybeMathNamedArg(start);
      if (arg !== null) {
        named = true;
        const name = this.text.slice(start, arg.end);
        if (arg.underscore) this.error(start, arg.end, "expected identifier, found underscore");
        else if (!this.see(seen, name)) this.error(start, arg.end, `duplicate argument: ${name}`);
        this.token.end = arg.end;
        this.token.lex = { kind: "Ident", start, end: arg.end };
        this.eat();
        this.eat(); // the colon
      }
    }
    this.withScope(start, () => {
      const count = this.mathExprs(MATH_ARG_STOP);
      if (count === 0 && named) this.expected("expression");
    });
  }

  // --- code ---------------------------------------------------------------------------

  codeExprs(stop: ReadonlySet<Kind>): void {
    if (!this.checkDepthUntil(stop)) return;
    while (!this.atSet(stop)) {
      this.withNlMode(CONTEXTUAL, () => {
        if (!this.atSet(CODE_EXPR)) {
          this.unexpected();
          return;
        }
        this.withScope(this.token.start, () => this.codeExprPrec(false, 0));
        if (!this.atSet(stop) && !this.eatIf("Semicolon")) this.expected("semicolon or line break");
      });
    }
  }

  embeddedCodeExpr(): void {
    const hash = this.token.start;
    this.enterModes("code", STOP, () => {
      this.eat();
      if (this.hadTrivia() || this.end()) {
        if (this.atRealEnd()) {
          this.require({ type: "cut", at: hash, reason: "incomplete-embed" });
        } else {
          this.events.push({ type: "bare-hash", at: hash });
          if (this.token.lex.kind === "Error") this.eat();
          else this.error(hash, hash + 1, "expected expression");
        }
        return;
      }
      const stmt = this.atSet(STMT);
      this.withScope(hash, () => this.codeExprPrec(true, 0));
      const semi = (stmt || this.directlyAt("Semicolon")) && this.eatIf("Semicolon");
      if (stmt && !semi && !this.end() && !this.at("RightBracket")) this.expected("semicolon or line break");
    });
  }

  codeExpr(): void {
    this.codeExprPrec(false, 0);
  }

  codeExprPrec(atomic: boolean, minPrec: number): void {
    if (!this.enter()) return;
    try {
      if (this.atSet(UNARY_OP)) {
        if (!atomic) {
          const op = this.current();
          const opStart = this.token.start;
          this.eat();
          const prec = op === "Not" ? 4 : 7;
          this.withScope(opStart, () => this.codeExprPrec(atomic, prec));
        } else {
          this.unexpected();
        }
      } else {
        this.codePrimary(atomic);
      }

      for (;;) {
        if (this.directlyAt("LeftParen") || this.directlyAt("LeftBracket")) {
          this.args();
          continue;
        }
        const atFieldOrMethod = this.directlyAt("Dot") && this.peekIsIdent();
        if (atomic && !atFieldOrMethod) break;

        if (this.eatIf("Dot")) {
          // A dangling field name cuts the whole chain, not just the name.
          if (this.at("Ident") && this.token.end >= this.len) {
            this.require({ type: "cut", at: this.scope(), reason: "partial-field", soft: true });
          }
          this.expect("Ident");
          continue;
        }

        let binop = BINARY_OP.get(this.current());
        if (binop === undefined && minPrec <= NOT_IN_PREC && this.at("Not")) {
          const notStart = this.token.start;
          this.eat();
          if (this.at("In")) {
            binop = [NOT_IN_PREC, false];
          } else {
            this.withScope(notStart, () => this.expected("keyword `in`"));
            break;
          }
        }
        if (binop !== undefined) {
          let [prec, right] = binop;
          if (prec < minPrec) break;
          if (!right) prec++;
          const opStart = this.token.start;
          this.eat();
          this.withScope(opStart, () => this.codeExprPrec(false, prec));
          continue;
        }
        break;
      }
    } finally {
      this.depth--;
    }
  }

  /** `p.lexer.clone().next().0 == Ident`: the token right after the current one, without trivia. */
  private peekIsIdent(): boolean {
    const lexer = this.lexer;
    const cursor = lexer.cursor;
    const newline = lexer.newline;
    const unclosed = lexer.blockCommentUnclosed;
    const kind = lexer.next().kind;
    lexer.jump(cursor);
    lexer.newline = newline;
    lexer.blockCommentUnclosed = unclosed;
    return kind === "Ident";
  }

  codePrimary(atomic: boolean): void {
    const m = this.token.start;
    switch (this.current()) {
      case "Ident":
        this.eat();
        if (!atomic && this.at("Arrow")) {
          this.eat();
          this.withScope(m, () => this.codeExpr());
        }
        return;
      case "Underscore":
        if (!atomic) {
          this.eat();
          if (this.at("Arrow")) {
            this.eat();
            this.withScope(m, () => this.codeExpr());
          } else if (this.eatIf("Eq")) {
            this.withScope(m, () => this.codeExpr());
          } else if (this.atRealEnd()) {
            this.require({ type: "cut", at: m, reason: "expected expression" });
          } else {
            this.error(m, m + 1, "expected expression");
          }
          return;
        }
        break;
      case "LeftBrace":
        this.codeBlock();
        return;
      case "LeftBracket":
        this.contentBlock();
        return;
      case "LeftParen":
        this.exprWithParen(atomic);
        return;
      case "Dollar":
        this.equation();
        return;
      case "Let":
        this.letBinding();
        return;
      case "Set":
        this.rule(() => this.setRule());
        return;
      case "Show":
        this.rule(() => this.showRule());
        return;
      case "Context":
        this.eat();
        this.codeExprPrec(atomic, 0);
        return;
      case "If":
        this.conditional();
        return;
      case "While":
        this.eat();
        this.codeExpr();
        this.block();
        return;
      case "For":
        this.forLoop();
        return;
      case "Import":
        this.rule(() => this.moduleImport());
        return;
      case "Include":
        this.rule(() => {
          this.eat();
          this.codeExpr();
        });
        return;
      case "Break":
      case "Continue":
      case "Raw":
      case "None":
      case "Auto":
      case "Int":
      case "Float":
      case "Bool":
      case "Numeric":
      case "Str":
      case "Label":
        this.eat();
        return;
      case "Return":
        this.eat();
        if (this.atSet(CODE_EXPR)) this.codeExpr();
        return;
    }
    if (atomic) this.unexpected();
    else this.expected("expression");
  }

  private rule(f: () => void): void {
    this.rules.push(this.scope());
    try {
      f();
    } finally {
      this.rules.pop();
    }
  }

  block(): void {
    if (this.at("LeftBracket")) this.contentBlock();
    else if (this.at("LeftBrace")) this.codeBlock();
    else this.expected("block");
  }

  codeBlock(): void {
    const m = this.token.start;
    this.enterModes("code", CONTINUE, () => {
      this.eat();
      this.codeExprs(CODE_BLOCK_STOP);
      this.expectClosingDelimiter(m, "RightBrace", "code-block");
    });
  }

  contentBlock(): void {
    const m = this.token.start;
    this.enterModes("markup", CONTINUE, () => {
      this.eat();
      this.markup(true, true, ITEM_STOP);
      this.expectClosingDelimiter(m, "RightBracket", "content");
    });
  }

  letBinding(): void {
    this.eat();
    let closure = false;
    let other = false;
    if (this.eatIf("Ident")) {
      if (this.directlyAt("LeftParen")) {
        this.params();
        closure = true;
      }
    } else {
      this.pattern(false, new Set(), "binding");
      other = true;
    }
    const hasEq = closure || other ? this.expect("Eq") : this.eatIf("Eq");
    if (hasEq) this.codeExpr();
  }

  setRule(): void {
    this.eat();
    this.expect("Ident");
    while (this.eatIf("Dot")) this.expect("Ident");
    this.args();
    if (this.eatIf("If")) this.codeExpr();
  }

  showRule(): void {
    this.eat();
    if (!this.at("Colon")) this.codeExpr();
    if (this.eatIf("Colon")) this.codeExpr();
    else this.expected("colon");
  }

  conditional(): void {
    this.eat();
    this.codeExpr();
    this.block();
    if (this.at("Else")) {
      const elseStart = this.token.start;
      this.eat();
      this.withScope(elseStart, () => {
        if (this.at("If")) this.conditional();
        else this.block();
      });
    }
  }

  forLoop(): void {
    this.eat();
    const seen = new Set<string>();
    this.pattern(false, seen, "binding");
    if (this.at("Comma")) {
      this.unexpected();
      if (this.atSet(PATTERN)) this.pattern(false, seen, "binding");
    }
    this.expect("In");
    this.codeExpr();
    this.block();
  }

  moduleImport(): void {
    this.eat();
    this.codeExpr();
    if (this.eatIf("As")) this.expect("Ident");
    if (this.eatIf("Colon")) {
      if (this.at("LeftParen")) {
        this.withNlMode(CONTINUE, () => {
          const m = this.token.start;
          this.eat();
          this.importItems();
          this.expectClosingDelimiter(m, "RightParen", "parens");
        });
      } else if (!this.eatIf("Star")) {
        this.importItems();
      }
    }
  }

  importItems(): void {
    while (!isTerminator(this.current())) {
      if (!this.eatIf("Ident")) this.unexpected();
      while (this.eatIf("Dot")) this.expect("Ident");
      if (this.eatIf("As")) this.expect("Ident");
      if (!isTerminator(this.current())) this.expect("Comma");
    }
  }

  exprWithParen(atomic: boolean): void {
    if (atomic) {
      this.parenthesizedOrArrayOrDict();
      return;
    }
    const cp = this.checkpoint();
    const kind = this.parenthesizedOrArrayOrDict();
    if (this.at("Arrow")) {
      this.restore(cp);
      const m = this.token.start;
      this.params();
      if (!this.expect("Arrow")) return;
      this.withScope(m, () => this.codeExpr());
    } else if (this.at("Eq") && kind !== "parenthesized") {
      this.restore(cp);
      const m = this.token.start;
      this.destructuringOrParenthesized(true, new Set());
      if (!this.expect("Eq")) return;
      this.withScope(m, () => this.codeExpr());
    }
  }

  parenthesizedOrArrayOrDict(): "parenthesized" | "array" | "dict" {
    let count = 0;
    let maybeJustParens = true;
    let kind: "array" | "dict" | null = null;
    const seen = new Set<string>();
    const m = this.token.start;
    this.withNlMode(CONTINUE, () => {
      this.eat();
      if (this.eatIf("Colon")) kind = "dict";
      while (!isTerminator(this.current())) {
        if (!this.atSet(ARG)) {
          this.unexpected();
          continue;
        }
        this.withScope(this.token.start, () => {
          const itemStart = this.token.start;
          if (this.eatIf("Dots")) {
            this.codeExpr();
            maybeJustParens = false;
            return;
          }
          const key = this.keyText();
          this.codeExpr();
          const keyEnd = this.token.prevEnd;
          if (this.eatIf("Colon")) {
            if (key !== null && keyEnd === key.end && !this.see(seen, key.text)) {
              this.error(itemStart, keyEnd, `duplicate key: ${key.text}`);
            }
            this.codeExpr();
            maybeJustParens = false;
            if (kind === "array") this.error(itemStart, this.token.prevEnd, "expected expression");
            else kind = "dict";
          } else if (kind === "dict") {
            // `(a: 1, "b"` may still become `"b": 2`.
            if (this.atRealEnd()) this.require({ type: "cut", at: itemStart, reason: "incomplete-pair" });
            else this.error(itemStart, this.token.prevEnd, "expected named or keyed pair");
          } else {
            kind = "array";
          }
        });
        count++;
        if (!isTerminator(this.current()) && this.expect("Comma")) maybeJustParens = false;
      }
      this.expectClosingDelimiter(m, "RightParen", "parens");
    });
    return maybeJustParens && count === 1 ? "parenthesized" : (kind ?? "array");
  }

  args(): void {
    if (!this.directlyAt("LeftParen") && !this.directlyAt("LeftBracket")) this.expected("argument list");
    if (this.at("LeftParen")) {
      const m = this.token.start;
      const seen = new Set<string>();
      this.withNlMode(CONTINUE, () => {
        this.eat();
        while (!isTerminator(this.current())) {
          if (!this.atSet(ARG)) {
            this.unexpected();
            continue;
          }
          this.withScope(this.token.start, () => {
            if (this.eatIf("Dots")) {
              this.codeExpr();
              return;
            }
            const start = this.token.start;
            const wasAtExpr = this.atSet(CODE_EXPR);
            const name = this.at("Ident") ? { text: this.currentText(), end: this.token.end } : null;
            this.codeExpr();
            const end = this.token.prevEnd;
            if (this.eatIf("Colon")) {
              if (wasAtExpr) {
                if (name === null || end !== name.end) this.error(start, end, "expected identifier");
                else if (!this.see(seen, name.text)) this.error(start, end, `duplicate argument: ${name.text}`);
              }
              this.codeExpr();
            }
          });
          if (!isTerminator(this.current())) this.expect("Comma");
        }
        this.expectClosingDelimiter(m, "RightParen", "args");
      });
    }
    while (this.directlyAt("LeftBracket")) this.contentBlock();
  }

  params(): void {
    const m = this.token.start;
    const seen = new Set<string>();
    let sink = false;
    this.withNlMode(CONTINUE, () => {
      this.eat();
      while (!isTerminator(this.current())) {
        if (!this.atSet(PARAM)) {
          this.unexpected();
          continue;
        }
        this.withScope(this.token.start, () => {
          const start = this.token.start;
          if (this.eatIf("Dots")) {
            if (this.atSet(PATTERN_LEAF)) this.patternLeaf(false, seen, "parameter");
            if (sink) this.error(start, this.token.prevEnd, "only one argument sink is allowed");
            sink = true;
            return;
          }
          const wasAtPat = this.atSet(PATTERN);
          const ident = this.pattern(false, seen, "parameter");
          if (this.eatIf("Colon")) {
            if (wasAtPat && !ident) this.error(start, this.token.prevEnd, "expected identifier");
            this.codeExpr();
          }
        });
        if (!isTerminator(this.current())) this.expect("Comma");
      }
      this.expectClosingDelimiter(m, "RightParen", "params");
    });
  }

  /** Returns whether the pattern is a plain identifier. */
  pattern(reassignment: boolean, seen: Set<string>, dupe: string): boolean {
    if (!this.enter()) return false;
    try {
      if (this.at("Underscore")) {
        this.eat();
        return false;
      }
      if (this.at("LeftParen")) {
        this.destructuringOrParenthesized(reassignment, seen);
        return false;
      }
      return this.patternLeaf(reassignment, seen, dupe);
    } finally {
      this.depth--;
    }
  }

  destructuringOrParenthesized(reassignment: boolean, seen: Set<string>): void {
    const m = this.token.start;
    let sink = false;
    this.withNlMode(CONTINUE, () => {
      this.eat();
      while (!isTerminator(this.current())) {
        if (!this.atSet(PARAM)) {
          this.unexpected();
          continue;
        }
        this.withScope(this.token.start, () => {
          const start = this.token.start;
          if (this.eatIf("Dots")) {
            if (this.atSet(PATTERN_LEAF)) this.patternLeaf(reassignment, seen, "binding");
            if (sink) this.error(start, this.token.prevEnd, "only one destructuring sink is allowed");
            sink = true;
            return;
          }
          const wasAtPat = this.atSet(PATTERN);
          let ident = false;
          const cp = this.checkpoint();
          if (!(this.eatIf("Ident") && this.at("Colon"))) {
            this.restore(cp);
            ident = this.pattern(reassignment, seen, "binding");
          } else {
            ident = true;
          }
          if (this.eatIf("Colon")) {
            if (wasAtPat && !ident) this.error(start, this.token.prevEnd, "expected identifier");
            this.pattern(reassignment, seen, "binding");
          }
        });
        if (!isTerminator(this.current())) this.expect("Comma");
      }
      this.expectClosingDelimiter(m, "RightParen", "parens");
    });
  }

  /** Returns whether the leaf is a plain identifier. */
  patternLeaf(reassignment: boolean, seen: Set<string>, dupe: string): boolean {
    if (isKeyword(this.current())) {
      this.invalidAsIs(this.token.start, this.token.end, "expected pattern");
      this.eat();
      return false;
    }
    if (!this.atSet(PATTERN_LEAF)) {
      this.expected("pattern");
      return false;
    }
    const start = this.token.start;
    const name = this.at("Ident") ? { text: this.currentText(), end: this.token.end } : null;
    this.codeExprPrec(true, 0);
    const ident = name !== null && this.token.prevEnd === name.end;
    if (!reassignment) {
      if (!ident) this.error(start, this.token.prevEnd, "expected pattern");
      else if (!this.see(seen, (name as { text: string }).text))
        this.error(start, this.token.prevEnd, `duplicate ${dupe}`);
    }
    return ident;
  }

  /** Adds a name to a set; false if it was already there. */
  private see(seen: Set<string>, name: string): boolean {
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  }

  /** The key of a dict item starting here (identifier or string literal), with its end. */
  private keyText(): { text: string; end: number } | null {
    if (this.at("Ident")) return { text: this.currentText(), end: this.token.end };
    if (this.at("Str")) {
      const raw = this.currentText().slice(1, -1);
      return { text: raw.replace(/\\(["\\])/g, "$1"), end: this.token.end };
    }
    return null;
  }
}

/**
 * Recognizes `text` from a root checkpoint (default: the start). Returned
 * checkpoints, errors, events and modes cover only `[from.offset, end)`.
 */
export const recognize = (text: string, from?: Checkpoint, opts: RecognizeOptions = {}): Recognition => {
  const offset = from?.offset ?? 0;
  const p = new Parser(text, offset, "markup", opts);
  p.markupExprs(true, ROOT_STOP, true, from?.nesting ?? 0);
  return {
    checkpoints: p.checkpoints,
    requirements: p.reqs,
    errors: p.errors,
    events: p.events,
    modes: p.modes,
    lastTokenStart: p.lastTokenStart,
    ...(p.stoppedAt === undefined ? {} : { stoppedAt: p.stoppedAt }),
  };
};
