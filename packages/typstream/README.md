# typstream

Render Typst streamed from an LLM, live, in React. The convenience package, like `streamdown`:

```tsx
import { Typstream } from "typstream";

<Typstream source={text} isStreaming={status === "streaming"} animated caret />;
```

It is `@typstream/react`'s `<Typstream>` with defaults an app wants:

- **html-compat** (`@typstream/html-compat`): grids, alignment, boxes and shapes survive the HTML target. `htmlCompat={false}` turns it off.
- **The engine's math font** registered for MathML, so delimiters stretch.

It also re-exports `TypstreamProvider`, `useTypstream`, the engine (`createEngine`, `engineWorker`), the healer (`createHealer`, `heal`) and html-compat. See `@typstream/react`'s README for the props, and `examples/nextjs-ai-sdk` for a chat with the Vercel AI SDK.
