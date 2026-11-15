# @typstream/universe

## 0.1.2

### Patch Changes

- @typstream/core@0.2.0

## 0.1.1

### Patch Changes

- 3e5b205: Published with npm provenance, through trusted publishing: each version on npm now carries a signed statement of the GitHub Actions run and commit that built it (0.1.0 has none). No code changes.
- Updated dependencies [3e5b205]
  - @typstream/core@0.1.1

## 0.1.0

### Minor Changes

- 8184b0f: Typst packages (#25). Documents may `#import "@preview/…"` packages from an allowlist: `initialize.packages`, plus a document's own (`document/open`'s new `packages`, filled from plugins' `engine.packages` by `mountTypstream`).
  - **Loading.** Before each compile the engine server scans the preamble and document for package specs. It fetches only allowed packages, checks their integrity, untars them into the document's files under `@ns/name:version/…` keys (engine-wasm roots those at the package), and follows the packages' own imports. Tarballs are kept in Cache Storage, and a package that arrives after the compile stopped waiting compiles the revision again.
  - **Versions and errors.** Another version of an allowed package gets the nearest allowed one, with a warning. A missing one is reported as not allowed, still loading or failed to load, and the new `package-stub` fixer binds what it imported to placeholders.
  - **Local packages.** Files keyed by a package spec mount a local package, e.g. `@typstream/edu:0.1.0/lib.typ`.
  - **Servers.** `ServerOptions.packages` sets a server's own allowlist, registry and cache; `@typstream/node` ignores client package lists.
  - **New package.** `@typstream/universe` vendors CeTZ 0.5.3, fletcher 0.5.8, cetz-plot 0.1.4, physica 0.9.8, unify 0.8.1, chemformula 0.1.3 and alchemist 0.2.0 with their dependencies, as an allowlist plugin with prompt rules. `typstream` enables it by default (`packages={false}` turns it off).

### Patch Changes

- 813029f: A first render sooner on a cold start. The engine's workers share the compiled engine: the first one compiles the wasm and posts the module to the page, and the spare, replacements and other engines' workers start from it instead of downloading and compiling 20 MB again. The spare starts once the active worker has answered a compile, so it no longer competes with the first one (or at once when a spare takes over). `PackageSpec.imports` lists the packages a package imports, fetched alongside it rather than once it is unpacked; universe lists them (CeTZ's oxifmt). `engineWasm({ wasm })` also takes a function, called when the worker initializes.
- fdb250d: Prompt kit measured on real models (#24). `@typstream/edu`: `buildSystemPrompt(plugins)` writes the system prompt from the plugins' rules, catalogue and examples, and `typstPromptRules` adds the Typst habits models get wrong (scripts without a base, multi-letter math names, bare math as arguments, `*/` and `/ ` in markup, imports for packages); `mcq`'s example shows math options. `@typstream/heal`: new `math-lone-script` lint fix (`m/s$^2$` → `m/s$""^2$`), and `currency-dollar` no longer warns on math such as `$0.4 times 0.3 =$` or `$30 degree$`. `@typstream/universe`: CeTZ's prompt line shows its own shapes.
- Updated dependencies [3e66075]
- Updated dependencies [12ea537]
- Updated dependencies [ba56f2e]
- Updated dependencies [ec38329]
- Updated dependencies [69f1477]
- Updated dependencies [b4d7bed]
- Updated dependencies [813029f]
- Updated dependencies [cbb44d9]
- Updated dependencies [ba77608]
- Updated dependencies [41ae15f]
- Updated dependencies [4ad0ae1]
- Updated dependencies [8184b0f]
- Updated dependencies [466147c]
- Updated dependencies [893bbb1]
- Updated dependencies [d54927d]
- Updated dependencies [60c1567]
- Updated dependencies [8d2f1c5]
- Updated dependencies [e6c5a7b]
- Updated dependencies [3a11cdc]
- Updated dependencies [5275321]
- Updated dependencies [c620668]
- Updated dependencies [0d1c1c3]
  - @typstream/core@0.1.0
