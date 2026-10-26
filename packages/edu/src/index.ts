// @typstream/edu: the Typst vocabulary for teachers' documents (PLAN §8.3, #23). The Typst side
// is a package of functions and templates (typst/); every function has an HTML branch, so
// documents look right in both targets. The browser side is a stylesheet for that HTML
// (css/edu.css). This module packages both as a typstream plugin, with the prompt catalogue
// generated from the package's doc comments.
import type { FunctionDoc, PromptExample, TemplateSpec, TypstreamPlugin } from "@typstream/core";
import { CATALOGUE, CSS_SOURCE, EXAMPLES, FILES } from "./assets.generated";

/** The Typst package's version, as in its `typst.toml`. */
export const EDU_VERSION = "0.1.0";

/**
 * The package spec edu's files are mounted under: `${EDU_ROOT}/lib.typ` and so on. The engine
 * roots keys of the form `@ns/name:x.y.z/path` at that package (#25), so it is a local package,
 * read from the files the plugin mounts; nothing is fetched and it needs no allowlist entry.
 */
export const EDU_ROOT = "@typstream/edu:0.1.0";

/** The input that shows answers: set it to `"true"` and recompile for a teacher's copy. */
export const SHOW_ANSWERS_INPUT = "showAnswers";

/** edu's Typst sources and `typst.toml`, keyed by their path in the engine (under {@link EDU_ROOT}). */
export const eduFiles: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(FILES).map(([name, source]) => [`${EDU_ROOT}/${name}`, source]),
);

/** Typst to put before a document: imports every public function and template. */
export const eduPreamble: string = `#import "${EDU_ROOT}": *\n`;

/**
 * Styles for the HTML edu's functions write. Rules are scoped to the renderer's root (class
 * `typstream`) with zero specificity, and follow its theme variables, so dark mode works.
 * Without them the HTML keeps its content and structure but loses answer lines and boxes.
 */
export const eduCss: string = CSS_SOURCE;

/** One entry per public function and template, from the doc comments in `typst/`. */
export const eduCatalogue: FunctionDoc[] = CATALOGUE;

/** Whole documents in edu's vocabulary (English, chemistry, Arabic, Bengali), for few-shot prompts. */
export const eduExamples: PromptExample[] = EXAMPLES;

/**
 * How to write documents with edu, for the system prompt. #24 measures and tunes these with
 * real models; this is the starting set.
 */
export const eduPromptRules: string[] = [
  'Start the document with one template line, e.g. `#show: worksheet.with(title: [...], subject: [...], grade: [...])`. Templates: worksheet, quiz, exam, lesson-plan, handout. For Arabic or Bengali pass `lang: "ar"` or `lang: "bn"` to the template.',
  "The edu functions are already imported. Never write an `#import` for them.",
  "Wrap every numbered question in `#question(points: n)[...]`; never number questions by hand. Write sub-parts as a numbered list (`+ ...`) inside the question.",
  "Give every answer to edu, never as plain text: `answer:` on `blank`, `mcq`, `true-false`, `answer-lines` and `answer-space`, and `#answer[...]` for worked solutions. Answers are hidden in the student's copy and shown in the teacher's.",
  "Use `#blank()` for fill-in blanks, `#answer-lines(count: n)` for written answers and `#answer-space(height: ...)` for working space. Never draw blanks with underscores.",
  "Multiple choice: `#mcq([option], [option], ..., answer: n)` with n counting from 1. Matching: `#matching((left, right), ...)` with the pairs correctly matched; edu shuffles the right column.",
  'Write chemical formulas and equations with `#ce("2H2 + O2 -> 2H2O")`. Use Typst math for mathematics.',
  "Use `#columns(2)[...]` for two flowing columns and `#grid(columns: 2, ...)` for side-by-side content.",
  "Add `#answer-key()` at the end when the teacher asks for an answer key; it lists every answer by question and appears only in the teacher's copy.",
];

/**
 * Templates by name, for apps that let the teacher pick the document type and ask the model for
 * the body only. A document that applies its own template (`#show: worksheet.with(...)`, the
 * prompt's default) must not also get one of these: the template would apply twice.
 */
export const eduTemplates: TemplateSpec[] = (
  [
    ["worksheet", "Worksheet", "Title, subject and grade, and name, date and class lines."],
    ["quiz", "Quiz", "A worksheet with the total of the questions' points."],
    ["exam", "Exam", "Duration and total points, student fields, an instructions box and a running header."],
    ["lesson-plan", "Lesson plan", "A table of subject, grade, duration, date and teacher; no student fields."],
    ["handout", "Handout", "Title and subtitle, with no student fields."],
  ] as const
).map(([name, title, description]) => ({ name, title, description, preamble: `#show: ${name}\n` }));

/** edu as a typstream plugin: its files and preamble for the engine, templates and prompt kit. */
export const edu: TypstreamPlugin = {
  key: "edu",
  version: EDU_VERSION,
  engine: { files: eduFiles, preamble: eduPreamble },
  templates: eduTemplates,
  prompt: { catalogue: eduCatalogue, rules: eduPromptRules, examples: eduExamples },
};
