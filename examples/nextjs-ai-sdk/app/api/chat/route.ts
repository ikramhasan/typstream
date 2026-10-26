// The chat endpoint. With ANTHROPIC_API_KEY set it asks Claude for a Typst
// document; without one it replays a recorded worksheet token by token, so the
// example (and its smoke test) runs offline. Either way the client sees the
// same UI message stream.

import { anthropic } from "@ai-sdk/anthropic";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type UIMessage,
} from "ai";
import { WORKSHEET } from "./worksheet";

export const maxDuration = 60;

const INSTRUCTIONS = `You write educational documents (worksheets, quizzes, handouts) in Typst 0.15 markup.
Reply with the Typst source only: no Markdown, no code fences, no commentary before or after.
- Headings are "= Title", "== Section"; *bold*, _italic_; "- " bullets and "+ " numbered items.
- Math goes between dollar signs: $a^2 + b^2 = c^2$, with a space inside for display math: $ x = 1/2 $.
- Tables: #table(columns: 3, [Header], [Header], [Header], [cell], [cell], [cell]).
- Write a literal dollar sign, hash or at sign as \\$, \\#, \\@.
- Leave room for answers with #v(2em) or #line(length: 100%).`;

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
    messages: await convertToModelMessages(messages),
  });
  return result.toUIMessageStreamResponse();
}
