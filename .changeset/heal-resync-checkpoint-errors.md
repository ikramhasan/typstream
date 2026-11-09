---
"@typstream/heal": patch
---

The incremental healer reports a syntax error at a block's start once, as stateless healing does. An error the block before reported there (a term item's missing colon, after an unclosed `_`) came twice when an edit's re-recognition stopped at that block, and went missing when it resumed there.
