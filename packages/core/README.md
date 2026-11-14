# @typstream/core

The contracts every typstream package shares: text edits and position mapping, the `Diagnostic` shape, the plugin
contract (`TypstreamPlugin`), the telemetry events, and the protocol between the engine client and its worker. Types
plus a few small pure helpers; no dependencies, runs anywhere. All offsets are UTF-16 code unit indices (JavaScript
string indices).

```sh
npm install @typstream/core
```

You rarely install it on its own: the packages you use re-export the types you need. Import from it directly when you
write a plugin, handle diagnostics, or implement an engine transport or server.

## Plugins

A plugin is a plain object with a key and optional facets; each package reads only the facets it understands.
`definePlugin` type-checks one and keeps its literal type:

```ts
import { definePlugin } from "@typstream/core";

export const acme = definePlugin({
  key: "acme/branding",
  engine: { preamble: '#set text(font: "Libertinus Serif", size: 11pt)' },
  templates: [{ name: "letter", title: "Letter", preamble: '#set page(paper: "us-letter")' }],
  prompt: { rules: ["Start every document with a level-1 heading."] },
  stylesheets: [".typstream h1 { color: #0b5394; }"],
});
```

Pass it in `plugins` to `<Typstream>`, `mountTypstream` or `engine.open()`. The facets: `heal` (`HealHandler`s and
lint overrides), `engine` (files, a preamble, allowed packages, fonts, and `DiagnosticFixer` and `FileGenerator`
modules for the worker), `templates` (`TemplateSpec`s), `prompt` (a function catalogue, rules and examples for the
model), `sanitize` and `stylesheets` (the HTML renderer), and `islands` (render islands, beta). `resolvePlugins` orders
a list of plugins by their dependencies.

## Text edits and positions

```ts
import { applyEdit, diffEdit, mapPosition, SourceMap } from "@typstream/core";

const edit = diffEdit("Hello world", "Hello, world"); // { from: 5, to: 5, insert: "," }
applyEdit("Hello world", edit!); // "Hello, world"
mapPosition(6, edit!); // 7: a cursor after "Hello " moves past the comma
```

A `TextEdit` replaces `[from, to)` with `insert`. `SourceMap` maps positions both ways between a transform's input
and output, built from its `Patch`es; heal's result has one, so positions in healed source map back to the raw stream.

## Diagnostics

Problems from the compiler, the healer and the fixers all come as a `Diagnostic` (`severity`, `span`, `message`,
`hints`, `trace`, `source`), with spans in UTF-16 offsets into the document. `formatDiagnostic` writes one as plain
text, `mapDiagnostic` carries one through a position mapping (healed source to input, or one revision to the next),
`normalizeDiagnostics` sorts and deduplicates a list, and `lineColumn`, `isError` and `hasErrors` help read them.

## Telemetry events and the protocol

`DocumentEvent` (`CompiledEvent`, `FallbackEvent`, `WatchdogEvent`, `DiagnosticsEvent`) and `RenderedEvent` are what
the engine and the renderers report; the library sends nothing anywhere. `RequestMap` and the message types describe
the protocol between the engine client and its worker (LSP-shaped requests and notifications, `PROTOCOL_VERSION`),
and `serializeMessage` / `deserializeMessage` carry them over a WebSocket as JSON, bytes as base64.

Docs: [reference](https://typstream.vercel.app/docs/reference/core),
[Writing a plugin](https://typstream.vercel.app/docs/guides/writing-a-plugin),
[Remote engine](https://typstream.vercel.app/docs/guides/remote-engine).

## License

MIT
