---
"@typstream/heal": patch
---

Streamed and incrementally edited text lints an indented Markdown heading (` # Title`) as a heading, as healing it in one go does; it had escaped the `#` instead (`\# Title`). Found by the nightly property campaign.
