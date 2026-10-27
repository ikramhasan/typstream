---
"@typstream/core": minor
"@typstream/dom": minor
"@typstream/html-compat": minor
"@typstream/edu": minor
---

A document in the HTML target stays inside its element (#69). The renderer's stylesheet clips its root (`position: relative; overflow: clip; clip-path: inset(0)` on `.typstream`), so nothing the document draws, or the page's CSS gives it, paints or takes clicks outside the element: not a viewport-sized `position: absolute` box, a `transform`, negative margins, nor a `position: fixed` that a page class applies. Layout doesn't change (no new formatting context); what reached past the element, such as a table wider than it, is now cut off. The sanitizer keeps only the classes Typst writes, the engine's `typstream-*` placeholders and the ones plugins list in the new `sanitize.allowClasses` facet (names, or prefixes like `"ts-*"`), so a document can no longer take on the page's own classes (Tailwind's `fixed inset-0 z-50`, an app's buttons). html-compat allows `ts-*` and edu `edu-*`; a plugin whose Typst writes classes for its stylesheet must list them.
