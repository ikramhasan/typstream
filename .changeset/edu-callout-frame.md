---
"@typstream/edu": minor
---

Callouts and the instructions box are a thin frame with the title set into its top edge, like a fieldset's legend, instead of a tinted panel with a bar. They print cleanly in black and white, and look like a printed worksheet rather than a web page. Both targets match: the paged target draws the label over the frame on the page's fill; the HTML target (`eduCss`) draws the frame in pieces around the title, so it needs no background colour and works on any page, in light and dark themes. The title sits on the starting side, at the top right in Arabic. A callout with `title: none` keeps a whole frame.
