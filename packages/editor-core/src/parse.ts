// Typst source → the editor's Plate value (PLAN §10.3, #36), from Typst's own syntax tree
// (@typstream/syntax). The top level is cut into *units*: a paragraph, a heading, a whole
// top-level list item with what's nested in it, a code block, an equation or a call on its own
// lines. Each unit becomes one or more Plate blocks and remembers its source, so a unit the
// teacher didn't touch is written back exactly (document.ts). Anything the editor can't edit as
// rich text, including any unit with a syntax error, becomes a `typst_code` block holding its
// source.

import { hasErrors, type SyntaxNode } from "@typstream/syntax";
import { escapedChar, hexColor, NAMED_COLORS, readString, SHORTHANDS } from "./text";
import type { TypstAlign, TypstBlock, TypstCode, TypstInline, TypstMarks, TypstParagraph, TypstText } from "./types";

/** The heading types by depth (1-based). */
const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

/** A top-level unit: its source and the blocks it became. */
export interface Unit {
  /** The unit's Typst source, exactly as written. */
  source: string;
  /** Where it was in the parsed text. */
  from: number;
  to: number;
  /** The blocks it became, in order (usually one; a list item with nested items is several). */
  blocks: TypstBlock[];
}

const EMPTY = (): [TypstText] => [{ text: "" }];

/** Thrown inside a unit's conversion when the unit can't be rich text; it becomes code. */
class NotRich extends Error {}

const textOf = (node: SyntaxNode, source: string): string => source.slice(node.from, node.to);

const hasNewline = (node: SyntaxNode, source: string): boolean => textOf(node, source).includes("\n");

const isGap = (node: SyntaxNode): boolean => node.kind === "Space" || node.kind === "Parbreak";

/** Whether only spaces and tabs separate `at` from the start of its line. */
const atLineStart = (source: string, at: number): boolean => {
  for (let i = at - 1; i >= 0; i--) {
    const c = source[i];
    if (c === "\n") return true;
    if (c !== " " && c !== "\t" && c !== "\r") return false;
  }
  return true;
};

/** Whether only spaces and tabs separate `at` from the end of its line. */
const atLineEnd = (source: string, at: number): boolean => {
  for (let i = at; i < source.length; i++) {
    const c = source[i];
    if (c === "\n" || c === "\r") return true;
    if (c !== " " && c !== "\t") return false;
  }
  return true;
};

/** A display equation: `$` followed by whitespace (ast.rs `Equation::block`). */
const isDisplay = (equation: SyntaxNode): boolean =>
  equation.children[1]?.kind === "Space" && equation.children[equation.children.length - 2]?.kind === "Space";

/** The math between an equation's dollars. */
const mathOf = (equation: SyntaxNode, source: string): string => {
  const first = equation.children[0];
  const last = equation.children[equation.children.length - 1];
  if (first?.kind !== "Dollar" || last?.kind !== "Dollar" || last === first) throw new NotRich();
  return source.slice(first.to, last.from).trim();
};

// --- calls -------------------------------------------------------------------------------------

/** A call's parts: callee name, positional and named arguments, trailing content blocks. */
interface Call {
  name: string;
  positional: SyntaxNode[];
  named: Map<string, SyntaxNode>;
  content: SyntaxNode[];
}

const readCall = (node: SyntaxNode, source: string): Call | null => {
  if (node.kind !== "FuncCall") return null;
  const [callee, args] = node.children;
  if (callee?.kind !== "Ident" || args?.kind !== "Args") return null;
  const call: Call = { name: textOf(callee, source), positional: [], named: new Map(), content: [] };
  for (const arg of args.children) {
    switch (arg.kind) {
      case "LeftParen":
      case "RightParen":
      case "Comma":
      case "Space":
        break;
      case "ContentBlock":
        call.content.push(arg);
        break;
      case "Named": {
        const name = arg.children[0];
        const value = arg.children[arg.children.length - 1];
        if (name?.kind !== "Ident" || !value) return null;
        call.named.set(textOf(name, source), value);
        break;
      }
      case "Spread":
        return null;
      default:
        // A content block written as a parenthesized argument, `#strong([x])`, is positional.
        call.positional.push(arg);
    }
  }
  return call;
};

/** The markup inside a content block, `[…]`. */
const contentMarkup = (block: SyntaxNode | undefined): SyntaxNode | null => {
  const markup = block?.children[1];
  return markup?.kind === "Markup" ? markup : null;
};

