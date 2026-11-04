// Finding Mermaid diagrams in a document's source: raw blocks tagged `mermaid`, as Typst's lexer
// reads them (lexer.rs `raw`): an opening run of three or more backticks, the language tag right
// after it, and the content up to the first run of as many backticks. A fence in a comment or a
// string is found too; the Typst side never asks for it, so it costs a render and nothing else.

/** A ```` ```mermaid ```` block: its content, and the key the Typst side looks it up by. */
export interface Fence {
  /** The diagram's source as written (indentation matters to some diagram types). */
  source: string;
  /** {@link diagramKey} of the source. */
  key: string;
}

/**
 * The key a diagram is found by: its source with whitespace runs collapsed and trimmed, which
 * the Typst side computes from `raw.text` alike (`lib.typ`'s `_key`). Typst drops a raw block's
 * common indentation and its first and last blank lines, so the two texts differ in whitespace
 * only.
 */
export const diagramKey = (source: string): string => source.replace(/\s+/g, " ").trim();

const OPEN = /(`{3,})mermaid(?=\s)/g;

/** The `mermaid` raw blocks of `text`, in order; an unclosed one (a stream cut) is left out. */
export const findFences = (text: string): Fence[] => {
  const fences: Fence[] = [];
  OPEN.lastIndex = 0;
  for (let m = OPEN.exec(text); m; m = OPEN.exec(text)) {
    const ticks = m[1] as string;
    // A longer run before it is a block of its own that happens to contain these backticks.
    if (m.index > 0 && text[m.index - 1] === "`") continue;
    const start = m.index + m[0].length;
    const end = text.indexOf(ticks, start);
    if (end < 0) break;
    // From the line after the tag, as Typst's text starts, so pele's line numbers are the block's.
    const source = text.slice(start, end).replace(/^[^\S\n]*\r?\n/, "");
    fences.push({ source, key: diagramKey(source) });
    OPEN.lastIndex = end + ticks.length;
  }
  return fences;
};
