= Calculus Midterm: Limits and Derivatives

*Time:* 60 minutes #h(2em) *Total:* 100 points #h(2em) *Calculators:* Not permitted

Name: #line(length: 60%)

== Instructions

- Answer every question in the space provided. Show all work; a correct final answer without justification may receive partial or no credit.
- Simplify answers fully unless a question says otherwise.
- Budget about one minute per point. If you are stuck, move on and return later.

== Part A: Limits (30 points)

*Question 1* (5 points). Evaluate the limit.

$ lim_(x -> 3) (x^2 - 9)/(x - 3) $

#v(2em)

*Question 2* (5 points). Evaluate the limit.

$ lim_(x -> 0) sin(3x)/x $

#v(2em)

*Question 3* (5 points). Evaluate the limit.

$ lim_(x -> oo) (3x^2 + x)/(5x^2 - 4) $

#v(2em)

*Question 4* (7 points). Let

$ f(x) = cases(x^2 + 1 "if" x < 2, 3x - 1 "if" x >= 2) $

Find $lim_(x -> 2^-) f(x)$, $lim_(x -> 2^+) f(x)$, and $f(2)$. Is $f$ continuous at $x = 2$? Explain.

#v(2em)

*Question 5* (8 points). Evaluate the limit by rationalizing the numerator.

$ lim_(x -> 0) (sqrt(x + 4) - 2)/x $

#v(2em)

== Part B: Derivatives (40 points)

*Question 6* (8 points). Use the limit definition of the derivative to find $f'(x)$ for $f(x) = x^2 - 2x$.

$ f'(x) = lim_(h -> 0) (f(x + h) - f(x))/h $

#v(2em)

*Question 7* (12 points). Differentiate each function. Do not simplify your answer to part (c).

+ $f(x) = 4x^5 - 3x^2 + 7x - 1$
+ $g(x) = x^3 sin x$
+ $h(x) = (2x + 1)/(x^2 - 3)$

#v(2em)

*Question 8* (10 points). Use the chain rule to differentiate each function.

+ $y = (3x^2 - x)^4$
+ $y = sqrt(x^2 + 1)$

#v(2em)

*Question 9* (10 points). The curve $x^2 + x y + y^2 = 7$ passes through the point $(1, 2)$. Use implicit differentiation to find $(d y)/(d x)$ in general, then evaluate it at $(1, 2)$.

#v(2em)

== Part C: Applications (30 points)

*Question 10* (8 points). Find the equation of the tangent line to $y = x^3 - 2x$ at $x = 1$.

#v(2em)

*Question 11* (10 points). A particle moves along a line with position $s(t) = t^3 - 6t^2 + 9t$ meters, where $t$ is in seconds and $t >= 0$.

+ Find the velocity $v(t)$ and the times when the particle is at rest.
+ Find the acceleration at $t = 1$ second.

#v(2em)

*Question 12* (12 points). A spherical balloon is inflated so that its radius increases at a constant rate of $2$ cm/s.

+ Find the rate at which the surface area $A = 4 pi r^2$ is changing when $r = 5$ cm.
+ Find the rate at which the volume $V = (4/3) pi r^3$ is changing when $r = 5$ cm.

#v(2em)

#pagebreak()

= Answer Key and Worked Solutions

_For the teacher. Point values are shown in brackets; award partial credit for correct method with arithmetic slips._

== Part A: Limits

*Question 1* [5]. Factor the numerator: $(x^2 - 9) = (x - 3)(x + 3)$. Cancel the nonzero factor $(x - 3)$ and substitute:

$ lim_(x -> 3) (x + 3) = 6 $

*Answer:* $6$

*Question 2* [5]. Rewrite using $sin(3x)/x = 3 dot sin(3x)/(3x)$. As $x -> 0$, $3x -> 0$, so $sin(3x)/(3x) -> 1$.

$ lim_(x -> 0) sin(3x)/x = 3 dot 1 = 3 $

*Answer:* $3$

*Question 3* [5]. Divide numerator and denominator by $x^2$, the highest power in the denominator:

$ (3 + 1/x)/(5 - 4/x^2) -> 3/5 $ as $x -> oo$, since $1/x -> 0$ and $4/x^2 -> 0$.

*Answer:* $3/5$

*Question 4* [7]. For $x < 2$ use $x^2 + 1$: $lim_(x -> 2^-) f(x) = 4 + 1 = 5$.

For $x >= 2$ use $3x - 1$: $lim_(x -> 2^+) f(x) = 6 - 1 = 5$.

