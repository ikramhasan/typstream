#show: exam.with(
  title: [Calculus Midterm: Limits and Derivatives],
  subject: [Mathematics (Calculus)],
  duration: [60 minutes],
  instructions: [
    Answer *all* questions. Show your working: marks are given for method as well as for the final answer.
    Calculators are not permitted.
  ],
)

= Section A: Limits and continuity

#question(points: 6)[
  Evaluate each limit. If a limit does not exist, say so.
  + $display(lim_(x -> 3) (x^2 - 9)/(x - 3))$
    #answer-space(height: 4em, answer: [Factor: $(x-3)(x+3)/(x-3) = x + 3$, so the limit is $6$.])
  + $display(lim_(x -> 0) (sin(5 x))/x)$
    #answer-space(height: 4em, answer: [$(sin(5x))/x = 5 dot (sin(5x))/(5x) -> 5 dot 1 = 5$.])
  + $display(lim_(x -> infinity) (3 x^2 + x)/(2 x^2 - 1))$
    #answer-space(height: 4em, answer: [Divide by $x^2$: $(3 + 1/x)/(2 - 1/x^2) -> 3/2$.])
]

#question(points: 2)[
  What is $display(lim_(x -> 2) (sqrt(x + 2) - 2)/(x - 2))$?
  #mcq([$0$], [$1/4$], [$1/2$], [The limit does not exist], answer: 2)
  #answer[
    Multiply by the conjugate: $(x + 2 - 4)/((x - 2)(sqrt(x+2) + 2)) = 1/(sqrt(x+2) + 2) -> 1/4$.
    (Equivalently, this is the derivative of $sqrt(x+2)$ at $x = 2$.)
  ]
]

#question(points: 4)[
  Find the value of the constant $a$ that makes $f$ continuous at $x = 1$, and justify your answer.
  $ f(x) = cases(x^2 + a "if" x < 1, 3 x - 1 "if" x >= 1) $
  #answer-space(height: 7em, answer: [
    $lim_(x -> 1^-) f(x) = 1 + a$, and $lim_(x -> 1^+) f(x) = f(1) = 2$.
    Continuity requires the one-sided limits to agree with $f(1)$, so $1 + a = 2$ and $a = 1$.
  ])
]

#question(points: 2)[
  Mark each statement true or false.
  #true-false(answer: false)[If $f$ is continuous at $x = a$, then $f$ is differentiable at $x = a$.]
  #true-false(answer: true)[A function can have a limit at a point where it is not defined.]
  #answer[
    (1) False: $f(x) = |x|$ is continuous but not differentiable at $0$.
    (2) True: for example $(x^2 - 1)/(x - 1)$ has limit $2$ at $x = 1$ but is undefined there.
  ]
]

= Section B: Derivatives

#question(points: 4)[
  Use the *limit definition* of the derivative to find $f'(x)$ for $f(x) = x^2 + 3 x$.
  #answer-space(height: 9em, answer: [
    $f'(x) = lim_(h -> 0) ((x+h)^2 + 3(x+h) - x^2 - 3x)/h = lim_(h -> 0) (2 x h + h^2 + 3 h)/h = lim_(h -> 0) (2x + h + 3) = 2x + 3$.
  ])
]

#question(points: 8)[
  Differentiate. You do not need to simplify part (a).
  + $y = 4 x^3 - 5 x + 7$
    #answer-space(height: 3em, answer: [$y' = 12 x^2 - 5$])
  + $y = x^2 e^x$
    #answer-space(height: 4em, answer: [Product rule: $y' = 2 x e^x + x^2 e^x = x(x + 2) e^x$.])
  + $y = (x^2 + 1)/(x - 1)$
    #answer-space(height: 5em, answer: [
      Quotient rule: $y' = (2x(x - 1) - (x^2 + 1))/(x - 1)^2 = (x^2 - 2x - 1)/(x - 1)^2$.
    ])
  + $y = cos(3 x^2)$
    #answer-space(height: 4em, answer: [Chain rule: $y' = -sin(3x^2) dot 6x = -6 x sin(3 x^2)$.])
]

#question(points: 5)[
  Find the equation of the tangent line to $y = x^3 - 2 x$ at the point where $x = 2$.
  #answer-space(height: 7em, answer: [
    $y(2) = 8 - 4 = 4$. $y' = 3x^2 - 2$, so the slope is $y'(2) = 10$.
    Tangent: $y - 4 = 10(x - 2)$, that is $y = 10 x - 16$.
  ])
]

#question(points: 6)[
  The circle $x^2 + y^2 = 25$ is given.
  + Use implicit differentiation to find $(d y)/(d x)$.
    #answer-space(height: 5em, answer: [$2x + 2y (d y)/(d x) = 0$, so $(d y)/(d x) = -x/y$.])
  + Find the slope of the tangent at the point $(3, 4)$ and write the tangent line's equation.
    #answer-space(height: 5em, answer: [
      Slope $= -3/4$. Tangent: $y - 4 = -3/4 (x - 3)$, i.e. $y = -3/4 x + 25/4$.
    ])
]

= Section C: Applications

#question(points: 8)[
  A farmer has $120$ m of fencing to enclose a rectangular field along a straight river. No fence is needed along the river. Find the dimensions of the field with the largest area, and justify that your answer is a maximum.
  #answer-space(height: 12em, answer: [
    Let the two sides perpendicular to the river be $x$ and the side parallel to it be $y$. Then $2x + y = 120$, so $y = 120 - 2x$.
    Area: $A(x) = x(120 - 2x) = 120 x - 2 x^2$, with $0 < x < 60$.
    $A'(x) = 120 - 4x = 0$ gives $x = 30$. Since $A''(x) = -4 < 0$, this is a maximum.
    Dimensions: $30$ m by $60$ m ($30$ m perpendicular to the river), maximum area $1800 "m"^2$.
  ])
]

#question(points: 5)[
  The radius of a circular oil spill grows at $2$ cm/s. How fast is the area increasing when the radius is $5$ cm?
  #answer-space(height: 8em, answer: [
    $A = pi r^2$, so $(d A)/(d t) = 2 pi r (d r)/(d t)$.
    When $r = 5$ and $(d r)/(d t) = 2$: $(d A)/(d t) = 2 pi (5)(2) = 20 pi "cm"^2 "/s"$.
  ])
]

#answer-key()