// Error classes for compile errors of healed prefixes (#13). Classified by the
// message, refined by where the error is and what the complete document holds.
import type { Diagnostic } from "./engine";

export type ErrorClass =
  /** `@x` where `<x>` comes later in the document: the label isn't streamed yet. */
  | "forward-ref"
  /** `@key` of a bibliography entry, cited before `#bibliography(..)` (usually the last line). */
  | "citation-before-bibliography"
  /** `@eq` of `@eq-energy`: the reference name is still being typed. */
  | "partial-ref"
  /** A call closed before its required arguments arrived: `#text(` → `#text()`, `#align(center` → no body. */
  | "missing-argument"
  /** A half-typed value of the wrong type: `#v(1` (integer, not length), `stroke: (` (array), `0.` (float). */
  | "type-mismatch"
  /** A half-typed value the function rejects: `rgb("#e")`, `link("")`, `lang: ""`, `(0cm, 2.5cm), (1`. */
  | "invalid-value"
  /** A half-typed path: `bibliography("assets/clim")`. */
  | "file-not-found"
  /** A half-typed identifier, or closure parameters `(x, y)` before their `=>` arrived. */
  | "unknown-variable"
  /** An operation on half-typed operands, possibly inside a settled function called with them. */
  | "invalid-operation"
  /** The document needs too-deep HTML (paged export doesn't care). */
  | "html-depth"
  /** Syntax errors: healing missed something (the parse oracle should have caught it first). */
  | "syntax"
  /**
   * No position in the document: a package evaluating the document's content raised it (CeTZ's
   * plugin panics on a half-typed coordinate `(6` inside a canvas, #24's recordings).
   */
  | "unlocated"
  | "other";

export const ERROR_CLASSES: readonly ErrorClass[] = [
  "citation-before-bibliography",
  "forward-ref",
  "partial-ref",
  "missing-argument",
  "type-mismatch",
  "invalid-value",
  "file-not-found",
  "unknown-variable",
  "invalid-operation",
  "html-depth",
  "syntax",
  "unlocated",
  "other",
];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const INVALID_VALUE = [
  /wrong length/,
  /must not be empty/,
  /must be positive/,
  /must contain exactly/,
  /must have at least/,
  /^expected at least one value/,
  /^invalid /,
  /^unknown (style|font|font family)\b/,
  /destructure/,
  /^expected two or three letter language code/,
  /^cannot draw a (vertical|horizontal) line/,
];

const INVALID_OPERATION = [/^cannot /, /has no method/, /does not contain field/];

const SYNTAX = [/^unclosed /, /^expected (expression|semicolon|block|closing|argument list)/, /^unexpected /];

/**
 * The class of `error` in the healed source of a prefix of `document` (the
 * complete source, used to tell a label that comes later from a name still
 * being typed).
 */
export const classify = (error: Diagnostic, document: string): ErrorClass => {
  const { message } = error;
  const label = /^label `<(.+)>` does not exist/.exec(message)?.[1];
  if (label !== undefined) {
    if (document.includes(`<${label}>`)) return "forward-ref";
    // The same reference, complete, somewhere in the document: a citation key.
    const complete = new RegExp(`@${escapeRegExp(label)}(?![\\p{XID_Continue}\\-_]|[.:][\\p{XID_Continue}])`, "u");
    if (complete.test(document) && /#bibliography\(/.test(document)) return "citation-before-bibliography";
    return "partial-ref";
  }
  if (message.startsWith("missing argument")) return "missing-argument";
  if (message.startsWith("file not found")) return "file-not-found";
  if (message.startsWith("unknown variable")) return "unknown-variable";
  if (message.startsWith("maximum HTML depth")) return "html-depth";
  if (SYNTAX.some((re) => re.test(message))) return "syntax";
  if (INVALID_VALUE.some((re) => re.test(message))) return "invalid-value";
  if (/^expected .*, found /.test(message)) return "type-mismatch";
  // `expected "solid", "dotted", …` without a `found`: a half-typed string.
  if (message.startsWith("expected ")) return "invalid-value";
  if (INVALID_OPERATION.some((re) => re.test(message))) return "invalid-operation";
  if (error.span === null && error.trace.every((t) => t.span === null)) return "unlocated";
  return "other";
};
