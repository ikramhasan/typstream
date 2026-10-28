---
"@typstream/edu": minor
---

edu's components are what Word can draw, so a DOCX export can match the pages (#130). Callouts and instructions are
square frames with the title on the first line (the title sat on a rounded frame's border) and don't break across
pages; a shown correct option is bold instead of circled; the answer reveal has no inset above or below; answer lines
are one ruled line per block, kept together, and a shown answer is set at their pitch with the remaining lines ruled
below it; MCQ options are one grid whose rows, like true/false's and matching's, don't break; a rubric cell with a word
too wide for its column is set smaller instead of hyphenated; sizes relative to the text are rounded to half points.
The HTML target follows the new callout and marker.
