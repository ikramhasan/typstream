// The prompts the harness compares. `naive` is what an app writes without the kit: the
// instructions examples/nextjs-ai-sdk had before it used the kit, plain Typst with no vocabulary. `kit` is edu's prompt
// kit as the code has it now (buildSystemPrompt over edu and universe), compiled with edu's
// preamble. Each recorded run keeps the exact system prompt it used (runs/<label>/system.md),
// so labels such as kit-v1 and kit-v2 stay comparable after the kit changes.
import { editPrompt } from "@typstream/ai";
import { buildSystemPrompt, edu } from "@typstream/edu";
import { universe } from "@typstream/universe";

const NAIVE = `You write educational documents (worksheets, quizzes, handouts) in Typst 0.15 markup.
Reply with the Typst source only: no Markdown, no code fences, no commentary before or after.
- Headings are "= Title", "== Section"; *bold*, _italic_; "- " bullets and "+ " numbered items.
- Math goes between dollar signs: $a^2 + b^2 = c^2$, with a space inside for display math: $ x = 1/2 $.
- Tables: #table(columns: 3, [Header], [Header], [Header], [cell], [cell], [cell]).
- Write a literal dollar sign, hash or at sign as \\$, \\#, \\@.
- Leave room for answers with #v(2em) or #line(length: 100%).`;

/**
 * @typedef {{ system: string, plugins: string[] }} Variant
 * `plugins` are the corpus `plugins` the documents compile with (meta.json): `edu` puts edu's
 * files and preamble on the document.
 */

/** @type {Record<string, () => Variant>} */
export const VARIANTS = {
  naive: () => ({ system: NAIVE, plugins: [] }),
  kit: () => ({ system: buildSystemPrompt([edu, universe]), plugins: ["edu"] }),
};

/**
 * The prompts for edit requests (#34). Both start from the kit's prompt. `edit-quote`: the
 * teacher asks in chat; the system prompt adds `editPrompt()`, the user turn holds the document
 * (`editRequest`), and the model answers with `<edit>` tags. `edit-selection`: the teacher
 * highlighted the part; the user turn marks it (`selectionRequest`), and the model answers with
 * its new text only.
 * @type {Record<string, () => Variant & { edits: "quote" | "selection" }>}
 */
export const EDIT_VARIANTS = {
  "edit-quote": () => ({ system: `${buildSystemPrompt([edu, universe])}\n\n${editPrompt()}`, plugins: ["edu"], edits: "quote" }),
  "edit-selection": () => ({ system: buildSystemPrompt([edu, universe]), plugins: ["edu"], edits: "selection" }),
};
