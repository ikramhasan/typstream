---
"@typstream/html-compat": patch
"@typstream/edu": patch
---

`place()` in the HTML target positions inside its container's `inset`, as Typst does, instead of against the padding box (#94). Blocks, boxes and shapes write their inset per side as custom properties (`--ts-inset-left`, …) that `place`'s offsets read; the stylesheet resets them on every element a placed piece can be positioned against, so nested containers each use their own. Placed text with a vertical alignment gets Typst's text box, cap height to baseline (`text-box: trim-both cap alphabetic`), so a label offset from a shape's edge lands where paged output puts it. All alignments, `dx`/`dy` and per-side insets match the paged layout within 1.5pt. edu's callouts set the same properties to their padding.
