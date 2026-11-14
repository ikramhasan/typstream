# vite-react

The `typstream` package's `<Typstream>` in a Vite + React app. A worksheet is replayed the way a model streams it, a
few characters at a time with `isStreaming` until the end, and shown as HTML or as pages. The PDF button exports it
through `useTypstream()`.

```bash
pnpm turbo run build --filter=@typstream/example-vite-react^...   # once: the packages it uses
pnpm --filter @typstream/example-vite-react dev                   # http://localhost:5173
pnpm --filter @typstream/example-vite-react test                  # build, serve, check in Chromium, Firefox, WebKit
```

Vite needs no configuration for typstream (`vite.config.ts` has only the React plugin): `vite build` emits the
engine's worker, the Typst wasm and its fonts as assets. `src/App.tsx` is the whole app. In your own app, `source` is
the text a model has written so far ([React](https://typstream.vercel.app/docs/getting-started/react)).

`smoke.mjs` builds the app and serves it with `vite preview`. In each browser it waits for the worksheet to finish as
HTML, with its heading, equations and table. It then switches to pages, waits for a page with text, downloads the PDF
and checks it starts with `%PDF-`. Any console error or uncaught exception fails it. `BROWSERS=chromium` runs one
browser, and `--screenshot` saves `smoke-<browser>.png`.
