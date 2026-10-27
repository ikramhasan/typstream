---
"@typstream/edu": patch
---

`student-info` on paper (the name, date and class lines under a template's title): each line now sits just under its label's baseline, as a `blank`'s line does in a sentence. The header is a grid with labels and lines in cells of their own; a line's cell holds no text, so with the cells aligned at the top the lines came out level with the middle of the labels, in every language. The cells now align at the bottom, where a text line's frame ends at its baseline. HTML output was already right.
