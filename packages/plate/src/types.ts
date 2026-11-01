// The editor's value: the HTML target's DOM as the renderer laid it out (value.ts), as Slate nodes. Elements keep
// their tag and attributes so Plate renders the same DOM, under the same CSS; text keeps the range of the Typst source
// it shows, so typing into it becomes an edit of the source.

/** A range of the source, `[from, to)`, UTF-16. */
export type Span = readonly [number, number];

/**
 * A piece of a text the document wrote: `[at, at + length)` of the text shows `src` of the source, exactly its
 * characters when `exact`, else a whole syntax node (a smart quote, an escape, a space Typst made of a line break).
 */
export interface TextPart {
  at: number;
  length: number;
  src: Span;
  exact: boolean;
}

/** Text in the document: one of the renderer's text nodes, with the pieces of it the document wrote. */
export interface TypstText {
  text: string;
  parts?: readonly TextPart[];
  /** Typed into since the value was read: its parts are in the source as it was after the session's first `rev` edits. */
  rev?: number;
  /** The renderer's text run (`span.typstream-t`) it is in: that span's attributes. */
  run?: Readonly<Record<string, string>>;
}

/** An element of the HTML: rendered as it is, its text editable. */
export interface TypstElement {
  type: "el";
  tag: string;
  attrs: Readonly<Record<string, string>>;
  inline: boolean;
  /** The syntax node that made it (`data-typstream-span`): a `*strong*`, a heading, a list item. */
  span?: Span;
  children: TypstChild[];
}

/**
 * HTML the editor shows but doesn't edit: what the document's text doesn't make (a template's words, numbering),
 * pictures, spacing, the pages' breaks. Rendered from its markup, its element as it is.
 */
export interface TypstAtom {
  type: "atom";
  tag: string;
  attrs: Readonly<Record<string, string>>;
  inline: boolean;
  /** Its namespace when not HTML's (an SVG picture, MathML): rendered in a `display: contents` wrapper. */
  ns?: string;
  html: string;
  /** Where it is in the source, when the document wrote it (an equation, a call). */
  span?: Span;
  children: [{ text: "" }];
}

export type TypstChild = TypstElement | TypstAtom | TypstText;
export type TypstBlock = TypstElement | TypstAtom;

export const isText = (node: unknown): node is TypstText =>
  typeof node === "object" && node !== null && typeof (node as TypstText).text === "string";
