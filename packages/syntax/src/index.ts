// Typst's syntax tree in JavaScript (PLAN §4.1, #36): typst-syntax 0.15.1, the parser Typst itself
// uses, compiled to wasm (rust/lib.rs). The wasm returns the tree as a flat array (kind, UTF-16
// length, child count per node, in pre-order); this module rebuilds nodes with offsets from it.
// Load the wasm once (`loadSyntax`), then `parse` is synchronous.

import init, { initSync, parse as parseFlat } from "../wasm/syntax.js";

/**
 * The names of typst-syntax's `SyntaxKind`s, in its declaration order: index `i` is the kind the
 * wasm writes as `i`.
 * @beta
 */
export const SYNTAX_KINDS = [
  "End",
  "Error",
  "Shebang",
  "LineComment",
  "BlockComment",
  "Markup",
  "Text",
  "Space",
  "Linebreak",
  "Parbreak",
  "Escape",
  "Shorthand",
  "SmartQuote",
  "Strong",
  "Emph",
  "Raw",
  "RawLang",
  "RawDelim",
  "RawTrimmed",
  "Link",
  "Label",
  "Ref",
  "RefMarker",
  "Heading",
  "HeadingMarker",
  "ListItem",
  "ListMarker",
  "EnumItem",
  "EnumMarker",
  "TermItem",
  "TermMarker",
  "Equation",
  "Math",
  "MathText",
  "MathIdent",
  "MathFieldAccess",
  "MathShorthand",
  "MathAlignPoint",
  "MathCall",
  "MathArgs",
  "MathDelimited",
  "MathAttach",
  "MathPrimes",
  "MathFrac",
  "MathRoot",
  "Hash",
  "LeftBrace",
  "RightBrace",
  "LeftBracket",
  "RightBracket",
  "LeftParen",
  "RightParen",
  "Comma",
  "Semicolon",
  "Colon",
  "Star",
  "Underscore",
  "Dollar",
  "Plus",
  "Minus",
  "Slash",
  "Hat",
  "Dot",
  "Eq",
  "EqEq",
  "ExclEq",
  "Lt",
  "LtEq",
  "Gt",
  "GtEq",
  "PlusEq",
  "HyphEq",
  "StarEq",
  "SlashEq",
  "Dots",
  "Arrow",
  "Root",
  "Bang",
  "Not",
  "And",
  "Or",
  "None",
  "Auto",
  "Let",
  "Set",
  "Show",
  "Context",
  "If",
  "Else",
  "For",
  "In",
  "While",
  "Break",
  "Continue",
  "Return",
  "Import",
  "Include",
  "As",
  "Code",
  "Ident",
  "Bool",
  "Int",
  "Float",
  "Numeric",
  "Str",
  "CodeBlock",
  "ContentBlock",
  "Parenthesized",
  "Array",
  "Dict",
  "Named",
  "Keyed",
  "Unary",
  "Binary",
  "FieldAccess",
  "FuncCall",
  "Args",
  "Spread",
  "Closure",
  "Params",
  "LetBinding",
  "SetRule",
  "ShowRule",
  "Contextual",
  "Conditional",
  "WhileLoop",
  "ForLoop",
  "ModuleImport",
  "ImportItems",
  "ImportItemPath",
  "RenamedImportItem",
  "ModuleInclude",
  "LoopBreak",
  "LoopContinue",
  "FuncReturn",
  "Destructuring",
  "DestructAssignment",
] as const;

/**
 * A kind of syntax node, as typst-syntax names it (`Markup`, `Strong`, `FuncCall`, …).
 * @beta
 */
export type SyntaxKind = (typeof SYNTAX_KINDS)[number];

/**
 * A node of Typst's lossless syntax tree: the text from `from` to `to` (UTF-16 offsets) is
 * exactly the text of its leaves, trivia (spaces, comments) included.
 * @beta
 */
export interface SyntaxNode {
  /** What the node is. */
  kind: SyntaxKind;
  /** Where the node starts (UTF-16 offset, as JavaScript string indices). */
  from: number;
  /** Where the node ends (exclusive). */
  to: number;
  /** The node's children in order; empty for a leaf (a token or an error). */
  children: SyntaxNode[];
}