/** A colour argument (`red`, `rgb("#e11d48")`) as a CSS hex colour, or null. */
const readColor = (node: SyntaxNode | undefined, source: string): string | null => {
  if (!node) return null;
  if (node.kind === "Ident") return NAMED_COLORS[textOf(node, source)] ?? null;
  const call = readCall(node, source);
  if (call?.name !== "rgb" || call.positional.length !== 1 || call.named.size > 0 || call.content.length > 0)
    return null;
  const arg = call.positional[0] as SyntaxNode;
  if (arg.kind !== "Str") return null;
  const hex = readString(textOf(arg, source));
  return hex === null ? null : hexColor(hex);
};

/** A size argument in points (`14pt`), or null. */
const readSize = (node: SyntaxNode | undefined, source: string): string | null => {
  if (node?.kind !== "Numeric") return null;
  const text = textOf(node, source);
  return /^\d+(?:\.\d+)?pt$/.test(text) ? text : null;
};

/** Marks a call adds to its content (`#underline[…]` → underline), or null if it isn't one. */
const markCall = (call: Call, source: string): TypstMarks | null => {
  if (call.content.length !== 1 || call.positional.length > 0) return null;
  const only = (...names: string[]): boolean => [...call.named.keys()].every((n) => names.includes(n));
  switch (call.name) {
    case "strong":
      return call.named.size === 0 ? { bold: true } : null;
    case "emph":
      return call.named.size === 0 ? { italic: true } : null;
    case "underline":
      return call.named.size === 0 ? { underline: true } : null;
    case "strike":
      return call.named.size === 0 ? { strikethrough: true } : null;
    case "sub":
      return call.named.size === 0 ? { subscript: true } : null;
    case "super":
      return call.named.size === 0 ? { superscript: true } : null;
    case "highlight": {
      if (call.named.size === 0) return { highlight: true };
      const fill = readColor(call.named.get("fill"), source);
      return only("fill") && fill ? { backgroundColor: fill } : null;
    }
    case "text": {
      if (call.named.size === 0 || !only("fill", "size")) return null;
      const marks: TypstMarks = {};
      if (call.named.has("fill")) {
        const fill = readColor(call.named.get("fill"), source);
        if (!fill) return null;
        marks.color = fill;
      }
      if (call.named.has("size")) {
        const size = readSize(call.named.get("size"), source);
        if (!size) return null;
        marks.fontSize = size;
      }
      return marks;
    }
    default:
      return null;
  }
};

// --- inline content ----------------------------------------------------------------------------

/** Nodes that end a paragraph in markup. */
const BLOCK_KINDS = new Set(["Parbreak", "Heading", "ListItem", "EnumItem", "TermItem"]);

/** Whether a call is one `inlines` reads as rich text (a mark, a link, raw text), not code. */
const isRichCall = (call: Call, source: string): boolean => {
  if (call.name === "link")
    return call.positional.length === 1 && call.positional[0]?.kind === "Str" && call.named.size === 0;
  if (call.name === "raw")
    return (
      call.positional[0]?.kind === "Str" &&
      call.positional.length === 1 &&
      call.named.size === 0 &&
      call.content.length === 0
    );
  const markup = contentMarkup(call.content[0]);
  return markCall(call, source) !== null && markup !== null && !markup.children.some((c) => BLOCK_KINDS.has(c.kind));
};

