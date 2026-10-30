// The editor's document as Plate (Slate) values: plain JSON, so this package needs no Slate. Keys
// are Plate's where Plate has the node (`p`, `h1`…`h6`, `a`, `code_block`, `hr`, and the marks), so
// Plate's plugins and Plate UI's components work on them; nodes only Typst has are `typst_*`.

/**
 * Marks a run of text can carry, as Plate names them. Each is written as Typst writes it:
 * `*bold*`, `_italic_`, `#underline[…]`, `#strike[…]`, inline raw (backticks), `#sub[…]`, `#super[…]`,
 * `#highlight[…]`, `#text(fill: …)[…]` (`color`), `#highlight(fill: …)[…]` (`backgroundColor`)
 * and `#text(size: …)[…]` (`fontSize`).
 * @beta
 */
export interface TypstMarks {
  /** Strong emphasis: `*…*` or `#strong[…]`. */
  bold?: boolean;
  /** Emphasis: `_…_` or `#emph[…]`. */
  italic?: boolean;
  /** `#underline[…]`. */
  underline?: boolean;
  /** `#strike[…]`. */
  strikethrough?: boolean;
  /** Inline raw text, between backticks or `#raw("…")`. Its text is literal. */
  code?: boolean;
  /** `#sub[…]`. */
  subscript?: boolean;
  /** `#super[…]`. */
  superscript?: boolean;
  /** `#highlight[…]` in Typst's default yellow. */
  highlight?: boolean;
  /** Text colour as a CSS hex colour (`#e11d48`), written `#text(fill: rgb("#e11d48"))[…]`. */
  color?: string;
  /** Highlight colour as a CSS hex colour, written `#highlight(fill: rgb("…"))[…]`. */
  backgroundColor?: string;
  /** Font size as a Typst length in points (`14pt`), written `#text(size: 14pt)[…]`. */
  fontSize?: string;
}

/**
 * A run of text. A `\n` in it is a line break (`\` in Typst).
 * @beta
 */
export interface TypstText extends TypstMarks {
  /** The text, as the reader sees it: escapes and shorthands are already resolved. */
  text: string;
}

/**
 * A link: `#link("url")[…]`, or a bare URL.
 * @beta
 */
export interface TypstLink {
  /** Plate's link type. */
  type: "a";
  /** Where the link goes. */
  url: string;
  /** The link's text. */
  children: TypstText[];
}

/**
 * An inline equation, `$…$`, edited as its Typst math source. A void node.
 * @beta
 */
export interface TypstInlineEquation {
  /** The node's type. */
  type: "typst_inline_equation";
  /** The math between the dollars (Typst math, not TeX). */
  math: string;
  /** Slate's single empty child of a void node. */
  children: [TypstText];
}

/**
 * Typst code or syntax the editor shows but doesn't edit as rich text, inside a paragraph: a call
 * (`#blank()`), a reference (`@fig`), a label, a comment. Written back exactly. A void node.
 * @beta
 */
export interface TypstInlineCode {
  /** The node's type. */
  type: "typst_inline_code";
  /** The node's Typst source, `#` included. */
  source: string;
  /** Slate's single empty child of a void node. */
  children: [TypstText];
}

/**
 * Something inside a paragraph.
 * @beta
 */
export type TypstInline = TypstText | TypstLink | TypstInlineEquation | TypstInlineCode;

/**
 * How a block is aligned. `left` is Typst's default; `center` and `right` are `#align(…)[…]`,
 * `justify` is `#par(justify: true)[…]`.
 * @beta
 */
export type TypstAlign = "left" | "center" | "right" | "justify";

/**
 * List properties, as Plate's indent lists store them: a list item is a block with a
 * `listStyleType` and an `indent` (1 for the outer list); a further paragraph of an item is a
 * block with only the `indent`.
 * @beta
 */
export interface TypstListProps {
  /** `disc` for `- ` items, `decimal` for `+ ` and `1. ` items. */
  listStyleType?: "disc" | "decimal";
  /** Nesting depth, from 1. */
  indent?: number;
  /**
   * An item's explicit number (`3. `), as Plate's restart numbering. Plate keeps its own computed
   * `listStart` on items too; that one is display only and never written.
   */
  listRestart?: number;
}

