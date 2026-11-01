// One export against Typst's PDF: what tools/docx-check reports for each corpus document (#131–#134) and the
// conformance suite asserts for each plugin example (#135).
import { compareColours } from "./colour.mjs";
import { compareInk } from "./ink.mjs";
import {
  compare,
  drift,
  linesOf,
  mathOf,
  missingOperands,
  pageCount,
  scriptLinesOf,
  sharedChars,
  textFaces,
  textLinesOf,
} from "./lines.mjs";
import { compareRegions } from "./pixels.mjs";

/** Letters of scripts whose PDF text can't be compared as written (#134): their lines are `scriptLinesOf`'s. */
export const OTHER_SCRIPT =
  /[\u0590-\u08ff\u0900-\u0dff\u0e00-\u109f\u1780-\u17ff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;

/**
 * Typst's PDF and another layout's of the DOCX exported from `model` (its pictures say where text is outlines):
 * - `lines`, `same`, `pageStarts`, `pageStartsSame`, `first` (lines.mjs's `compare`): by text, by the text around
 *   equations when it has some (each engine sets math its own way, #132), or as `scriptLinesOf` reads them (`scripts`);
 *   what `unmapped` matches left out on both sides (glyphs the other layout's PDF has no text for);
 * - `pages`: both page counts;
 * - `pictures`: each picture's pixels (pixels.mjs);
 * - `math`: how many of the equations' letters and digits came out (`chars`, `same`), when it has equations, and how
 *   many operands the other layout's math drew as missing (`missing`: LibreOffice's "¿");
 * - `ink`: the largest cluster of differing pixels in what pages draw besides text and pictures (ink.mjs), on the
 *   pages both have; none with equations, which each engine sets taller or shorter, moving what follows;
 * - `drift`: the line set farthest from where Typst set it (lines.mjs's `drift`); none with equations or in other
 *   scripts;
 * - `colours`: the words whose paper or ink differ from Typst's (colour.mjs): a highlight or a text colour lost;
 *   equations' left out, and in other scripts their papers only.
 */
export const compareExport = (typst, other, model, { scripts = false, unmapped } = {}) => {
  const regions = model.pictures ?? [];
  const math = JSON.stringify(model.sections).includes('"math":[');
  const plain = !scripts && !math && [linesOf(typst, regions), linesOf(other)];
  const lines = scripts
    ? compare(scriptLinesOf(typst, regions), scriptLinesOf(other), unmapped)
    : math
      ? compare(textLinesOf(typst, undefined, regions), textLinesOf(other, textFaces(typst)), unmapped)
      : compare(...plain, unmapped);
  const chars = math ? [mathOf(typst, regions), mathOf(other)] : undefined;
  const ink = math
    ? null
    : compareInk(typst, other, { regions }).reduce((a, b) => (b.cluster > a.cluster ? b : a), {
        page: 0,
        pixels: 0,
        cluster: 0,
        box: null,
      });
  return {
    ...lines,
    pages: [pageCount(typst), pageCount(other)],
    pictures: compareRegions(typst, other, regions),
    math: chars && {
      chars: chars[0].length,
      same: sharedChars(chars[0], chars[1]),
      missing: Math.max(0, missingOperands(other) - missingOperands(typst)),
    },
    ink,
    drift: plain ? drift(...plain) : null,
    colours: compareColours(typst, other, { regions, ink: !scripts }),
  };
};