/**
 * What {@link loadSyntax} accepts: a URL to fetch, a fetch `Response`, the bytes, or a compiled
 * `WebAssembly.Module`.
 * @beta
 */
export type SyntaxWasmInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

let loaded: Promise<void> | null = null;
let ready = false;

/**
 * Loads the parser's wasm (~76 KB brotli) once; later calls return the same promise. Default:
 * `syntax_bg.wasm` next to this module, which bundlers emit as an asset. In Node, pass the bytes
 * (`readFileSync(require.resolve("@typstream/syntax/syntax_bg.wasm"))`): Node's `fetch` can't read
 * files.
 * @beta
 */
export const loadSyntax = (wasm?: SyntaxWasmInput | Promise<SyntaxWasmInput>): Promise<void> => {
  loaded ??= (async () => {
    await init(wasm === undefined ? undefined : { module_or_path: await wasm });
    ready = true;
  })().catch((error: unknown) => {
    loaded = null;
    throw error;
  });
  return loaded;
};

/**
 * Loads the parser from bytes or a compiled module without waiting (e.g. in a worker that already
 * has them).
 * @beta
 */
export const loadSyntaxSync = (wasm: BufferSource | WebAssembly.Module): void => {
  if (ready) return;
  initSync({ module: wasm });
  ready = true;
  loaded = Promise.resolve();
};

/**
 * Whether the parser is loaded, so {@link parse} can run.
 * @beta
 */
export const isSyntaxLoaded = (): boolean => ready;

/**
 * Parses a Typst document (markup mode) into its syntax tree, as Typst does: the root is a
 * `Markup` node spanning the whole text, and malformed parts are `Error` leaves rather than
 * exceptions. Throws if the wasm isn't loaded ({@link loadSyntax}).
 * @beta
 */
export const parse = (text: string): SyntaxNode => {
  if (!ready) throw new Error("@typstream/syntax: call loadSyntax() before parse()");
  const flat = parseFlat(text);
  let at = 0;
  // Pre-order: a node's children follow it, each with its own subtree. Iterative, because
  // deeply nested documents (brackets inside brackets) would overflow a recursive build.
  const read = (from: number): SyntaxNode => {
    const node: SyntaxNode = { kind: kindOf(flat[at] ?? 0), from, to: from + (flat[at + 1] ?? 0), children: [] };
    at += 3;
    return node;
  };
  const root = read(0);
  const stack: { node: SyntaxNode; left: number; offset: number }[] = [{ node: root, left: flat[2] ?? 0, offset: 0 }];
  while (stack.length > 0) {
    const top = stack[stack.length - 1] as (typeof stack)[number];
    if (top.left === 0) {
      stack.pop();
      continue;
    }
    top.left--;
    const count = flat[at + 2] ?? 0;
    const child = read(top.offset);
    top.offset = child.to;
    top.node.children.push(child);
    if (count > 0) stack.push({ node: child, left: count, offset: child.from });
  }
  return root;
};

const kindOf = (index: number): SyntaxKind => {
  const kind = SYNTAX_KINDS[index];
  if (kind === undefined) throw new Error(`@typstream/syntax: unknown syntax kind ${index}`);
  return kind;
};

/**
 * Walks a tree depth-first, parents before children. Return `false` from `visit` to skip a
 * node's children.
 * @beta
 */
export const walk = (node: SyntaxNode, visit: (node: SyntaxNode, parent: SyntaxNode | null) => unknown): void => {
  const stack: [SyntaxNode, SyntaxNode | null][] = [[node, null]];
  while (stack.length > 0) {
    const [current, parent] = stack.pop() as [SyntaxNode, SyntaxNode | null];
    if (visit(current, parent) === false) continue;
    for (let i = current.children.length - 1; i >= 0; i--) stack.push([current.children[i] as SyntaxNode, current]);
  }
};

/**
 * Whether a tree has a syntax error anywhere (an `Error` node).
 * @beta
 */
export const hasErrors = (node: SyntaxNode): boolean => {
  let found = false;
  walk(node, (n) => {
    if (n.kind === "Error") found = true;
    return !found;
  });
  return found;
};