/**
 * Properties every block has.
 * @beta
 */
export interface TypstBlockProps {
  /** A stable id (Plate's node ids); the editor-core document uses it to keep unchanged source. */
  id?: string;
}

/**
 * A paragraph, or a list item when it has list properties.
 * @beta
 */
export interface TypstParagraph extends TypstBlockProps, TypstListProps {
  /** Plate's paragraph type. */
  type: "p";
  /** Alignment, when not the default. */
  align?: TypstAlign;
  /** The paragraph's content. */
  children: TypstInline[];
}

/**
 * A heading, `=` to `======`.
 * @beta
 */
export interface TypstHeading extends TypstBlockProps {
  /** Plate's heading types, by depth. */
  type: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  /** Alignment, when not the default. */
  align?: TypstAlign;
  /** The label after the heading (`= Intro <intro>`), without the angle brackets. */
  label?: string;
  /** The heading's text. */
  children: TypstInline[];
}

/**
 * A block quote, `#quote(block: true)[…]`.
 * @beta
 */
export interface TypstBlockquote extends TypstBlockProps {
  /** Plate's block quote type. */
  type: "blockquote";
  /** The quote's text. */
  children: TypstInline[];
}

/**
 * A line of a code block.
 * @beta
 */
export interface TypstCodeLine {
  /** Plate's code line type. */
  type: "code_line";
  /** The line's text. */
  children: [TypstText];
}

/**
 * A raw block: three or more backticks, a language, lines of code.
 * @beta
 */
export interface TypstCodeBlock extends TypstBlockProps {
  /** Plate's code block type. */
  type: "code_block";
  /** The language after the backticks, if any. */
  lang?: string;
  /** The block's lines. */
  children: TypstCodeLine[];
}

/**
 * A display equation, `$ … $` on its own lines. A void node.
 * @beta
 */
export interface TypstEquation extends TypstBlockProps {
  /** The node's type. */
  type: "typst_equation";
  /** The math between the dollars, trimmed (Typst math, not TeX). */
  math: string;
  /** The label after the equation (`$ x $ <eq>`), without the angle brackets. */
  label?: string;
  /** Slate's single empty child of a void node. */
  children: [TypstText];
}

/**
 * A horizontal rule, `#line(length: 100%)`. A void node.
 * @beta
 */
export interface TypstRule extends TypstBlockProps {
  /** Plate's horizontal rule type. */
  type: "hr";
  /** Slate's single empty child of a void node. */
  children: [TypstText];
}

/**
 * A page break, `#pagebreak()`. A void node.
 * @beta
 */
export interface TypstPageBreak extends TypstBlockProps {
  /** The node's type. */
  type: "typst_pagebreak";
  /** Slate's single empty child of a void node. */
  children: [TypstText];
}

/**
 * Typst code the editor shows compiled but doesn't edit as rich text: a call on its own lines
 * (`#question[…]`, `#table(…)`, a CeTZ drawing), a rule (`#set`, `#show`, `#let`, `#import`), a
 * comment, or a block with a syntax error. Written back exactly; edited as source. A void node.
 * @beta
 */
export interface TypstCode extends TypstBlockProps {
  /** The node's type. */
  type: "typst_code";
  /** The block's Typst source. */
  source: string;
  /**
   * What the code is, for how the editor shows it: `rule` for `#set`, `#show`, `#let`, `#import`
   * and `#include` (a compact chip), `comment`, or `content` for everything else (compiled).
   */
  role: "content" | "rule" | "comment";
  /** The called function's name, for a call (`question`, `table`); plugins' node specs match it. */
  call?: string;
  /** Slate's single empty child of a void node. */
  children: [TypstText];
}

/**
 * A top-level block of the editor's document.
 * @beta
 */
export type TypstBlock =
  | TypstParagraph
  | TypstHeading
  | TypstBlockquote
  | TypstCodeBlock
  | TypstEquation
  | TypstRule
  | TypstPageBreak
  | TypstCode;

/**
 * The editor's document: Plate's value.
 * @beta
 */
export type TypstValue = TypstBlock[];
