// Every function's catalogue example, every template and every prompt example compiles in both
// targets, with answers hidden and shown, without errors or warnings: in HTML none of edu's
// output is dropped ("… was ignored during HTML export"), with html-compat or without it.
import { describe, expect, it } from "vitest";
import { eduCatalogue, eduExamples, eduTemplates } from "../src/index";
import { compileHtml, compilePaged, newEngine, problems } from "./support/engine";

const engine = newEngine();

/** A body for template examples, so they have questions and points to count. */
const BODY = "\n= Part A\n\n#question(points: 2)[What is $2 + 2$? #blank(answer: [4])]\n";

const documents: [string, string][] = [
  ...eduCatalogue.map((d): [string, string] => [
    `catalogue: ${d.name}`,
    (d.example ?? "") + (d.example?.startsWith("#show:") ? BODY : ""),
  ]),
  ...eduTemplates.map((t): [string, string] => [`template spec: ${t.name}`, t.preamble + BODY]),
  ...eduExamples.map((e): [string, string] => [`example: ${e.title}`, e.output]),
];

/**
 * Calls with nothing filled in yet, as a stream can cut them (`#mcq([Paris]` heals to
 * `#mcq([Paris])`, `#number-line(from: 2` to `#number-line(from: 2)`): every parameter has a
 * default, so they render instead of failing the compile.
 */
const EMPTY_CALLS = [
  "#question[]",
  "#question(points: 2)[]",
  "#mcq()",
  "#mcq([Paris])",
  "#mcq([a], [b], answer: 9)",
  '#mcq([a], [b], answer: "z")',
  "#true-false[]",
  '#true-false(answer: "maybe")[x]',
  "#matching()",
  "#matching(([dog]))",
  "#matching(([dog], [perro]), [cat])",
  "#blank()",
  "#answer-lines()",
  "#answer-lines(count: 0)",
  "#answer-space()",
  "#answer[]",
  "#answer-key()",
  "#callout[]",
  '#callout(kind: "unknown")[x]',
  "#instructions[]",
  "#learning-objectives[]",
  "#rubric()",
  "#rubric(([Only a name]))",
  "#rubric(([A], [a]), levels: (), points: none)",
  "#student-info()",
  '#student-info("Anything")',
  "#number-line()",
  "#number-line(from: 5, to: 5)",
  "#number-line(from: 0, to: 1, step: 0)",
  "#number-line(from: 0, to: 1000000)",
  "#graph-paper()",
  "#graph-paper(cols: 0, rows: 100000)",
  "#coordinate-plane()",
  "#coordinate-plane(x: (3, 1))",
  "#coordinate-plane(x: (-1000, 1000), points: ((1,), (1, 2)))",
  '#ce("")',
  '#ce("Fe(OH")',
  '#ce("^ v + -> ->")',
  '#ce("e- + Cu^{2+} -> Cu")',
  // Arrays cut while streaming heal to their first item: `(2` is the number 2, `((1, 2` the pair.
  "#rubric(([A], [a]), points: (2))",
  '#rubric(([A], [a]), levels: ("Good"))',
  "#number-line(points: (2), open-points: (1), marks: ((2, [A])), labels: ((0.5, [half])))",
  "#number-line(marks: ((2,)), labels: ([x]), points: ([y]))",
  "#coordinate-plane(x: (-4), y: (3), points: ((1, 2)))",
  "#coordinate-plane(points: ((1, [a])))",
  '#show: worksheet.with(info: ("name"))\n',
  // Lengths cut before their unit: `5em` arrives as `5`.
  "#blank(width: 5) #answer-lines(spacing: 2) #answer-space(height: 5)",
  "#number-line(length: 10) #graph-paper(step: 5) #coordinate-plane(unit: 7)",
  "#show: worksheet\n",
  "#show: quiz\n",
  "#show: exam\n",
  "#show: lesson-plan\n",
  "#show: handout\n",
];

const variants = [
  { target: "paged", answers: false, compat: false },
  { target: "paged", answers: true, compat: false },
  { target: "html", answers: false, compat: false },
  { target: "html", answers: true, compat: false },
  { target: "html", answers: false, compat: true },
  { target: "html", answers: true, compat: true },
] as const;

const check = (source: string): string[] =>
  variants.flatMap((v) => {
    const out = v.target === "paged" ? compilePaged(engine, source, v) : compileHtml(engine, source, v);
    return problems(out.diagnostics).map(
      (p) => `${v.target}${v.answers ? " answers" : ""}${v.compat ? " compat" : ""}: ${p}`,
    );
  });

describe("compiles without errors or warnings in both targets", () => {
  it.each(documents)("%s", (_, source) => {
    expect(check(source)).toEqual([]);
  });

  it.each(EMPTY_CALLS)("%s", (source) => {
    expect(check(source)).toEqual([]);
  });

  it("templates write pages only in the paged target", () => {
    const source = `#show: exam.with(title: [T])${BODY}#pagebreak()\nMore.`;
    expect(compilePaged(engine, source).pages.length).toBe(2);
    const { html } = compileHtml(engine, source);
    expect(html).toContain('<header class="edu-header">');
    expect(html).toContain("<h1>T</h1>");
  });
});
