---
"@typstream/docx": patch
---

DOCX exports keep the room of an anchored drawing, and of other space held by an empty paragraph, in Google Docs. Google
Docs has no exact line heights and sized those paragraphs from their point-tall font, so a box as wide as its cell, a
code block or a rounded box with text held a fifth of its height there and covered the text after it, and a room that
breaks between pages kept three quarters of it. Their mark is now Arial at the size whose line Google Docs makes the
height (10.5 pt for a line of 0.72 pt or more, smaller below that, where Google Docs keeps at least 0.06 of a line);
Word, LibreOffice and ONLYOFFICE lay the file out as before.
