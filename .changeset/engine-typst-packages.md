---
"@typstream/core": minor
"@typstream/engine": minor
"@typstream/engine-wasm": minor
"@typstream/dom": minor
"@typstream/node": minor
"@typstream/universe": minor
"typstream": minor
---

Typst packages (#25). Documents may `#import "@preview/…"` packages from an allowlist: `initialize.packages`, plus a document's own (`document/open`'s new `packages`, filled from plugins' `engine.packages` by `mountTypstream`).
- **Loading.** Before each compile the engine server scans the preamble and document for package specs. It fetches only allowed packages, checks their integrity, untars them into the document's files under `@ns/name:version/…` keys (engine-wasm roots those at the package), and follows the packages' own imports. Tarballs are kept in Cache Storage, and a package that arrives after the compile stopped waiting compiles the revision again.
- **Versions and errors.** Another version of an allowed package gets the nearest allowed one, with a warning. A missing one is reported as not allowed, still loading or failed to load, and the new `package-stub` fixer binds what it imported to placeholders.
- **Local packages.** Files keyed by a package spec mount a local package, e.g. `@typstream/edu:0.1.0/lib.typ`.
- **Servers.** `ServerOptions.packages` sets a server's own allowlist, registry and cache; `@typstream/node` ignores client package lists.
- **New package.** `@typstream/universe` vendors CeTZ 0.5.3, fletcher 0.5.8, cetz-plot 0.1.4, physica 0.9.8, unify 0.8.1, chemformula 0.1.3 and alchemist 0.2.0 with their dependencies, as an allowlist plugin with prompt rules. `typstream` enables it by default (`packages={false}` turns it off).
