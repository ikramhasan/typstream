---
"@typstream/core": patch
"@typstream/engine": patch
"@typstream/dom": patch
---

Trusted Types (#70): typstream works on pages that send `require-trusted-types-for 'script'`, with `trusted-types typstream` in their Content-Security-Policy. Every script sink goes through one policy named `typstream`, created on first use where the browser has Trusted Types: the HTML renderer's and the paged view's markup (parsed into an inert `<template>` and sanitized before anything reaches the page) and the engine worker's URL (`engineWorker()`). The paged view now also parses each page into a template first, so its links and images are filtered before the page is inserted, not after. If the page has already taken the name `typstream` (or doesn't list it), the renderers pass strings as before, which a page without enforcement, or with a default policy, still takes.
