// @typstream/edu: the Typst vocabulary for teachers' documents (PLAN §8.3, #23). The Typst side
// is a package of functions and templates (typst/); every function has an HTML branch, so
// documents look right in both targets. The browser side is a stylesheet for that HTML
// (css/edu.css). This module packages both as a typstream plugin, with the prompt catalogue
// generated from the package's doc comments.
import type { EditorComponentSpec, FunctionDoc, PromptExample, TemplateSpec, TypstreamPlugin } from "@typstream/core";
import { CATALOGUE, CSS_SOURCE, EXAMPLES, FILES } from "./assets.generated";

export { buildSystemPrompt, type SystemPromptOptions, typstPromptRules } from "./prompt";

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
  "The edu functions are already imported. Never write an `#import` for them. Packages are not: write the `#import` line of every package you use (cetz, physica, unify, …) right after the template line.",
  "Wrap every numbered question in `#question(points: n)[...]`; never number questions by hand. Write sub-parts as a numbered list (`+ ...`) inside the question.",
  "Give every answer to edu, never as plain text: `answer:` on `blank`, `mcq`, `true-false`, `answer-lines` and `answer-space`, and `#answer[...]` for worked solutions. Answers are hidden in the student's copy and shown in the teacher's.",
  "Use `#blank()` for fill-in blanks, `#answer-lines(count: n)` for written answers and `#answer-space(height: ...)` for working space. Never draw blanks with underscores, not even in example sentences. A blank inside a formula goes in the math: `$2/3 = #blank(answer: [4])/6$`, never one formula split in two around it.",
  "Multiple choice: `#mcq([option], [option], ..., answer: n)` with n counting from 1. Matching: `#matching((left, right), ...)` with the pairs correctly matched; edu shuffles the right column.",
  'Write chemical formulas and equations with `#ce("2H2 + O2 -> 2H2O")`. Use Typst math for mathematics.',
  "Use `#columns(2)[...]` for two flowing columns and `#grid(columns: 2, ...)` for side-by-side content.",
  "Put boxed text in edu's components (`#callout`, `#instructions`). Never give a `block`, `box` or `rect` rounded corners (`radius`) and never rotate text: a Word export keeps those only as pictures.",
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

const content = (name: string, label: string, help?: string) => ({
  name,
  label,
  type: "content" as const,
  ...(help && { help }),
});

/**
 * edu's components as the visual editor offers them (#36): in its insert menu, with a form for
 * their arguments. Their text (a question's body, a callout's, the options of a multiple choice)
 * is edited on the page.
 * @beta
 */
