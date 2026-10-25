#set document(title: "Solving Linear Equations", author: "Ms. Rivera")
#set page(
  margin: 2cm,
  header: [_Algebra I_ #h(1fr) Unit 2: Linear Equations],
  footer: context [#h(1fr) Page #counter(page).display("1 of 1", both: true) #h(1fr)],
)
#set text(size: 11pt)
#set heading(numbering: "1.")

#let show-answers = true
#let blank = box(width: 3cm, repeat[.])

= Solving Linear Equations

*Objective:* Solve one-step and two-step linear equations and check the solution by substitution.

== Worked example

Solve $3x + 7 = 22$.

$
  3x + 7 &= 22 \
  3x &= 22 - 7 \
  3x &= 15 \
  x &= 5
$

*Check:* $3(5) + 7 = 15 + 7 = 22$ ✓

== One-step equations

#grid(
  columns: 3,
  row-gutter: 1.6em,
  column-gutter: 2em,
  [a) $x + 9 = 14$], [b) $y - 4 = 11$], [c) $6m = 42$],
  [d) $n/5 = 7$], [e) $-3k = 21$], [f) $p + 2.5 = 10$],
)

== Two-step equations

+ $2x + 5 = 17$ #h(1fr) $x =$ #blank
+ $4y - 3 = 25$ #h(1fr) $y =$ #blank
+ $x/3 + 4 = 10$ #h(1fr) $x =$ #blank
+ $7 - 2a = -9$ #h(1fr) $a =$ #blank
+ $(b + 4)/2 = 6$ #h(1fr) $b =$ #blank

== Equations with variables on both sides

+ $5x - 2 = 3x + 8$
+ $4(t - 1) = 2t + 10$
+ $1/2 (6z + 4) = 3z + 2$ #footnote[Careful: what happens to the $z$ terms?]

#if show-answers [
  #pagebreak()
  = Answer key <answers>

  #table(
    columns: (auto, 1fr),
    stroke: 0.5pt + gray,
    inset: 6pt,
    table.header([*Problem*], [*Answer*]),
    [1a–1f], [$x = 5$, $y = 15$, $m = 7$, $n = 35$, $k = -7$, $p = 7.5$],
    [2.1], [$x = 6$],
    [2.2], [$y = 7$],
    [2.3], [$x = 18$],
    [2.4], [$a = 8$],
    [2.5], [$b = 8$],
    [3.1], [$x = 5$],
    [3.2], [$t = 7$],
    [3.3], [Every real number is a solution (identity).],
  )
]
