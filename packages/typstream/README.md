# typstream

Render Typst streamed from an LLM, live, in React. The convenience package, like `streamdown`:

```tsx
import { Typstream } from "typstream";

<Typstream source={text} isStreaming={status === "streaming"} animated caret />;
```

It is `@typstream/react`'s `<Typstream>` with defaults an app wants:

- **html-compat** (`@typstream/html-compat`): grids, alignment, boxes and shapes survive the HTML target. `htmlCompat={false}` turns it off.
- **The engine's math font** registered for MathML, so delimiters stretch.
- **Typst packages** (`@typstream/universe`): documents may import CeTZ and fletcher (diagrams), cetz-plot, physica and unify (math), chemformula and alchemist (chemistry), at the vendored versions. The tarballs are served from your app's origin (your bundler emits them as assets) and fetched only when a document imports one. `packages={false}` turns them off; the `universe` plugin's `prompt.rules` tell the model what it may import.

It also re-exports `TypstreamProvider`, `useTypstream`, the engine (`createEngine`, `engineWorker`), the healer (`createHealer`, `heal`), html-compat and the vendored packages. See `@typstream/react`'s README for the props, and `examples/nextjs-ai-sdk` for a chat with the Vercel AI SDK.

Documents are untrusted code: what they can't do, and the Content-Security-Policy to serve typstream under (no `'unsafe-inline'` or `'unsafe-eval'`, just `'wasm-unsafe-eval'`), are in [Security](../../apps/website/content/docs/guides/security.mdx).
