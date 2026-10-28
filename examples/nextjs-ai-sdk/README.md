# nextjs-ai-sdk

A chat whose answers are Typst documents: the Vercel AI SDK's `useChat` streams the model's answers, and each one renders as `<Typstream>` from the `typstream` package, with `@typstream/ai` saying whether it is still being written (Next.js App Router, Turbopack). The model writes with `@typstream/edu`'s vocabulary for teachers' documents, and the chat around it is built from shadcn/ui's AI Elements.

```bash
pnpm turbo run build --filter=@typstream/example-nextjs-ai-sdk^...   # once: the packages and the engine's wasm
cd examples/nextjs-ai-sdk
pnpm dev        # http://localhost:3000; put ANTHROPIC_API_KEY in .env.local, or it replays a worksheet
pnpm test       # build, start, stream two answers in Chromium (pages, then HTML): no error frames
```

If your shell sets `ANTHROPIC_BASE_URL` (a proxy), the route sends requests there: Next.js doesn't let `.env.local` override a variable that's already set. Start it with `env -u ANTHROPIC_BASE_URL pnpm dev`.

## The integration

One component per answer (`app/page.tsx`):

```tsx
const chat = useChat();
// for each assistant message:
<Typstream source={textOf(message)} isStreaming={isStreaming(message, chat)} plugins={[edu]} animated caret />
```

The page's `documentOf(message)` is `textOf` of the parts after the last image search: what the model says before a search
isn't the document.

- `source` is the text so far; `<Typstream>` heals each prefix so it compiles, and keeps the last good render while one doesn't.
- When `isStreaming` turns false the document is finished: compiled strictly, without the caret. That's when the answer ends with its text complete, or when it stops early (the user stops it, the network fails), which the message's own part state doesn't say. While an image search runs, the answer is still streaming: more text follows it.
- Every answer shares one engine worker, and only visible or streaming answers compile, so a long chat stays cheap.
- `useTypstream()` reads an answer's status, open frames ("writing a table…") and diagnostics, as the footer under each answer shows.
- No Next.js configuration is needed for the engine: its worker, wasm and fonts are assets Turbopack emits. `next.config.ts` only sets the workspace root.

## The prompt

The route (`app/api/chat/route.ts`) asks Claude with edu's prompt kit, `buildSystemPrompt([edu, universe, googleFonts, mindmap])`: Typst rules that target the mistakes models make, the vocabulary (templates, questions, answers, rubrics, drawings) with each function's signature and example, example documents, how to name a font, and how to write a mind map. Mind maps (`@typstream/mindmap`) are interactive in the HTML target: the page passes `islands={mindmapIslands}`, and React Flow, which draws them, loads the first time an answer has one; pages show the map's Typst drawing. The page renders with the same plugins, so every function and font the model was told about exists. Measured on 29 requests (without the font rules), it took Claude Sonnet from 3 documents failing to compile to none (`tools/llm-corpus`). The prompt is ~8.6K tokens and the same for every request, so it's marked for Anthropic's prompt cache. Set `TYPSTREAM_MODEL` to use another model.

Without a key, the route replays a worksheet (`app/api/chat/worksheet.ts`) token by token. It's plain Typst written so that every prefix compiles, which the smoke test relies on: it fails on any compile error while streaming, and real model output, kit answers included, has a few at the prefixes where a call is cut.

## Images

Typst reads images only from the document's files, and a model can't know a real image URL, so the route gives it a tool: `searchImages` (`app/api/chat/images.ts`) searches [Wikimedia Commons](https://commons.wikimedia.org), whose images are freely licensed, and returns each image's URL (resized to 960 px), size, description, author and license. A short addition to edu's prompt tells the model when to search (pictures, photos, real things; a diagram it can draw is better drawn), to search before writing anything, to use only the URLs it got, and to credit each image in its figure's caption. `streamText` runs up to five steps, searches then the document.

The page fetches the images itself: `fetchImages({ hosts: ["thumb.wikimedia.org", "upload.wikimedia.org"] })` as `<Typstream resolveImage>`. Both hosts send CORS headers, so no proxy is needed, and no other host is allowed: a model can be steered into writing an image URL that carries what it read to someone else's server. While an image downloads, typstream shows a placeholder, and both exports include the images (the HTML file as `data:` URLs). Each search shows above the answer ("Searching Wikimedia Commons for …", then what it found).

Commons needs no API key. The route identifies itself with a `User-Agent`, as Wikimedia asks, which allows 200 requests a minute.

## Fonts

`@typstream/google-fonts` lets an answer use any [Google Fonts](https://fonts.google.com) family by name (`#set text(font: "Lora")`). Its plugin is in the page's `plugins`, and its prompt rules are in the route's prompt (exact names, one or two families, and which families stand in for Arial, Times New Roman and Calibri). The first time an answer names a family the engine doesn't have, the worker fetches the catalogue's index (465 KB, an asset Turbopack emits), downloads the family's files from `cdn.jsdelivr.net` and compiles the answer again. Pages draw it, and in HTML the text shows in web fonts made from the same files. A family loads once for every answer. Both exports have it too.

## The page

- **Suggestions.** One button per thing edu can write (each template, question kind, drawing, the Universe packages, Arabic and Bengali, a font), most of them the requests the prompt kit was measured on. They show in an empty chat and in a row above the field after; **New chat** starts over.
- **Pages or HTML.** Answers render as pages by default (`layout="fit-width"`: the document's pages, scaled to the chat's width); the header switches to HTML.
- **Show answers.** edu writes answers (filled-in blanks, worked answers, answer keys) only when the document's `showAnswers` input is `"true"`: the switch recompiles every answer as the teacher's copy.
- **Following the answer.** Message Scroller (AI Elements' Chat) keeps the reply in view while you stay at the bottom, and stops when you scroll away. As pages, a streaming answer is cut off just below the line being written: Typst adds a whole page as soon as it starts one, and following the bottom of a blank page would leave the text above the screen.
- **Before the first token** a "Writing…" line shows, and a failed request shows its error with a retry, so nothing is ever silent.
- From an answer's footer: **copy** it, **export** it, or retry it, in the view's form. As pages, copy takes its Typst source and export downloads a PDF (`useTypstream().exportPdf()`, the same pages the preview shows). As HTML, both take the file `useTypstream().exportHtml()` makes, with edu's CSS, the theme and the fonts, which opens on its own. Exports compile in final mode with the component's `inputs`, so the answers are in them if they're shown. Stop a reply from the send button.
- **Styles.** Tailwind's preflight resets headings, lists and inline SVG, which a Typst document needs as the browser draws them, so `app/globals.css` undoes it inside answers.

`app/telemetry.tsx` wires typstream's events to the console and to `/api/telemetry`, which logs them (see the telemetry guide).
