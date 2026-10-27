#show: exam.with(
  title: [Algebra II Final Examination],
  subject: [Mathematics],
  grade: [Algebra II],
  duration: [90 minutes],
  instructions: [
    - Answer *all* questions. The paper is worth 100 points in total: Section A (20), Section B (30), Section C (50).
    - In Sections B and C, show your working. Answers without working may not earn full credit.
    - Calculators are allowed. Give exact answers unless a question asks you to round.
    - Suggested timing: Section A 20 minutes, Section B 30 minutes, Section C 40 minutes.
  ],
)

= Section A: Multiple choice (2 points each)

Circle the one best answer.

#question(points: 2)[
  Solve $|2 x - 3| = 7$.
  #mcq([$x = 5$ or $x = -2$], [$x = 5$ or $x = 2$], [$x = -5$ or $x = 2$], [$x = 2$ only], answer: 1)
]

#question(points: 2)[
  What are the solutions of $x^2 + 4 x + 13 = 0$?
  #mcq([$-2 plus.minus 3 i$], [$2 plus.minus 3 i$], [$-2 plus.minus 6 i$], [$-4 plus.minus 3 i$], answer: 1)
]

#question(points: 2)[
  What is the domain of $f(x) = sqrt(x - 3)/(x - 5)$?
  #mcq([$x >= 3$], [$x >= 3$ and $x != 5$], [$x > 3$ and $x != 5$], [$x != 5$], answer: 2)
]

#question(points: 2)[
  Simplify $(x^2 - 9)/(x^2 - x - 6)$ for $x != 3$ and $x != -2$.
  #mcq([$(x - 3)/(x + 2)$], [$(x + 3)/(x - 2)$], [$(x + 3)/(x + 2)$], [$x + 3$], answer: 3)
]

#question(points: 2)[
  Evaluate $log_3 81 - log_3 3$.
  #mcq([$1$], [$2$], [$3$], [$4$], answer: 3)
]

#question(points: 2)[
  What is the 5th term of the geometric sequence $3, 6, 12, dots$?
  #mcq([$24$], [$48$], [$96$], [$30$], answer: 2)
]

#question(points: 2)[
  What is the vertex of the parabola $y = x^2 - 6 x + 5$?
  #mcq([$(3, 4)$], [$(-3, -4)$], [$(3, -4)$], [$(6, 5)$], answer: 3)
]

#question(points: 2)[
  Describe the end behavior of $f(x) = -2 x^3 + x$.
  #mcq([Rises left, rises right], [Rises left, falls right], [Falls left, rises right], [Falls left, falls right], answer: 2)
]

#question(points: 2)[
  Solve $2^(x + 1) = 32$.
  #mcq([$x = 3$], [$x = 4$], [$x = 5$], [$x = 15$], answer: 2)
]

#question(points: 2)[
  What is the inverse of $f(x) = 2 x + 6$?
  #mcq([$f^(-1)(x) = (x - 6)/2$], [$f^(-1)(x) = (x + 6)/2$], [$f^(-1)(x) = 2 x - 6$], [$f^(-1)(x) = x/2 + 6$], answer: 1)
]

= Section B: Short answer (5 points each)

#question(points: 5)[
  Solve $x^2 - 5 x - 14 = 0$ by factoring.
  #answer-space(height: 5em, answer: [$(x - 7)(x + 2) = 0$, so $x = 7$ or $x = -2$.])
]

#question(points: 5)[
  Solve the inequality $3 x - 2 < 7 x + 10$ and write the solution set.
  #answer-space(height: 5em, answer: [$-12 < 4 x$, so $x > -3$.])
]

#question(points: 5)[
  Divide $x^3 - 2 x^2 - 5 x + 6$ by $x - 3$. State the quotient and the remainder.
  #answer-space(height: 6em, answer: [Synthetic division with 3 gives $1, 1, -2, 0$. Quotient $x^2 + x - 2$, remainder $0$.])
]

#question(points: 5)[
  Solve $sqrt(x + 6) = x$ and check for extraneous solutions.
  #answer-space(height: 6em, answer: [Squaring: $x + 6 = x^2$, so $x^2 - x - 6 = 0$ and $x = 3$ or $x = -2$. Check: $x = -2$ gives $sqrt(4) = 2 != -2$, so it is extraneous. The solution is $x = 3$.])
]

#question(points: 5)[
  Solve $log_2 (x + 1) + log_2 (x - 1) = 3$.
  #answer-space(height: 6em, answer: [$log_2 (x^2 - 1) = 3$, so $x^2 - 1 = 8$ and $x = 3$ or $x = -3$. Since $x - 1$ must be positive, $x = -3$ is rejected. The solution is $x = 3$.])
]

