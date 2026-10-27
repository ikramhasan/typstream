#show: exam.with(
  title: [Algebra II Final Examination],
  subject: [Mathematics],
  grade: [Grade 11],
  duration: [90 minutes],
  instructions: [
    Answer *all* questions. The paper has three sections and is worth 100 points in total.
    - Section A: multiple choice, 2 points each. Circle one answer.
    - Section B: short answer, 5 points each. Show your working.
    - Section C: extended response. Points for each part are shown in brackets.
    A scientific or graphing calculator is allowed.
  ],
)

= Section A: Multiple Choice (20 points)

#question(points: 2)[
  Solve $|2 x - 3| = 7$.
  #mcq([$x = 5$ or $x = -2$], [$x = 5$ or $x = 2$], [$x = -5$ or $x = 2$], [$x = 10$ or $x = -4$], answer: 1)
]

#question(points: 2)[
  What is the vertex of $f(x) = x^2 - 6 x + 14$?
  #mcq([$(3, 5)$], [$(-3, 5)$], [$(3, -5)$], [$(5, 3)$], answer: 1)
]

#question(points: 2)[
  What is the sum of the roots of $2 x^2 - 8 x + 3 = 0$?
  #mcq([$-4$], [$4$], [$3/2$], [$-3/2$], answer: 2)
]

#question(points: 2)[
  Simplify $(2 + 3 i)(1 - i)$.
  #mcq([$5 + i$], [$5 - i$], [$-1 + i$], [$2 - 3 i$], answer: 1)
]

#question(points: 2)[
  What is the domain of $f(x) = sqrt(x - 4)$?
  #mcq([$x >= 4$], [$x > 4$], [$x <= 4$], [All real numbers], answer: 1)
]

#question(points: 2)[
  Evaluate $log_3 81$.
  #mcq([$3$], [$4$], [$9$], [$27$], answer: 2)
]

#question(points: 2)[
  What is the inverse of $f(x) = 2 x + 6$?
  #mcq([$(x - 6)/2$], [$(x + 6)/2$], [$2 x - 6$], [$1/(2 x + 6)$], answer: 1)
)

#question(points: 2)[
  Describe the end behavior of $f(x) = -3 x^4 + x$.
  #mcq([Falls to the left, rises to the right], [Rises to the left and to the right], [Falls to the left and to the right], [Rises to the left, falls to the right], answer: 3, columns: 1)
]

#question(points: 2)[
  Solve $2^(x + 1) = 16$.
  #mcq([$x = 2$], [$x = 3$], [$x = 4$], [$x = 7$], answer: 2)
]

#question(points: 2)[
  What is the horizontal asymptote of $f(x) = (3 x^2 + 1)/(x^2 - 4)$?
  #mcq([$y = 0$], [$y = 3$], [$y = -1/4$], [$x = 2$], answer: 2)
]

= Section B: Short Answer (30 points)

#question(points: 5)[
  Solve $x^2 + 4 x - 12 = 0$ by factoring.
  #answer-space(height: 6em, answer: [$(x + 6)(x - 2) = 0$, so $x = -6$ or $x = 2$.])
]

#question(points: 5)[
  Use the quadratic formula to solve $x^2 - 4 x + 13 = 0$. Write your answers in the form $a + b i$.
  #answer-space(height: 7em, answer: [
    $x = (4 plus.minus sqrt(16 - 52))/2 = (4 plus.minus 6 i)/2 = 2 plus.minus 3 i$.
  ])
]

#question(points: 5)[
  Solve $log_2 (x + 3) + log_2 (x - 3) = 4$. Check for extraneous solutions.
  #answer-space(height: 8em, answer: [
    $log_2 (x^2 - 9) = 4$, so $x^2 - 9 = 16$ and $x = plus.minus 5$. For $x = -5$ the logarithms are undefined, so it is extraneous. The solution is $x = 5$.
  ])
]

#question(points: 5)[
  Simplify $(x^2 - 9)/(x^2 + x - 6)$ and state the values of $x$ that are excluded.
  #answer-space(height: 7em, answer: [
    $((x - 3)(x + 3))/((x + 3)(x - 2)) = (x - 3)/(x - 2)$, with $x != -3$ and $x != 2$.
  ])
]

#question(points: 5)[
  Let $f(x) = x^2 + 1$ and $g(x) = 3 x - 2$. Find $f(g(2))$ and $g(f(x))$.
  #answer-space(height: 7em, answer: [
    $g(2) = 4$, so $f(g(2)) = f(4) = 17$. \
    $g(f(x)) = 3(x^2 + 1) - 2 = 3 x^2 + 1$.
  ])
]

