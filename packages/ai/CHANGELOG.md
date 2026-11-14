# @typstream/ai

## 0.1.1

### Patch Changes

- 3e5b205: Published with npm provenance, through trusted publishing: each version on npm now carries a signed statement of the GitHub Actions run and commit that built it (0.1.0 has none). No code changes.
- Updated dependencies [3e5b205]
  - @typstream/core@0.1.1
  - @typstream/heal@0.1.1

## 0.1.0

### Minor Changes

- 22417cf: New package, `@typstream/ai`: typstream with the Vercel AI SDK. An assistant message is a Typst document: `textOf(message)` is its text (text parts only) and `isStreaming(message, chat)` says whether more is coming, for `<Typstream source isStreaming>` with `useChat`. `isStreaming` finishes an answer that stopped early (`stop()`, a network error), whose text part the AI SDK leaves `"streaming"`, keeps an answer streaming across a tool call (text, then an image search, then the document), and keeps earlier answers finished while a new one streams. `textStream(snapshots)` turns `readUIMessageStream`'s snapshots into the chunks `mountTypstream`'s `stream` reads, for apps without React. It reads AI SDK messages by their shape (AI SDK 5 and later, tested on 7) and doesn't depend on `ai`.
- 548dc48: Streaming edits: a model changes part of a finished document, and the change streams into place. The model writes `<edit><old>…</old><new>…</new></edit>`s that quote the text they replace (`editPrompt()` after your system prompt, `editRequest(document, request)` as the user turn). `createEditSession(document)` applies an answer's edits as it streams (`update(textOf(message), done)`): a quote must match one place, exactly or with whitespace evened out, or the edit fails and is reported (`editFeedback` words it for the model). A quote of whole blocks streams its new text into a streaming range, so only that part heals as it's written and the rest stays; a quote inside a block is replaced once its new text is complete. While a quote streams, the text it matches is reported so the app can highlight it. A stopped answer rolls back the edit it was writing, the teacher's own edits (`userEdit`) move the answer's, and `keep()` / `undo()` end it. Selection edits: `blockRange(document, highlight)`, `selectionRequest`, and `session.write(range, replacement, done)`. Also `parseEdits`, `findQuote`, and `blockStarts` (from `@typstream/heal`). The package now depends on `@typstream/core` and `@typstream/heal`.

### Patch Changes

- Updated dependencies [ea04dbd]
- Updated dependencies [3e66075]
- Updated dependencies [12ea537]
- Updated dependencies [28374ec]
- Updated dependencies [ba56f2e]
- Updated dependencies [ec38329]
- Updated dependencies [69f1477]
- Updated dependencies [b4d7bed]
- Updated dependencies [813029f]
- Updated dependencies [cbb44d9]
- Updated dependencies [865949a]
- Updated dependencies [ba77608]
- Updated dependencies [41ae15f]
- Updated dependencies [85ab88f]
- Updated dependencies [4ad0ae1]
- Updated dependencies [8184b0f]
- Updated dependencies [466147c]
- Updated dependencies [b880330]
- Updated dependencies [ba55345]
- Updated dependencies [aef5d68]
- Updated dependencies [b880330]
- Updated dependencies
- Updated dependencies [893bbb1]
- Updated dependencies [d54927d]
- Updated dependencies [60c1567]
- Updated dependencies [8d2f1c5]
- Updated dependencies [e6c5a7b]
- Updated dependencies [fdb250d]
- Updated dependencies [3a11cdc]
- Updated dependencies [5275321]
- Updated dependencies [c620668]
- Updated dependencies [0d1c1c3]
  - @typstream/heal@0.1.0
  - @typstream/core@0.1.0
