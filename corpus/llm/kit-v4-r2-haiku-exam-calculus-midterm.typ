#show: exam.with(
  title: [Calculus Midterm: Limits and Derivatives],
  subject: [Mathematics],
  grade: [Grade 12],
  duration: [60 minutes],
  instructions: [Answer *all* questions. Show all working. Calculators are not permitted.],
)

= Section A: Limits

#question(points: 6)[
  Evaluate each limit.
  + $lim_(x -> 3) (x^2 - 9)/(x - 3)$ #answer-space(height: 2.5em, answer: [Factor: $(x^2 - 9)/(x - 3) = x + 3$ for $x != 3$, so the limit is $6$.])
  + $lim_(x -> 0) (sin(3 x))/x$ #answer-space(height: 2.5em, answer: [Use $lim_(u -> 0) (sin u)/u = 1$ with $u = 3x$: $lim (sin(3x))/x = 3 dot 1 = 3$.])
  + $lim_(x -> oo) (2 x^2 + 1)/(5 x^2 - x)$ #answer-space(height: 2.5em, answer: [Divide top and bottom by $x^2$: $(2 + 1/x^2)/(5 - 1/x) -> 2/5$.])
]

#question(points: 4)[
  Let $f(x) = cases(x^2 - 4 & "if" x != 2, k & "if" x = 2)$. Find the value of $k$ that makes $f$ continuous at $x = 2$.
  #answer-space(height: 4em, answer: [$lim_(x -> 2) (x^2 - 4)/(x - 2) = lim_(x -> 2) (x + 2) = 4$. Continuity requires $f(2) = 4$, so $k = 4$.])
]

= Section B: Derivatives

#question(points: 8)[
  Differentiate each function with respect to $x$.
  + $f(x) = 3 x^4 - 2 x^2 + 7$ #answer-space(height: 2.5em, answer: [$f'(x) = 12 x^3 - 4 x$.])
  + $g(x) = x^2 sin x$ #answer-space(height: 2.5em, answer: [Product rule: $g'(x) = 2 x sin x + x^2 cos x$.])
  + $h(x) = (x + 1)/(x^2 + 1)$ #answer-space(height: 4em, answer: [Quotient rule: $h'(x) = ((x^2 + 1) - (x + 1)(2 x))/(x^2 + 1)^2 = (-x^2 - 2 x + 1)/(x^2 + 1)^2$.])
]

#question(points: 4)[
  Use the chain rule to find $(d y)/(d x)$ for each function.
  + $y = (3 x - 5)^7$ #answer-space(height: 2.5em, answer: [$(d y)/(d x) = 7 (3 x - 5)^6 dot 3 = 21 (3 x - 5)^6$.])
  + $y = sqrt(x^2 + 4)$ #answer-space(height: 2.5em, answer: [$(d y)/(d x) = (2 x)/(2 sqrt(x^2 + 4)) = x/sqrt(x^2 + 4)$.])
]

#question(points: 5)[
  Find the equation of the tangent line to $y = x^3 - 2 x$ at the point where $x = 1$.
  #answer-space(height: 5em, answer: [$y(1) = -1$ and $y' = 3 x^2 - 2$, so the slope at $x = 1$ is $1$. The tangent is $y = -1 + (x - 1)$, i.e. $y = x - 2$.])
]

#question(points: 5)[
  A particle moves along a line so that its position at time $t$ seconds is $s(t) = t^3 - 6 t^2 + 9 t$ metres.
  + Find the velocity $v(t) = s'(t)$. #answer-space(height: 2.5em, answer: [$v(t) = 3 t^2 - 12 t + 9$.])
  + Find the times when the particle is momentarily at rest. #answer-space(height: 2.5em, answer: [$3 t^2 - 12 t + 9 = 3(t - 1)(t - 3) = 0$, so $t = 1$ s and $t = 3$ s.])
  + Find the acceleration at $t = 4$ s. #answer-space(height: 2.5em, answer: [$a(t) = v'(t) = 6 t - 12$, so $a(4) = 12$ m/s$^2$.])
]

= Section C: Concepts

#question(points: 2)[
  Which is the derivative of $ln x$?
  #mcq([$e^x$], [$1/x$], [$x ln x$], [$ln x / x$], answer: 2)
  #answer[The derivative of $ln x$ is $1/x$ for $x > 0$.]
]

#question(points: 2)[
  What is $lim_(x -> 0) (1 - cos x)/x$?
  #mcq([$0$], [$1$], [$1/2$], [does not exist], answer: 1)
  #answer[Since $1 - cos x$ approaches $0$ and is divided by $x$ with the ratio tending to $0$ (it behaves like $x^2/2$), the limit is $0$.]
]

#question(points: 3)[
  Explain why a function that is differentiable at a point must be continuous at that point.
  #answer-lines(count: 3, answer: [Differentiability means $lim_(h -> 0) (f(a + h) - f(a))/h$ exists. Multiplying by $h$, $f(a+h) - f(a) = h dot (f(a+h)-f(a))/h -> 0 dot f'(a) = 0$, so $lim_(h -> 0) f(a + h) = f(a)$, which is continuity.])
]