---
"@typstream/engine": minor
"@typstream/heal": minor
"@typstream/node": minor
"@typstream/edu": minor
"@typstream/html-compat": patch
---

Pages follow typstream's layout profile (#129), so a DOCX export can break lines and pages where Typst does: a
constant line pitch (1.3em, close to Typst's default), ragged right without hyphenation, table rows that don't split,
and inline math at least a line tall. The engine puts it (`LAYOUT_PROFILE`, from `@typstream/engine/server`) in front
of every document and its preamble when it compiles pages or exports a PDF; `@typstream/node` does too. Its show-set
rules win over a document's set rules; heal's new `layout-profile` lint rule takes out the arguments that would win
(`par(justify: true)[…]`, `show par: set par(…)`, `show text: set text(hyphenate: …)`). Every page looks a little
different: default gaps between paragraphs and headings are smaller to keep Typst's distances between baselines, and
some documents that set their own table insets or spacing gain a page. edu's spacing, answer lines, circled answers and
blanks are adjusted to keep their look under the profile. `fromMain` takes where the preamble starts, after the
profile. html-compat's placed text uses the profile's text edges.
