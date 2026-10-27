---
"@typstream/heal": minor
"@typstream/edu": minor
"@typstream/universe": patch
---

Prompt kit measured on real models (#24). `@typstream/edu`: `buildSystemPrompt(plugins)` writes the system prompt from the plugins' rules, catalogue and examples, and `typstPromptRules` adds the Typst habits models get wrong (scripts without a base, multi-letter math names, bare math as arguments, `*/` and `/ ` in markup, imports for packages); `mcq`'s example shows math options. `@typstream/heal`: new `math-lone-script` lint fix (`m/s$^2$` → `m/s$""^2$`), and `currency-dollar` no longer warns on math such as `$0.4 times 0.3 =$` or `$30 degree$`. `@typstream/universe`: CeTZ's prompt line shows its own shapes.
