#set page(paper: "us-letter", margin: 0.9in, numbering: "1")
#set text(size: 11pt)
#set par(justify: false)

= Calculus Midterm Exam
*Limits and Derivatives* #h(1fr) *Time: 60 minutes* #h(1em) *Total: 100 points*

Name: #box(width: 3in, line(length: 100%)) #h(1fr) Date: #box(width: 1.3in, line(length: 100%))

#v(0.5em)

*Instructions*
- Show all work. A correct answer with no supporting work earns little or no credit.
- Calculators are not permitted. Leave answers in exact form, such as $sqrt(2)$ or $3/5$.
- Suggested pacing: Part A about 20 minutes, Part B about 20 minutes, Part C about 20 minutes.

#table(
  columns: (1fr, 1fr, 1fr, 1fr),
  align: center,
  [*Part A* (34)], [*Part B* (34)], [*Part C* (32)], [*Total* (100)],
  [#v(1.5em)], [], [], [],
)

#v(1em)

== Part A: Limits (34 points)

*1.* _(4 pts)_ Evaluate $lim_(x -> 3) (x^2 - 9)/(x - 3)$.

#v(6em)

*2.* _(5 pts)_ Evaluate $lim_(x -> 0) (sqrt(x + 4) - 2)/x$.

#v(8em)

*3.* _(4 pts)_ Evaluate $lim_(x -> oo) (3x^2 - x)/(5x^2 + 2)$.

#v(6em)

*4.* _(4 pts)_ Evaluate $lim_(x -> 0) (sin(5x))/(2x)$.

#v(6em)

*5.* _(6 pts)_ Find the value of the constant $k$ that makes $f$ continuous at $x = 2$. Justify using the definition of continuity.
$ f(x) = cases(3x + k & "if " x < 2, x^2 - 1 & "if " x >= 2) $

#v(8em)

*6.* _(5 pts)_ Determine $lim_(x -> 2^(-)) abs(x - 2)/(x - 2)$ and $lim_(x -> 2^(+)) abs(x - 2)/(x - 2)$. Does $lim_(x -> 2) abs(x - 2)/(x - 2)$ exist? Explain.

#v(8em)

*7.* _(6 pts)_ Use the Intermediate Value Theorem to show that $f(x) = x^3 + x - 1$ has a root in the interval $(0, 1)$. State clearly why the theorem applies.

#v(8em)

#pagebreak()

== Part B: Derivative Techniques (34 points)

*8.* _(6 pts)_ Use the *limit definition* of the derivative to find $f'(x)$ for $f(x) = x^2 + 3x$.

#v(10em)

*9.* _(16 pts, 4 each)_ Find the derivative of each function. You need not simplify unless it is easy to do so.

(a) $f(x) = 4x^3 - 2sqrt(x) + 7$

#v(5em)

(b) $g(x) = x^2 e^x$

#v(5em)

(c) $h(x) = (sin x)/(1 + cos x)$

#v(6em)

(d) $k(x) = ln(x^2 + 1)$

#v(5em)

*10.* _(6 pts)_ Find the equation of the tangent line to $y = x^3 - 2x$ at the point where $x = 1$.

#v(8em)

*11.* _(6 pts)_ The point $(3, 4)$ lies on the circle $x^2 + y^2 = 25$. Use implicit differentiation to find $dy/dx$ at this point.

#v(8em)

#pagebreak()

== Part C: Applications (32 points)

*12.* _(10 pts)_ A rectangle has a perimeter of 40 meters. Find the dimensions that maximize its area, and state the maximum area. Justify that your answer is a maximum.

#v(14em)

*13.* _(10 pts)_ A 10-foot ladder leans against a vertical wall. The bottom of the ladder slides away from the wall at a rate of 2 ft/s. How fast is the top of the ladder sliding down the wall at the instant when the bottom is 6 feet from the wall?

#v(14em)

*14.* _(12 pts)_ Let $f(x) = x^3 - 6x^2 + 9x + 1$.

(a) Find all critical points of $f$. _(4 pts)_

#v(6em)

(b) Determine the intervals on which $f$ is increasing and decreasing. _(4 pts)_

#v(6em)

(c) Classify each critical point as a local maximum or local minimum, and give the corresponding $y$-values. _(4 pts)_

#v(6em)

#pagebreak()

= Teacher Key: Worked Solutions
*Calculus Midterm, Limits and Derivatives* (100 points)

== Part A: Limits

