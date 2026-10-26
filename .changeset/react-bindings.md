---
"@typstream/react": minor
"typstream": minor
"@typstream/dom": minor
---

The React bindings (#17). `@typstream/react` (new): `<Typstream source isStreaming />` (or `stream`) renders a streaming Typst document as HTML or pages, `TypstreamProvider` sets app-wide defaults (engine, plugins, stylesheets, theme, heal and schedule options), and `useTypstream()` reads an instance's status, diagnostics, healed source and open frames. Instances without an engine share one engine worker per page, disposed a second after the last one unmounts; documents open lazily near the viewport, so only visible or streaming ones compile. `typstream` (new) is the convenience package: the same component with html-compat and the engine's math font set up, plus the engine and healer. `@typstream/dom` adds `mountTypstream(element, options)`, the framework-free controller the bindings wrap.
