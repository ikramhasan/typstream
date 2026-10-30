// The answer switch: with `showAnswers` unset, no answer reaches the output in either target
// (a student's copy can't leak them); with it, every answer is written in place and listed by
// `answer-key()` under its question's number.
import { describe, expect, it } from "vitest";
import { compileHtml, compilePaged, htmlText, newEngine, pagedText, problems } from "./support/engine";

const engine = newEngine();

/** Every answer-bearing function, each answer a unique word. */
const DOCUMENT = `
#question(points: 1)[Fill in: #blank(answer: [Zanzibar])]
#question(points: 2)[Explain. #answer-lines(count: 2, answer: [Quixotic reasons])]
#question(points: 3)[Work it out. #answer-space(answer: [Xylophone working])]
#question[A proof. #answer[Wobbly solution]]
#question[Pick one. #mcq([Kumquat], [Persimmon], answer: 2)]
#question[#true-false(answer: false)[Vexing statement.]]
#question[#matching(([Alpha], [Ypsilon]), ([Beta], [Omicron]))]
#answer[Outside any question: Jabberwock]
#answer-key()
`;

const WRITTEN = ["Zanzibar", "Quixotic", "Xylophone", "Wobbly", "Jabberwock"];

describe("answers", () => {
  const hidden = { paged: compilePaged(engine, DOCUMENT), html: compileHtml(engine, DOCUMENT) };
  const shown = {
    paged: compilePaged(engine, DOCUMENT, { answers: true }),
    html: compileHtml(engine, DOCUMENT, { answers: true }),
  };

  it("compile cleanly", () => {
    for (const out of [hidden.paged, hidden.html, shown.paged, shown.html])
      expect(problems(out.diagnostics)).toEqual([]);
  });

  it("are absent from the student's copy in both targets", () => {
    const texts = [pagedText(hidden.paged), htmlText(hidden.html.html)];
    for (const text of texts) {
      for (const word of WRITTEN) expect(text).not.toContain(word);
      expect(text).not.toContain("Answer key");
      expect(text).not.toContain("Answer:");
    }
    // The questions themselves are there.
    for (const text of texts)
      for (const word of ["Kumquat", "Persimmon", "Vexing", "Alpha", "Ypsilon"]) expect(text).toContain(word);
    for (const marker of ["edu-ink", "edu-correct", "edu-answer", "edu-key"])
      expect(hidden.html.html).not.toContain(marker);
  });

  it("are written in place in the teacher's copy", () => {
    for (const text of [pagedText(shown.paged), htmlText(shown.html.html)]) {
      for (const word of WRITTEN) expect(text).toContain(word);
    }
    // The correct option and the true/false choice are marked, bold in the accent colour, as on pages.
    const accent = (text: string) => new RegExp(`color: #c0392b; font-weight: 700[^>]*>(?:<[^>]+>)*${text}`);
    expect(shown.html.html).toMatch(accent("\\(b\\)"));
    expect(shown.html.html).toMatch(accent("False"));
  });

  it("are listed by answer-key() under their question's number", () => {
    const text = htmlText(shown.html.html).replace(/\s+/g, " ");
    const key = text.slice(text.indexOf("Answer key"));
    expect(key).toContain("Answer key");
    expect(key).toMatch(/1\.\s*Zanzibar/);
    expect(key).toMatch(/2\.\s*Quixotic/);
    expect(key).toMatch(/3\.\s*Xylophone/);
    expect(key).toMatch(/4\.\s*Wobbly/);
    expect(key).toMatch(/5\.\s*b/);
    expect(key).toMatch(/6\.\s*False/);
    expect(key).toMatch(/7\.\s*1–[ab], 2–[ab]/);
    expect(key).toContain("Jabberwock");
    expect(pagedText(shown.paged)).toContain("Answer key");
  });

  it("count towards the template's total", () => {
    const { html } = compileHtml(engine, `#show: quiz.with(title: [Q])\n${DOCUMENT}`);
    expect(htmlText(html)).toContain("Total: 6 points");
  });
});

describe("matching", () => {
  const pairs = [
    ["one", "uno"],
    ["two", "dos"],
    ["three", "tres"],
    ["four", "cuatro"],
    ["five", "cinco"],
  ];
  const source = `#matching(${pairs.map(([l, r]) => `([${l}], [${r}])`).join(", ")})`;
  const { html } = compileHtml(engine, source, { answers: true });
  // Each row: number, left, the answer letter, marker, right: the grid's cells, in order.
  const cells = html
    .split('<div class="ts-cell')
    .slice(1)
    // Without the word joiner that puts a blank on a text line.
    .map((cell) => htmlText(cell.slice(cell.indexOf(">") + 1)).replace(/\u2060/g, "").trim());
  const rows = Array.from({ length: pairs.length }, (_, i) => cells.slice(i * 5, i * 5 + 5));

  it("shuffles the right column and keys every pair to its match", () => {
    expect(rows.map((r) => r[1])).toEqual(pairs.map(([l]) => l));
    const right = new Map(rows.map((r) => [r[3]?.replace(/[()]/g, ""), r[4]]));
    for (const [i, [, match]] of pairs.entries()) expect(right.get(rows[i]?.[2])).toBe(match);
    // Nothing is left beside its own match.
    for (const [i, [, match]] of pairs.entries()) expect(rows[i]?.[4]).not.toBe(match);
  });

  it("shuffles the same way every time", () => {
    expect(compileHtml(engine, source, { answers: true }).html).toBe(html);
  });
});
