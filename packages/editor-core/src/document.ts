// A Typst document behind a Plate editor (PLAN §10.1, §10.3): the source stays the truth and the
// Plate value is derived from it. Every block remembers which top-level unit of the source it
// came from (by its Plate id). Serializing writes an untouched unit's source exactly, and the
// whitespace around it, so comments, spacing and the author's syntax survive; only changed
// blocks are written canonically (serialize.ts). Each change is then one minimal `TextEdit`.

import { diffEdit, type Range, type TextEdit } from "@typstream/core";
import { parse } from "@typstream/syntax";
import { parseUnits, type Unit } from "./parse";
import { separator, serializeBlock } from "./serialize";
import type { TypstBlock, TypstValue } from "./types";

/**
 * Options of {@link TypstDocument.serialize}.
 * @beta
 */
export interface SerializeOptions {
  /**
   * Write every block canonically, as if each had been edited, keeping the whitespace between
   * blocks that are still where they were. Default false: unchanged blocks keep their source.
   */
  rewrite?: boolean;
}

/**
 * Options of {@link TypstDocument}.
 * @beta
 */
export interface TypstDocumentOptions {
  /** Makes block ids. Default: `t` and a counter, prefixed per document. */
  newId?: () => string;
}

interface UnitInfo extends Unit {
  index: number;
  /** The block ids, in order. */
  ids: string[];
  /** The unit's blocks in canonical Typst: when a value's blocks still say this, they're unchanged. */
  canonical: string;
}

/** A run of output: an unchanged unit written as it was, or a block written canonically. */
interface Piece {
  text: string;
  first: TypstBlock;
  last: TypstBlock;
  /** The unit it starts in the parsed source, if it does (for the whitespace before it). */
  starts?: number;
  /** The unit it ends in the parsed source, if it does (for the whitespace after it). */
  ends?: number;
  ids: string[];
}

let documents = 0;

const canonicalOf = (blocks: readonly TypstBlock[]): string => {
  let out = "";
  let previous: TypstBlock | undefined;
  for (const block of blocks) {
    const text = serializeBlock(block, previous);
    if (text === "") continue;
    if (previous) out += separator(previous, block);
    out += text;
    previous = block;
  }
  return out;
};

const newlines = (text: string): number => text.split("\n").length - 1;

const isFlowParagraph = (block: TypstBlock): boolean => block.type === "p" && block.listStyleType === undefined;

/**
 * A Typst document edited as a Plate value. Parse the source once (`new TypstDocument(source)`,
 * after `loadSyntax()`), give Plate {@link TypstDocument.value}, and pass each new value to
 * {@link TypstDocument.update}, which returns the `TextEdit` that brings the source up to date.
 * An edit from elsewhere (an AI, a collaborator) goes through {@link TypstDocument.setSource}.
 * @beta
 */
export class TypstDocument {
  /** The current source. */
  source: string;
  /** The value parsed from the source by the constructor or the last `setSource`. */
  value: TypstValue;
  private units: UnitInfo[] = [];
  private byId = new Map<string, UnitInfo>();
  private ranges = new Map<string, Range>();
  // The units' offsets are into the source they were parsed from, which `update` moves on from.
  private parsed = "";
  private readonly newId: () => string;

  constructor(source: string, options: TypstDocumentOptions = {}) {
    const prefix = `t${(documents++).toString(36)}_`;
    let n = 0;
    this.newId = options.newId ?? (() => `${prefix}${(n++).toString(36)}`);
    this.source = source;
    this.value = this.load(source, []);
  }

  /** The source range a block was written to by the last parse or update, by its id. */
  rangeOf(id: string): Range | undefined {
    return this.ranges.get(id);
  }

  /** The id of the block whose source contains `offset`, if any. */
  blockAt(offset: number): string | undefined {
    for (const [id, range] of this.ranges) if (offset >= range.from && offset <= range.to) return id;
    return undefined;
  }

  /** The Typst source of a value. Unchanged blocks keep their source; the rest are written canonically. */
  serialize(value: TypstValue, options: SerializeOptions = {}): string {
    return this.write(value, options.rewrite === true).text;
  }

  /**
   * Brings the source up to date with a value from the editor; returns the edit (origin `user`),
   * or null when the source didn't change.
   */
  update(value: TypstValue): TextEdit | null {
    const { text, ranges } = this.write(value);
    const edit = diffEdit(this.source, text);
    this.source = text;
    this.ranges = ranges;
    return edit && { ...edit, origin: "user" };
  }

