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
    // The correct option and the true/false choice are marked.
    expect(shown.html.html).toMatch(/<li class="edu-correct"><span class="edu-marker">\(b\)<\/span> Persimmon<\/li>/);
    expect(shown.html.html).toMatch(/<span class="edu-choice edu-correct">False<\/span>/);
  });

  it("are listed by answer-key() under their question's number", () => {
    const section = shown.html.html.slice(shown.html.html.indexOf('class="edu-key"'));
    const key = htmlText(section);
    expect(key).toContain("Answer key");
    // One paragraph per question.
    const lines = [...section.matchAll(/<p>(.*?)<\/p>/g)].map((m) =>
      htmlText(m[1] ?? "")
        .replace(/\s+/g, " ")
        .trim(),
    );
    const line = (n: number): string => lines.find((l) => l.startsWith(`${n}.`)) ?? "";
    expect(line(1)).toContain("Zanzibar");
    expect(line(2)).toContain("Quixotic");
    expect(line(3)).toContain("Xylophone");
    expect(line(4)).toContain("Wobbly");
    expect(line(5)).toMatch(/5\.\s*b/);
    expect(line(6)).toMatch(/6\.\s*False/);
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
  // Each row: number, left, the answer letter, marker, right.
  const cells = [...html.matchAll(/<span(?: class="([^"]*)")?>(.*?)<\/span>(?=<span|<\/div>)/g)].map((m) =>
    htmlText(m[2] ?? "").trim(),
  );
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
