---
"@typstream/edu": minor
"@typstream/docx": patch
"@typstream/engine-wasm": patch
---

DOCX exports can be filled in. A blank is underlined no-break spaces of their own width, so letters typed in
it are no longer spread a blank apart; an empty line to write on (edu's answer lines, a student's details, a matching
letter) has a line to type on above its rule, in the text's face and size, instead of room no text fits in; and the
space after a blank that ends a line is no longer underlined. edu's `student-info` (and a template's `info`) fills
fields in: `info: (name: [Ikram Hasan], class: [9B], date: none)` writes the name and class on their lines and leaves
the date empty. A matching exercise's letter line sits at the bottom of its line, as `student-info`'s do.
