---
"@typstream/core": minor
"@typstream/engine": minor
"@typstream/dom": minor
"typstream": minor
"@typstream/edu": minor
"@typstream/html-compat": minor
"@typstream/node": patch
---

Plugins load through one system (#27, PLAN §8.0). `resolvePlugins` (core) loads each key once (its last definition), puts every plugin after its dependencies and otherwise keeps the given order, and rejects missing dependencies and cycles; facets it doesn't know are ignored. `createEngine({ plugins })` sends plugins' fonts, packages and fixer modules with `initialize`; `engine.open({ plugins })` applies a document's plugins' files, packages, preambles, heal handlers and lint settings, and fixer modules, which the worker now loads per document (`document/open`'s `fixerModules`; one that fails to load is logged and skipped). Plugins have a `stylesheets` facet, which the HTML renderer, `standaloneHtml` (new `plugins` option) and `mountTypstream` apply: html-compat and edu carry their CSS in it, so `plugins: [htmlCompat]` is enough and `typstream` no longer adds `htmlCompatCss` separately.

Security: the engine server's new `clientFixers` option (default true) decides whether it imports the fixer modules a client names. `@typstream/node`'s protocol server sets it to false: it already treated clients as untrusted for packages, but still imported `initialize`'s `fixerModules`, which let a client run code in the server (a `data:` module URL).
