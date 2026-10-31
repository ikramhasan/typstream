// Questions about the document's syntax tree (`@typstream/syntax`, Typst's own parser): what is at
// an offset, which markup it is in, and the blocks a markup is made of. Every command reads the
// tree this way, so they act on what Typst will make of the text rather than on guesses.

import type { SyntaxKind, SyntaxNode } from "@typstream/syntax";

/** The last element of `list` that `test` accepts (`Array.prototype.findLast` is ES2023). */
export const findLast = <T>(list: readonly T[], test: (item: T) => boolean): T | undefined => {
  for (let i = list.length - 1; i >= 0; i--) if (test(list[i] as T)) return list[i];
  return undefined;
};

/** A node with its ancestors, innermost last: `path[0]` is the root. */
export type Path = SyntaxNode[];

/** Leaves of inline markup: what text between two blocks is made of. */
const INLINE = new Set<SyntaxKind>([
  "Text",
  "Space",
  "Linebreak",
  "Escape",
  "Shorthand",
  "SmartQuote",
  "Strong",
  "Emph",
  "Raw",
  "Link",
  "Label",
  "Ref",
  "Equation",
  "Hash",
  "LineComment",
  "BlockComment",
]);

/** Markup nodes that start a block of their own: a heading or a list, enum or term item. */
export const BLOCK_ITEMS = new Set<SyntaxKind>(["Heading", "ListItem", "EnumItem", "TermItem"]);

/** Whether `node` is inline markup (or code embedded in it: the expression after a `#`). */
export const isInline = (node: SyntaxNode): boolean => INLINE.has(node.kind) || isEmbedded(node);

/** Kinds an embedded expression (after `#` in markup) can be. */
const EXPRESSIONS = new Set<SyntaxKind>([
  "FuncCall",
  "Ident",
  "FieldAccess",
  "CodeBlock",
  "ContentBlock",
  "Str",
  "Int",
  "Float",
  "Numeric",
  "Bool",
  "None",
  "Auto",
  "Parenthesized",
  "Array",
  "Dict",
  "Contextual",
  "Conditional",
  "ForLoop",
  "WhileLoop",
  "LetBinding",
  "SetRule",
  "ShowRule",
  "ModuleImport",
  "ModuleInclude",
]);

/** Whether `node` is an expression embedded in markup (it follows a `Hash`). */
export const isEmbedded = (node: SyntaxNode): boolean => EXPRESSIONS.has(node.kind);

/**
 * The path to the innermost node containing `offset`. At a boundary between two nodes, `side`
 * picks the one after (1, default) or before (-1).
 */
export const pathAt = (root: SyntaxNode, offset: number, side: 1 | -1 = 1): Path => {
  const path: Path = [root];
  let node = root;
  for (;;) {
    let next: SyntaxNode | undefined;
    for (const child of node.children) {
      // An empty node (an empty `[]`'s markup) holds the offset it sits at.
      const inside =
        child.from === child.to
          ? child.from === offset && child.kind === "Markup"
          : side > 0
            ? child.from <= offset && offset < child.to
            : child.from < offset && offset <= child.to;
      if (inside) {
        next = child;
        break;
      }
    }
    if (!next) return path;
    path.push(next);
    node = next;
  }
};

/** The innermost `Markup` on `path`, and its index in it. */
export const markupOf = (path: Path): { markup: SyntaxNode; index: number } | null => {
  for (let i = path.length - 1; i >= 0; i--)
    if ((path[i] as SyntaxNode).kind === "Markup") return { markup: path[i] as SyntaxNode, index: i };
  return null;
};

/** The ancestors on `path` of `kind`, innermost first. */
export const ancestors = (path: Path, kind: SyntaxKind): SyntaxNode[] => path.filter((n) => n.kind === kind).reverse();

/** Whether `path` ends in markup text a caret can type into (not code, math or a string). */
export const inMarkup = (path: Path): boolean => {
  for (let i = path.length - 1; i >= 0; i--) {
    const kind = (path[i] as SyntaxNode).kind;
    if (kind === "Markup") return true;
    if (kind === "Math" || kind === "Code" || kind === "Args" || kind === "CodeBlock" || kind === "Str") return false;
    if (kind === "Raw") return false;
  }
  return false;
};

/**
 * A block of a markup: a paragraph (a run of inline nodes), a heading, a list item, or an
 * expression on its own (a table, a question). `from`/`to` cover its nodes, not the space or
 * blank line after it. `nodes` are the markup's children it is made of.
 */
