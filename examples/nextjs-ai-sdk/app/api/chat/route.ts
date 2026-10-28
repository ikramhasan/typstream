// The chat endpoint. With ANTHROPIC_API_KEY set it asks Claude for a Typst
// document; without one it replays a worksheet token by token, so the
// example (and its smoke test) runs offline. Either way the client sees the
// same UI message stream.
//
// Once there's a document, the page sends it with each request (in the user
// message's metadata), and the model edits it instead of writing a new one:
// @typstream/ai's `editPrompt()` teaches the `<edit>` format, and the request
// goes in with the document as it is now (`editRequest`). The page applies the
// answer's edits as they stream (`createEditSession`).

import { anthropic } from "@ai-sdk/anthropic";
import { editPrompt, editRequest, textOf } from "@typstream/ai";
import { buildSystemPrompt, edu } from "@typstream/edu";
import { googleFonts } from "@typstream/google-fonts";
import { mindmap } from "@typstream/mindmap";
import { universe } from "@typstream/universe";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type SystemModelMessage,
  streamText,
  type UIMessage,
} from "ai";
import { IMAGE_RULES, stopWhen, tools } from "./images";
import { EDIT, WORKSHEET } from "./worksheet";

// Image searches come before the document, so an answer can take longer than one model call.
export const maxDuration = 120;

// edu's prompt kit: Typst rules that target the mistakes models make, the vocabulary (templates,
// questions, answers, rubrics) with each function's signature and example, and example documents.
// The page renders with the same plugins, so every function and font the model is told about exists:
// googleFonts adds rules for naming any Google Fonts family, and mindmap teaches `#mindmap`, which the page shows
// as an interactive map (a render island) over its Typst drawing. Import `universe` from @typstream/universe
// here: the typstream bundle is a client module. It's ~8.6K tokens and the same for every request, so
// it's marked for Anthropic's prompt cache.
const INSTRUCTIONS: SystemModelMessage[] = [
  {
    role: "system",
    content: buildSystemPrompt([edu, universe, googleFonts, mindmap]),
    providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
  },
  // This example's addition, after the measured kit: images from Wikimedia Commons (./images.ts).
  { role: "system", content: IMAGE_RULES },
];

/** In edit mode, after the kit: the `<edit>` format and its rules (measured in tools/llm-corpus, #34). */
const EDITING: SystemModelMessage = { role: "system", content: editPrompt() };

/** What the page sends: the chat, and on a user message, the document it is about. */
export type ChatMetadata = { document?: string };

/** Splits text into token-sized chunks (words and the space before them), as a model streams. */
const tokens = (text: string): string[] => text.match(/\s*\S+|\s+$/g) ?? [];

const replay = (text: string) =>
  createUIMessageStreamResponse({
    stream: createUIMessageStream({
      async execute({ writer }) {
        const id = "answer";
        writer.write({ type: "text-start", id });
        for (const delta of tokens(text)) {
          writer.write({ type: "text-delta", id, delta });
          await new Promise((resolve) => setTimeout(resolve, 8));
        }
        writer.write({ type: "text-end", id });
      },
    }),
  });

export async function POST(request: Request) {
  const { messages }: { messages: UIMessage<ChatMetadata>[] } = await request.json();
  const last = messages[messages.length - 1];
  const document = last?.role === "user" ? last.metadata?.document : undefined;
  if (!process.env.ANTHROPIC_API_KEY) return replay(document === undefined ? WORKSHEET : EDIT);
  // Editing: the last request goes in with the document as it is now. Earlier answers stay as
  // they were written (documents, or edits); the document in the last turn is the one to quote.
  const sent =
    document === undefined
      ? messages
      : messages.map((message) =>
          message === last
            ? {
                ...message,
                parts: [
                  { type: "text" as const, text: editRequest(document, textOf(message)) },
                  ...message.parts.filter((part) => part.type !== "text"),
                ],
              }
            : message,
        );
  const result = streamText({
    model: anthropic(process.env.TYPSTREAM_MODEL ?? "claude-sonnet-5-5"),
    instructions: document === undefined ? INSTRUCTIONS : [...INSTRUCTIONS, EDITING],
    messages: await convertToModelMessages(sent, { tools, ignoreIncompleteToolCalls: true }),
    tools,
    stopWhen,
  });
  return result.toUIMessageStreamResponse();
}
