// Editing commands the toolbars, the slash menu and the popovers share. They change the Plate
// value; the editor turns each change into a `TextEdit` of the Typst source (editor-core).

import { toggleCodeBlock } from "@platejs/code-block";
import { indent, outdent } from "@platejs/indent";
import { upsertLink } from "@platejs/link";
import { indentList, outdentList, toggleList } from "@platejs/list";
import type { Range } from "@typstream/core";
import { type TypstBlock, TypstDocument, type TypstValue } from "@typstream/editor-core";
import type { Descendant, Path, TElement } from "platejs";
import type { PlateEditor } from "platejs/react";

/** What a block can be turned into. `ul` and `ol` are lists. */
export type BlockKind = "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "blockquote" | "code_block" | "ul" | "ol";

const TEXT_BLOCKS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote"]);
const LIST_PROPS = ["listStyleType", "indent", "listStart", "listRestart", "listRestartPolite"];

/** The top-level block the selection is in. */
export const currentBlock = (editor: PlateEditor): [TElement, Path] | undefined =>
  editor.selection ? (editor.api.block({ highest: true }) as [TElement, Path] | undefined) : undefined;

/** What the selection's block is, as the "turn into" menu names it. */
export const currentKind = (editor: PlateEditor): BlockKind | undefined => {
  const [block] = currentBlock(editor) ?? [];
  if (!block) return undefined;
  const list = (block as { listStyleType?: string }).listStyleType;
  if (list) return list === "decimal" ? "ol" : "ul";
  return TEXT_BLOCKS.has(block.type) || block.type === "code_block" ? (block.type as BlockKind) : undefined;
};

const selectedBlocks = (editor: PlateEditor): [TElement, Path][] =>
  [...editor.api.blocks({ mode: "highest" })] as [TElement, Path][];

/** Turns the selected blocks into a heading, a list, a quote, … */
export const turnInto = (editor: PlateEditor, kind: BlockKind): void => {
  editor.tf.withoutNormalizing(() => {
    if (kind === "ul" || kind === "ol") {
      for (const [block, path] of selectedBlocks(editor)) {
        if (block.type !== "p") editor.tf.setNodes({ type: "p" }, { at: path });
      }
      toggleList(editor, { listStyleType: kind === "ul" ? "disc" : "decimal" });
      return;
    }
    if (currentKind(editor) === "code_block" && kind !== "code_block") toggleCodeBlock(editor);
    for (const [block, path] of selectedBlocks(editor)) {
      if ((block as { listStyleType?: string }).listStyleType) editor.tf.unsetNodes(LIST_PROPS, { at: path });
      if (kind !== "code_block" && TEXT_BLOCKS.has(block.type)) editor.tf.setNodes({ type: kind }, { at: path });
    }
    if (kind === "code_block" && currentKind(editor) !== "code_block") toggleCodeBlock(editor);
  });
};

/** Whether the selection's text carries a mark. */
export const hasMark = (editor: PlateEditor, key: string): boolean => {
  const marks = editor.api.marks() as Record<string, unknown> | null;
  return Boolean(marks?.[key]);
};

/** A mark's value on the selection (a colour, a size). */
export const markValue = (editor: PlateEditor, key: string): string | undefined => {
  const marks = editor.api.marks() as Record<string, unknown> | null;
  const value = marks?.[key];
  return typeof value === "string" ? value : undefined;
};

export const toggleMark = (editor: PlateEditor, key: string): void => {
  // Typst can't set text as both: `#sub` and `#super` exclude each other.
  const remove = key === "subscript" ? "superscript" : key === "superscript" ? "subscript" : undefined;
  editor.tf.toggleMark(key, remove ? { remove } : undefined);
  editor.tf.focus();
};

export const setMark = (editor: PlateEditor, key: string, value: string | undefined): void => {
  if (value === undefined) editor.tf.removeMarks(key);
  else editor.tf.addMarks({ [key]: value });
  editor.tf.focus();
};

export type Align = "left" | "center" | "right" | "justify";

export const currentAlign = (editor: PlateEditor): Align => {
  const [block] = currentBlock(editor) ?? [];
  return ((block as { align?: Align } | undefined)?.align ?? "left") as Align;
};

