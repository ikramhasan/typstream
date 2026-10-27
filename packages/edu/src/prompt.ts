// The prompt kit (PLAN §8.3, #24): one system prompt from the prompt facets of the plugins an app
// uses (edu's catalogue, rules and examples; universe's package list). The catalogue is generated
// from edu's doc comments, so the prompt can't drift from the functions the engine mounts.
//
// #24 measured what models get wrong with and without it (tools/llm-corpus); the rules here are
// the ones that moved the error rate. Keep them short: each one costs tokens on every request.
import type { FunctionDoc, PromptExample, TypstreamPlugin } from "@typstream/core";

/**
 * Typst habits models get wrong whatever the vocabulary: Markdown syntax, characters that start
 * code or math, and how a reply is framed. The first group of the system prompt.
 * @beta
 */
export const typstPromptRules: string[] = [
  "Reply with the Typst document only. No Markdown code fence around it, and nothing before or after it.",
  'This is Typst, not Markdown: `= Heading`, `*bold*`, `_italic_`, `- item`, `+ numbered item`, `#link("https://…")[text]`. `*` and `_` only work around whole words; inside a word write `walk#strong[ed]`.',
  // The most common error in #24's baseline: units and formulas with a lone `$^2$` or `$_2$`.
  'A superscript or subscript needs its base inside the same `$…$`, so units go in the math with their number: `$9.8 "m/s"^2$`, `$25 "cm"^2$`, `$x_1$`. `m/s$^2$`, `cm$^2$` and `H$_2$O` fail to compile; write chemistry with `#ce`.',
  'In math, a name of two or more letters is a variable or symbol, and unknown ones fail. Use `<=`, `>=`, `!=`, `times`, `dot`, `div`; put spaces between single letters (`$(d y)/(d x)$`, `$2 x y$`); quote words and units (`$"area" = l w$`).',
  "Arguments of a function call are code: give text and math as content in brackets, `f([$6$ cm], [Name])`, never bare `f($6$ cm)`.",
  // `*/` ends a block comment and `/ ` starts a term list, even inside `*bold*` or a table cell.
  "Escape characters you mean literally: `\\$` (money), `\\#`, `\\@` (emails), `\\*`, `\\_`, and a `/` that follows `*` or starts a line or cell (`*\\/16*`, `[\\/ 10]`).",
];

/**
 * Options for {@link buildSystemPrompt}.
 * @beta
 */
export interface SystemPromptOptions {
  /** Include the plugins' few-shot examples. Default true. */
  examples?: boolean;
  /** Replaces {@link typstPromptRules}. */
  typstRules?: readonly string[];
}

const INTRO =
  "You write documents for teachers (worksheets, quizzes, exams, lesson plans, handouts, rubrics) in Typst 0.15 markup. The document is rendered while you write it.";

const bullets = (rules: readonly string[]): string => rules.map((r) => `- ${r}`).join("\n");

const entry = (doc: FunctionDoc): string =>
  [`### ${doc.name}`, `\`${doc.signature}\``, doc.description, doc.example ? `Example:\n${doc.example}` : ""]
    .filter(Boolean)
    .join("\n");

const example = (e: PromptExample): string =>
  `<example>\n${e.request ? `<request>${e.request}</request>\n` : ""}<document>\n${e.output.trim()}\n</document>\n</example>`;

/**
 * The system prompt for documents in the plugins' vocabulary: Typst rules, then each plugin's
 * rules and function catalogue, then their examples. Deterministic for the same plugins, so the
 * prompt caches.
 * @beta
 */
export const buildSystemPrompt = (plugins: readonly TypstreamPlugin[], options: SystemPromptOptions = {}): string => {
  const { examples = true, typstRules = typstPromptRules } = options;
  const sections = [INTRO, `## Typst\n${bullets(typstRules)}`];
  for (const plugin of plugins) {
    const { rules = [], catalogue = [] } = plugin.prompt ?? {};
    if (rules.length) sections.push(`## Rules (${plugin.key})\n${bullets(rules)}`);
    if (catalogue.length) sections.push(`## Functions (${plugin.key})\n\n${catalogue.map(entry).join("\n\n")}`);
  }
  const shots = examples ? plugins.flatMap((p) => p.prompt?.examples ?? []) : [];
  if (shots.length) sections.push(`## Examples\n\n${shots.map(example).join("\n\n")}`);
  return `${sections.join("\n\n")}\n`;
};