  /**
   * Replaces the source (an edit from outside the editor) and returns the new value. Units whose
   * source didn't change keep their blocks' ids, so the editor can keep them as they are.
   */
  setSource(source: string): TypstValue {
    this.source = source;
    this.value = this.load(source, this.units);
    return this.value;
  }

  private load(source: string, previous: readonly UnitInfo[]): TypstValue {
    this.parsed = source;
    const reusable = new Map<string, UnitInfo[]>();
    for (const unit of previous) {
      const list = reusable.get(unit.source) ?? [];
      list.push(unit);
      reusable.set(unit.source, list);
    }
    this.units = parseUnits(parse(source), source).map((unit, index) => {
      const old = reusable.get(unit.source)?.shift();
      const ids = old && old.ids.length === unit.blocks.length ? old.ids : unit.blocks.map(() => this.newId());
      const blocks = unit.blocks.map((block, i) => ({ ...block, id: ids[i] }) as TypstBlock);
      return { ...unit, blocks, index, ids, canonical: canonicalOf(blocks) };
    });
    this.byId = new Map(this.units.flatMap((unit) => unit.ids.map((id) => [id, unit] as const)));
    this.ranges = new Map(
      this.units.flatMap((unit) => unit.ids.map((id) => [id, { from: unit.from, to: unit.to }] as const)),
    );
    const value = this.units.flatMap((unit) => unit.blocks);
    return value.length > 0 ? value : [{ type: "p", id: this.newId(), children: [{ text: "" }] }];
  }

  private write(value: TypstValue, rewrite = false): { text: string; ranges: Map<string, Range> } {
    const pieces: Piece[] = [];
    for (let k = 0; k < value.length; ) {
      const block = value[k] as TypstBlock;
      const unit = block.id === undefined ? undefined : this.byId.get(block.id);
      const n = unit?.ids.length ?? 0;
      if (!rewrite && unit && unit.ids[0] === block.id && unit.ids.every((id, j) => value[k + j]?.id === id)) {
        const blocks = value.slice(k, k + n);
        if (canonicalOf(blocks) === unit.canonical) {
          const last = blocks[n - 1] as TypstBlock;
          pieces.push({ text: unit.source, first: block, last, starts: unit.index, ends: unit.index, ids: unit.ids });
          k += n;
          continue;
        }
      }
      const text = serializeBlock(block, value[k - 1]);
      if (text !== "") {
        const piece: Piece = { text, first: block, last: block, ids: block.id ? [block.id] : [] };
        if (unit && unit.ids[0] === block.id) piece.starts = unit.index;
        if (unit && unit.ids[n - 1] === block.id) piece.ends = unit.index;
        pieces.push(piece);
      }
      k++;
    }
    const ranges = new Map<string, Range>();
    if (pieces.length === 0) {
      // Nothing written: a document of whitespace stays as it was until something is typed.
      return { text: this.units.length === 0 ? this.source : "", ranges };
    }
    const firstUnit = this.units[0];
    const lastUnit = this.units[this.units.length - 1];
    let text = pieces[0]?.starts === 0 && firstUnit ? this.before(0) : "";
    pieces.forEach((piece, i) => {
      if (i > 0) text += this.between(pieces[i - 1] as Piece, piece);
      const from = text.length;
      text += piece.text;
      for (const id of piece.ids) ranges.set(id, { from, to: text.length });
    });
    const last = pieces[pieces.length - 1] as Piece;
    text += lastUnit && last.ends === lastUnit.index ? this.after(lastUnit.index) : "\n";
    return { text, ranges };
  }

  /** The text before unit `index` in the parsed source (whitespace). */
  private before(index: number): string {
    const unit = this.units[index] as UnitInfo;
    const previous = this.units[index - 1];
    return this.parsed.slice(previous?.to ?? 0, unit.from);
  }

  /** The whitespace after unit `index` in the parsed source. */
  private after(index: number): string {
    const unit = this.units[index] as UnitInfo;
    const next = this.units[index + 1];
    return this.parsed.slice(unit.to, next?.from ?? this.parsed.length);
  }

  private between(a: Piece, b: Piece): string {
    if (a.ends !== undefined && b.starts === a.ends + 1) {
      const original = this.after(a.ends);
      // Two paragraphs that were, say, list items one line apart need a blank line now.
      if (!(isFlowParagraph(a.last) && isFlowParagraph(b.first) && newlines(original) < 2)) return original;
    }
    return separator(a.last, b.first);
  }
}
