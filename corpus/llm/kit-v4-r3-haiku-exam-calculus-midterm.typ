#show: exam.with(
  title: [Calculus Midterm: Limits and Derivatives],
  subject: [Mathematics],
  duration: [60 minutes],
  instructions: [Answer *all* questions. Show your working. Calculators are not permitted.],
)

= Section A: Limits

#question(points: 2)[
  Evaluate $lim_(x -> 2) (x^2 - 4)/(x - 2)$.
  #answer-space(height: 4em, answer: [Factor: $(x^2 - 4)/(x - 2) = (x + 2)(x - 2)/(x - 2) = x + 2$ for $x != 2$, so the limit is $4$.])
]

#question(points: 2)[
  Evaluate $lim_(x -> 0) (sin 3x)/x$.
  #answer-space(height: 4em, answer: [Write $(sin 3x)/x = 3 dot (sin 3x)/(3x)$. Using $lim_(u -> 0) (sin u)/u = 1$ with $u = 3x$, the limit is $3$.])
]

#question(points: 3)[
  Let $f(x) = cases((x^2 - 1)/(x - 1) "if" x != 1, c "if" x = 1)$. Find the value of $c$ that makes $f$ continuous at $x = 1$.
  #answer-space(height: 5em, answer: [$lim_(x -> 1) (x^2 - 1)/(x - 1) = lim_(x -> 1) (x + 1) = 2$. Continuity requires $c = 2$.])
]

= Section B: Differentiation

#question(points: 2)[
  Find $(d y)/(d x)$ when $y = 3x^4 - 2x^2 + 5x - 7$.
  #answer-space(height: 4em, answer: [$(d y)/(d x) = 12x^3 - 4x + 5$])
]

#question(points: 3)[
  Use the product rule to find $(d y)/(d x)$ when $y = x^2 sin x$.
  #answer-space(height: 6em, answer: [$(d y)/(d x) = 2x sin x + x^2 cos x$])
]

#question(points: 3)[
  Use the chain rule to find $(d y)/(d x)$ when $y = (3x + 1)^5$.
  #answer-space(height: 5em, answer: [Let $u = 3x + 1$. Then $(d y)/(d x) = 5u^4 dot 3 = 15(3x + 1)^4$.])
]

#question(points: 3)[
  Find $(d y)/(d x)$ by implicit differentiation when $x^2 + y^2 = 25$.
  #answer-space(height: 5em, answer: [Differentiate: $2x + 2y (d y)/(d x) = 0$, so $(d y)/(d x) = -x/y$.])
]

#question(points: 1)[
  What is $d/(d x) ln x$?
  #mcq([$x$], [$1/x$], [$ln x / x$], [$e^x$], answer: 2)
]

= Section C: Applications

#question(points: 4)[
  Find the equation of the tangent line to $y = x^3$ at $x = 2$.
  #answer-space(height: 7em, answer: [The point is $(2, 8)$. The slope is $y' = 3x^2 = 12$. So $y - 8 = 12(x - 2)$, which gives $y = 12x - 16$.])
]

#question(points: 5)[
  A farmer has $40$ m of fencing to enclose a rectangular pen. Let the sides be $x$ and $y$ metres.
  + Write the area $A$ as a function of $x$ alone.
  + Find the value of $x$ that maximises $A$, and state the maximum area.
  #answer-space(height: 12em, answer: [
    + Perimeter: $2x + 2y = 40$, so $y = 20 - x$. Then $A = x(20 - x) = 20x - x^2$.
    + $A' = 20 - 2x = 0$ gives $x = 10$. Since $A'' = -2 < 0$, this is a maximum. Then $y = 10$ and $A = 100$ m$^2$. The maximum area is $100$ m$^2$, for a $10$ m by $10$ m square.
  ])
]

#question(points: 3)[
  Explain in one or two sentences why a function that is differentiable at a point must also be continuous there.
  #answer-lines(count: 2, answer: [Differentiability means the limit of the difference quotient exists, which requires $f(x) - f(a) = (f(x) - f(a))/(x - a) dot (x - a) -> f'(a) dot 0 = 0$. So $f(x) -> f(a)$, which is continuity.])
]