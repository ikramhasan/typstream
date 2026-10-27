# nextjs-ai-sdk

A chat whose answers are Typst documents: the Vercel AI SDK's `useChat` streams the model's answers, and each one renders as `<Typstream>` from the `typstream` package, with `@typstream/ai` reading the document from the message (Next.js App Router, Turbopack).

```bash
pnpm --filter @typstream/example-nextjs-ai-sdk^... build   # once: the packages and the engine's wasm
cd examples/nextjs-ai-sdk
ANTHROPIC_API_KEY=… pnpm dev          # without a key, the server replays a recorded worksheet
pnpm test                             # build, start, stream one answer in Chromium: no error frames
```

The whole integration is one component per answer (`app/page.tsx`):

```tsx
const chat = useChat();
// for each assistant message:
<Typstream source={textOf(message)} isStreaming={isStreaming(message, chat)} animated caret />
```

- `source` is the text so far; `<Typstream>` heals each prefix so it compiles, and keeps the last good render while one doesn't.
- When `isStreaming` turns false the document is finished: compiled strictly, without the caret. That's when the answer's text ends, or when it stops early (the user stops it, the network fails), which the message's own part state doesn't say.
- Every answer shares one engine worker, and only visible or streaming answers compile, so a long chat stays cheap.
- `useTypstream()` reads an answer's status, open frames ("writing a table…") and diagnostics, as the footer under each answer shows.
- No Next.js configuration is needed for the engine: its worker, wasm and fonts are assets Turbopack emits. `next.config.ts` only sets the workspace root.

The server route (`app/api/chat/route.ts`) asks Claude for Typst with short instructions (no Markdown, no fences, how to escape `$`, `#` and `@`). Set `TYPSTREAM_MODEL` to use another model.
