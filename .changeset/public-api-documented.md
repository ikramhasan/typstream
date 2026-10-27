---
"@typstream/core": patch
"@typstream/heal": patch
"@typstream/engine": patch
"@typstream/node": patch
---

Every `@public` and `@beta` export and member has TSDoc (#33): the protocol and plugin types in core, heal's results, options and recognizer types, and `@typstream/node`'s options and results, so editors show what each one means. `HealHandler.priority`'s comment said the built-in lint rules run at 50; they run before every handler, and a handler's default priority is 100.
