#show: exam.with(
  title: [Calculus Midterm: Limits and Derivatives],
  subject: [Calculus],
  duration: [60 minutes],
  instructions: [
    Answer *all* questions. Show your working in the spaces provided; marks are given for method as well as for the final answer. Calculators are not permitted.
  ],
)

= Section A: Short questions

#question(points: 1)[
  Evaluate $lim_(x -> 3) (x^2 - 9)/(x - 3)$.
  #mcq([$0$], [$3$], [$6$], [The limit does not exist], answer: 3)
  #answer[Factor: $(x^2 - 9)/(x - 3) = x + 3$ for $x != 3$, so the limit is $3 + 3 = 6$.]
]

#question(points: 1)[
  Evaluate $lim_(x -> 0) (sin(3x))/x$.
  #mcq([$0$], [$1$], [$3$], [$1/3$], answer: 3)
  #answer[$(sin 3x)/x = 3 dot (sin 3x)/(3x) -> 3 dot 1 = 3$.]
]

#question(points: 1)[
  What is the derivative of $f(x) = ln(x^2 + 1)$?
  #mcq([$1/(x^2 + 1)$], [$(2x)/(x^2 + 1)$], [$2x ln(x^2 + 1)$], [$(x^2 + 1)/(2x)$], answer: 2)
  #answer[Chain rule: $f'(x) = 1/(x^2 + 1) dot 2x = (2x)/(x^2 + 1)$.]
]

#question(points: 1)[
  What is the slope of the tangent line to $y = x^2$ at $x = 3$?
  #mcq([$3$], [$6$], [$9$], [$2$], answer: 2)
  #answer[$y' = 2x$, so the slope at $x = 3$ is $6$.]
]

#question(points: 1)[
  #true-false(answer: false)[If $f$ is continuous at $x = a$, then $f$ is differentiable at $x = a$.]
  #answer[False. Counterexample: $f(x) = |x|$ is continuous at $0$ but has a corner there, so it is not differentiable.]
]

= Section B: Limits and the definition of the derivative

#question(points: 9)[
  Evaluate each limit. Show your working.
  + $lim_(x -> 2) (x^2 - x - 2)/(x - 2)$
    #answer-space(height: 5em, answer: [Factor: $x^2 - x - 2 = (x - 2)(x + 1)$. Cancel $(x - 2)$ to get $lim_(x -> 2) (x + 1) = 3$.])
  + $lim_(x -> 0) (sqrt(x + 4) - 2)/x$
    #answer-space(height: 6em, answer: [Multiply by the conjugate: $((sqrt(x + 4) - 2)(sqrt(x + 4) + 2))/(x (sqrt(x + 4) + 2)) = x/(x (sqrt(x + 4) + 2)) = 1/(sqrt(x + 4) + 2)$. As $x -> 0$ this tends to $1/4$.])
  + $lim_(x -> oo) (3x^2 + x)/(5x^2 - 2)$
    #answer-space(height: 5em, answer: [Divide the numerator and denominator by $x^2$: $(3 + 1/x)/(5 - 2/x^2) -> 3/5$.])
]

#question(points: 6)[
  The function $f$ is defined by
  $ f(x) = cases(x^2 + k "if" x < 1, 3x + 1 "if" x >= 1) $
  Find the value of $k$ that makes $f$ continuous at $x = 1$. Justify your answer using limits.
  #answer-space(height: 8em, answer: [
    Right-hand limit: $lim_(x -> 1^+) (3x + 1) = 4$, and $f(1) = 4$.

    Left-hand limit: $lim_(x -> 1^-) (x^2 + k) = 1 + k$.

    Continuity requires $1 + k = 4$, so $k = 3$.
  ])
]

#question(points: 5)[
  Use the *limit definition* of the derivative to find $f'(x)$ for $f(x) = x^2 + 3x$.
  #answer-space(height: 9em, answer: [
    $f'(x) = lim_(h -> 0) (f(x + h) - f(x))/h = lim_(h -> 0) ((x + h)^2 + 3(x + h) - x^2 - 3x)/h$

    $= lim_(h -> 0) (2x h + h^2 + 3h)/h = lim_(h -> 0) (2x + h + 3) = 2x + 3$.

    Marking: setting up the difference quotient (1), expanding correctly (2), cancelling $h$ (1), final answer (1).
  ])
]

= Section C: Techniques and applications of differentiation

#question(points: 8)[
  Find $f'(x)$ in each case. You need not simplify part (a).
  + $f(x) = x^4 - 3x^2 + 7$
    #answer-space(height: 3em, answer: [$f'(x) = 4x^3 - 6x$])
  + $f(x) = x^2 sin x$
    #answer-space(height: 4em, answer: [Product rule: $f'(x) = 2x sin x + x^2 cos x$.])
  + $f(x) = (x^2 + 1)/(x - 1)$
    #answer-space(height: 6em, answer: [Quotient rule: $f'(x) = (2x(x - 1) - (x^2 + 1))/(x - 1)^2 = (x^2 - 2x - 1)/(x - 1)^2$.])
  + $f(x) = e^(3x^2)$
    #answer-space(height: 4em, answer: [Chain rule: $f'(x) = 6x e^(3x^2)$.])
]

#question(points: 6)[
  Find the equation of the tangent line to the curve $y = x^3 - 2x$ at the point where $x = 2$.
  #answer-space(height: 8em, answer: [
    $y(2) = 8 - 4 = 4$, so the point is $(2, 4)$.

    $y' = 3x^2 - 2$, so the slope at $x = 2$ is $3(4) - 2 = 10$.

    Tangent line: $y - 4 = 10(x - 2)$, that is $y = 10x - 16$.
  ])
]

#question(points: 5)[
  The circle $x^2 + y^2 = 25$ passes through the point $(3, 4)$. Use implicit differentiation to find the slope of the tangent to the circle at this point.
  #answer-space(height: 8em, answer: [
    Differentiate both sides with respect to $x$: $2x + 2y dv(y, x) = 0$, so $dv(y, x) = -x/y$.

    At $(3, 4)$: $dv(y, x) = -3/4$.
  ])
]

#question(points: 6)[
  A farmer has $40$ m of fencing to enclose a rectangular pen. Find the dimensions that give the largest possible area, and state that area. Justify that your answer is a maximum.
  #answer-space(height: 11em, answer: [
    Let the sides be $x$ and $20 - x$ (since $2x + 2y = 40$). Area $A(x) = x(20 - x) = 20x - x^2$, for $0 < x < 20$.

    $A'(x) = 20 - 2x = 0$ gives $x = 10$.

    $A''(x) = -2 < 0$, so $x = 10$ is a maximum (or: $A'$ changes from positive to negative at $x = 10$).

    The pen is a $10 "m" times 10 "m"$ square with maximum area $100 "m"^2$.
  ])
]