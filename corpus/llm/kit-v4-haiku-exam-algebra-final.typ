#show: exam.with(
  title: [Algebra II Final Examination],
  subject: [Mathematics],
  grade: [Grade 11],
  duration: [90 minutes],
  instructions: [Answer *all* questions in all three sections. Show your working in Section B and Section C. Calculators are permitted.],
)

= Section A: Multiple choice

#question(points: 2)[
  Solve $2x - 5 = 11$.
  #mcq([$x = 3$], [$x = 8$], [$x = -3$], [$x = 6$], answer: 2)
]

#question(points: 2)[
  What is the vertex of the parabola $y = (x - 2)^2 + 3$?
  #mcq([$(2, 3)$], [$(-2, 3)$], [$(2, -3)$], [$(3, 2)$], answer: 1)
]

#question(points: 2)[
  Simplify $x^2 dot x^3$.
  #mcq([$x^5$], [$x^6$], [$2x^5$], [$x^1$], answer: 1)
]

#question(points: 2)[
  Which linear function has a slope of $-2$?
  #mcq([$y = 2x + 1$], [$y = x - 2$], [$y = -2x + 5$], [$y = -x/2 + 3$], answer: 3)
]

= Section B: Short answer

#question(points: 3)[
  Solve $3(x - 4) = 2x + 1$.
  #answer-space(height: 4em, answer: [$3x - 12 = 2x + 1$, so $x = 13$.])
  
  #blank(answer: [$x = 13$])
]

#question(points: 3)[
  Factor completely: $x^2 - 5x + 6$.
  #answer-lines(count: 2, answer: [$(x - 2)(x - 3)$. Check: the factors multiply to $6$ and add to $-5$.])
]

#question(points: 4)[
  Solve the system of equations:
  $ x + y = 7 $
  $ x - y = 1 $
  + Find the value of $x$.
    #answer-space(height: 2.5em, answer: [Adding the equations gives $2x = 8$, so $x = 4$.])
  + Find the value of $y$.
    #answer-space(height: 2.5em, answer: [Substituting $x = 4$ gives $y = 3$.])
]

#question(points: 2)[
  Let $f(x) = x^2 - 1$. Find $f(-2)$.
  #blank(width: 3em, answer: [$3$])
]

= Section C: Extended response

#question(points: 6)[
  Solve $x^2 - 4x - 5 = 0$ by factoring. Show each step and state both solutions.
  #answer-space(height: 9em, answer: [$x^2 - 4x - 5 = (x - 5)(x + 1) = 0$, so $x = 5$ or $x = -1$.])
]

#question(points: 6)[
  A bacteria culture starts with $500$ cells and doubles every $3$ hours. The number of cells after $t$ hours is $P(t) = 500 dot 2^(t/3)$.
  + Find $P(0)$ and explain what it represents.
    #answer-lines(count: 2, answer: [$P(0) = 500$. It is the starting number of cells.])
  + Find $P(9)$.
    #answer-space(height: 4em, answer: [$P(9) = 500 dot 2^3 = 4000$ cells.])
  + Explain why the function is exponential rather than linear.
    #answer-lines(count: 3, answer: [The population is multiplied by a constant factor, $2$, over equal time intervals. A linear function would instead add a constant amount each interval.])
]

#answer-key()