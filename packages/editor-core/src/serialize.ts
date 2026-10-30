// The editor's Plate value → Typst source, for blocks the teacher changed (unchanged ones keep
// their source, document.ts). The output is canonical Typst a teacher could have written: `*bold*`
// and `_italic_` where Typst reads the delimiters, `#strong[…]` where it wouldn't (inside a word),
// `#underline[…]` and friends for the other marks, lists as `- ` and `+ ` with two spaces per
// level. Tests check that Typst's parser reads every output back into the same value.

import { escapeMarkup, isIdContinue, isWordy, typstColor, typstString } from "./text";
import type { TypstBlock, TypstInline, TypstMarks, TypstText, TypstValue } from "./types";

// Marks from the outermost wrapper to the innermost: `code` is raw text, so it must be innermost.
const ORDER = [
  "fontSize",
  "color",
  "backgroundColor",
  "highlight",
  "underline",
  "strikethrough",
  "superscript",
  "subscript",
  "bold",
  "italic",
  "code",
] as const satisfies readonly (keyof TypstMarks)[];

type MarkKey = (typeof ORDER)[number];

/** A rendered piece of inline markup, with what it needs to know about its neighbours. */
interface Piece {
  text: string;
  /**
   * How the piece ends, when the next character could change it: `expr` for an embedded
   * expression (`#f[…]`, `#name`), which an adjacent `(`, `[`, `.name` or identifier character
   * would continue; `ref` for `@ref` or a label, which identifier characters, `.` and `:` extend.
   */
  open?: "expr" | "ref";
  /** Whether the piece ends a line (a `//` comment). */
  newline?: boolean;
}

const markValue = (text: TypstText, key: MarkKey): string | true | undefined => {
  const value = text[key];
  return value === false || value === undefined || value === "" ? undefined : value;
};

/** Renders inline content. `lineStart` says it starts a line, where list and heading markers count. */
export const serializeInlines = (children: readonly TypstInline[], lineStart = false): string => {
  const pieces = render(children, 0);
  let out = "";
  let atStart = lineStart;
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i] as Piece;
    let text = piece.text;
    if (atStart && piece.open === undefined && !piece.newline) text = escapeLineStartOf(text);
    out += text;
    const next = pieces[i + 1]?.text ?? "";
    out += guard(piece, next);
    atStart = piece.newline === true;
    if (piece.newline && next !== "") out += "\n";
  }
  return out;
};

/** What to put between a piece and the next text so the piece ends where it should. */
const guard = (piece: Piece, next: string): string => {
  const c = next[0];
  if (c === undefined) return "";
  // After `)` or `]` only a call or a field continues the expression; after a name, any identifier
  // character does too.
  const continues =
    c === "(" || c === "[" || (c === "." && isIdContinue(next[1])) || (!/[)\]]$/.test(piece.text) && isIdContinue(c));
  if (piece.open === "expr" && continues) return ";";
  // `\` before the next character ends a reference or label; any character but whitespace and
  // `u{` escapes.
  if (piece.open === "ref" && (isIdContinue(c) || c === "." || c === ":")) return "\\";
  return "";
};

/** Escapes a marker at the start of already-escaped text (`- `, `= `, `+ `, `/ `, `1. `). */
const escapeLineStartOf = (text: string): string => {
  const marker = /^(\s*)(=+|-|\+|\/|\d+\.)(?=\s|$)/.exec(text);
  if (!marker) return text;
  const [whole, space, m] = marker as unknown as [string, string, string];
  const escaped = /^\d/.test(m) ? `${m.slice(0, -1)}\\.` : `\\${m}`;
  return space + escaped + text.slice(whole.length);
};

