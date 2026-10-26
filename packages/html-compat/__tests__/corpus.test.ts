// Every edu corpus document through the wasm engine with the prelude: it compiles, HTML export
// drops nothing, and its HTML holds the text of its paged output except what is listed below.
import { loadCorpus } from "@typstream/corpus";
import { describe, expect, it } from "vitest";
import { KNOWN_HTML_WARNINGS } from "../src/index";
import { corpusFiles } from "./support/corpus";
import { compileHtml, newEngine } from "./support/engine";
import { pagedText } from "./support/paged";
import { blocksInInline, htmlText, missing } from "./support/text";

const PAGE_NUMBERS = "page numbers (#set page(numbering)): HTML has no pages";
const HEADER = "page header/footer text (#set page(header, footer)): HTML has no pages";
// pdf.js reads these from the PDF's text layer, where they aren't text: a stretched `cases`
// brace is assembled from glyph parts, and Devanagari conjuncts repeat their letters.
const PDF_ARTIFACT = "not in the paged text either: PDF text-layer artifacts";

/** Characters of the paged text the HTML lacks, per document (sorted), and why. Exact: an improvement fails too. */
const KNOWN_GAPS: Record<string, { chars: string; why: string[] }> = {
  "exam-algebra-final": { chars: "123AACCFFIIaaaaaaaabbddddeeeeggiiiillllnnnnnnoorrtt", why: [HEADER, PAGE_NUMBERS] },
  "exam-calculus-midterm": { chars: "12", why: [PAGE_NUMBERS] },
  "exam-history-short-answer": { chars: "12", why: [PAGE_NUMBERS] },
  "exam-physics-mechanics": { chars: "1222", why: [`${PAGE_NUMBERS} ("1 / 2", "2 / 2")`] },
  "lab-report-pendulum": { chars: "1", why: [PAGE_NUMBERS] },
  "lesson-plan-persuasive-writing": {
    chars: "44EEPPUUaaeeeegggghhiiiiiiiiiillnnnnnnrrrrssssssttttuuvvww",
    why: [HEADER],
  },
  "math-linear-algebra": { chars: "12234", why: [PAGE_NUMBERS, PDF_ARTIFACT] },
  "math-statistics-probability": { chars: "12", why: [PAGE_NUMBERS] },
  "multilingual-arabic-rtl-quiz": { chars: "ي", why: [PDF_ARTIFACT] },
  "multilingual-hindi-science": { chars: "वववववववववववववववववव१", why: [PAGE_NUMBERS, PDF_ARTIFACT] },
  "quiz-mcq-geography": { chars: "12", why: [PAGE_NUMBERS] },
  "report-climate-change": { chars: "1112222223333344445566iiiiiiiv", why: [PAGE_NUMBERS, "outline page numbers"] },
  "table-periodic-elements": { chars: "1", why: [PAGE_NUMBERS] },
  "worksheet-linear-equations": {
    chars: "122222AAEEIILLPPUUaaaaaaaabbeeeeeeffggggiiiiiillnnnnnnooooqqrrrrssttttuu",
    why: [HEADER, PAGE_NUMBERS],
  },
  "worksheet-photosynthesis": { chars: "1", why: [PAGE_NUMBERS] },
};

const engine = newEngine();
const entries = loadCorpus({ sets: ["edu"] });

describe("edu corpus in HTML", () => {
  it.each(entries)("$name", async (entry) => {
    const files = corpusFiles(entry);
    const result = compileHtml(engine, entry.source, { files });
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    const allowed = [...KNOWN_HTML_WARNINGS, ...(entry.meta.allowedWarnings ?? [])];
    const unexpected = result.diagnostics.filter((d) => !allowed.some((w) => d.message.includes(w)));
    expect(unexpected.map((d) => d.message)).toEqual([]);
    const lost = missing(await pagedText(entry.source, files), htmlText(result.html ?? ""));
    expect(lost).toBe(KNOWN_GAPS[entry.name]?.chars ?? "");
    expect(blocksInInline(result.html ?? "")).toEqual([]);
  });

  it("lists gaps only for corpus documents", () => {
    const names = new Set(entries.map((e) => e.name));
    expect(Object.keys(KNOWN_GAPS).filter((name) => !names.has(name))).toEqual([]);
  });
});