export interface Block {
  kind: "paragraph" | "heading" | "list" | "enum" | "term" | "expression";
  from: number;
  to: number;
  nodes: SyntaxNode[];
  /** For a heading, list, enum or term item: the node; for an expression: the expression after `#`. */
  node?: SyntaxNode;
}

const ITEM_KINDS: Record<string, Block["kind"]> = {
  Heading: "heading",
  ListItem: "list",
  EnumItem: "enum",
  TermItem: "term",
};

/** Calls Typst sets inline, in the paragraph around them, even alone on a line. */
export const INLINE_CALLS = new Set([
  "strong",
  "emph",
  "underline",
  "overline",
  "strike",
  "highlight",
  "sub",
  "super",
  "smallcaps",
  "text",
  "link",
  "box",
  "raw",
  "ref",
  "cite",
  "footnote",
  "h",
  "sym",
  "emoji",
  "linebreak",
  "lower",
  "upper",
]);

/**
 * The blocks `markup`'s children make. A paragraph ends at a blank line (`Parbreak`) or a block
 * item (heading, list item). An embedded expression alone on its line is a block of its own
 * (Typst makes most such calls blocks: tables, grids, figures, a plugin's components) unless
 * `inline` says it is set in the paragraph (`#strong[…]` alone on a line). `inline` gets the
 * callee's name; default: {@link INLINE_CALLS}.
 */
export const blocksOf = (
  markup: SyntaxNode,
  text: string,
  inline: (name: string) => boolean = (name) => INLINE_CALLS.has(name),
): Block[] => {
  const out: Block[] = [];
  let run: SyntaxNode[] = [];
  let line: SyntaxNode[] = [];
  const flush = (nodes: SyntaxNode[]) => {
    const kept = [...nodes];
    while (kept.length && (kept[kept.length - 1] as SyntaxNode).kind === "Space") kept.pop();
    while (kept.length && (kept[0] as SyntaxNode).kind === "Space") kept.shift();
    if (kept.length === 0) return;
    const first = kept[0] as SyntaxNode;
    const last = kept[kept.length - 1] as SyntaxNode;
    const expression = lone(kept);
    if (expression) out.push({ kind: "expression", from: first.from, to: last.to, nodes: kept, node: expression });
    else out.push({ kind: "paragraph", from: first.from, to: last.to, nodes: kept });
  };
  /** The expression `nodes` hold alone (with its `#`), if it is set as a block. */
  const lone = (nodes: SyntaxNode[]): SyntaxNode | undefined => {
    const meaningful = nodes.filter((n) => n.kind !== "Space" && n.kind !== "LineComment" && n.kind !== "BlockComment");
    const [hash, expr] = meaningful;
    if (meaningful.length !== 2 || hash?.kind !== "Hash" || !expr || !isEmbedded(expr)) return undefined;
    if (expr.kind === "FuncCall") {
      const name = calleeName(expr, text);
      if (name !== null && inline(name)) return undefined;
    }
    return expr;
  };
  /** A line ended (a newline, or the markup's end): a lone expression on it is a block of its own. */
  const endLine = () => {
    if (lone(line)) {
      flush(run.slice(0, run.length - line.length));
      flush(line);
      run = [];
    }
    line = [];
  };
  for (const child of markup.children) {
    const item = ITEM_KINDS[child.kind];
    if (item) {
      endLine();
      flush(run);
      run = [];
      out.push({ kind: item, from: child.from, to: child.to, nodes: [child], node: child });
    } else if (child.kind === "Parbreak") {
      endLine();
      flush(run);
      run = [];
    } else if (child.kind === "Space" && text.slice(child.from, child.to).includes("\n")) {
      endLine();
      run.push(child);
    } else {
      run.push(child);
      line.push(child);
    }
  }
  endLine();
  flush(run);
  return out;
};

/** The block of `blocks` containing `offset` (or ending at it), or the last before it. */
export const blockAt = (blocks: Block[], offset: number): Block | null => {
  let found: Block | null = null;
  for (const b of blocks) {
    if (b.from <= offset) found = b;
    if (b.from <= offset && offset <= b.to) return b;
  }
  return found;
};

/** The node of `kind` among `node`'s children, or null. */
export const child = (node: SyntaxNode, kind: SyntaxKind): SyntaxNode | null =>
  node.children.find((c) => c.kind === kind) ?? null;

/** The leaves of `node` in order. */
export const leaves = (node: SyntaxNode): SyntaxNode[] => {
  if (node.children.length === 0) return [node];
  const out: SyntaxNode[] = [];
  const stack = [...node.children].reverse();
  while (stack.length) {
    const n = stack.pop() as SyntaxNode;
    if (n.children.length === 0) out.push(n);
    else for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i] as SyntaxNode);
  }
  return out;
};

