---
"@typstream/engine": minor
---

New built-in fixer, `hoist-import` (exported as `hoistImport` from `@typstream/engine/server`, priority 25). Models sometimes write a package's import below the code that uses it: a helper on CeTZ above `#import "@preview/cetz:0.5.3"`, or `#unit(…)` in a template's arguments above unify's import. A Typst function only sees what exists where it is defined, so the name was unknown wherever it was called, and the fallback replaced that block with an error box. Now the import moves to the document's start and the document renders. Only an import that binds the failing name outright (bare, `as`, items) at the top level moves; wildcard imports don't. While streaming, only a settled import moves; in final mode the error is still reported, since the source doesn't compile as written.
