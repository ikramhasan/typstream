// One export against Typst's PDF: what tools/docx-check reports for each corpus document (#131–#134) and the
// conformance suite asserts for each plugin example (#135).
import { compareInk } from "./ink.mjs";
import { compare, linesOf, mathOf, pageCount, scriptLinesOf, sharedChars, textFaces, textLinesOf } from "./lines.mjs";
import { compareRegions } from "./pixels.mjs";

/** Letters of scripts whose PDF text can't be compared as written (#134): their lines are `scriptLinesOf`'s. */
export const OTHER_SCRIPT =
  /[\u0590-\u08ff\u0900-\u0dff\u0e00-\u109f\u1780-\u17ff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;

/**
 * Typst's PDF and another layout's of the DOCX exported from `model` (its pictures say where text is outlines):
 * - `lines`, `same`, `pageStarts`, `pageStartsSame`, `first` (lines.mjs's `compare`): by text, by the text around
 *   equations when it has some (each engine sets math its own way, #132), or as `scriptLinesOf` reads them (`scripts`);
 * - `pages`: both page counts;
 * - `pictures`: each picture's pixels (pixels.mjs);
 * - `math`: how many of the equations' letters and digits came out (`chars`, `same`), when it has equations;
 * - `ink`: the largest cluster of differing pixels in what pages draw besides text and pictures (ink.mjs), on the
 *   pages both have; none with equations, which each engine sets taller or shorter, moving what follows.
 */
export const compareExport = (typst, other, model, { scripts = false } = {}) => {
  const regions = model.pictures ?? [];
  const math = JSON.stringify(model.sections).includes('"math":[');
  const lines = scripts
    ? compare(scriptLinesOf(typst, regions), scriptLinesOf(other))
    : math
      ? compare(textLinesOf(typst, undefined, regions), textLinesOf(other, textFaces(typst)))
      : compare(linesOf(typst, regions), linesOf(other));
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
    math: chars && { chars: chars[0].length, same: sharedChars(chars[0], chars[1]) },
    ink,
  };
};
