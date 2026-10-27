---
"@typstream/engine": patch
---

Layer 3's `tail-cut` fixer now handles errors that have no position in the document (#72). These come from code that evaluates the document's content inside a `context` or a layout callback: CeTZ resolving a half-typed coordinate in a canvas, unify, edu's `coordinate-plane`. Before, such an error left the prefix failing until the value was complete, and the stable prefix dropped the whole canvas. Now `tail-cut` cuts what is open at the end of the streamed text: a value at its opener, an argument list as the whole call. A second round cuts the call if it still fails without the value.
