# vanilla

typstream without a framework: `@typstream/dom`'s `mountTypstream` on an engine from `@typstream/engine`, with
html-compat, universe and the math font, as [Without a framework](https://typstream.vercel.app/docs/getting-started/vanilla)
sets it up. A worksheet is replayed the way a model streams it, a few characters at a time with `isStreaming` until
the end, and shown as HTML or as pages. The PDF button exports it from the mount.

```bash
pnpm turbo run build --filter=@typstream/example-vanilla^...   # once: the packages it uses
pnpm --filter @typstream/example-vanilla dev                   # http://localhost:5173
pnpm --filter @typstream/example-vanilla test                  # build, serve, check in Chromium, Firefox, WebKit
```

`src/main.ts` is the whole app. `update()` replaces a mount's options rather than merging them, so it keeps them in
one object and passes all of them each time. Vite needs no configuration: `vite build` emits the engine's worker, the
Typst wasm and its fonts as assets.

`smoke.mjs` is examples/vite-react's test on this page. It checks the worksheet as HTML and as pages, then the PDF
download, and fails on any console error. `BROWSERS=chromium` runs one browser, and `--screenshot` saves
`smoke-<browser>.png`.