export const eduComponents: EditorComponentSpec[] = [
  {
    name: "question",
    label: "Question",
    description: "A numbered question with its points",
    group: "Questions",
    icon: "circle-help",
    keywords: ["exercise", "problem", "points"],
    template: "#question(points: 1)[\n  {{cursor}}Question text\n]",
    params: [{ name: "points", label: "Points", type: "number", min: 0, step: 0.5, help: "Empty: no points shown." }],
  },
  {
    name: "mcq",
    label: "Multiple choice",
    description: "Options to choose from, one correct",
    group: "Questions",
    icon: "list-checks",
    keywords: ["choice", "options", "quiz"],
    template: "#mcq([First option], [Second option], [Third option], answer: 1)",
    params: [
      {
        name: "answer",
        label: "Correct option",
        type: "number",
        min: 1,
        step: 1,
        help: "1 is the first option. Shown in the answer key only.",
      },
      { name: "columns", label: "Columns", type: "number", min: 1, max: 6, step: 1, help: "Empty: as many as fit." },
    ],
  },
  {
    name: "true-false",
    label: "True or false",
    description: "A statement to mark true or false",
    group: "Questions",
    icon: "circle-help",
    template: "#true-false(answer: true)[{{cursor}}The statement]",
    params: [
      {
        name: "answer",
        label: "Answer",
        type: "choice",
        options: [
          { value: "true", label: "True" },
          { value: "false", label: "False" },
        ],
      },
    ],
  },
  {
    name: "blank",
    label: "Blank",
    description: "A gap in the text to fill in",
    group: "Answers",
    icon: "text-cursor-input",
    inline: true,
    keywords: ["gap", "fill in", "cloze"],
    template: "#blank(answer: [answer])",
    params: [
      content("answer", "Answer", "Shown in the answer key only."),
      { name: "width", label: "Width", type: "length", default: "4em" },
    ],
  },
  {
    name: "answer-lines",
    label: "Answer lines",
    description: "Ruled lines to write the answer on",
    group: "Answers",
    icon: "notebook-pen",
    template: "#answer-lines(count: 3)",
    params: [
      { name: "count", label: "Lines", type: "number", min: 1, max: 30, step: 1, default: "3" },
      content("answer", "Answer", "Shown in the answer key only."),
    ],
  },
  {
    name: "answer-space",
    label: "Answer space",
    description: "Empty room to work in",
    group: "Answers",
    icon: "square",
    template: "#answer-space(height: 4em)",
    params: [
      { name: "height", label: "Height", type: "length", default: "4em" },
      { name: "boxed", label: "Framed", type: "boolean", default: "false" },
      content("answer", "Answer", "Shown in the answer key only."),
    ],
  },
  {
    name: "answer",
    label: "Answer",
    description: "A worked answer, in the answer key only",
    group: "Answers",
    icon: "book-open-check",
    template: "#answer[{{cursor}}The answer]",
  },
  {
    name: "callout",
    label: "Callout",
    description: "A note, tip, warning or definition in a box",
    group: "Blocks",
    icon: "info",
    keywords: ["note", "tip", "warning", "definition", "box"],
    template: '#callout(kind: "note")[{{cursor}}Something to note.]',
    params: [
      {
        name: "kind",
        label: "Kind",
        type: "choice",
        default: '"note"',
        options: ["note", "tip", "warning", "definition", "example", "remember"].map((k) => ({
          value: `"${k}"`,
          label: k[0]?.toUpperCase() + k.slice(1),
        })),
      },
      content("title", "Title", "Empty: the kind's name."),
    ],
  },
  {
    name: "instructions",
    label: "Instructions",
    description: "Instructions for students, in a box",
    group: "Blocks",
    icon: "clipboard-list",
    template: "#instructions[{{cursor}}Answer all questions.]",
  },
  {
    name: "learning-objectives",
    label: "Learning objectives",
    description: "What students will learn",
    group: "Blocks",
    icon: "list-checks",
    template: "#learning-objectives[\n  - {{cursor}}First objective\n]",
  },
  {
    name: "student-info",
    label: "Student fields",
    description: "Name, class and date to fill in",
    group: "Blocks",
    icon: "pen-line",
    template: "#student-info()",
  },
  {
    name: "rubric",
    label: "Rubric",
    description: "Criteria and levels in a table",
    group: "Blocks",
    icon: "table",
    template:
      "#rubric(\n  ([Content], [Complete and accurate], [Mostly accurate], [Some errors], [Missing]),\n  ([Presentation], [Clear], [Mostly clear], [Unclear], [Missing]),\n)",
  },
  {
    name: "number-line",
    label: "Number line",
    description: "A number line with ticks and labels",
    group: "Drawings",
    icon: "minus",
    template: "#number-line(from: 0, to: 10)",
    params: [
      { name: "from", label: "From", type: "number", default: "0" },
      { name: "to", label: "To", type: "number", default: "10" },
      { name: "step", label: "Step", type: "number", default: "1", min: 0 },
      { name: "length", label: "Length", type: "length", default: "12cm" },
    ],
  },
  {
    name: "graph-paper",
    label: "Graph paper",
    description: "A grid to draw on",
    group: "Drawings",
    icon: "table",
    template: "#graph-paper(cols: 30, rows: 10)",
    params: [
      { name: "cols", label: "Columns", type: "number", default: "30", min: 1, step: 1 },
      { name: "rows", label: "Rows", type: "number", default: "10", min: 1, step: 1 },
    ],
  },
  {
    name: "coordinate-plane",
    label: "Coordinate plane",
    description: "Axes and a grid",
    group: "Drawings",
    icon: "plus",
    template: "#coordinate-plane()",
    params: [
      { name: "unit", label: "Unit", type: "length", default: "7mm" },
      { name: "grid", label: "Grid", type: "boolean", default: "true" },
      { name: "labels", label: "Labels", type: "boolean", default: "true" },
    ],
  },
];

/**
 * edu as a typstream plugin: its files and preamble for the engine, templates, prompt kit, the
 * classes the sanitizer keeps, its stylesheet for the HTML renderer and standalone exports, and
 * its components for the visual editor.
 */
export const edu: TypstreamPlugin = {
  key: "edu",
  version: EDU_VERSION,
  engine: { files: eduFiles, preamble: eduPreamble },
  templates: eduTemplates,
  prompt: { catalogue: eduCatalogue, rules: eduPromptRules, examples: eduExamples },
  sanitize: { allowClasses: ["edu-*"] },
  stylesheets: [eduCss],
  editor: { components: eduComponents, inline: ["blank", "ce"] },
};