/** Renders inlines grouped by the marks from `ORDER[level]` inward. */
const render = (children: readonly TypstInline[], level: number): Piece[] => {
  const key = ORDER[level];
  if (key === undefined) return children.flatMap(renderLeaf);
  // Maximal runs of children with the same value of this mark.
  const runs: { value: string | true | undefined; items: TypstInline[] }[] = [];
  for (const child of children) {
    const value = marksOf(child) ? markValue(marksOf(child) as TypstText, key) : undefined;
    const last = runs[runs.length - 1];
    if (last && last.value === value) last.items.push(child);
    else runs.push({ value, items: [child] });
  }
  const rendered = runs.map((run) => (run.value === undefined ? render(run.items, level + 1) : null));
  const out: Piece[] = [];
  runs.forEach((run, r) => {
    const inner = rendered[r];
    if (inner) {
      out.push(...inner);
      return;
    }
    const content = render(run.items, level + 1);
    if (content.length > 0) {
      // Across a run boundary at an outer level there is always a wrapper's delimiter, which
      // isn't a word character, so only this level's neighbours matter.
      const before = lastChar(out);
      const next = rendered[r + 1];
      const after = r + 1 < runs.length ? (next ? next[0]?.text[0] : "#") : undefined;
      out.push(wrap(key, run.value as string | true, content, before, after));
    }
  });
  return out;
};

const lastChar = (pieces: readonly Piece[]): string | undefined => {
  const last = pieces[pieces.length - 1];
  return last?.text[last.text.length - 1];
};

/** Where an inline's marks are: a text's own, a void inline's on its empty child; a link's are inside it. */
const marksOf = (child: TypstInline): TypstText | undefined => {
  if (!("type" in child)) return child;
  return child.type === "a" ? undefined : child.children[0];
};

const join = (pieces: readonly Piece[]): string => {
  let out = "";
  pieces.forEach((piece, i) => {
    out += piece.text + guard(piece, pieces[i + 1]?.text ?? "");
    if (piece.newline && i < pieces.length - 1) out += "\n";
  });
  // A comment at the end of content in brackets would swallow the closing bracket.
  if (pieces[pieces.length - 1]?.newline) out += "\n";
  return out;
};

/** Wraps rendered content in a mark. */
const wrap = (key: MarkKey, value: string | true, content: Piece[], before?: string, after?: string): Piece => {
  // The start of a content block is the start of a line, where markers count (`#text[/ a]`).
  const inner = escapeLineStartOf(join(content));
  const call = (name: string, args = ""): Piece => ({ text: `#${name}${args}[${inner}]`, open: "expr" });
  switch (key) {
    case "bold":
    case "italic": {
      const delim = key === "bold" ? "*" : "_";
      // lexer.rs `in_word`: a delimiter between two word characters is text.
      const opens = !(isWordy(before) && isWordy(inner[0]));
      const closes = !(isWordy(inner[inner.length - 1]) && isWordy(after));
      const lastPiece = content[content.length - 1];
      if (opens && closes && !lastPiece?.open && !lastPiece?.newline) return { text: `${delim}${inner}${delim}` };
      return call(key === "bold" ? "strong" : "emph");
    }
    case "underline":
      return call("underline");
    case "strikethrough":
      return call("strike");
    case "subscript":
      return call("sub");
    case "superscript":
      return call("super");
    case "highlight":
      return call("highlight");
    case "backgroundColor":
      return call("highlight", `(fill: ${typstColor(value as string)})`);
    case "color":
      return call("text", `(fill: ${typstColor(value as string)})`);
    case "fontSize":
      return call("text", `(size: ${value})`);
    case "code":
      // Already rendered by renderLeaf.
      return { text: inner };
  }
};

/** Renders a text (its marks already applied by `render`) or an inline element. */
const renderLeaf = (child: TypstInline): Piece[] => {
  if (!("type" in child)) {
    if (child.text === "") return [];
    if (child.code) {
      const text = child.text;
      if (!text.includes("`") && !text.includes("\n") && text.trim() === text) return [{ text: `\`${text}\`` }];
      return [{ text: `#raw(${typstString(text)})`, open: "expr" }];
    }
    return textPieces(child.text);
  }
  switch (child.type) {
    case "a": {
      // A bare URL would take in whatever follows it, so links are always calls; one whose text
      // is its URL has no body.
      const text = child.children.map((c) => c.text).join("");
      const plain = child.children.every((c) => markValuesEmpty(c));
      const body = plain && text === child.url ? "" : join(render(child.children, 0));
      return [{ text: `#link(${typstString(child.url)})${body ? `[${body}]` : ""}`, open: "expr" }];
    }
    case "typst_inline_equation":
      return [{ text: `$${child.math.trim()}$` }];
    case "typst_inline_code": {
      const source = child.source;
      if (source.startsWith("//")) return [{ text: source, newline: true }];
      if (source.startsWith("#")) return [source.endsWith(";") ? { text: source } : { text: source, open: "expr" }];
      if (source.startsWith("@") || source.startsWith("<")) return [{ text: source, open: "ref" }];
      return [{ text: source }];
    }
  }
};

