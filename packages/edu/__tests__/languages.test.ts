// The launch languages (#1): English, Arabic (right to left) and Bengali. edu's own words and
// option letters follow the document's language, and in Arabic its HTML carries dir="rtl" so
// grids and logical CSS properties flip.
import { describe, expect, it } from "vitest";
import { compileHtml, compilePaged, htmlText, newEngine, pagedText, problems } from "./support/engine";

const engine = newEngine();

const body = `
#question(points: 2)[#mcq([x], [y], [z], answer: 2)]
#question(points: 1)[#true-false(answer: true)[s]]
#callout(kind: "definition")[d]
`;

const doc = (lang: string) => `#show: worksheet.with(lang: "${lang}", title: [T])\n${body}`;

describe("languages", () => {
  // Combining marks (Bengali's virama, U+09CD) are written as escapes: CLAUDE.md, Gotchas.
  it.each([
    ["en", ["Name:", "Date:", "Class:", "(a)", "(b)", "(c)", "2 points", "1 point", "True", "False", "Definition"]],
    ["ar", ["الاسم:", "التاريخ:", "الفصل:", "(أ)", "(ب)", "(ج)", "درجتان", "درجة واحدة", "صح", "خطأ", "تعريف"]],
    [
      "bn",
      [
        "নাম:",
        "তারিখ:",
        "শ\u09cdরেণি:",
        "(ক)",
        "(খ)",
        "(গ)",
        "2 নম\u09cdবর",
        "1 নম\u09cdবর",
        "সত\u09cdয",
        "মিথ\u09cdযা",
        "সংজ\u09cdঞা",
      ],
    ],
  ])("%s: labels, option letters and points in the document's language", (lang, words) => {
    const html = compileHtml(engine, doc(lang));
    expect(problems(html.diagnostics)).toEqual([]);
    const text = htmlText(html.html).replace(/\s+/g, " ");
    for (const word of words) expect(text).toContain(word);
  });

  it("marks edu's HTML right to left in Arabic, and only there", () => {
    const ar = compileHtml(engine, doc("ar")).html;
    for (const cls of ["edu-header", "edu-question", "edu-mcq", "edu-tf", "edu-callout"]) {
      expect(ar).toMatch(
        new RegExp(`<[a-z]+ class="${cls}[^"]*"[^>]* dir="rtl"|<[a-z]+ [^>]*dir="rtl"[^>]* class="${cls}`),
      );
    }
    expect(compileHtml(engine, doc("en")).html).not.toContain('dir="rtl"');
    expect(compileHtml(engine, doc("bn")).html).not.toContain('dir="rtl"');
  });

  it("keeps question numbers in Western digits (A7 on #23)", () => {
    for (const lang of ["ar", "bn"]) expect(htmlText(compileHtml(engine, doc(lang)).html)).toMatch(/\b1\.\s.*\b2\./s);
  });

  it("applies the language to the title block too, set through the template", () => {
    // `#set text(lang: …)` after the template line would leave the header in English.
    const paged = compilePaged(engine, doc("bn"));
    expect(problems(paged.diagnostics)).toEqual([]);
    expect(pagedText(paged)).toContain("নাম:");
  });
});
