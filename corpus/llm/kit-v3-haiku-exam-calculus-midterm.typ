#show: exam.with(
  title: [Calculus Midterm: Limits and Derivatives],
  subject: [Mathematics],
  grade: [Grade 12],
  duration: [60 minutes],
  instructions: [Answer *all* questions. Show your working. Calculators are not permitted.],
)

= Section A: Limits

#question(points: 4)[
  Evaluate each limit.
  + $lim_(x -> 3) (x^2 - 9)/(x - 3)$
    #answer-space(height: 3em, answer: [Factor: $(x^2 - 9)/(x - 3) = (x + 3)(x - 3)/(x - 3) = x + 3$ for $x != 3$. So the limit is $3 + 3 = 6$.])
  + $lim_(x -> 0) (sin x)/x$
    #answer-space(height: 3em, answer: [This is the standard limit $lim_(x -> 0) (sin x)/x = 1$.])
]

#question(points: 3)[
  Let $f(x) = cases(x^2 + 1 & "if" x < 2, 3x - 1 & "if" x >= 2)$. Find $lim_(x -> 2^-) f(x)$ and $lim_(x -> 2^+) f(x)$. Does $lim_(x -> 2) f(x)$ exist? Justify your answer.
  #answer-space(height: 6em, answer: [From the left: $2^2 + 1 = 5$. From the right: $3(2) - 1 = 5$. Both one-sided limits equal 5, so $lim_(x -> 2) f(x) = 5$ exists.])
]

= Section B: Derivatives

#question(points: 3)[
  Differentiate $f(x) = 3x^4 - 2x^2 + 5x$ with respect to $x$.
  #answer-space(height: 4em, answer: [$f'(x) = 12x^3 - 4x + 5$])
]

#question(points: 4)[
  Differentiate each function.
  + $y = x^2 e^x$ (use the product rule)
    #answer-space(height: 4em, answer: [$y' = 2x e^x + x^2 e^x = x(x + 2)e^x$])
  + $y = (3x + 1)^5$ (use the chain rule)
    #answer-space(height: 4em, answer: [$y' = 5(3x + 1)^4 dot 3 = 15(3x + 1)^4$])
]

#question(points: 4)[
  Find the equation of the tangent line to $y = x^3 - x$ at the point where $x = 2$. Write your answer in the form $y = m x + c$.
  #answer-space(height: 6em, answer: [$f(2) = 8 - 2 = 6$, so the point is $(2, 6)$. $f'(x) = 3x^2 - 1$, so $m = f'(2) = 11$. Then $6 = 11(2) + c$ gives $c = -16$. The tangent line is $y = 11x - 16$.])
]

#question(points: 3)[
  Use the limit definition of the derivative to find $f'(x)$ when $f(x) = x^2$.
  #answer-space(height: 6em, answer: [$f'(x) = lim_(h -> 0) ((x + h)^2 - x^2)/h = lim_(h -> 0) (2x h + h^2)/h = lim_(h -> 0) (2x + h) = 2x$.])
]

= Section C: Applications

#question(points: 4)[
  A particle moves along a line so that its position at time $t$ seconds is $s(t) = t^3 - 6t^2 + 9t$ metres, for $t >= 0$.
  + Find the velocity $v(t)$.
  + Find the times when the particle is at rest.
  + Find the particle's acceleration at $t = 1$.

  #answer-space(height: 8em, answer: [
    (a) $v(t) = s'(t) = 3t^2 - 12t + 9$.

    (b) Set $v(t) = 0$: $3t^2 - 12t + 9 = 3(t - 1)(t - 3) = 0$, so $t = 1$ s and $t = 3$ s.

    (c) $a(t) = v'(t) = 6t - 12$, so $a(1) = -6$ m/s$^2$.
  ])
]

#question(points: 3)[
  Find and classify the critical points of $f(x) = x^3 - 3x$.
  #answer-space(height: 6em, answer: [$f'(x) = 3x^2 - 3 = 0$ gives $x = -1$ and $x = 1$. $f''(x) = 6x$. At $x = -1$, $f''(-1) = -6 < 0$, so $f$ has a local maximum there, with $f(-1) = 2$. At $x = 1$, $f''(1) = 6 > 0$, so $f$ has a local minimum there, with $f(1) = -2$.])
]

#answer-key()