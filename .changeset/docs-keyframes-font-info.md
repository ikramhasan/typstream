---
"@typstream/dom": patch
"@typstream/core": patch
---

Docs. `AnimateOptions.animation` says that your own keyframes must be named `typstream-<name>`: `animation: "pop"` plays `@keyframes typstream-pop` (#83). `FontSource.info` points to `Engine.font_info` from `@typstream/engine-wasm` instead of a script the package doesn't ship (#84).