const markValuesEmpty = (text: TypstText): boolean => ORDER.every((key) => markValue(text, key) === undefined);

/** Plain text as markup: escaped, with `\n` as a line break. */
const textPieces = (text: string): Piece[] => {
  const lines = text.split("\n");
  return [
    {
      text: lines
        .map((line, i) => {
          const escaped = escapeMarkup(line);
          // `\` and a space is a line break (a `\` alone could escape what follows the text).
          return i < lines.length - 1 ? `${escaped}\\ ` : escaped;
        })
        .join(""),
    },
  ];
};

// --- blocks ------------------------------------------------------------------------------------

const isListItem = (block: TypstBlock | undefined): boolean => block?.type === "p" && block.listStyleType !== undefined;

/** Whether a paragraph continues the list item before it (Plate's indented, unmarked block). */
export const isContinuation = (block: TypstBlock, previous: TypstBlock | undefined): boolean =>
  block.type === "p" &&
  block.listStyleType === undefined &&
  (block.indent ?? 0) >= 1 &&
  previous?.type === "p" &&
  (previous.indent ?? 0) >= 1;

const wrapAlign = (block: { align?: string }, text: string): string => {
  switch (block.align) {
    case "center":
    case "right":
      return `#align(${block.align})[${text}]`;
    case "justify":
      return `#par(justify: true)[${text}]`;
    default:
      return text;
  }
};

/** A block in canonical Typst. `previous` is the block before it, for list continuations. */
export const serializeBlock = (block: TypstBlock, previous: TypstBlock | undefined): string => {
  switch (block.type) {
    case "p": {
      if (isListItem(block)) {
        const indent = "  ".repeat(Math.max(0, (block.indent ?? 1) - 1));
        const marker = block.listStyleType === "decimal" ? (block.listRestart ? `${block.listRestart}.` : "+") : "-";
        const body = serializeInlines(block.children, true);
        return `${indent}${marker}${body ? ` ${body}` : ""}`;
      }
      if (isContinuation(block, previous)) {
        const body = serializeInlines(block.children, true);
        return body ? `${"  ".repeat(block.indent ?? 1)}${body}` : "";
      }
      const body = serializeInlines(block.children, block.align === undefined || block.align === "left");
      return body ? wrapAlign(block, body) : "";
    }
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const depth = Number(block.type.slice(1));
      const body = serializeInlines(block.children, true);
      const label = block.label ? ` <${block.label}>` : "";
      return wrapAlign(block, `${"=".repeat(depth)} ${body}`) + label;
    }
    case "blockquote": {
      const body = serializeInlines(block.children, true);
      return `#quote(block: true)[${body}]`;
    }
    case "code_block": {
      const lines = block.children.map((line) => line.children.map((t) => t.text).join(""));
      const longest = Math.max(0, ...lines.flatMap((l) => (l.match(/`+/g) ?? []).map((m) => m.length)));
      const fence = "`".repeat(Math.max(3, longest + 1));
      return `${fence}${block.lang ?? ""}\n${lines.join("\n")}\n${fence}`;
    }
    case "typst_equation":
      return `$ ${block.math.trim()} $${block.label ? ` <${block.label}>` : ""}`;
    case "hr":
      return "#line(length: 100%)";
    case "typst_pagebreak":
      return "#pagebreak()";
    case "typst_code":
      return block.source;
  }
};

/** The whitespace between two canonical blocks. */
export const separator = (previous: TypstBlock, next: TypstBlock): string =>
  isListItem(next) && previous.type === "p" && (isListItem(previous) || (previous.indent ?? 0) >= 1) ? "\n" : "\n\n";

/** A whole value in canonical Typst, ignoring where it came from. */
export const serializeValue = (value: TypstValue): string => {
  let out = "";
  let previous: TypstBlock | undefined;
  for (const block of value) {
    const text = serializeBlock(block, previous);
    if (text === "") continue;
    if (previous) out += separator(previous, block);
    out += text;
    previous = block;
  }
  return out ? `${out}\n` : "";
};
