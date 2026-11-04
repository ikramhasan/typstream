---
"@typstream/core": patch
"@typstream/engine": patch
"@typstream/universe": patch
---

A first render sooner on a cold start. The engine's workers share the compiled engine: the first one compiles the wasm and posts the module to the page, and the spare, replacements and other engines' workers start from it instead of downloading and compiling 20 MB again. The spare starts once the active worker has answered a compile, so it no longer competes with the first one (or at once when a spare takes over). `PackageSpec.imports` lists the packages a package imports, fetched alongside it rather than once it is unpacked; universe lists them (CeTZ's oxifmt). `engineWasm({ wasm })` also takes a function, called when the worker initializes.
