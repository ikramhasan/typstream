---
"@typstream/docx": patch
---

DOCX exports keep a drawing's room in Google Docs: a CeTZ canvas, image or other picture in a line of its own is now
a character in a single-spaced line as tall as it, instead of anchored in front of the text over an exact-height
paragraph. Google Docs has no exact line heights, so that paragraph shrank to a fraction of the picture and the text
after it ran under it. Word, LibreOffice and ONLYOFFICE lay it out as before. A picture that starts left of its
container, or reaches past its room by more than the space above it, is still anchored.
