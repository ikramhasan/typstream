#show: exam.with(
  title: [Calculus Midterm: Limits and Derivatives],
  subject: [Mathematics],
  grade: [Year 12],
  duration: [60 minutes],
  instructions: [Answer *all* questions. Show all working. Simplify your final answers where possible.],
)

= Part A: Limits

#question(points: 4)[
  Evaluate $lim_(x -> 2) (x^2 - 4)/(x - 2)$.
  #answer-space(height: 4em, answer: [Factor the numerator: $(x^2 - 4)/(x - 2) = (x - 2)(x + 2)/(x - 2) = x + 2$ for $x != 2$. So the limit is $2 + 2 = 4$.])
]

#question(points: 4)[
  Evaluate $lim_(x -> 0) (sin x)/x$.
  #answer-space(height: 4em, answer: [This is the standard limit $lim_(x -> 0) (sin x)/x = 1$.])
]

#question(points: 4)[
  Evaluate $lim_(x -> infinity) (3x^2 + 1)/(x^2 - 5x)$.
  #answer-space(height: 5em, answer: [Divide numerator and denominator by $x^2$: $(3 + 1/x^2)/(1 - 5/x)$. As $x -> infinity$ the fractions go to $0$, so the limit is $3/1 = 3$.])
]

= Part B: Derivatives

#question(points: 6)[
  Let $f(x) = 3x^4 - 2x^2 + 5x - 7$.
  + Find $f'(x)$.
    #answer-space(height: 4em, answer: [$f'(x) = 12x^3 - 4x + 5$.])
  + Hence find $f'(2)$.
    #answer-space(height: 3em, answer: [$f'(2) = 12 dot 8 - 8 + 5 = 96 - 8 + 5 = 93$.])
]

#question(points: 6)[
  Differentiate $y = x^2 e^(3x)$ with respect to $x$. Use the product rule and simplify.
  #answer-space(height: 6em, answer: [Product rule: $(d y)/(d x) = 2x e^(3x) + x^2 dot 3 e^(3x) = e^(3x)(2x + 3x^2) = x e^(3x)(2 + 3x)$.])
]

#question(points: 6)[
  Find the equation of the tangent line to $y = x^3 - x$ at the point where $x = 1$. Give your answer in the form $y = m x + c$.
  #answer-space(height: 6em, answer: [At $x = 1$: $y = 1 - 1 = 0$. The derivative is $(d y)/(d x) = 3x^2 - 1$, so $m = 3 - 1 = 2$. The tangent is $y - 0 = 2(x - 1)$, so $y = 2x - 2$.])
]

#question(points: 6)[
  Differentiate $g(x) = sqrt(x^2 + 1)$ using the chain rule.
  #answer-space(height: 6em, answer: [Write $g(x) = (x^2 + 1)^(1/2)$. Then $g'(x) = 1/2 (x^2 + 1)^(-1/2) dot 2x = x/sqrt(x^2 + 1)$.])
]

= Part C: Continuity and Application

#question(points: 8)[
  Let $f(x) = (x^2 - 9)/(x - 3)$ for $x != 3$, and $f(3) = k$.
  + Simplify $f(x)$ for $x != 3$ and hence find $lim_(x -> 3) f(x)$.
    #answer-space(height: 4em, answer: [$f(x) = (x - 3)(x + 3)/(x - 3) = x + 3$, so $lim_(x -> 3) f(x) = 6$.])
  + Find the value of $k$ that makes $f$ continuous at $x = 3$.
    #answer-space(height: 3em, answer: [Continuity requires $f(3) = lim_(x -> 3) f(x)$, so $k = 6$.])
]

#question(points: 6)[
  A rectangle has perimeter $20$ cm. Let its width be $x$ cm. Show that its area is $A(x) = 10x - x^2$, and find the value of $x$ that maximises the area. Justify that it is a maximum.
  #answer-space(height: 8em, answer: [Length $= 10 - x$, so $A(x) = x(10 - x) = 10x - x^2$. Then $A'(x) = 10 - 2x = 0$ gives $x = 5$. Since $A''(x) = -2 < 0$, this is a maximum. The maximum area is $25$ cm$^2$ at $x = 5$, so the rectangle is a $5$ cm by $5$ cm square.])
]