/** The name a call's callee has: `table` for `table(…)`, `table.cell` for `table.cell(…)`. */
export const calleeName = (call: SyntaxNode, text: string): string | null => {
  const callee = call.children[0];
  if (!callee || (callee.kind !== "Ident" && callee.kind !== "FieldAccess")) return null;
  return text.slice(callee.from, callee.to);
};

/** A call's arguments: named ones by name, positional ones in order, trailing content blocks last. */
export interface CallArgs {
  /** The `Args` node. */
  node: SyntaxNode;
  named: Map<string, SyntaxNode>;
  /** The `Named` nodes, for their whole range. */
  namedNodes: Map<string, SyntaxNode>;
  positional: SyntaxNode[];
  /** Trailing `[…]` content blocks (`f(…)[body]`). */
  trailing: SyntaxNode[];
  /** The `(` … `)` part, if written. */
  parens: { from: number; to: number } | null;
}

/** Reads a `FuncCall`'s arguments. */
export const callArgs = (call: SyntaxNode, text: string): CallArgs | null => {
  const args = child(call, "Args");
  if (!args) return null;
  const named = new Map<string, SyntaxNode>();
  const namedNodes = new Map<string, SyntaxNode>();
  const positional: SyntaxNode[] = [];
  const trailing: SyntaxNode[] = [];
  let open: number | null = null;
  let close: number | null = null;
  for (const c of args.children) {
    if (c.kind === "LeftParen") open = c.from;
    else if (c.kind === "RightParen") close = c.to;
    else if (c.kind === "Named") {
      const name = c.children[0];
      const value = c.children.filter((n) => n.kind !== "Space" && n.kind !== "Colon" && n !== name).at(-1);
      if (name && value) {
        named.set(text.slice(name.from, name.to), value);
        namedNodes.set(text.slice(name.from, name.to), c);
      }
    } else if (c.kind === "ContentBlock" && (close !== null || open === null)) trailing.push(c);
    else if (c.kind !== "Comma" && c.kind !== "Space" && c.kind !== "LineComment" && c.kind !== "BlockComment")
      positional.push(c);
  }
  return {
    node: args,
    named,
    namedNodes,
    positional,
    trailing,
    parens: open !== null && close !== null ? { from: open, to: close } : null,
  };
};

/** The `Markup` inside a `ContentBlock` (`[…]`). */
export const contentMarkup = (block: SyntaxNode): SyntaxNode | null => child(block, "Markup");

/**
 * The content blocks (`[…]`) in `node`'s code: a call's arguments, positional, named or trailing,
 * and those of calls nested in them (`table.cell(…)[…]`), not those inside other content blocks.
 */
export const contentBlocksIn = (node: SyntaxNode): SyntaxNode[] => {
  if (node.kind === "ContentBlock") return [node];
  const out: SyntaxNode[] = [];
  const stack = [...node.children].reverse();
  while (stack.length) {
    const n = stack.pop() as SyntaxNode;
    if (n.kind === "ContentBlock") out.push(n);
    else if (n.kind !== "Markup" && n.kind !== "CodeBlock" && n.kind !== "Closure")
      for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i] as SyntaxNode);
  }
  return out;
};

/** Headings and list, enum and term items: blocks with a marker before their text. */
export const ITEM_NODES = new Set<SyntaxKind>(["Heading", "ListItem", "EnumItem", "TermItem"]);

/**
 * The heading or list item whose text a caret at `offset` is in, innermost, or `null`. An empty
 * item (`- ` with nothing after) counts when the caret is right after its marker's space.
 */
export const itemAt = (root: SyntaxNode, text: string, offset: number): SyntaxNode | null => {
  for (const side of [1, -1] as const) {
    const path = pathAt(root, offset, side);
    for (let i = path.length - 1; i >= 0; i--) {
      const n = path[i] as SyntaxNode;
      if (!ITEM_NODES.has(n.kind)) continue;
      const marker = n.children[0] as SyntaxNode;
      if (offset > marker.from) return n;
      break;
    }
  }
  // `- ` at the end of a line: the space after the marker is outside the item.
  let at = offset;
  while (at > 0 && (text[at - 1] === " " || text[at - 1] === "\t")) at--;
  if (at < offset) {
    const path = pathAt(root, at, -1);
    const n = findLast(path, (k) => ITEM_NODES.has(k.kind));
    if (n && n.to === at) return n;
  }
  return null;
};
