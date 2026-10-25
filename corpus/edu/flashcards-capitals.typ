#set page(paper: "a4", margin: 1cm)
#set text(size: 14pt)

#let cards = (
  ("France", "Paris"),
  ("Japan", "Tokyo"),
  ("Kenya", "Nairobi"),
  ("Brazil", "Brasília"),
  ("Canada", "Ottawa"),
  ("Egypt", "Cairo"),
  ("India", "New Delhi"),
  ("Mexico", "Mexico City"),
  ("Norway", "Oslo"),
  ("Peru", "Lima"),
  ("Vietnam", "Hanoi"),
  ("New Zealand", "Wellington"),
)

#let card(body, back: false) = rect(
  width: 100%,
  height: 4.2cm,
  radius: 6pt,
  stroke: (dash: "dashed", paint: luma(150)),
  fill: if back { rgb("#fffde7") } else { white },
)[
  #align(center + horizon)[#body]
  #place(bottom + right, text(7pt, fill: luma(150))[#if back [answer] else [question]])
]

#let sheet(back) = grid(
  columns: (1fr, 1fr, 1fr),
  gutter: 0pt,
  ..cards.map(((country, capital)) => if back {
    card(back: true)[*#capital*]
  } else {
    card[What is the capital of \ *#country*?]
  }),
)

// Fronts, then backs; print double-sided and flip on the long edge.
#sheet(false)
#pagebreak()
#sheet(true)
