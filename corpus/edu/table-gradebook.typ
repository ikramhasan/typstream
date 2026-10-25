#set page(paper: "a4", flipped: true, margin: 1.4cm)
#set text(size: 9pt)

#let assessments = ("Quiz 1", "Quiz 2", "Lab 1", "Midterm", "Lab 2", "Quiz 3", "Project", "Final")
#let weights = (0.05, 0.05, 0.10, 0.20, 0.10, 0.05, 0.15, 0.30)
#let students = (
  ("Adeyemi, T.", (88, 92, 85, 79, 90, 95, 88, 84)),
  ("Bianchi, L.", (72, 65, 80, 70, 75, 68, 82, 71)),
  ("Chen, W.", (95, 98, 92, 96, 94, 99, 97, 95)),
  ("Dubois, M.", (60, 58, 70, 55, 66, 62, 74, 59)),
  ("Eriksson, A.", (84, 80, 88, 82, 86, 81, 90, 85)),
  ("Fernández, J.", (91, 87, 78, 85, 80, 90, 86, 88)),
  ("Gupta, R.", (77, 82, 95, 88, 92, 79, 94, 90)),
  ("Hassan, N.", (68, 74, 72, 66, 70, 77, 69, 73)),
  ("Ivanova, K.", (99, 96, 90, 94, 97, 98, 95, 97)),
  ("Johnson, P.", (55, 62, 65, 58, 60, 57, 68, 61)),
  ("Kim, S.", (82, 85, 87, 80, 84, 88, 83, 86)),
  ("López, D.", (73, 70, 76, 74, 71, 75, 78, 72)),
  ("Mensah, E.", (89, 91, 84, 87, 88, 90, 92, 89)),
  ("Nakamura, H.", (66, 69, 81, 72, 79, 70, 80, 75)),
  ("O'Brien, C.", (94, 89, 93, 91, 95, 92, 96, 93)),
  ("Patel, A.", (80, 78, 82, 76, 83, 79, 85, 81)),
)

#let weighted(scores) = scores.zip(weights).map(((s, w)) => s * w).sum()
#let letter(avg) = if avg >= 90 { "A" } else if avg >= 80 { "B" } else if avg >= 70 { "C" } else if avg >= 60 { "D" } else { "F" }
#let cell-fill(score) = if score < 60 { rgb("#ffcdd2") } else if score >= 90 { rgb("#c8e6c9") } else { none }

= Gradebook — Biology 11, Section B

Weights: #assessments.zip(weights).map(((a, w)) => [#a #(int(w * 100))%]).join([, ]).

#table(
  columns: (auto, 1.4fr) + (1fr,) * assessments.len() + (1fr, auto),
  align: (right, left) + (center,) * (assessments.len() + 2),
  inset: 5pt,
  stroke: 0.4pt + luma(170),
  table.header(
    [*\#*], [*Student*], ..assessments.map(a => [*#a*]), [*Weighted*], [*Grade*],
  ),
  ..students
    .enumerate(start: 1)
    .map(((i, (name, scores))) => {
      let avg = weighted(scores)
      (
        [#i],
        [#name],
        ..scores.map(s => table.cell(fill: cell-fill(s))[#s]),
        [*#calc.round(avg, digits: 1)*],
        [#letter(avg)],
      )
    })
    .flatten(),
  table.hline(stroke: 1pt),
  [], [*Class mean*],
  ..range(assessments.len()).map(j => [#calc.round(students.map(s => s.at(1).at(j)).sum() / students.len(), digits: 1)]),
  [#calc.round(students.map(s => weighted(s.at(1))).sum() / students.len(), digits: 1)], [],
)

#let dist = ("A", "B", "C", "D", "F").map(g => (g, students.filter(s => letter(weighted(s.at(1))) == g).len()))

== Grade distribution

#grid(
  columns: dist.len(),
  column-gutter: 1em,
  align: bottom,
  ..dist.map(((g, n)) => align(center)[
    #rect(width: 1.2cm, height: n * 0.6cm + 1pt, fill: rgb("#90caf9"))
    *#g* (#n)
  ]),
)
