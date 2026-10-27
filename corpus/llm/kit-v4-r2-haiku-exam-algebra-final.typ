#show: exam.with(
  title: [Algebra II Final Examination],
  subject: [Mathematics],
  grade: [Grade 11],
  duration: [90 minutes],
  instructions: [Answer *all* questions in all three sections. Show your working in the spaces provided. Calculators are permitted.],
)

= Section A: Multiple choice

#question(points: 2)[
  Solve $2x + 5 = 17$.
  #mcq([$x = 6$], [$x = 11$], [$x = 7$], [$x = 12$], answer: 1)
]

#question(points: 2)[
  What is the slope of the line through $(1, 2)$ and $(3, 8)$?
  #mcq([$2$], [$3$], [$1/3$], [$6$], answer: 2)
]

#question(points: 2)[
  Which expression is a factorization of $x^2 - 5x + 6$?
  #mcq([$(x - 1)(x - 6)$], [$(x + 2)(x + 3)$], [$(x - 2)(x - 3)$], [$(x + 1)(x + 6)$], answer: 3)
]

#question(points: 2)[
  Let $f(x) = 2x^2 - 3$. What is $f(-2)$?
  #mcq([$-3$], [$5$], [$11$], [$-11$], answer: 2)
]

#question(points: 2)[
  Which expression is equivalent to $x^(-2)$?
  #mcq([$x^2$], [$-2x$], [$1/x^2$], [$2/x$], answer: 3)
]

= Section B: Short answer

#question(points: 4)[
  + Solve the system $3x - y = 7$ and $x + y = 5$ for $x$ and $y$.
    #answer-lines(count: 1, answer: [$x = 3$, $y = 2$])
  + Simplify $(2x^3 y)(4x y^2)$.
    #answer-lines(count: 1, answer: [$8x^4 y^3$])
]

#question(points: 3)[
  Solve $x^2 - 6x + 5 = 0$ by factoring. Give both solutions.
  #answer-space(height: 4em, answer: [$(x - 1)(x - 5) = 0$, so $x = 1$ or $x = 5$.])
]

#question(points: 3)[
  Write the equation of the line with slope $-2$ that passes through $(0, 4)$ in slope-intercept form.
  #answer-space(height: 3em, answer: [$y = -2x + 4$])
]

= Section C: Extended response

#question(points: 8)[
  The length of a rectangle is 3 cm more than twice its width. The perimeter of the rectangle is 36 cm.
  Find the width and length of the rectangle, and its area. Show all steps.
  #answer-space(height: 9em, answer: [Let the width be $w$. Then the length is $2w + 3$, so $2(w + 2w + 3) = 36$, giving $6w + 6 = 36$ and $w = 5$. The length is $13$ cm and the area is $5 times 13 = 65$ cm$^2$.])
]

#question(points: 10)[
  The function $f(x) = x^2 - 4x - 5$ is given.
  + Find the coordinates of the vertex of the graph of $f$.
  + Find the $x$-intercepts and the $y$-intercept.
  + Sketch the graph on the coordinate plane below, marking the vertex and intercepts.

  #coordinate-plane(x: (-3, 7), y: (-10, 4), unit: 6mm, points: ((2, -9, [V]), (-1, 0, [A]), (5, 0, [B]), (0, -5, [C])))

  #answer[Vertex $(2, -9)$. Factoring gives $(x - 5)(x + 1)$, so the $x$-intercepts are $-1$ and $5$; the $y$-intercept is $-5$.]
]

#answer-key()