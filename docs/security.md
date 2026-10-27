# Security

Typstream renders Typst that a language model writes. Treat that text as untrusted
code: a model can be wrong, and a prompt can be injected through anything it reads
(a pasted article, a student's answer, a web page). This page explains what a
hostile document can and can't do to a page that shows it, what holds that line,
and how to serve typstream under a strict Content-Security-Policy.

The design is in PLAN.md §9. The tests that check every claim below are listed at
the end.

## Threat model

**Attacker.** Whoever controls the document text: the model, or someone steering it.
A typstream server (`@typstream/node`) faces a second attacker: any client that can
reach it.

**What they want.**

- To run script in the host page's origin: steal its session, act as the user.
- To make the browser fetch something: track the reader, leak data in a URL, probe
  the app's own origin.
- To read files the app didn't mean to show: other documents' files, the app's static
  files, the server's disk.
- To take the page down: hang the tab, exhaust memory, crash the worker for good.
- To deceive the reader: links to other schemes, content that covers the app's own
  interface.

**Where the document goes.** Text → the healer (main thread) → the engine worker
(Typst compiled to WebAssembly) → an artifact (HTML, or page SVGs) → the renderer
(DOM). Each step is a boundary below.

## Defences

### The engine's world: no files, no network, no host

Typst sees a virtual file system that the app fills. It holds the document, its
preamble, the files the app passes (`files`), and the packages the app allows. There
is no network, no environment and no clock beyond the date, and `#read`, `#image`,
`#json`, `#xml`, `#plugin` and imports resolve inside that file system only:

| A document tries | What happens |
|---|---|
| `#read("/etc/passwd")`, `#read("file:///etc/passwd")` | `file not found (searched at /etc/passwd)`: paths name virtual files only |
| `#read("../../../etc/passwd")` | `path … would escape the project root` |
| `#image("https://tracker.example/pixel.png")` | `file not found`: a URL is just a path |
| reading another document's files | `file not found`: each document's engine mounts only its own files |
| `#import "@local/…"`, a package not on the allowlist | `package … is not allowed`, and nothing is fetched |
| a wasm plugin importing a host function | `cannot find definition for import env::fetch`: plugins get only Typst's two protocol functions |
| an XML external entity, entity expansion, an SVG `use` bomb | refused by Typst's XML and SVG parsers (unknown entity, entity loop, nodes limit) |

Diagnostics name virtual paths only, never the server's or the machine's.

Packages come from an allowlist with pinned versions and integrity hashes, served
from the app's own origin by default (`@typstream/universe`). A server facing
untrusted clients ignores the lists they send (`trustClient: false`, which
`@typstream/node` sets).

Don't give typstream an engine whose file access goes to the network. typst.ts's
`FetchAccessModel`, for example, turns every path a document names into a request
to your origin.

### Compute: the watchdog, traps and limits

Typst stops some runaways itself: infinite `while` loops, deep recursion, show rules
that never terminate, and layout that doesn't converge (five attempts). It doesn't
stop the rest: long finite loops, recursion with distinct arguments, memory bombs,
and wasm plugins that never return (plugins have no fuel limit).

- **The watchdog** gives every compile a budget (3 s streaming, 10 s final). Past it,
  the main thread terminates the worker and continues on a fresh one. Three strikes
  stop live preview; the finished document compiles once more, and then the fallback
  ladder finds the blocks that hang and shows them as error boxes (PLAN §5.6).
- **Traps.** A Typst panic, running out of wasm memory, or content nested so deep
  that the wasm stack overflows ends the worker without an answer. The client counts
  it like a timeout and replaces the worker. The stack overflow surfaces as the host's
  error (`RangeError` in V8 and JavaScriptCore, `InternalError` in SpiderMonkey), not a
  wasm trap, and leaves the instance unusable, so the server treats it as fatal too.
- **Memory.** Typst's caches are evicted after every compile. A worker that reports
  more than 256 MiB is replaced (`recycleBytes`).
- **Limits** (`createEngine({ limits })`):
  - `maxLength` (default 1 MiB of UTF-16 code units): longer input isn't healed or
    compiled, which protects the main thread. The document reports `too-large`, keeps
    its last render, and refuses exports until `set()` or `reset()` brings it back
    under the limit.
  - `livePages` (default 100): a streaming compile with more pages stops live preview
    (`too-complex`). The finished document compiles in full.
  - `@typstream/node` refuses documents over `maxTextLength` (1,000,000).

### Output: what reaches the DOM

Typst writes what `html.elem` asks for, verbatim: `<script>`, `onerror=`,
`href="javascript:…"`, `<iframe srcdoc>`, `<base>`, `<meta http-equiv=refresh>`.
The renderers are where these stop.

- **HTML target.** The renderer parses markup into an inert `<template>`, so nothing
  runs or loads while it is parsed. It cleans that tree with an allowlist sanitizer
  and moves the cleaned nodes into the page; nothing is serialized and parsed again, so
  mutation XSS can't happen. The sanitizer keeps:
  - the HTML elements Typst writes, MathML Core and drawing SVG;
  - links to `http(s)`, `mailto` and `#fragments` (external links get
    `rel="noopener noreferrer"`), read the way URL parsers read them (`java\tscript:`
    is `javascript:`);
  - images from `data:image/*` and `blob:` only;
  - CSS that loads nothing (no `url()`, `image-set()`, `expression()`, bindings) and
    isn't `position: fixed`.

  Everything else goes: scripts, styles, frames, objects, forms, `on*` handlers,
  `data-*`, `name`, `is`, `srcset`, `ping`, SVG animation and `foreignObject`. Ids
  get a per-renderer prefix, so a label can't clobber a global (`window.location`).
  Plugins can allow more tags and attributes, but never handlers, scripts or URL
  attributes.
- **Paged target.** Pages are typst-svg's output: glyphs as paths, images as `data:`
  URLs, and attribute values escaped by its XML writer. A page lives in its own
  shadow root, where the app's CSS can't reach it. The view keeps links to `http(s)`
  and `mailto` only, and images with `data:` URLs only. It trusts typst-svg's
  serializer for the rest. The hostile corpus checks that on every Typst upgrade.
- **Standalone HTML exports** (`standaloneHtml`) aren't sanitized. A downloaded file
  carries its own Content-Security-Policy (no scripts, no network, no forms), which
  stops what the document wrote in all three engines.

### Privacy

Nothing is fetched from third parties by default. The engine, its fonts and
packages come from the app's origin and are cached in Cache Storage.

## Content-Security-Policy

Typstream works under a strict policy: no inline script, no inline style and no
`eval`, with everything served from your own origin. `examples/strict-csp` is a page
served with exactly this policy. CI opens it in Chromium, Firefox and WebKit and
fails on any violation:

```
default-src 'none';
script-src 'self' 'wasm-unsafe-eval';
worker-src 'self';
connect-src 'self';
img-src 'self' data: blob:;
font-src 'self';
style-src 'self';
base-uri 'none';
form-action 'none';
frame-ancestors 'none'
```

What each directive is for:

| Directive | Why typstream needs it |
|---|---|
| `script-src 'wasm-unsafe-eval'` | The engine is WebAssembly. Compiling a module needs this keyword: it allows `WebAssembly.compile*`, not `eval`. The worker gets the policy from its own response, so send the header on the worker script too. |
| `worker-src 'self'` | The engine runs in a module worker loaded from your origin (`engineWorker()`). Bundling setups that inline workers as `blob:` URLs need `blob:` here. |
| `connect-src 'self'` | The worker fetches the wasm, the fonts (script fonts lazily, when a document uses them) and package tarballs. Add the origin if you serve these from a CDN. |
| `img-src data: blob:` | Typst writes a document's images as `data:` URLs, and apps may pass `blob:` ones. |
| `font-src 'self'` | `registerMathFont` loads New Computer Modern Math for MathML through the FontFace API. |
| `style-src 'self'` | Enough. The renderers inject their CSS as constructed stylesheets (`adoptedStyleSheets`), and apply the inline styles of Typst's HTML (layout from html-compat, fills, colours) through the CSSOM. A strict policy refuses `style` attributes parsed from markup, so they never reach the parser. Browsers without constructed stylesheets (Safari before 16.4) get a `<style>` element instead, which needs `'unsafe-inline'`. |

Not needed: `'unsafe-eval'`, `'unsafe-inline'`, cross-origin isolation
(COOP/COEP), or any third-party origin.

Not supported yet: **Trusted Types** (`require-trusted-types-for 'script'`). The
renderers parse markup with `innerHTML`, which Trusted Types refuses without a
policy ([#70](https://github.com/ikramhasan/typstream/issues/70)).

Setting the header: in Next.js, `headers()` in `next.config`; in Vite,
`server.headers` and `preview.headers` (as in the example); for any static host, its
header configuration. Prefer the header to a `<meta>` tag: `frame-ancestors` is
ignored in `<meta>`, and the header covers the worker script too.

## Known gaps

- A document can draw outside its element in the HTML target: absolutely positioned
  content sized to the viewport, or the host page's own utility classes (`fixed
  inset-0`), can cover the app around it
  ([#69](https://github.com/ikramhasan/typstream/issues/69)). Script, network and
  navigation stay blocked; this is about deception.
- Trusted Types ([#70](https://github.com/ikramhasan/typstream/issues/70)).
- The paged view trusts typst-svg's serializer (above): re-run the hostile suite on
  every Typst upgrade, as for the plugin sandbox.

## Tests

- `corpus/adversarial/hostile-*.typ`: the hostile documents. They cover reads,
  images, imports, plugins and XML outside the sandbox; links to other schemes;
  `html.elem` scripts, handlers, frames, forms and CSS; markup in text; runaway
  plugins; content nested too deep; and huge dimensions. `pnpm corpus:validate` checks
  what native Typst does with them.
- `packages/engine/__tests__/security.test.ts`: the sandbox, in both targets, on the
  real engine. It also checks that diagnostics name no host paths, that documents'
  files stay separate, and that the worker ends on a wasm stack overflow.
- `tools/browser-suites/__tests__/security.test.ts`, in Chromium, Firefox and WebKit:
  every hostile document streamed into `mountTypstream` in both targets. Nothing
  forbidden is left on the page, nothing ran, nothing was fetched from the hosts the
  documents name, runaways are stopped and the same mount renders the next document,
  and the limits hold.
- `packages/dom/__tests__/browser/html-sanitize.test.ts`: the sanitizer against
  classic XSS vectors and mutation XSS.
- `examples/strict-csp` (`pnpm --filter @typstream/example-strict-csp test`): both
  targets under the policy above, with no violation.