/** Converts a run of markup nodes to Plate inlines. */
const inlines = (nodes: readonly SyntaxNode[], source: string, marks: TypstMarks): TypstInline[] => {
  const out: TypstInline[] = [];
  const text = (value: string, extra: TypstMarks = {}): void => {
    if (value) out.push({ text: value, ...marks, ...extra });
  };
  // Void inlines carry their marks on their empty text, as Plate keeps marks on a void's child.
  const chip = (from: number, to: number): void => {
    out.push({ type: "typst_inline_code", source: source.slice(from, to), children: [{ text: "", ...marks }] });
  };
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i] as SyntaxNode;
    switch (node.kind) {
      case "Text":
      case "SmartQuote":
        text(textOf(node, source));
        break;
      case "Space":
        // A space next to a line break is the break's own (`a \ b`).
        if (nodes[i - 1]?.kind !== "Linebreak" && nodes[i + 1]?.kind !== "Linebreak") text(" ");
        break;
      case "Linebreak":
        text("\n");
        break;
      case "Escape":
        text(escapedChar(textOf(node, source)));
        break;
      case "Shorthand":
        text(SHORTHANDS[textOf(node, source)] ?? textOf(node, source));
        break;
      case "Strong":
      case "Emph": {
        const markup = node.children[1];
        if (markup?.kind !== "Markup") throw new NotRich();
        // `__` shows nothing, but it is in the source (models write `____` for a blank): keep it.
        if (markup.children.length === 0) {
          chip(node.from, node.to);
          break;
        }
        out.push(...inlines(markup.children, source, { ...marks, [node.kind === "Strong" ? "bold" : "italic"]: true }));
        break;
      }
      case "Raw": {
        const [open, body, close, extra] = node.children;
        const value = body?.kind === "Text" ? textOf(body, source) : body === close ? "" : null;
        if (open && textOf(open, source) === "`" && value && !extra && !value.includes("\n")) {
          text(value, { code: true });
        } else chip(node.from, node.to);
        break;
      }
      case "Link": {
        const url = textOf(node, source);
        out.push({ type: "a", url, children: [{ text: url, ...marks }] });
        break;
      }
      case "Equation":
        if (isDisplay(node)) chip(node.from, node.to);
        else
          out.push({ type: "typst_inline_equation", math: mathOf(node, source), children: [{ text: "", ...marks }] });
        break;
      case "Hash": {
        const expr = nodes[i + 1];
        if (!expr) throw new NotRich();
        // A `;` after the expression only ends it; the serializer writes one where it's needed.
        const end = nodes[i + 2]?.kind === "Semicolon" ? i + 2 : i + 1;
        const call = readCall(expr, source);
        const added = call && markCall(call, source);
        const markup = contentMarkup(call?.content[0]);
        if (call && added && markup && !markup.children.some((c) => BLOCK_KINDS.has(c.kind))) {
          out.push(...inlines(markup.children, source, { ...marks, ...added }));
        } else if (call?.name === "link" && call.positional.length === 1 && call.named.size === 0) {
          const url = readString(textOf(call.positional[0] as SyntaxNode, source));
          const body = call.content.length === 1 ? contentMarkup(call.content[0]) : null;
          if (
            url !== null &&
            (call.content.length === 0 || (body && !body.children.some((c) => BLOCK_KINDS.has(c.kind))))
          ) {
            const children = body ? inlines(body.children, source, marks) : [{ text: url, ...marks }];
            if (children.every((c) => !("type" in c))) out.push({ type: "a", url, children: children as TypstText[] });
            else chip(node.from, expr.to);
          } else chip(node.from, expr.to);
        } else if (
          call?.name === "raw" &&
          call.positional.length === 1 &&
          call.named.size === 0 &&
          call.content.length === 0 &&
          call.positional[0]?.kind === "Str"
        ) {
          const value = readString(textOf(call.positional[0], source));
          if (value === null) chip(node.from, expr.to);
          else text(value, { code: true });
        } else chip(node.from, expr.to);
        i = end;
        break;
      }
      case "Error":
        throw new NotRich();
      default:
        // Labels, references, comments and anything else: kept as written.
        chip(node.from, node.to);
    }
  }
  return out;
};

/**
 * Plate's normal form for inline children: adjacent texts with the same marks merged, a text
 * (possibly empty) before, between and after inline elements.
 */
export const normalizeInlines = (children: readonly TypstInline[]): TypstInline[] => {
  const out: TypstInline[] = [];
  for (const child of children) {
    const last = out[out.length - 1];
    if (!("type" in child)) {
      if (last && !("type" in last) && sameMarks(last, child))
        out[out.length - 1] = { ...last, text: last.text + child.text };
      else out.push(child);
      continue;
    }
    if (!last || "type" in last) out.push({ text: "" });
    out.push(child.type === "a" ? { ...child, children: normalizeInlines(child.children) as TypstText[] } : child);
  }
  const last = out[out.length - 1];
  if (!last || "type" in last) out.push({ text: "" });
  // Drop empty texts that aren't needed around an element.
  return out.filter((child, i) => {
    if ("type" in child || child.text !== "") return true;
    const before = out[i - 1];
    const after = out[i + 1];
    return out.length === 1 || (before !== undefined && "type" in before) || (after !== undefined && "type" in after);
  });
};

