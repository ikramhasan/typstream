---
"@typstream/engine": patch
"@typstream/heal": patch
---

Content no longer vanishes and returns at the stream's position (#65). A streaming compile that succeeds but shows less of the unsettled tail than the last artifact did (heal or the tail-cut fixer cut what had rendered, such as `..xs.map(x => (a, b` before its `.flatten()`, or the stable prefix would show it as source again) publishes nothing and answers `error`, so the client keeps its last render until the tail shows as much again or that text is settled. heal closes a math group left open inside a math call's arguments (`$sqrt(1/n sum (x_i` heals to `$sqrt(1/n sum (x_i))$`, new frame kind `math-delimited`); before, the group took the call's `)` and the whole construct was dropped.
