# @typstream/universe

The [Typst Universe](https://typst.app/universe) packages typstream allows by default, vendored with their integrity hashes (PLAN.md §6.4, #25). It answers #1's "diagrams, chemistry, math":

| For | Package | Import |
|---|---|---|
| Diagrams | `@preview/cetz:0.5.3` | `#import "@preview/cetz:0.5.3"` |
| Diagrams | `@preview/fletcher:0.5.8` | `#import "@preview/fletcher:0.5.8": diagram, node, edge` |
| Math | `@preview/cetz-plot:0.1.4` | `#import "@preview/cetz-plot:0.1.4": plot` |
| Math | `@preview/physica:0.9.8` | `#import "@preview/physica:0.9.8": *` |
| Math | `@preview/unify:0.8.1` | `#import "@preview/unify:0.8.1": num, qty, unit` |
| Chemistry | `@preview/chemformula:0.1.3` | `#import "@preview/chemformula:0.1.3": ch` |
| Chemistry | `@preview/alchemist:0.2.0` | `#import "@preview/alchemist:0.2.0": *` |

Their dependencies come too, pinned as the packages pin them: cetz 0.5.2 and 0.3.4 and oxifmt 1.0.0 and 0.2.1.

```ts
import { universe, UNIVERSE_PACKAGES } from "@typstream/universe";

// As a plugin: the engine's allowlist (engine.packages) and prompt rules (prompt.rules).
<Typstream source={text} plugins={[universe]} />;
// Or engine-wide:
createEngine({ spawn: engineWorker(), initialize: { packages: [...UNIVERSE_PACKAGES] } });
```

`typstream`'s `<Typstream>` adds the plugin by default (`packages={false}` turns it off).

- **Tarballs.** `vendor/` holds the `.tar.gz` files exactly as packages.typst.org serves them. Each `url` is a `new URL("../vendor/…", import.meta.url)`, which bundlers emit as an asset. The engine fetches one from your origin only when a document imports it, and keeps it in Cache Storage after that.
- **Integrity.** `integrity` is the SHA-256 of the uncompressed tar, so it holds even when a server sends the `.gz` with `Content-Encoding: gzip` (Vite's dev server does) and the browser hands over the tar.
- **CeTZ needs Typst's wasm plugins.** It calls its `cetz-core` plugin for geometry, so the engine keeps plugin support.
- **HTML target.** With `@typstream/html-compat`, CeTZ canvases become inline SVG. fletcher diagrams stay empty in HTML (a known gap, listed in html-compat's README) and render in paged output.

## Licenses

Each tarball carries its package's own license, unmodified:
- **LGPL-3.0-or-later:** cetz and cetz-plot.
- **MIT:** fletcher, physica, unify, chemformula and alchemist.
- **oxifmt:** MIT OR Apache-2.0 (1.0.0) and MIT-0 (0.2.1).

An app that can't ship LGPL code can leave this plugin out and pass its own allowlist.

## Updating

Adding or updating a package:

1. `node scripts/vendor.mjs name:version` downloads it and prints its integrity.
2. Add it to `src/index.ts` with its dependencies. The tests list any imported package that is missing.
3. `node scripts/vendor.mjs --check` compares every tarball with upstream.