const MARK_KEYS: (keyof TypstMarks)[] = [
  "bold",
  "italic",
  "underline",
  "strikethrough",
  "code",
  "subscript",
  "superscript",
  "highlight",
  "color",
  "backgroundColor",
  "fontSize",
];

/** Whether two texts carry the same marks (absent and `false` alike). */
export const sameMarks = (a: TypstMarks, b: TypstMarks): boolean =>
  MARK_KEYS.every((key) => (a[key] || undefined) === (b[key] || undefined));

/** Inline content trimmed of the gaps at its ends. */
const trimGaps = (nodes: readonly SyntaxNode[]): SyntaxNode[] => {
  let from = 0;
  let to = nodes.length;
  while (from < to && isGap(nodes[from] as SyntaxNode)) from++;
  while (to > from && isGap(nodes[to - 1] as SyntaxNode)) to--;
  return nodes.slice(from, to);
};

// --- blocks ------------------------------------------------------------------------------------

const code = (source: string, role: TypstCode["role"], call?: string): TypstCode => ({
  type: "typst_code",
  source,
  role,
  ...(call ? { call } : {}),
  children: EMPTY(),
});

const RULES = new Set(["SetRule", "ShowRule", "LetBinding", "ModuleImport", "ModuleInclude"]);

/**
 * Spaces as Typst lays them out: a run of spaces is one space (`a ____ b`, empty emphasis between
 * two spaces, shows one), and a paragraph has none at its ends.
 */
const collapseSpaces = (children: TypstInline[]): TypstInline[] => {
  let previous: string | undefined;
  const out: TypstInline[] = [];
  for (const child of children) {
    // Raw text's spaces are its own: they all show.
    if ("type" in child || child.code) {
      out.push(child);
      previous = undefined;
      continue;
    }
    let text = child.text;
    if (previous === undefined && out.length === 0) text = text.replace(/^ +/, "");
    if (previous !== undefined && /[ \n]$/.test(previous)) text = text.replace(/^ +/, "");
    if (text === "") continue;
    out.push({ ...child, text });
    previous = text;
  }
  for (let i = out.length - 1; i >= 0; i--) {
    const last = out[i] as TypstInline;
    if ("type" in last || last.code) break;
    const text = last.text.replace(/ +$/, "");
    if (text !== "") {
      out[i] = { ...last, text };
      break;
    }
    out.splice(i, 1);
  }
  return out;
};

/** Inline markup as a block's children. */
const blockInlines = (nodes: readonly SyntaxNode[], source: string): TypstInline[] =>
  normalizeInlines(collapseSpaces(inlines(trimGaps(nodes), source, {})));

/** A paragraph's markup as one block, or `NotRich`. */
const paragraph = (nodes: readonly SyntaxNode[], source: string): TypstParagraph => ({
  type: "p",
  children: blockInlines(nodes, source),
});

/** A heading node (and the label after it, if any). */
const heading = (node: SyntaxNode, source: string, label: string | undefined): TypstBlock => {
  const [marker, , markup] = node.children;
  const depth = marker ? marker.to - marker.from : 0;
  const type = HEADINGS[depth - 1];
  if (!type || markup?.kind !== "Markup") throw new NotRich();
  if (markup.children.some((c) => BLOCK_KINDS.has(c.kind))) throw new NotRich();
  return {
    type,
    ...(label !== undefined ? { label } : {}),
    children: blockInlines(markup.children, source),
  };
};

/** A top-level list or enum item and everything nested in it, flattened into Plate's indent list blocks. */
const listItem = (node: SyntaxNode, source: string, depth: number, out: TypstBlock[]): void => {
  const [marker, , markup] = node.children;
  if (!marker || markup?.kind !== "Markup") throw new NotRich();
  const props: Pick<TypstParagraph, "listStyleType" | "listRestart"> = { listStyleType: "disc" };
  if (node.kind === "EnumItem") {
    props.listStyleType = "decimal";
    // An explicit number (`3.`) is kept, even 1, which Typst writes out (`<li value="1">`).
    const number = Number.parseInt(textOf(marker, source), 10);
    if (Number.isFinite(number)) props.listRestart = number;
  }
  let first = true;
  let pending: SyntaxNode[] = [];
  const flush = (): void => {
    const nodes = trimGaps(pending);
    pending = [];
    if (nodes.length === 0 && !first) return;
    out.push({ ...paragraph(nodes, source), ...(first ? props : {}), indent: depth });
    first = false;
  };
  for (const child of markup.children) {
    if (child.kind === "ListItem" || child.kind === "EnumItem") {
      flush();
      listItem(child, source, depth + 1, out);
    } else if (child.kind === "Parbreak") flush();
    else if (BLOCK_KINDS.has(child.kind)) throw new NotRich();
    else if (child.kind === "Equation" && isDisplay(child)) throw new NotRich();
    else pending.push(child);
  }
  if (first || pending.length > 0) flush();
};

