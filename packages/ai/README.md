# @typstream/ai

typstream with the [Vercel AI SDK](https://ai-sdk.dev). When a model answers in Typst, an assistant message is a
document: this package reads its text and whether more of it is coming, which is what `<Typstream>` takes as `source`
and `isStreaming`. When the model changes a document that exists, its answer is a set of edits that quote what they
replace, and the edit session applies them to the document as they stream.

```sh
npm install @typstream/ai typstream
```

It reads AI SDK messages by their shape and imports nothing from `ai`, so it adds no dependency; it works with AI SDK 5
and later and is tested against AI SDK 7.

## An answer as a document

```tsx
"use client";

import { useChat } from "@ai-sdk/react";
import { isStreaming, textOf } from "@typstream/ai";
import { Typstream } from "typstream";

export default function Chat() {
  const chat = useChat();
  return chat.messages.map((message) =>
    message.role === "user" ? (
      <p key={message.id}>{textOf(message)}</p>
    ) : (
      <Typstream key={message.id} source={textOf(message)} isStreaming={isStreaming(message, chat)} animated caret />
    ),
  );
}
```

- **`textOf(message)`**: the message's text parts, joined. Reasoning, tool, file, source and data parts aren't part of
  the document.
- **`isStreaming(message, chat)`**: true while the chat is answering with this message and its last text part hasn't
  ended. It reads the chat's `status` as well as the part's `state`, because an answer stopped early (the stop button,
  a network failure) leaves its text part `"streaming"`: read from the part alone, the document would never finish.
- **`textStream(snapshots)`**: a message's text as chunks, from the snapshots `readUIMessageStream` yields, for
  `mountTypstream`'s `stream` without React.

The model still needs to be told to answer in Typst: `buildSystemPrompt` from `@typstream/edu` writes that prompt for
teachers' documents.

## Streaming edits

```ts
import { createEditSession, editPrompt, editRequest, textOf } from "@typstream/ai";
import { buildSystemPrompt, edu } from "@typstream/edu";

// System prompt: the document's vocabulary, then the edit format.
const system = `${buildSystemPrompt([edu])}\n\n${editPrompt()}`;
// User turn: the document as it is now, then the request.
const prompt = editRequest(worksheet, "Make question 3 harder.");

const session = createEditSession(worksheet); // one per answer
session.subscribe((state) => render(state)); // state.text, state.streamingRange, state.streaming, state.phase
// As the answer streams:
session.update(textOf(answer), done);
// When state.phase is "review":
session.keep(); // or session.undo()
```

Show `state.text` in `<Typstream>` with `streamingRange={state.streamingRange}` and `isStreaming={state.streaming}`:
the part being rewritten changes in place while the rest of the document stays. An edit whose quote matches nowhere,
or more than one place, fails and is reported in `state.edits`; `editFeedback(edits)` says what to tell the model so it
writes them again. `selectionRequest` and `session.write(range, replacement, done)` rewrite a selected part instead.
`userEdit` takes the teacher's own edits while the session is open, and `abort` rolls back the edit being written.

The lower-level pieces are exported too: `parseEdits` reads an answer's `<edit>`s as far as they have arrived,
`findQuote` finds where a quote matches a document, and `blockRange` / `blockStarts` give the top-level blocks a range
touches. The edit prompt (`editPrompt`, `editPromptRules`, `editRequest`, `selectionRequest`, `editFeedback`) is beta:
its rules change only with a new measured run against real models.

Docs: [reference](https://typstream.vercel.app/docs/reference/ai),
[Streaming edits](https://typstream.vercel.app/docs/guides/streaming-edits),
[Next.js and the AI SDK](https://typstream.vercel.app/docs/getting-started/nextjs-ai-sdk).

## License

MIT