*1.* _(4 pts)_ Factor the numerator: $(x^2 - 9)/(x - 3) = ((x - 3)(x + 3))/(x - 3) = x + 3$ for $x != 3$. Therefore
$ lim_(x -> 3) (x^2 - 9)/(x - 3) = lim_(x -> 3) (x + 3) = 6. $
_Grading:_ 2 pts for factoring or cancelling, 2 pts for the correct value.

*2.* _(5 pts)_ Multiply by the conjugate:
$ (sqrt(x + 4) - 2)/x dot (sqrt(x + 4) + 2)/(sqrt(x + 4) + 2) = ((x + 4) - 4)/(x (sqrt(x + 4) + 2)) = 1/(sqrt(x + 4) + 2). $
Then
$ lim_(x -> 0) 1/(sqrt(x + 4) + 2) = 1/(2 + 2) = 1/4. $
_Grading:_ 3 pts for the algebra, 1 pt for cancelling $x$, 1 pt for the answer.

*3.* _(4 pts)_ Divide the numerator and denominator by $x^2$:
$ lim_(x -> oo) (3 - 1/x)/(5 + 2/x^2) = 3/5. $
_Grading:_ 2 pts for the method (or comparing leading coefficients with justification), 2 pts for the answer.

*4.* _(4 pts)_ Rewrite using the standard limit $lim_(u -> 0) (sin u)/u = 1$:
$ (sin(5x))/(2x) = 5/2 dot (sin(5x))/(5x) -> 5/2 dot 1 = 5/2. $
_Grading:_ 2 pts for rewriting with $5x$ in the denominator, 2 pts for the answer.

*5.* _(6 pts)_ Continuity at $x = 2$ requires $lim_(x -> 2^(-)) f(x) = lim_(x -> 2^(+)) f(x) = f(2)$.
- Left: $lim_(x -> 2^(-)) (3x + k) = 6 + k$.
- Right and value: $f(2) = 2^2 - 1 = 3$, and $lim_(x -> 2^(+)) (x^2 - 1) = 3$.

Setting $6 + k = 3$ gives $k = -3$.
_Grading:_ 2 pts for the one-sided limits, 2 pts for equating them (and $f(2)$), 2 pts for $k = -3$.

*6.* _(5 pts)_ For $x > 2$, $abs(x - 2) = x - 2$, so the quotient is $1$ and the right-hand limit is $1$. For $x < 2$, $abs(x - 2) = -(x - 2)$, so the quotient is $-1$ and the left-hand limit is $-1$. Since $-1 != 1$, the two-sided limit *does not exist*.
_Grading:_ 2 pts for each one-sided limit, 1 pt for the conclusion with reason.

*7.* _(6 pts)_ $f(x) = x^3 + x - 1$ is a polynomial, so it is continuous on $[0, 1]$. We have $f(0) = -1 < 0$ and $f(1) = 1 > 0$. Since $0$ lies between $f(0)$ and $f(1)$, the Intermediate Value Theorem guarantees a $c in (0, 1)$ with $f(c) = 0$.
_Grading:_ 2 pts for continuity, 2 pts for the endpoint values, 2 pts for the conclusion.

== Part B: Derivative Techniques

*8.* _(6 pts)_
$ f'(x) = lim_(h -> 0) (f(x + h) - f(x))/h = lim_(h -> 0) ((x + h)^2 + 3(x + h) - x^2 - 3x)/h. $
Expanding the numerator gives $2x h + h^2 + 3h$, so
$ f'(x) = lim_(h -> 0) (2x h + h^2 + 3h)/h = lim_(h -> 0) (2x + h + 3) = 2x + 3. $
_Grading:_ 2 pts for the correct difference quotient, 2 pts for expanding and cancelling $h$, 2 pts for the limit. Award at most 2 pts if the limit definition is not used.

*9.* _(16 pts, 4 each)_

(a) $f'(x) = 12x^2 - 2 dot 1/(2 sqrt(x)) = 12x^2 - 1/sqrt(x)$.

(b) Product rule: $g'(x) = 2x e^x + x^2 e^x = x(x + 2) e^x$.

(c) Quotient rule:
$ h'(x) = (cos x (1 + cos x) - sin x (-sin x))/(1 + cos x)^2 = (cos x + cos^2 x + sin^2 x)/(1 + cos x)^2 = (1 + cos x)/(1 + cos x)^2 = 1/(1 + cos x). $
_Note:_ Full credit is given for the unsimplified quotient-rule expression.

