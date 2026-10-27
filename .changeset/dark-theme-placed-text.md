---
"@typstream/dom": patch
"@typstream/html-compat": patch
---

Dark theme: text `place`d inside a filled area (a flashcard's corner label) takes the fill's light-theme colours instead of the page's, which made it light on light (#64). html-compat marks a placement that points outward from its anchoring edge (`bottom` with a positive `dy`, `right` with a positive `dx`, …) with `ts-place-out`, and only those keep the page's theme, so a shape's dimension labels drawn beside it stay readable.