/** Aligns the selected paragraphs and headings (`#align(…)`, `#par(justify: true)` for paragraphs). */
export const setAlign = (editor: PlateEditor, align: Align): void => {
  for (const [block, path] of selectedBlocks(editor)) {
    if (block.type !== "p" && !/^h[1-6]$/.test(block.type)) continue;
    if ((block as { listStyleType?: string }).listStyleType) continue;
    // Typst justifies paragraphs, not headings.
    if (align === "left" || (align === "justify" && block.type !== "p")) editor.tf.unsetNodes("align", { at: path });
    else editor.tf.setNodes({ align } as Partial<TElement>, { at: path });
  }
  editor.tf.focus();
};

export const indentBlocks = (editor: PlateEditor): void => {
  if (currentKind(editor) === "ul" || currentKind(editor) === "ol") indentList(editor);
  else indent(editor);
  editor.tf.focus();
};

export const outdentBlocks = (editor: PlateEditor): void => {
  if (currentKind(editor) === "ul" || currentKind(editor) === "ol") outdentList(editor);
  else outdent(editor);
  editor.tf.focus();
};

/** The link the selection is in. */
export const currentLink = (editor: PlateEditor): string | undefined => {
  const entry = editor.api.above<TElement & { url?: string }>({ match: { type: "a" } });
  return entry?.[0].url;
};

export const setLink = (editor: PlateEditor, url: string): void => {
  if (url.trim() === "") editor.tf.unwrapNodes({ match: { type: "a" }, split: true });
  else upsertLink(editor, { url: url.trim() });
  editor.tf.focus();
};

/** A void node with Slate's empty child. */
export const voidNode = <T extends object>(props: T): T & { children: [{ text: "" }] } => ({
  ...props,
  children: [{ text: "" }],
});

/** Inserts blocks after the selection's block, or in place of it when it's an empty paragraph. */
export const insertBlocks = (editor: PlateEditor, blocks: Descendant[]): void => {
  const entry = currentBlock(editor);
  editor.tf.withoutNormalizing(() => {
    if (!entry) {
      editor.tf.insertNodes(blocks, { at: [editor.children.length], select: true });
      return;
    }
    const [block, path] = entry;
    const empty = block.type === "p" && editor.api.isEmpty(block);
    const at = empty ? path : [(path[0] ?? 0) + 1];
    editor.tf.insertNodes(blocks, { at, select: true });
    if (empty) editor.tf.removeNodes({ at: [(path[0] ?? 0) + blocks.length] });
  });
  editor.tf.focus();
};

/** Inserts Typst source as blocks (a plugin's `#question[…]`, a table). */
export const insertSource = (editor: PlateEditor, source: string): void => {
  insertBlocks(editor, new TypstDocument(source).value as Descendant[]);
};

/**
 * Replaces a block with what its edited Typst source is now: still code, or rich text if the
 * teacher wrote plain markup.
 */
export const replaceWithSource = (editor: PlateEditor, element: TElement, source: string): void => {
  const path = editor.api.findPath(element);
  if (!path) return;
  const blocks = source.trim() === "" ? [] : (new TypstDocument(source).value as Descendant[]);
  editor.tf.withoutNormalizing(() => {
    editor.tf.removeNodes({ at: path });
    if (blocks.length > 0) editor.tf.insertNodes(blocks, { at: path });
    else if (editor.children.length === 0) editor.tf.insertNodes({ type: "p", children: [{ text: "" }] }, { at: [0] });
  });
};

export const insertInlineEquation = (editor: PlateEditor, math: string): void => {
  editor.tf.insertNodes(voidNode({ type: "typst_inline_equation", math }), { select: true });
  editor.tf.focus();
};

/** The source range of the selected top-level blocks, for "Ask AI" (`@typstream/ai` edits it). */
export const selectionSourceRange = (editor: PlateEditor, doc: TypstDocument): Range | null => {
  const blocks = selectedBlocks(editor);
  const first = blocks[0]?.[0] as TypstBlock | undefined;
  const last = blocks[blocks.length - 1]?.[0] as TypstBlock | undefined;
  const from = first?.id ? doc.rangeOf(first.id) : undefined;
  const to = last?.id ? doc.rangeOf(last.id) : undefined;
  return from && to ? { from: from.from, to: to.to } : null;
};

export type { TypstValue };
