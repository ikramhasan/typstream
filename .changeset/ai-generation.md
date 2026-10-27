---
"@typstream/ai": minor
---

New package, `@typstream/ai`: typstream with the Vercel AI SDK. An assistant message is a Typst document: `textOf(message)` is its text (text parts only) and `isStreaming(message, chat)` says whether more is coming, for `<Typstream source isStreaming>` with `useChat`. `isStreaming` finishes an answer that stopped early (`stop()`, a network error), whose text part the AI SDK leaves `"streaming"`, and keeps earlier answers finished while a new one streams. `textStream(snapshots)` turns `readUIMessageStream`'s snapshots into the chunks `mountTypstream`'s `stream` reads, for apps without React. It reads AI SDK messages by their shape (AI SDK 5 and later, tested on 7) and doesn't depend on `ai`.
