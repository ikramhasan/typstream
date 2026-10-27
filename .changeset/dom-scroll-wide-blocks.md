---
"@typstream/dom": minor
"@typstream/html-compat": patch
---

In the HTML target, a table, an equation or a code block wider than its element scrolls sideways inside it instead of being cut off (#95). Once a render is laid out, and again when the element's size changes, the renderer marks the boxes that are too wide: code scrolls itself, a table or a display equation scrolls in a `div` the renderer puts around it (Firefox and WebKit can't scroll a `math` element). The marked box has `data-typstream-wide` and `tabindex="0"`, so the keyboard can scroll it too. Only those boxes change: a document that fits is laid out as before, and the page never scrolls sideways. Display equations are now as wide as their content, so a wide one is measured the same in every browser. html-compat's `repeat` now stops at the edge of its box (or line), as in Typst, instead of spilling past it.