/** Block forms a call on its own lines can be: `#align(center)[…]`, `#line(length: 100%)`, …. */
const callBlock = (call: Call, source: string): TypstBlock | null => {
  const inner = (): TypstBlock | null => {
    const markup = contentMarkup(call.content[0]);
    if (!markup || call.content.length !== 1) return null;
    const nodes = trimGaps(markup.children);
    const only = nodes[0];
    if (nodes.length === 1 && only?.kind === "Heading") return heading(only, source, undefined);
    if (nodes.some((c) => BLOCK_KINDS.has(c.kind) || (c.kind === "Equation" && isDisplay(c)))) return null;
    return paragraph(nodes, source);
  };
  const isTrue = (node: SyntaxNode | undefined): boolean => node?.kind === "Bool" && textOf(node, source) === "true";
  switch (call.name) {
    case "align": {
      const where = call.positional[0];
      const align = where?.kind === "Ident" ? ALIGNS[textOf(where, source)] : undefined;
      const block = call.positional.length === 1 && call.named.size === 0 && align ? inner() : null;
      return block && block.type !== "blockquote" ? ({ ...block, align } as TypstBlock) : null;
    }
    case "par": {
      const block =
        call.named.size === 1 && isTrue(call.named.get("justify")) && call.positional.length === 0 ? inner() : null;
      return block?.type === "p" ? { ...block, align: "justify" } : null;
    }
    case "quote": {
      const block =
        call.named.size === 1 && isTrue(call.named.get("block")) && call.positional.length === 0 ? inner() : null;
      return block?.type === "p" ? { type: "blockquote", children: block.children } : null;
    }
    case "line": {
      const length = call.named.get("length");
      const full = length?.kind === "Numeric" && textOf(length, source) === "100%";
      return call.named.size === 1 && full && call.positional.length === 0 && call.content.length === 0
        ? { type: "hr", children: EMPTY() }
        : null;
    }
    case "pagebreak":
      return call.named.size === 0 && call.positional.length === 0 && call.content.length === 0
        ? { type: "typst_pagebreak", children: EMPTY() }
        : null;
    default:
      return null;
  }
};

const ALIGNS: Record<string, TypstAlign> = { center: "center", right: "right", left: "left" };

/** A raw block's lines and language. */
const codeBlock = (node: SyntaxNode, source: string): TypstBlock => {
  let lang: string | undefined;
  const lines: string[] = [];
  for (const child of node.children) {
    if (child.kind === "RawLang") lang = textOf(child, source);
    else if (child.kind === "Text") lines.push(textOf(child, source));
  }
  return {
    type: "code_block",
    ...(lang ? { lang } : {}),
    children: (lines.length ? lines : [""]).map((line) => ({ type: "code_line", children: [{ text: line }] })),
  };
};

/**
 * Cuts a document's syntax tree into units and converts each to Plate blocks. Every byte of the
 * source is either in a unit or in the whitespace between two.
 */
