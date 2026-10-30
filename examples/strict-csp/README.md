# strict-csp

typstream on a page served with a strict Content-Security-Policy: everything from the page's own origin, no inline
script or style, no `eval`, and Trusted Types enforced. One worksheet is mounted twice with `@typstream/dom`, as HTML and as pages. It needs
everything a policy could block: the engine (WebAssembly in a module worker), a Bengali word (a script font fetched
on demand), a CeTZ diagram (a Typst package fetched from this origin), MathML with the math font, and html-compat's
layout (inline styles). A second page, `island.html`, renders a mind map with `@typstream/react`'s `<Typstream>` and
`@typstream/mindmap`'s render island (#28), in both targets (on a page, over its canvas): React and React Flow, whose
styles go through the CSSOM and whose CSS is adopted as constructable stylesheets.

```bash
pnpm turbo run build --filter=@typstream/example-strict-csp^...   # once: the packages it uses
pnpm --filter @typstream/example-strict-csp dev                   # http://localhost:5173, with the policy
pnpm --filter @typstream/example-strict-csp test                  # build, serve, check in Chromium, Firefox, WebKit
```

The policy is in `csp.mjs`; `vite.config.mjs` sends it from the dev server and `vite preview`. `smoke.mjs` fails on any
`securitypolicyviolation` or console error. It also checks that the grid has its two columns, the equations are MathML,
the diagram is drawn and the pages have text, and that the island page's map has its nodes and edges in both targets, over a drawing
hidden from assistive technology in HTML and in a box over the page. Last, it checks that the policy is enforced at all: an inline style the
test adds itself must be refused, and so must a string it assigns to `innerHTML` (Trusted Types). `BROWSERS=chromium`
runs one browser, and `--screenshot` saves `smoke-<browser>.png`.

What each directive is for: [Security](../../apps/website/content/docs/guides/security.mdx).
