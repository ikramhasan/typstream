#set page(margin: 2.2cm, numbering: "1")
#set text(size: 11pt)
#set math.equation(numbering: none)
#set enum(numbering: "1.a.", full: false)

#let problem-counter = counter("problem")
#let problem(points, body) = {
  problem-counter.step()
  block(above: 1.5em, below: 1em, width: 100%)[
    #context [*Problem #problem-counter.display()* #h(1fr) _(#points points)_]
    #v(0.2em)
    #body
  ]
}
#let solution(body) = block(fill: rgb("#eef4ff"), inset: 8pt, radius: 3pt, width: 100%)[*Solution.* #body]
#let show-solutions = true

#align(center)[
  #text(18pt)[*MATH 151 — Calculus I*] \
  Midterm Examination 2 #h(1em) · #h(1em) 75 minutes
]

#problem(10)[
  Evaluate the following limits, or show that they do not exist.

  + $display(lim_(x -> 3) (x^2 - 9)/(x - 3))$
  + $display(lim_(x -> 0) (sin 5x)/x)$
  + $display(lim_(x -> infinity) (3x^2 + 1)/(2x^2 - x))$
  + $display(lim_(x -> 0^+) x ln x)$

  #if show-solutions [
    #solution[
      (a) $6$. #h(1em) (b) $5$. #h(1em) (c) $3/2$. #h(1em)
      (d) By L'Hôpital, $lim_(x->0^+) (ln x)/(1\/x) = lim_(x->0^+) (1\/x)/(-1\/x^2) = lim_(x->0^+) -x = 0$.
    ]
  ]
]

#problem(15)[
  Differentiate with respect to $x$.

  + $f(x) = 4x^5 - 3 sqrt(x) + 7/x^2$
  + $g(x) = x^2 e^(3x)$
  + $h(x) = (ln x)/(1 + x^2)$
  + $k(x) = arctan(sqrt(x))$
  + $y$, where $x^2 + x y + y^3 = 7$ (implicit differentiation)

  #if show-solutions [
    #solution[
      $
        f'(x) &= 20x^4 - 3/(2 sqrt(x)) - 14/x^3 \
        g'(x) &= 2x e^(3x) + 3x^2 e^(3x) = x e^(3x) (2 + 3x) \
        h'(x) &= ((1 + x^2) dot 1/x - 2x ln x)/(1 + x^2)^2 \
        k'(x) &= 1/(1 + x) dot 1/(2 sqrt(x)) \
        (d y)/(d x) &= -(2x + y)/(x + 3y^2)
      $
    ]
  ]
]

#problem(10)[
  Let $f(x) = x^3 - 6x^2 + 9x + 1$.

  + Find the critical points of $f$.
  + Classify each critical point using the second derivative test.
  + Find the absolute maximum and minimum of $f$ on $[0, 4]$.

  #if show-solutions [
    #solution[
      $f'(x) = 3(x - 1)(x - 3)$, so $x = 1, 3$. $f''(x) = 6x - 12$: $f''(1) = -6 < 0$ (local max, $f(1) = 5$),
      $f''(3) = 6 > 0$ (local min, $f(3) = 1$). On $[0, 4]$: $f(0) = 1$, $f(4) = 5$, so the absolute max is $5$ (at $x = 1, 4$) and the absolute min is $1$ (at $x = 0, 3$).
    ]
  ]
]

#problem(15)[
  Evaluate the integrals.

  $
    "(a)" integral_0^2 (3x^2 - 2x + 1) dif x
    quad quad
    "(b)" integral x cos(x^2) dif x
    quad quad
    "(c)" integral_1^e (ln x)/x dif x
  $

  #if show-solutions [
    #solution[
      (a) $[x^3 - x^2 + x]_0^2 = 6$. #h(1em)
      (b) $1/2 sin(x^2) + C$. #h(1em)
      (c) $[1/2 (ln x)^2]_1^e = 1/2$.
    ]
  ]
]

#problem(10)[
  A $10 "m"$ ladder leans against a vertical wall. The bottom slides away from the wall at $1 "m/s"$.
  How fast is the top sliding down when the bottom is $6 "m"$ from the wall?

  #if show-solutions [
    #solution[
      $x^2 + y^2 = 100 => 2x dot(x) + 2y dot(y) = 0$. With $x = 6$, $y = 8$, $dot(x) = 1$: $dot(y) = -6/8 = -0.75 "m/s"$.
    ]
  ]
]

#v(1fr)
#align(center)[
  #table(
    columns: 6,
    [*Problem*], [1], [2], [3], [4], [5],
    [*Score*], [/10], [/15], [/10], [/15], [/10],
  )
]