#question(points: 5)[
  Solve the compound inequality $-3 < 2 x + 1 <= 9$ and graph the solution on the number line.
  #answer-space(height: 4em, answer: [
    $-4 < 2 x <= 8$, so $-2 < x <= 4$.
    #number-line(from: -5, to: 6, length: 11cm, open-points: (-2,), points: (4,))
  ])
  #number-line(from: -5, to: 6, length: 11cm)
]

= Section C: Extended Response (50 points)

#question(points: 12)[
  Consider the function $f(x) = x^2 - 6 x + 5$.
  + Rewrite $f(x)$ in vertex form by completing the square. (3 pts)
    #answer-space(height: 5em, answer: [$f(x) = (x - 3)^2 - 4$.])
  + State the vertex and the axis of symmetry. (2 pts)
    #answer-space(height: 3em, answer: [Vertex $(3, -4)$; axis of symmetry $x = 3$.])
  + Find the $x$-intercepts. (3 pts)
    #answer-space(height: 5em, answer: [$(x - 1)(x - 5) = 0$, so $x = 1$ and $x = 5$.])
  + Sketch the graph of $f$ on the grid, labelling the vertex and the intercepts. (4 pts)
    #coordinate-plane(x: (-1, 7), y: (-5, 6), unit: 6mm)
    #answer[
      Upward parabola through $(1, 0)$, $(5, 0)$ and $(0, 5)$, with vertex $(3, -4)$.
      #coordinate-plane(x: (-1, 7), y: (-5, 6), unit: 6mm, points: ((3, -4, [V]), (1, 0), (5, 0), (0, 5)))
    ]
]

#question(points: 12)[
  Let $p(x) = x^3 - 2 x^2 - 5 x + 6$.
  + Show that $x = 1$ is a root of $p$. (2 pts)
    #answer-space(height: 4em, answer: [$p(1) = 1 - 2 - 5 + 6 = 0$.])
  + Factor $p(x)$ completely. (4 pts)
    #answer-space(height: 6em, answer: [
      Dividing by $(x - 1)$ gives $p(x) = (x - 1)(x^2 - x - 6) = (x - 1)(x - 3)(x + 2)$.
    ])
  + State all zeros of $p$. (2 pts)
    #answer-space(height: 3em, answer: [$x = -2$, $x = 1$, $x = 3$.])
  + Solve $p(x) > 0$. (4 pts)
    #answer-space(height: 6em, answer: [
      The leading coefficient is positive, so $p$ is positive between $-2$ and $1$ and after $3$. \
      Solution: $(-2, 1) union (3, infinity)$.
    ])
]

#question(points: 13)[
  A culture starts with 500 bacteria, and the population doubles every 3 hours.
  + Write a function $P(t)$ for the population after $t$ hours. (3 pts)
    #answer-space(height: 4em, answer: [$P(t) = 500 dot 2^(t/3)$.])
  + How many bacteria are there after 12 hours? (3 pts)
    #answer-space(height: 4em, answer: [$P(12) = 500 dot 2^4 = 8000$.])
  + After how many hours will the population reach 32 000? (4 pts)
    #answer-space(height: 6em, answer: [
      $500 dot 2^(t/3) = 32000$, so $2^(t/3) = 64 = 2^6$. Then $t/3 = 6$ and $t = 18$ hours.
    ])
  + Explain why this model would not stay realistic over a long time. (3 pts)
    #answer-lines(count: 2, answer: [Resources such as food and space are limited, so growth slows and levels off rather than doubling forever.])
]

#question(points: 13)[
  Consider the line $y = x + 1$ and the parabola $y = x^2 - 3 x + 5$.
  + Solve the system algebraically. (5 pts)
    #answer-space(height: 7em, answer: [
      $x + 1 = x^2 - 3 x + 5$ gives $x^2 - 4 x + 4 = 0$, so $(x - 2)^2 = 0$ and $x = 2$. Then $y = 3$. The solution is $(2, 3)$.
    ])
  + What does the number of solutions tell you about the graphs? (3 pts)
    #answer-lines(count: 2, answer: [There is exactly one solution (a double root), so the line touches the parabola at one point: it is tangent to it.])
  + For which values of $k$ does the line $y = x + k$ intersect the parabola in two distinct points? (5 pts)
    #answer-space(height: 7em, answer: [
      $x + k = x^2 - 3 x + 5$ gives $x^2 - 4 x + (5 - k) = 0$. The discriminant is $16 - 4(5 - k) = 4 k - 4$. Two distinct points need $4 k - 4 > 0$, so $k > 1$.
    ])
]

#answer-key()