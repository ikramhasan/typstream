# nextjs-ai-sdk

A chat whose answers are Typst documents: the Vercel AI SDK's `useChat` streams the model's text, and each text part renders as `<Typstream>` from the `typstream` package (Next.js App Router, Turbopack). The model writes with `@typstream/edu`'s vocabulary for teachers' documents, and the chat around it is built from shadcn/ui's AI Elements.

```bash
pnpm turbo run build --filter=@typstream/example-nextjs-ai-sdk^...   # once: the packages and the engine's wasm
cd examples/nextjs-ai-sdk
pnpm dev        # http://localhost:3000; put ANTHROPIC_API_KEY in .env.local, or it replays a worksheet
pnpm test       # build, start, stream two answers in Chromium (pages, then HTML): no error frames
```

If your shell sets `ANTHROPIC_BASE_URL` (a proxy), the route sends requests there: Next.js doesn't let `.env.local` override a variable that's already set. Start it with `env -u ANTHROPIC_BASE_URL pnpm dev`.

## The integration

One component per text part (`app/page.tsx`):

```tsx
const { messages, status } = useChat();
// for each assistant text part:
<Typstream source={part.text} isStreaming={status === "streaming" && isLastMessage} plugins={[edu]} animated caret />
```

- `source` is the text so far; `<Typstream>` heals each prefix so it compiles, and keeps the last good render while one doesn't.
- When `isStreaming` turns false the document is finished: compiled strictly, without the caret.
- Every answer shares one engine worker, and only visible or streaming answers compile, so a long chat stays cheap.
- `useTypstream()` reads an answer's status, open frames ("writing a table…") and diagnostics, as the footer under each answer shows.
- No Next.js configuration is needed for the engine: its worker, wasm and fonts are assets Turbopack emits. `next.config.ts` only sets the workspace root.

## The prompt

The route (`app/api/chat/route.ts`) asks Claude with edu's prompt kit, `buildSystemPrompt([edu, universe])`: Typst rules that target the mistakes models make, the vocabulary (templates, questions, answers, rubrics, drawings) with each function's signature and example, and example documents. The page renders with the same plugin, so every function the model was told about exists. Measured on 29 requests, it took Claude Sonnet from 3 documents failing to compile to none (`tools/llm-corpus`). The prompt is ~8.4K tokens and the same for every request, so it's marked for Anthropic's prompt cache. Set `TYPSTREAM_MODEL` to use another model.

Without a key, the route replays a worksheet (`app/api/chat/worksheet.ts`) token by token. It's plain Typst written so that every prefix compiles, which the smoke test relies on: it fails on any compile error while streaming, and real model output, kit answers included, has a few at the prefixes where a call is cut.

## The page

- **Suggestions.** One button per thing edu can write (each template, question kind, drawing, the Universe packages, Arabic and Bengali), most of them the requests the prompt kit was measured on. They show in an empty chat and in a row above the field after; **New chat** starts over.
- **Pages or HTML.** Answers render as pages by default (`layout="fit-width"`: as wide as the chat); the header switches to HTML.
- **Show answers.** edu writes answers (filled-in blanks, worked answers, answer keys) only when the document's `showAnswers` input is `"true"`: the switch recompiles every answer as the teacher's copy.
- **Following the answer.** Message Scroller (AI Elements' Chat) keeps the reply in view while you stay at the bottom, and stops when you scroll away. As pages, a streaming answer is cut off just below the line being written: Typst adds a whole page as soon as it starts one, and following the bottom of a blank page would leave the text above the screen.
- **Before the first token** a "Writing…" line shows, and a failed request shows its error with a retry, so nothing is ever silent.
- From an answer's footer: copy its Typst source, **export it as PDF**, or retry it. The PDF comes from the engine document `useTypstream()` returns (`t.document.exportPdf({ inputs })`): compiled in final mode at the document's own page size (fit-width only sizes the preview), with the answers if they're shown. Stop a reply from the send button.
- **Styles.** Tailwind's preflight resets headings, lists and inline SVG, which a Typst document needs as the browser draws them, so `app/globals.css` undoes it inside answers.

`app/telemetry.tsx` wires typstream's events to the console and to `/api/telemetry`, which logs them (see the telemetry guide).
