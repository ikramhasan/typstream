// The chat endpoint. With ANTHROPIC_API_KEY set it asks Claude for a Typst
// document; without one it replays a worksheet token by token, so the
// example (and its smoke test) runs offline. Either way the client sees the
// same UI message stream.

import { anthropic } from "@ai-sdk/anthropic";
import { buildSystemPrompt, edu } from "@typstream/edu";
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
import { WORKSHEET } from "./worksheet";

// Image searches come before the document, so an answer can take longer than one model call.
export const maxDuration = 120;

// edu's prompt kit: Typst rules that target the mistakes models make, the vocabulary (templates,
// questions, answers, rubrics) with each function's signature and example, and example documents.
// The page renders with the same plugin, so every function the model is told about exists. Import
// `universe` from @typstream/universe here: the typstream bundle is a client module. It's ~8.4K tokens
// and the same for every request, so it's marked for Anthropic's prompt cache.
const INSTRUCTIONS: SystemModelMessage[] = [
  {
    role: "system",
    content: buildSystemPrompt([edu, universe]),
    providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
  },
  // This example's addition, after the measured kit: images from Wikimedia Commons (./images.ts).
  { role: "system", content: IMAGE_RULES },
];

/** Splits text into token-sized chunks (words and the space before them), as a model streams. */
const tokens = (text: string): string[] => text.match(/\s*\S+|\s+$/g) ?? [];

const replay = () =>
  createUIMessageStreamResponse({
    stream: createUIMessageStream({
      async execute({ writer }) {
        const id = "worksheet";
        writer.write({ type: "text-start", id });
        for (const delta of tokens(WORKSHEET)) {
          writer.write({ type: "text-delta", id, delta });
          await new Promise((resolve) => setTimeout(resolve, 8));
        }
        writer.write({ type: "text-end", id });
      },
    }),
  });

export async function POST(request: Request) {
  const { messages }: { messages: UIMessage[] } = await request.json();
  if (!process.env.ANTHROPIC_API_KEY) return replay();
  const result = streamText({
    model: anthropic(process.env.TYPSTREAM_MODEL ?? "claude-sonnet-5-5"),
    instructions: INSTRUCTIONS,
    messages: await convertToModelMessages(messages, { tools, ignoreIncompleteToolCalls: true }),
    tools,
    stopWhen,
  });
  return result.toUIMessageStreamResponse();
}
