#show: exam.with(
  title: [Calculus I Midterm: Limits and Derivatives],
  subject: [Mathematics],
  grade: [Grade 12],
  duration: [60 minutes],
  info: ("name", "class", "roll"),
  instructions: [Answer *all* questions. Show your working. Calculators are not permitted.],
)

#question(points: 4)[
  Evaluate each limit.
  + $lim_(x -> 3) (x^2 - 9)/(x - 3)$
    #answer-space(height: 3em, answer: [Factor: $(x^2 - 9)/(x - 3) = x + 3$ for $x != 3$, so the limit is $6$.])
  + $lim_(x -> 0) sin(3x)/x$
    #answer-space(height: 3em, answer: [Standard limit with $u = 3x$: $lim_(x -> 0) 3 dot sin(3x)/(3x) = 3$.])
  + $lim_(x -> infinity) (3x^2 + 1)/(x^2 - 4)$
    #answer-space(height: 3em, answer: [Divide top and bottom by $x^2$: $(3 + 1/x^2)/(1 - 4/x^2) -> 3$.])
  + $lim_(x -> 2^+) (|x - 2|)/(x - 2)$
    #answer-space(height: 3em, answer: [For $x > 2$, $|x - 2| = x - 2$, so the expression equals $1$ and the limit is $1$.])
]

#question(points: 4)[
  Differentiate each function with respect to $x$. Simplify your answers.
  + $f(x) = 3x^4 - 2x^2 + 5x - 7$
    #answer-space(height: 3em, answer: [$f'(x) = 12x^3 - 4x + 5$.])
  + $h(x) = x^2 e^x$
    #answer-space(height: 4em, answer: [Product rule: $h'(x) = 2x e^x + x^2 e^x = x(x + 2) e^x$.])
]

#question(points: 5)[
  Find the equation of the tangent line to $f(x) = (2x - 1)^3$ at $x = 1$. Write your answer in the form $y = m x + c$.
  #answer-space(height: 8em, answer: [
    Chain rule: $f'(x) = 3(2x - 1)^2 dot 2 = 6(2x - 1)^2$.
    At $x = 1$: $f(1) = 1$ and $f'(1) = 6$.
    Tangent: $y - 1 = 6(x - 1)$, so $y = 6x - 5$.
  ])
]

#question(points: 4)[
  Let $f(x) = x^3 - 3x$.
  + Find all critical points of $f$.
    #answer-space(height: 3em, answer: [$f'(x) = 3x^2 - 3 = 0$ gives $x = -1$ and $x = 1$.])
  + Use the second derivative test to classify each critical point.
    #answer-space(height: 4em, answer: [$f''(x) = 6x$. $f''(1) = 6 > 0$, so $(1, -2)$ is a local minimum. $f''(-1) = -6 < 0$, so $(-1, 2)$ is a local maximum.])
]

#question(points: 3)[
  Use the definition of the derivative as a limit to find $f'(x)$ for $f(x) = x^2 + x$.
  #answer-space(height: 8em, answer: [
    $f'(x) = lim_(h -> 0) ((x + h)^2 + (x + h) - x^2 - x)/h = lim_(h -> 0) (2x h + h^2 + h)/h = lim_(h -> 0) (2x + h + 1) = 2x + 1$.
  ])
]

#question(points: 5)[
  The side $s$ of a square is increasing at a constant rate of $2 "cm/s"$. Find the rate at which its area $A$ is increasing when $s = 5 "cm"$.
  #answer-space(height: 8em, answer: [
    $A = s^2$, so $(d A)/(d t) = 2 s (d s)/(d t)$.
    At $s = 5$: $(d A)/(d t) = 2 dot 5 dot 2 = 20$, so the area increases at $20 "cm"^2 "/s"$.
  ])
]