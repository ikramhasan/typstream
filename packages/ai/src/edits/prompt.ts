// Prompting a model to edit a document (#34). The system prompt is the app's
// own, built for writing documents (`buildSystemPrompt(plugins)`, edu's kit),
// plus `editPrompt()`: the edit format and its rules. Rules change only with a
// measured `tools/llm-corpus` run under a new label, as the kit's do.

import type { Range } from "@typstream/core";
import type { EditResult } from "./session";

/**
 * The rules of the edit format, one per entry: what {@link editPrompt} lists.
 * @beta
 */
export const editPromptRules: readonly string[] = [
  "To change the document, write one `<edit>` per change: `<edit><old>` the exact text you replace `</old><new>` its replacement `</new></edit>`. Outside the tags, write one or two plain sentences for the teacher saying what you changed.",
  "Copy the old text character for character from the latest version of the document you have, with its line breaks and indentation. Quote enough of it to match one place only.",
  "To rewrite a question, a section or a paragraph, quote all of it and write all of its new version. To change a few words, quote the line they are in.",
  "To add something, quote the question or paragraph it goes after, and write it again followed by a blank line and the new part. To delete something, quote it and leave `<new></new>` empty.",
  "Write the edits in the order their old text appears in the document. They must not overlap: one edit per part.",
  "The tags aren't part of the document. Inside `<new>`, write Typst as the document does, with the same functions and style, and without code fences.",
  "Change only what was asked. Keep everything else, numbering included: questions number themselves.",
  "If you can't tell which part the teacher means, ask instead of editing, with no tags.",
];

/**
 * The edit format and its rules, for the end of a system prompt that already
 * teaches the model the document's Typst (such as `buildSystemPrompt(plugins)`).
 * The model's answers are then read by {@link createEditSession}.
 * @beta
 */
export const editPrompt = (): string =>
  [
    "# Editing the document",
    "",
    "The teacher asks you to change the document they are working on. You don't write it again: you write edits, which are applied to it as you write them.",
    "",
    ...editPromptRules.map((rule) => `- ${rule}`),
    "",
    "For example:",
    "",
    "Question 2 now asks for the sum of two two-digit numbers.",
    "<edit>",
    "<old>",
    "#question(points: 1)[What is $3 + 4$?]",
    "</old>",
    "<new>",
    "#question(points: 2)[What is $37 + 48$?]",
    "</new>",
    "</edit>",
  ].join("\n");

/**
 * The user turn of an edit request: the current document, then the teacher's
 * request. Send it with {@link editPrompt} in the system prompt.
 * @beta
 */
export const editRequest = (document: string, request: string): string =>
  `The document as it is now:\n\n<document>\n${document}\n</document>\n\n${request}`;

/**
 * The user turn of a selection edit: the document with the part to rewrite
 * marked, and the instruction. `range` is the part ({@link blockRange} of the
 * teacher's highlight). The model answers with the new text of that part only,
 * as plain Typst: give its answer to {@link EditSession.write}.
 * @beta
 */
export const selectionRequest = (document: string, range: Range, instruction: string): string =>
  [
    "The document as it is now, with the part to rewrite between <selection> and </selection>:",
    "",
    "<document>",
    `${document.slice(0, range.from)}<selection>${document.slice(range.from, range.to)}</selection>${document.slice(range.to)}`,
    "</document>",
    "",
    `Rewrite the selected part: ${instruction}`,
    "",
    "Answer with its new text only, as Typst written as the document is, with nothing before or after it, no code fences and no tags.",
  ].join("\n");

const REASONS: Record<string, string> = {
  "not-found": "its <old> text isn't in the document",
  ambiguous: "its <old> text appears more than once in the document; quote more of it",
  overlap: "it changes text that an earlier edit of yours changed",
  conflict: "the teacher edited that text while you were writing",
  malformed: "it isn't written as <edit><old>…</old><new>…</new></edit>",
  incomplete: "your answer ended before it did",
};

/**
 * What to tell the model about the edits that failed, to send back as the next
 * user turn so it can try again (with the document as it is now); `null` when
 * every edit applied.
 * @beta
 */
export const editFeedback = (edits: readonly EditResult[]): string | null => {
  const failed = edits.flatMap((edit, i) =>
    edit.status === "failed" && edit.error ? [`- Edit ${i + 1}: ${REASONS[edit.error]}.`] : [],
  );
  if (!failed.length) return null;
  return [
    `${failed.length === 1 ? "One of your edits wasn't" : `${failed.length} of your edits weren't`} applied:`,
    ...failed,
    "The others were. Write the ones that failed again, quoting the document as it is now.",
  ].join("\n");
};
