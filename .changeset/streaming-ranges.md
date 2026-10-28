---
"@typstream/core": minor
"@typstream/heal": minor
"@typstream/engine": minor
"@typstream/dom": minor
"@typstream/react": minor
"@typstream/node": patch
---

Streaming into a range of a finished document: an edit such as a model rewriting one question, where only that part heals as text being typed and the rest shows as it did. `EngineDocument.setStreamingRange(range)`, and `streamingRange` on `mountTypstream` and `<Typstream>` (with `isStreaming`; a finished document given a range streams again without starting over). Heal: `setStreamingRange` works on a finished healer (streaming mode until `finish()`); the text after a range is linted as a text of its own, so its fixes stay; `HealResult.suffixOffset` and `Healer.streamingRange`; `blockStarts` (`@beta`, moved from the engine's server) gives the top-level blocks a range should cover. The worker keeps to the range: `CompileParams.settledFrom` and `FixContext.settledFrom`, so `tail-cut` no longer drops the rest of the document with the text being typed. Layer 4's level 1 compares only what the range wrote, and the new `FallbackParams.restart` (sent after `setStreamingRange` and `reset()`) shows text that starts over even when it is shorter than what it replaces: a regenerated answer no longer keeps the old one on screen until it has caught up. `@typstream/node`'s server accepts the new fields.
