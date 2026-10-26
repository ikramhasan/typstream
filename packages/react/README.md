# @typstream/react

React bindings for typstream: render Typst streamed from an LLM, live. A thin layer over `@typstream/dom`'s `mountTypstream`. Most apps import the `typstream` package instead, which is this with html-compat and the math font set up.

```tsx
import { Typstream } from "@typstream/react";

<Typstream source={text} isStreaming={status === "streaming"} animated caret />;
```

## `<Typstream>`

The document is `source`, its whole text so far (streamdown-style), or `stream`, an `AsyncIterable<string>` of chunks (create it once, e.g. in `useMemo`: a new stream starts the document over).

| Prop | Default | |
|---|---|---|
| `source` / `stream` | | The document. |
| `isStreaming` | `false` | More `source` is coming. When it turns false the document is finished: compiled strictly (final mode), without the caret. Turning true again starts over (a regenerated answer). Ignored with `stream`, which finishes when it ends. |
| `target` | `"html"` | `"html"` (semantic HTML + MathML) or `"paged"` (SVG pages). Switching keeps the document; the old output stays until the new target's first compile. |
| `layout`, `pageHeight` | `"fixed"`, `"a4"` | Paged only. `"fit-width"` lays pages out as wide as the element. |
| `preamble` | | Typst evaluated before the document, after the plugins' and the template's. |
| `template` | | Name of a template from the plugins' `templates`: its preamble and default `inputs`. |
| `inputs` | | `sys.inputs`, e.g. `{ showAnswers: "true" }` to recompile with answers instead of re-prompting. |
| `files` | | Files the document reads (images, data). |
| `heal` | | `@typstream/heal` options (lint settings, fences). |
| `schedule` | | Compile pacing (`minInterval`, `maxInterval`). |
| `plugins`, `stylesheets` | | Plugins' engine files and preambles, heal handlers, templates and sanitizer allowances; extra CSS for the HTML target. |
| `animated`, `caret` | `false` | Word fade-in (`true` or `AnimateOptions`) and a caret, while streaming (HTML target). |
| `theme` | `"auto"` | HTML target: `"light"`, `"dark"`, or the page's `color-scheme`. |
| `linkTarget`, `textLayer` | `"_blank"`, `true` | External links' `target`; paged text layer (selection, find). |
| `lazy` | `true` | Open and compile only near the viewport, or while streaming. |
| `engine` | shared | An `Engine` from `createEngine()`. Default: one engine worker for the page, shared by every instance. |
| `mathFont` | | URL of New Computer Modern Math, registered as a web font for MathML. |
| `onStatusChange`, `onDiagnostics`, `onRendered` | | `idle` / `compiling` / `stale` / `error` / `done`; diagnostics in `source` coordinates; render telemetry (`@beta`). |
| `className`, `style`, `id`, `ref` | | The host element; `ref` receives a `TypstreamHandle`. |

Not yet: `fallback` (block isolation, PLAN §5.6, beyond the last good render the engine keeps), `islands` (#28), and `engine={{ adapter, fonts, packages }}` options (#11, #25): pass an `Engine` you created instead.

## `TypstreamProvider`

App-wide settings for every `<Typstream>` below it: the same props except the document and callbacks. Lists (`plugins`, `stylesheets`) add up, records (`inputs`, `files`) merge, and anything else an instance sets wins. Without an `engine`, the provider keeps the page's shared engine alive while it is mounted, so the worker survives answers coming and going.

```tsx
<TypstreamProvider plugins={[edu]} theme="dark" heal={{ lint: { "currency-dollar": "warn" } }}>
  <App />
</TypstreamProvider>
```

## `useTypstream()`

```tsx
const t = useTypstream();
<Typstream ref={t.ref} source={text} isStreaming />;
t.status; // "idle" until the document opens
t.diagnostics; t.healedSource; t.openFrames; // e.g. "writing a table…"
t.document; // the EngineDocument, for exports (#18)
```

React refs don't announce when they're set, so the hook hands out a callback ref rather than reading yours.

## Behaviour

- **One worker, many documents.** Instances without an `engine` share one; it is created on first use and terminated a second after the last instance (or provider) unmounts. Compiles run one at a time across documents.
- **Only visible or streaming documents compile.** A document opens when its element comes within one screen of the viewport, or as soon as it streams; offscreen, finished ones apply prop changes when they scroll back.
- **StrictMode-safe.** The mount follows the component's lifetime; StrictMode's second mount opens a fresh document and the first is disposed. Unmounting disposes the document.
- **Server rendering.** The component renders an empty `<div>` on the server and starts in the browser. The bundle is marked `"use client"`.

## Tests

- `pnpm test`: configuration merging and the shared engine's lifetime, in Node.
- `pnpm test:browser`: `<Typstream>` with React Testing Library against the real engine worker in Chromium, Firefox and WebKit (`BROWSERS=chromium` runs one).
- `pnpm size`: ≤ 15.5 KB gzipped with `@typstream/dom` (React and the engine external).
