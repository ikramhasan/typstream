#show: exam.with(
  title: [Algebra II Final Examination],
  subject: [Mathematics],
  grade: [Grade 11],
  duration: [90 minutes],
  instructions: [Answer *all* questions in the three sections. Show your working for every question in Sections B and C. Calculators are permitted.],
)

= Section A: Multiple choice (10 points)

#question(points: 2)[
  Which expression is equivalent to $(2 x^3 y)(3 x y^2)$?
  #mcq($6 x^4 y^3$, $5 x^4 y^3$, $6 x^3 y^2$, $6 x^3 y^3$, answer: 1)
]

#question(points: 2)[
  The solutions of $x^2 - 5x + 6 = 0$ are:
  #mcq($x = 2$ and $x = 3$, $x = -2$ and $x = -3$, $x = 1$ and $x = 6$, $x = -1$ and $x = -6$, answer: 1)
]

#question(points: 2)[
  What is the slope of the line through $(1, 4)$ and $(5, 12)$?
  #mcq([$1/2$], [$2$], [$4$], [$8$], answer: 2)
]

#question(points: 2)[
  If $f(x) = 2 x + 3$, what is $f(-4)$?
  #mcq([$-11$], [$-5$], [$5$], [$11$], answer: 1)
]

#question(points: 2)[
  Which of the following is the inverse of $f(x) = 3 x - 6$?
  #mcq($f^(-1)(x) = (x + 6)/3$, $f^(-1)(x) = (x - 6)/3$, $f^(-1)(x) = 3 x + 6$, $f^(-1)(x) = x/3 - 6$, answer: 1)
]

= Section B: Short answer (16 points)

#question(points: 4)[
  Solve each equation. Show your working.
  + $3(x - 2) + 4 = 2 x + 7$
    #answer-space(height: 3em, answer: [$3x - 6 + 4 = 2x + 7$, so $x = 9$.])
  + $(x + 1)/2 - (x - 3)/3 = 2$
    #answer-space(height: 3em, answer: [Multiply by 6: $3(x + 1) - 2(x - 3) = 12$, so $x + 9 = 12$ and $x = 3$.])
]

#question(points: 4)[
  Factor each expression completely.
  + $x^2 + 7x + 12$
    #answer-space(height: 2.5em, answer: [$(x + 3)(x + 4)$])
  + $4 y^2 - 9$
    #answer-space(height: 2.5em, answer: [$(2 y - 3)(2 y + 3)$])
]

#question(points: 4)[
  Solve $x^2 - 6x + 2 = 0$ using the quadratic formula. Give your answers in simplest radical form.
  #answer-space(height: 6em, answer: [
    $x = (6 plus.minus sqrt(36 - 8))/2 = (6 plus.minus sqrt(28))/2 = 3 plus.minus sqrt(7)$
  ])
]

#question(points: 4)[
  Simplify $(2 x^(-2) y^3)^3 / (4 x y^(-1))$, writing your answer with positive exponents.
  #answer-space(height: 4em, answer: [$(8 x^(-6) y^9)/(4 x y^(-1)) = 2 x^(-7) y^10 = (2 y^10)/x^7$])
]

= Section C: Extended response (24 points)

#question(points: 12)[
  A rectangular garden has a length that is 4 metres more than its width. Its area is 96 square metres.
  + Write an equation for the area in terms of the width $w$.
    #answer-space(height: 3em, answer: [$w(w + 4) = 96$, so $w^2 + 4w - 96 = 0$.])
  + Solve the equation and find the dimensions of the garden.
    #answer-space(height: 7em, answer: [$(w + 12)(w - 8) = 0$, so $w = 8$ (the negative root is rejected). The width is 8 m and the length is 12 m.])
  + Find the perimeter of the garden, in metres.
    #answer-space(height: 3em, answer: [$P = 2(8) + 2(12) = 40$ m.])
]

#question(points: 12)[
  The function $f(x) = x^2 - 4x - 5$ is graphed for all real $x$.
  + Find the $x$-intercepts and the $y$-intercept of the graph.
    #answer-space(height: 4em, answer: [$x$-intercepts: $(5, 0)$ and $(-1, 0)$. $y$-intercept: $(0, -5)$.])
  + Find the vertex of the parabola and state whether it is a minimum or a maximum.
    #answer-space(height: 5em, answer: [$x = 2$, $f(2) = -9$. Vertex $(2, -9)$; it is a minimum since the leading coefficient is positive.])
  + Explain how the graph of $g(x) = f(x - 3)$ differs from the graph of $f$.
    #answer-lines(count: 3, answer: [The graph of $g$ is the graph of $f$ shifted 3 units to the right.])
]

#rubric(
  ([Method], [Complete, justified method.], [Correct method, minor gaps.], [Partly correct method.], [No method shown.]),
  ([Accuracy], [All answers correct.], [One arithmetic error.], [Several errors.], [Incorrect.]),
  points: (2, 1.5, 1, 0),
)

#answer-key()