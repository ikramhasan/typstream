#set page(paper: "a4", flipped: true, margin: 1.5cm)
#set text(size: 9.5pt)
#set par(justify: false)

#let levels = (
  (name: "Exemplary", pts: 4, color: rgb("#c8e6c9")),
  (name: "Proficient", pts: 3, color: rgb("#dcedc8")),
  (name: "Developing", pts: 2, color: rgb("#fff9c4")),
  (name: "Beginning", pts: 1, color: rgb("#ffcdd2")),
)

#let criteria = (
  (
    "Thesis",
    (
      "Clear, specific, arguable thesis that frames the whole essay.",
      "Clear thesis; mostly guides the essay.",
      "Thesis is present but vague or too broad.",
      "No identifiable thesis.",
    ),
  ),
  (
    "Evidence",
    (
      "Relevant, well-chosen evidence from several credible sources, smoothly integrated.",
      "Relevant evidence from credible sources; some integration.",
      "Limited or loosely connected evidence.",
      "Little or no evidence; relies on opinion.",
    ),
  ),
  (
    "Reasoning",
    (
      "Explains insightfully how evidence supports each claim; addresses counter-arguments.",
      "Explains how most evidence supports claims; mentions a counter-argument.",
      "Explanation is thin or repeats the evidence.",
      "No explanation linking evidence to claims.",
    ),
  ),
  (
    "Organisation",
    (
      "Logical structure with purposeful transitions; strong introduction and conclusion.",
      "Clear structure; transitions mostly effective.",
      "Some structure, but paragraphs lack focus.",
      "Disorganised; hard to follow.",
    ),
  ),
  (
    "Conventions",
    (
      "Virtually error-free grammar, spelling and citation format.",
      "Few errors that do not impede meaning.",
      "Several errors that sometimes impede meaning.",
      "Frequent errors that impede meaning.",
    ),
  ),
)

#align(center)[
  #text(16pt)[*Argumentative Essay Rubric*] \
  Grade 10 English · Total #(criteria.len() * 4) points
]

#table(
  columns: (auto,) + (1fr,) * levels.len() + (auto,),
  align: (left + horizon, ..(left,) * levels.len(), center + horizon),
  inset: 7pt,
  fill: (x, y) => if y == 0 and x >= 1 and x <= levels.len() { levels.at(x - 1).color } else if y == 0 { luma(230) },
  table.header(
    [*Criterion*],
    ..levels.map(l => [*#l.name* (#l.pts)]),
    [*Score*],
  ),
  ..criteria.map(((name, descs)) => ([*#name*], ..descs.map(d => [#d]), [])).flatten(),
  table.cell(colspan: levels.len() + 1, align: right)[*Total*],
  [\_\_ / #(criteria.len() * 4)],
)

#v(1em)
*Teacher comments:*
#v(3em)
#line(length: 100%, stroke: 0.4pt)