#question(points: 5)[
  Let $f(x) = x^2 + 1$ and $g(x) = 3 x - 4$. Find $(f compose g)(2)$ and $(g compose f)(x)$.
  #answer-space(height: 6em, answer: [$g(2) = 2$, so $(f compose g)(2) = f(2) = 5$. Also $(g compose f)(x) = 3(x^2 + 1) - 4 = 3 x^2 - 1$.])
]

= Section C: Extended response

#question(points: 15)[
  A ball is thrown upward from a platform. Its height in feet after $t$ seconds is
  $ h(t) = -16 t^2 + 48 t + 64. $
  + What is the height of the platform? #h(1fr) (2 points)
    #answer-space(height: 3em, answer: [$h(0) = 64$ feet.])
  + Find the time at which the ball reaches its maximum height, and find that height. #h(1fr) (5 points)
    #answer-space(height: 6em, answer: [$t = -48/(2(-16)) = 1.5$ seconds. $h(1.5) = -36 + 72 + 64 = 100$ feet.])
  + How long does it take for the ball to hit the ground? #h(1fr) (5 points)
    #answer-space(height: 6em, answer: [$-16 t^2 + 48 t + 64 = 0$ gives $t^2 - 3 t - 4 = 0$, so $(t - 4)(t + 1) = 0$. Only $t = 4$ seconds is valid.])
  + At what times is the ball 84 feet above the ground? #h(1fr) (3 points)
    #answer-space(height: 6em, answer: [$-16 t^2 + 48 t + 64 = 84$ gives $4 t^2 - 12 t + 5 = 0$, so $(2 t - 1)(2 t - 5) = 0$. The ball is at 84 feet when $t = 0.5$ s and $t = 2.5$ s.])
]

#question(points: 15)[
  An account is opened with \$2000 and earns 5% interest compounded annually, so the balance after $t$ years is $A = 2000(1.05)^t$.
  + Find the balance after 10 years, to the nearest cent. #h(1fr) (4 points)
    #answer-space(height: 4em, answer: [$A = 2000(1.05)^10 approx 2000(1.628895) approx \$3257.79$.])
  + Write and solve an equation to find how long it takes for the balance to double. Give your answer to the nearest tenth of a year. #h(1fr) (8 points)
    #answer-space(height: 8em, answer: [$2000(1.05)^t = 4000$, so $(1.05)^t = 2$. Then $t ln(1.05) = ln 2$ and $t = ln 2 / ln 1.05 approx 14.2$ years.])
  + Explain why this account's growth is exponential and not linear. #h(1fr) (3 points)
    #answer-lines(count: 2, answer: [Each year the balance is multiplied by the same factor, 1.05, so the amount added each year grows. A linear account would add the same amount every year.])
]

#question(points: 10)[
  Consider the rational function $f(x) = (x - 2)/(x^2 - x - 6)$.
  + State the domain of $f$. #h(1fr) (2 points)
    #answer-space(height: 3em, answer: [$x^2 - x - 6 = (x - 3)(x + 2)$, so the domain is all real $x$ with $x != 3$ and $x != -2$.])
  + Find the equations of the vertical asymptotes. #h(1fr) (2 points)
    #answer-space(height: 3em, answer: [$x = 3$ and $x = -2$ (nothing cancels).])
  + Find the equation of the horizontal asymptote. #h(1fr) (2 points)
    #answer-space(height: 3em, answer: [The degree of the denominator is greater than that of the numerator, so $y = 0$.])
  + Find the $x$-intercept and the $y$-intercept. #h(1fr) (4 points)
    #answer-space(height: 5em, answer: [$x$-intercept: $x - 2 = 0$, so $(2, 0)$. $y$-intercept: $f(0) = (-2)/(-6) = 1/3$, so $(0, 1/3)$.])
]

#question(points: 10)[
  Solve the system of equations. Show your working.
  $ x + y + z &= 6 \ 2 x - y + z &= 3 \ x + 2 y - z &= 2 $
  #answer-space(height: 12em, answer: [Adding equations 1 and 3: $2 x + 3 y = 8$. Adding equations 2 and 3: $3 x + y = 5$, so $y = 5 - 3 x$. Then $2 x + 15 - 9 x = 8$, so $x = 1$ and $y = 2$. From equation 1, $z = 3$. The solution is $(1, 2, 3)$. Check in equation 2: $2 - 2 + 3 = 3$.])
]

#rubric(
  ([Method (Section C)], [Complete, correct method], [Minor gaps in method], [Partial method], [Little or no valid method]),
  ([Accuracy (Section C)], [No errors], [One small error], [Several errors], [Mostly incorrect]),
  ([Communication (Section C)], [Clear, organized working with units], [Mostly clear], [Hard to follow], [No working shown]),
  points: (3, 2, 1, 0),
)

#answer-key()