export const parseUnits = (root: SyntaxNode, source: string): Unit[] => {
  const units: Unit[] = [];
  const nodes = root.children;
  let pending: SyntaxNode[] = [];

  const add = (from: number, to: number, convert: () => TypstBlock[]): void => {
    const text = source.slice(from, to);
    let blocks: TypstBlock[];
    try {
      blocks = hasErrorsIn(nodes, from, to) ? [codeFor(nodes, from, to, source)] : convert();
    } catch (error) {
      if (!(error instanceof NotRich)) throw error;
      blocks = [codeFor(nodes, from, to, source)];
    }
    units.push({ source: text, from, to, blocks });
  };
  const flush = (): void => {
    const run = trimGaps(pending);
    pending = [];
    const first = run[0];
    const last = run[run.length - 1];
    if (first && last) add(first.from, last.to, () => [paragraph(run, source)]);
  };
  /** The index after a same-line `Space? Label` following node `i`, and the label's name. */
  const labelAfter = (i: number): [number, string | undefined] => {
    let j = i + 1;
    if (nodes[j]?.kind === "Space" && !hasNewline(nodes[j] as SyntaxNode, source)) j++;
    const label = nodes[j];
    if (label?.kind !== "Label" || !atLineEnd(source, label.to)) return [i, undefined];
    return [j, textOf(label, source).slice(1, -1)];
  };

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i] as SyntaxNode;
    if (isGap(node)) {
      if (node.kind === "Parbreak") flush();
      else if (pending.length > 0) pending.push(node);
      continue;
    }
    if (node.kind === "Heading") {
      flush();
      const [end, label] = labelAfter(i);
      add(node.from, (nodes[end] as SyntaxNode).to, () => [heading(node, source, label)]);
      i = end;
      continue;
    }
    if (node.kind === "ListItem" || node.kind === "EnumItem") {
      flush();
      add(node.from, node.to, () => {
        const out: TypstBlock[] = [];
        listItem(node, source, 1, out);
        return out;
      });
      continue;
    }
    if (node.kind === "TermItem") {
      flush();
      add(node.from, node.to, () => {
        throw new NotRich();
      });
      continue;
    }
    // Things that are blocks when they're alone on their lines.
    if (atLineStart(source, node.from)) {
      let end = i;
      let convert: (() => TypstBlock[]) | null = null;
      if (node.kind === "Hash") {
        const expr = nodes[i + 1];
        const call = expr && readCall(expr, source);
        // A mark or a link alone on its line is still a paragraph (`#underline[Name:]`).
        if (expr && !(call && isRichCall(call, source) && !callBlock(call, source))) {
          end = nodes[i + 2]?.kind === "Semicolon" ? i + 2 : i + 1;
          const [withLabel] = labelAfter(end);
          end = withLabel;
          convert = () => {
            const call = readCall(expr, source);
            const text = source.slice(node.from, (nodes[end] as SyntaxNode).to);
            const block =
              call && end <= i + 2 && (nodes[end] as SyntaxNode).kind !== "Label" ? callBlock(call, source) : null;
            if (block) return [block];
            if (RULES.has(expr.kind)) return [code(text, "rule")];
            return [code(text, "content", call?.name)];
          };
        }
      } else if (node.kind === "Equation" && isDisplay(node)) {
        const [withLabel, label] = labelAfter(i);
        end = withLabel;
        convert = () => [
          {
            type: "typst_equation",
            math: mathOf(node, source),
            ...(label !== undefined ? { label } : {}),
            children: EMPTY(),
          },
        ];
      } else if (node.kind === "Raw" && textOf(node, source).startsWith("```") && hasNewline(node, source)) {
        convert = () => [codeBlock(node, source)];
      } else if (node.kind === "LineComment" || node.kind === "BlockComment") {
        convert = () => [code(textOf(node, source), "comment")];
      }
      const last = nodes[end] as SyntaxNode;
      if (convert && atLineEnd(source, last.to)) {
        flush();
        add(node.from, last.to, convert);
        i = end;
        continue;
      }
    }
    pending.push(node);
  }
  flush();
  return units;
};

const hasErrorsIn = (nodes: readonly SyntaxNode[], from: number, to: number): boolean =>
  nodes.some((n) => n.from >= from && n.to <= to && hasErrors(n));

/** A unit that isn't rich text: code, a comment, or a rule. */
const codeFor = (nodes: readonly SyntaxNode[], from: number, to: number, source: string): TypstCode => {
  const inside = nodes.filter((n) => n.from >= from && n.to <= to && !isGap(n));
  const first = inside[0];
  const text = source.slice(from, to);
  if (inside.length === 1 && (first?.kind === "LineComment" || first?.kind === "BlockComment"))
    return code(text, "comment");
  const expr = first?.kind === "Hash" ? inside[1] : undefined;
  if (expr && RULES.has(expr.kind)) return code(text, "rule");
  const call =
    expr?.kind === "FuncCall" && expr.children[0]?.kind === "Ident" ? textOf(expr.children[0], source) : undefined;
  return code(text, "content", call);
};
