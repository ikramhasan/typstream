# node-validate

Server-side checks for LLM-written Typst with `@typstream/node`: validate a document before saving it, run the repair loop, and render the result to PDF.

```bash
pnpm --filter @typstream/node build   # once: the engine and fonts
node index.mjs                        # the bundled worksheet.typ, which has three mistakes
node index.mjs path/to/doc.typ
```

It prints each repair prompt, then writes `out/<name>.pdf` and the repaired source next to it.

The model in `index.mjs` is a stand-in that fixes exactly what it's told, so the example runs offline. With a real model, `generate` sends the prompt and the current source and returns the reply:

```js
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const result = await fixLoop({
  source,
  generate: async ({ prompt, source }) => {
    const reply = await client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      messages: [{ role: "user", content: `${prompt}\n\n${source}` }],
    });
    return reply.content[0].type === "text" ? reply.content[0].text : "";
  },
});
```

`fixLoop` strips a ```` ```typst ```` fence from the reply, validates it, and stops when the document is clean or after `maxRounds` (default 3), returning the best attempt.