Since $f(2) = 3(2) - 1 = 5$, all three values agree.

*Answer:* Both one-sided limits and $f(2)$ equal $5$. The limit exists and equals $f(2)$, so $f$ is continuous at $x = 2$.

*Question 5* [8]. Multiply by the conjugate $(sqrt(x + 4) + 2)/(sqrt(x + 4) + 2)$:

$ (sqrt(x + 4) - 2)/x dot (sqrt(x + 4) + 2)/(sqrt(x + 4) + 2) = (x + 4 - 4)/(x (sqrt(x + 4) + 2)) = 1/(sqrt(x + 4) + 2) $

Taking $x -> 0$ gives $1/(2 + 2) = 1/4$.

*Answer:* $1/4$

== Part B: Derivatives

*Question 6* [8]. Compute $f(x + h) - f(x)$:

$ (x + h)^2 - 2(x + h) - (x^2 - 2x) = 2x h + h^2 - 2h $

Divide by $h$ (for $h != 0$): $2x + h - 2$. Let $h -> 0$.

*Answer:* $f'(x) = 2x - 2$

*Question 7* [12]. Each part is worth 4 points.

+ Power rule term by term: $f'(x) = 20x^4 - 6x + 7$.
+ Product rule: $g'(x) = 3x^2 sin x + x^3 cos x$.
+ Quotient rule with $u = 2x + 1$, $v = x^2 - 3$:

$ h'(x) = (2(x^2 - 3) - (2x + 1)(2x))/(x^2 - 3)^2 = (2x^2 - 6 - 4x^2 - 2x)/(x^2 - 3)^2 = (-2x^2 - 2x - 6)/(x^2 - 3)^2 $

Accept equivalent forms such as $-(2x^2 + 2x + 6)/(x^2 - 3)^2$.

*Question 8* [10]. Each part is worth 5 points.

+ Outer power, inner $u = 3x^2 - x$: $y' = 4(3x^2 - x)^3 (6x - 1)$.
+ Write $y = (x^2 + 1)^(1/2)$. Then $y' = 1/2 (x^2 + 1)^(-1/2) dot 2x = x/sqrt(x^2 + 1)$.

*Question 9* [10]. Differentiate both sides with respect to $x$, treating $y$ as a function of $x$:

$ 2x + y + x (d y)/(d x) + 2y (d y)/(d x) = 0 $

Collect the $(d y)/(d x)$ terms: $(d y)/(d x) (x + 2y) = -(2x + y)$, so

$ (d y)/(d x) = -(2x + y)/(x + 2y) $

At $(1, 2)$: $-(2 + 2)/(1 + 4) = -4/5$.

*Answer:* $(d y)/(d x) = -(2x + y)/(x + 2y)$; slope at $(1, 2)$ is $-4/5$.

== Part C: Applications

*Question 10* [8]. At $x = 1$: $y = 1 - 2 = -1$. The derivative is $y' = 3x^2 - 2$, so the slope is $y'(1) = 1$.

Point-slope form: $y - (-1) = 1(x - 1)$, so $y = x - 2$.

*Answer:* $y = x - 2$

*Question 11* [10].

+ [6] $v(t) = s'(t) = 3t^2 - 12t + 9 = 3(t - 1)(t - 3)$. The particle is at rest when $v(t) = 0$, i.e., at $t = 1$ s and $t = 3$ s.
+ [4] $a(t) = v'(t) = 6t - 12$. At $t = 1$: $a(1) = -6$ m/s$^2$.

*Question 12* [12].

+ [6] $(d A)/(d t) = 8 pi r (d r)/(d t)$. At $r = 5$ and $(d r)/(d t) = 2$: $(d A)/(d t) = 8 pi (5)(2) = 80 pi$ cm$^2$/s.

  Note: the surface area formula is $A = 4 pi r^2$, so $A' = 8 pi r$. Students who write $A = pi r^2$ (the area of a circle) should receive no credit for this part.

+ [6] $(d V)/(d t) = 4 pi r^2 (d r)/(d t)$. At $r = 5$: $(d V)/(d t) = 4 pi (25)(2) = 200 pi$ cm$^3$/s.

== Scoring Guide

#table(
  columns: 3,
  [*Part*], [*Questions*], [*Points*],
  [A: Limits], [1–5], [30],
  [B: Derivatives], [6–9], [40],
  [C: Applications], [10–12], [30],
  [*Total*], [], [*100*],
)