(d) Chain rule: $k'(x) = 1/(x^2 + 1) dot 2x = (2x)/(x^2 + 1)$.

_Grading:_ 4 pts each: 3 for the correct rule and setup, 1 for the final expression.

*10.* _(6 pts)_ At $x = 1$: $y = 1 - 2 = -1$, so the point is $(1, -1)$. Since $y' = 3x^2 - 2$, the slope is $y'(1) = 1$. The tangent line is
$ y - (-1) = 1 (x - 1) quad ==> quad y = x - 2. $
_Grading:_ 1 pt for the point, 2 pts for the derivative, 1 pt for the slope, 2 pts for the equation.

*11.* _(6 pts)_ Differentiate both sides with respect to $x$:
$ 2x + 2y dy/dx = 0 quad ==> quad dy/dx = -x/y. $
At $(3, 4)$: $dy/dx = -3/4$.
_Grading:_ 3 pts for correct implicit differentiation, 1 pt for solving for $dy/dx$, 2 pts for evaluating.

== Part C: Applications

*12.* _(10 pts)_ Let the sides be $x$ and $y$, so $2x + 2y = 40$ and $y = 20 - x$. Then
$ A(x) = x(20 - x) = 20x - x^2, quad 0 < x < 20. $
$A'(x) = 20 - 2x = 0$ gives $x = 10$, so $y = 10$. Since $A''(x) = -2 < 0$, this is a maximum. The rectangle is a $10 times 10$ m square with maximum area $100$ m#super[2].
_Grading:_ 2 pts for the constraint, 2 pts for the area function, 2 pts for the critical point, 2 pts for justifying the maximum (second-derivative test, sign chart, or endpoints), 2 pts for the dimensions and area.

*13.* _(10 pts)_ Let $x$ be the distance from the wall to the bottom of the ladder and $y$ the height of the top, so $x^2 + y^2 = 100$. When $x = 6$, $y = sqrt(100 - 36) = 8$. Differentiate with respect to $t$:
$ 2x dx/dt + 2y dy/dt = 0 quad ==> quad dy/dt = -x/y dot dx/dt. $
With $dx/dt = 2$:
$ dy/dt = -6/8 dot 2 = -3/2 "ft/s". $
The top of the ladder slides down the wall at $3/2$ ft/s (the negative sign indicates downward motion).
_Grading:_ 2 pts for the equation, 2 pts for finding $y = 8$, 3 pts for differentiating with respect to $t$, 2 pts for substituting, 1 pt for the answer with units and interpretation. Deduct 2 pts if values are substituted before differentiating.

*14.* _(12 pts)_ $f(x) = x^3 - 6x^2 + 9x + 1$.

(a) $f'(x) = 3x^2 - 12x + 9 = 3(x - 1)(x - 3)$. The critical points are $x = 1$ and $x = 3$. _(4 pts)_

(b) Sign analysis of $f'(x) = 3(x - 1)(x - 3)$:

#table(
  columns: 4,
  align: center,
  [*Interval*], [$(-oo, 1)$], [$(1, 3)$], [$(3, oo)$],
  [*Sign of $f'$*], [$+$], [$-$], [$+$],
  [*Behavior of $f$*], [increasing], [decreasing], [increasing],
)

_(4 pts)_

(c) By the first derivative test, $f'$ changes from $+$ to $-$ at $x = 1$, so there is a *local maximum* with $f(1) = 1 - 6 + 9 + 1 = 5$, at the point $(1, 5)$. At $x = 3$, $f'$ changes from $-$ to $+$, so there is a *local minimum* with $f(3) = 27 - 54 + 27 + 1 = 1$, at the point $(3, 1)$. (The second derivative test works as well: $f''(x) = 6x - 12$, with $f''(1) = -6 < 0$ and $f''(3) = 6 > 0$.) _(4 pts)_

_Grading for (c):_ 1 pt for each classification, 1 pt for each $y$-value.

== Scoring Summary

#table(
  columns: (1fr, 1fr, 1fr),
  align: center,
  [*Part*], [*Questions*], [*Points*],
  [A: Limits], [1–7], [34],
  [B: Derivative techniques], [8–11], [34],
  [C: Applications], [12–14], [32],
  [*Total*], [], [*100*],
)

_Common errors to watch for:_ cancelling terms that are not factors in Q1–Q3; dropping the chain-rule factor in 9(d); substituting numerical values before differentiating in related rates (Q13); and reporting only $x$-values for local extrema in Q14(c).