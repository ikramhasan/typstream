// Typst's own elements, without a plugin (#118): documents as a model writes them, which must look the same in the
// paged view, Typst's PDF and the DOCX export. Each holds what a DOCX export once broke while the lines still matched
// by text: a blank or a highlight that lost its line, a gap that went missing, a label Word centred, a line a `\`
// broke where Typst would have, a box with rounded corners (heal's layout-profile lint squares it, so its text stays
// editable), a dashed line or a gradient drawn solid.
import type { ConformanceSuite } from "../../src/suite";

export const suite: ConformanceSuite = {
  name: "typst",
  plugins: [],
  examples: [
    {
      name: "text: styles, colours, highlights and a filled box",
      source: `= Text

Plain text with *bold*, _italic_, *_bold italic_* and \`inline code\`.
#text(fill: red)[Red text], #text(fill: rgb("#2563eb"))[blue text] and #text(fill: luma(140))[grey text].
Plants need #highlight[sunlight], #highlight(fill: rgb("#bbf7d0"))[water] and carbon dioxide; the #highlight[chlorophyll] in their leaves absorbs the light.
#underline[Underlined words], H#sub[2]O, #text(size: 14pt)[bigger] and #text(size: 8pt)[smaller] text.
#text(font: "DejaVu Sans Mono")[A monospace font] and #text(font: "New Computer Modern")[Computer Modern].
A #link("https://typst.app")[link to Typst]. "Smart quotes" and 'single' -- en dash --- em dash.

The key term is #box(fill: luma(225), inset: (x: 3pt), outset: (y: 2pt))[osmosis].
`,
    },
    {
      name: "layout: alignment, blocks, a quote and a stack",
      source: `= Layout

#align(center)[A centred paragraph of text.]
#align(right)[A right-aligned paragraph.]

#block(fill: luma(235), inset: 8pt, width: 100%)[A shaded block with an inset.]

#block(fill: rgb("#fef3c7"), stroke: (left: 3pt + rgb("#f59e0b")), inset: 8pt)[A block with a bar on its left.]

Left #h(1fr) Right

#pad(left: 2em)[A paragraph padded by two em.]

#quote(block: true, attribution: [Martin Luther King Jr.])[Injustice anywhere is a threat to justice everywhere.]

#stack(dir: ltr, spacing: 1em, [A], [B], [C])

After the stack.
`,
    },
    {
      name: "lists: bullets, numbers, Roman numerals from v, terms and their blanks",
      source: `= Lists

- First bullet
- Second bullet
  - Nested bullet
- Third

+ One
+ Two
  + Two point one

#set enum(numbering: "a)")
+ Alpha
+ Beta

#enum(numbering: "i.", start: 5)[Fifth question][Sixth question][Seventh question]

/ Term: Its definition.
/ Reason: #box(width: 12em, stroke: (bottom: 0.5pt))
/ Variable: #box(width: 8em, stroke: (bottom: 0.5pt))

#box(width: 4em, stroke: (bottom: 0.5pt)) is the capital of France.
`,
    },
    {
      name: "tables: fills, spans, a centred column of numbered words, numbered blanks, dashed borders",
      source: `= Tables

#table(
  columns: 3,
  fill: (x, y) => if y == 0 { luma(220) } else if calc.even(y) { luma(245) },
  table.header[*Name*][*Age*][*City*],
  [Alice], [30], [Paris],
  [Bob], [25], [London],
)

#table(
  columns: 3,
  table.cell(colspan: 2)[Spans two], [C],
  table.cell(rowspan: 2)[Two rows], [B], [C],
  [B2], [C2],
)

#table(
  columns: (1fr, 1fr, 1fr),
  align: center,
  [*Present*], [*Letter*], [*Past*],
  [1. run], [], [A. swam],
  [2. jump], [], [B. laughed],
)

#table(
  columns: 4,
  stroke: none,
  [1. #box(width: 2em, stroke: (bottom: 0.6pt), height: 1em)], [la manzana], [], [A. cheese],
  [2. #box(width: 2em, stroke: (bottom: 0.6pt), height: 1em)], [el pan], [], [B. fish],
)

#table(columns: 2, stroke: (dash: "dashed"), [Dashed], [borders])
`,
    },
    {
      name: "pages: header, footer, numbering, numbered headings",
      source: `#set page(header: [Header text #h(1fr) Course], footer: context [#h(1fr) Page #counter(page).display() #h(1fr)], numbering: "1")
#set heading(numbering: "1.1")
= First section
#lorem(60)
== Subsection
#lorem(80)
= Second section
#lorem(200)
#pagebreak()
= Third section
#lorem(40)
`,
    },
    {
      name: "figures, an outline and references",
      source: `#set heading(numbering: "1.")
#outline()
= Introduction <intro>
As shown in @fig1 and @tab1, see also @intro.
#figure(rect(width: 4cm, height: 2cm, fill: aqua), caption: [A rectangle]) <fig1>
#figure(table(columns: 2, [a], [b]), caption: [A table]) <tab1>
= Body
#lorem(30)
`,
    },
    {
      name: "code blocks",
      source: `= Code

\`\`\`python
for i in range(3):
    print(f"Step {i}: done")
\`\`\`

\`\`\`
plain raw block
  with indentation
\`\`\`

Inline \`raw text\` in a sentence.
`,
    },
    {
      name: "columns",
      source: `#set page(columns: 2)
= Two columns
#lorem(150)
#colbreak()
#lorem(50)
`,
    },
    {
      name: "shapes: fills, dashed and dotted lines, a gradient",
      source: `= Shapes

#rect(width: 3cm, height: 1cm, fill: rgb("#fde68a"))
#circle(radius: 0.6cm, fill: green)
#line(length: 100%, stroke: 2pt + red)

Cut along the dashed line:
#line(length: 100%, stroke: (dash: "dashed"))
#line(length: 100%, stroke: (thickness: 1pt, dash: "dotted"))

#rect(width: 100%, height: 0.6cm, fill: gradient.linear(red, blue))
`,
    },
    {
      name: "boxes as models write them: rounded corners, centred cards, stanzas",
      source: `= Boxes as models write them

*Source A.* A speech from 1914.

#block(width: 100%, inset: 10pt, stroke: 0.6pt + gray, radius: 3pt)[
  "The lamps are going out all over Europe; we shall not see them lit again in our lifetime."
]

#rect(width: 100%, inset: 8pt, radius: 3pt, fill: rgb("#eef6ff"))[
  *Hint:* Balance the metals first, then the non-metals.
]

#grid(columns: (1fr, 1fr), gutter: 0pt,
  rect(width: 100%, height: 3cm, radius: 6pt, stroke: (dash: "dashed", paint: luma(150)))[
    #align(center + horizon)[What is the capital of \\ *France*?]
  ],
  rect(width: 100%, height: 3cm, radius: 6pt, stroke: (dash: "dashed", paint: luma(150)), fill: rgb("#fffde7"))[
    #align(center + horizon)[*Paris*]
  ],
)

#block(fill: luma(245), stroke: 0.8pt, inset: 10pt, width: 100%)[
  "If in some smothering dreams you too could pace \\
  Behind the wagon that we flung him in, \\
  \\
  My friend, you would not tell with such high zest \\
  To children ardent for some desperate glory."
]
`,
    },
  ],
};
