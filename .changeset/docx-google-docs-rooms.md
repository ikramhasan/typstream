---
"@typstream/docx": patch
---

DOCX exports keep the room of an anchored drawing, and of other space held by an empty paragraph, in Google Docs. Google
Docs has no exact line heights and sized those paragraphs from their point-tall font, so a box as wide as its cell, a
code block or a rounded box with text held a fifth of its height there and covered the text after it. Their mark is now
10.5 pt Arial, whose line Google Docs makes 12 pt, so its multiple comes out the height; Word, LibreOffice and
ONLYOFFICE lay the file out as before.
