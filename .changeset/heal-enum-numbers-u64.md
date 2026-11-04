---
"@typstream/heal": patch
---

heal reads an enum marker as Typst does: any number that parses as a u64 followed by `.`, so a 20-digit number up to 18446744073709551615 and numbers with leading zeros (`0001.`) are enum markers. `blockStarts` follows, so a 20-digit item right after another is in the same list.
