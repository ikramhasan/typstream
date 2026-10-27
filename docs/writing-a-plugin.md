# Writing a typstream plugin

A plugin is one plain object with a `key` and any of a set of optional **facets**. Each typstream package reads the
facets it understands and ignores the rest, so a plugin written for the renderer keeps working when new packages (the
editor) add facets of their own. `@typstream/html-compat`, `@typstream/universe` and `@typstream/edu` are plugins; so are
a school's branded templates or a chemistry pack.

```ts
import { definePlugin } from "@typstream/core";

export const chemistry = definePlugin({
  key: "acme/chemistry", // unique; namespace third-party keys
  version: "1.0.0",
  dependencies: ["edu"], // keys of plugins that must load too, before this one
  engine: {
    files: { "@acme/chemistry:1.0.0/lib.typ": LIB, "@acme/chemistry:1.0.0/typst.toml": TOML },
    preamble: '#import "@acme/chemistry:1.0.0": *',
  },
  stylesheets: [CSS],
});
```

`definePlugin` only type-checks the literal; a plugin needs no runtime from typstream.

## Using plugins

```tsx
// React: on a provider (every document below it) or on one <Typstream>.
<TypstreamProvider plugins={[edu, chemistry]}>…</TypstreamProvider>

// Without a framework.
mountTypstream(element, { engine, source, plugins: [edu, chemistry] });

// The engine alone (Node, a custom renderer).
const doc = engine.open({ plugins: [edu, chemistry] });
```

`typstream`'s `<Typstream>` adds `htmlCompat` and `universe` before the plugins you give it (turn them off with
`htmlCompat={false}` and `packages={false}`).

**Order.** Plugins load in the order given, except that a plugin always comes after its dependencies: a dependency
listed later moves up to just before the first plugin that needs it. Order matters where facets add up: preambles run in
that order, a later plugin's file replaces an earlier one's at the same path, and later stylesheets come later in the
cascade.

**Duplicates.** A key given more than once loads once, as its last definition, at the place of its first. A provider's
plugin can be overridden by a component's with the same key.

**Errors.** A dependency that isn't among the plugins, or a cycle, throws when the document opens (`resolvePlugins`
from `@typstream/core` does the resolution, if you want to check a list yourself).

## Facets

| Facet | Read by | What it does |
|---|---|---|
| `heal.handlers` | heal (main thread) | `HealHandler`s: product-specific fixes on settled text (`settled`) or on the healed source (`output`). The only facet that holds functions. |
| `heal.lint` | heal | Overrides built-in lint rules by id: `{ "currency-dollar": "fix" }`. Later plugins and the document's own `heal.lint` win. |
| `engine.files` | engine | Files mounted for every document. Keys of the form `@ns/name:x.y.z/path` make a local Typst package, importable with no download. |
| `engine.preamble` | engine | Typst evaluated before the document, after earlier plugins' preambles and before a template's and the app's. |
| `engine.packages` | engine | Typst Universe packages the document may import (an allowlist entry: name, version, URL, integrity). Fetched only when imported. |
| `engine.fixerModules` | engine worker | ES module URLs whose default export is a `DiagnosticFixer` or an array of them (PLAN §8.2). Loaded inside the worker, once per URL. |
| `engine.fonts` | engine worker | Fonts for the engine. Worker-wide: see below. |
| `templates` | dom, react | Named document setups (`template="worksheet"`): a preamble and default `sys.inputs`. A later plugin's template replaces an earlier one's of the same name. |
| `sanitize` | dom | Extra tags and attributes the HTML sanitizer lets through. Scripts, event handlers and URL-loading attributes stay blocked whatever a plugin says. |
| `stylesheets` | dom | CSS for the HTML your Typst writes, injected next to the renderer's and included in standalone HTML exports. |
| `prompt` | your app, `@typstream/ai` | The function catalogue, rules and few-shot examples to tell the model about your Typst API. |
| `islands` | (#28) | Interactive components the renderer swaps in for Typst markers. Reserved; not rendered yet. |
| `editor` | (future editor) | Reserved; typed loosely so plugins can fill it in early. |

### What runs where

Everything except `heal.handlers` is plain data. The `engine` facet is posted to the worker, which can't receive
functions, so it must stay structured-clonable: code that runs in the worker is referenced by URL
(`engine.fixerModules`).

A document's plugins bring their files, packages, preamble, heal handlers and lint settings, and their fixer modules,
which the worker loads for that document only. A fixer module that fails to load is logged (an engine `log` event) and
the document compiles without it.

Fonts belong to the worker, not to a document: give a plugin with `engine.fonts` to the engine itself.

```ts
const engine = createEngine({ spawn: engineWorker(), plugins: [bengali] }); // fonts, packages, fixer modules
<TypstreamProvider engine={engine} plugins={[bengali]}>…</TypstreamProvider>
```

The engine's plugins' fonts, packages and fixer modules are sent with `initialize`, so every worker (including
replacements after a watchdog restart) has them. A document whose plugin brings fonts the engine doesn't have logs a
warning once per plugin.

## Writing the Typst side

- **Mount it as a local package** (`@acme/chemistry:1.0.0/…` keys with a `typst.toml`), so documents and exported
  sources can `#import` it by name and the same files work with native `typst --package-path`.
- **Expect cut-off input.** The model's output is compiled after every token. Give every parameter a default, and accept
  what a stream cut leaves (`(2` arrives as `2`, `5em` as `5`): see `@typstream/edu` for patterns.
- **Branch on the target** with `context target()` where the HTML and paged output should differ, and write semantic
  HTML with classes your `stylesheets` style. Scope rules to the renderer's root and keep their specificity at zero, so
  apps can override them: `:where(.typstream .acme-formula) { … }`. Follow the theme's custom properties
  (`--typstream-foreground`, `--typstream-muted`, …) so dark mode works.
- **Allow only what you write.** If your HTML needs a tag or attribute the sanitizer drops, list exactly those in
  `sanitize`.

## Writing a fixer module

```js
// fixers.js, served by your app. Default export: a fixer or an array of them.
export default {
  name: "acme/unknown-as-text", // `#foo` with no `foo` defined: write the word
  match: /^unknown variable: (\w+)$/,
  fix: (d, ctx) => (d.span ? [{ from: d.span.from - 1, to: d.span.to, insert: ctx.text.slice(d.span.from, d.span.to) }] : null),
};
```

```ts
const chemistry = definePlugin({ key: "acme/chemistry", engine: { fixerModules: [new URL("./fixers.js", import.meta.url).href] } });
```

`fix` returns edits against `ctx.text` (the document without its preamble), or `null`. Fixers run after a failed compile,
by `priority` (default 50; the built-in `pending-ref` runs at 10 and the catch-all `tail-cut` at 100); `modes` limits
one to `streaming` or `final` compiles. A fixer that throws is skipped.

## Testing a plugin

Open a document with your plugin on a real engine and check what it renders, as typstream's own contract tests do
(`packages/engine/__tests__/plugins.test.ts`, `packages/dom/__tests__/browser/mount.test.ts`). In Node,
`@typstream/engine/server`'s `inProcess` runs the worker on the calling thread.
