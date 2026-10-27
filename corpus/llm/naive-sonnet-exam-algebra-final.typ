#set page(paper: "us-letter", margin: 0.9in, numbering: "1 of 1", header: align(right)[_Algebra II Final Exam_])
#set text(size: 11pt)
#set par(justify: false)
#set enum(numbering: "(a)")

#let q(n, pts, body) = block(breakable: false, below: 1.3em)[*#n.* #h(0.2em) _(#pts pts)_ #h(0.3em) #body]

#let choices(..opts) = {
  let letters = ("A", "B", "C", "D")
  pad(left: 1.5em, grid(
    columns: (1fr, 1fr),
    row-gutter: 0.8em,
    ..opts.pos().enumerate().map(((i, o)) => [(#letters.at(i)) #o]),
  ))
}

#align(center)[
  #text(size: 20pt, weight: "bold")[Algebra II Final Exam]
  #v(0.2em)
  #text(size: 12pt)[Time allowed: 90 minutes #h(1em) | #h(1em) Total: 100 points]
]

#v(0.5em)
Name: #box(width: 8cm, line(length: 100%)) #h(1fr) Date: #box(width: 3.5cm, line(length: 100%))

Class period: #box(width: 2cm, line(length: 100%)) #h(1fr) Teacher: #box(width: 6cm, line(length: 100%))

#v(0.5em)

== Instructions

- Write your name on this page before you begin.
- A scientific or graphing calculator is allowed for all sections.
- In Sections II and III, *show all work*. Answers without supporting work may receive little or no credit.
- Give exact answers unless the question asks for a decimal approximation.
- Suggested pacing is shown below. You may move between sections.

#table(
  columns: (2.2fr, 1.4fr, 1.6fr, 1fr, 1fr),
  align: (left, center, center, center, center),
  [*Section*], [*Suggested time*], [*Questions*], [*Points*], [*Score*],
  [I. Multiple Choice], [30 min], [1–15 (2 pts each)], [30], [],
  [II. Short Answer], [35 min], [16–23 (5 pts each)], [40], [],
  [III. Extended Response], [25 min], [24–26 (10 pts each)], [30], [],
  [*Total*], [*90 min*], [], [*100*], [],
)

#pagebreak()

= Section I: Multiple Choice
_Circle the letter of the best answer. Each question is worth 2 points (30 points total)._

#v(0.5em)

#q(1, 2)[Solve $abs(2x - 3) = 7$.]
#choices([$x = 5$ only], [$x = 5$ or $x = -2$], [$x = -2$ only], [$x = 2$ or $x = -5$])

#q(2, 2)[Simplify $(3 + 2i)(1 - 4i)$.]
#choices([$-5 - 10i$], [$11 + 14i$], [$-5 + 14i$], [$11 - 10i$])

#q(3, 2)[What is true about the solutions of $x^2 - 6x + 13 = 0$?]
#choices([Two distinct real solutions], [One repeated real solution], [Two distinct nonreal complex solutions], [The type cannot be determined])

#q(4, 2)[What is the vertex of $f(x) = x^2 - 8x + 3$?]
#choices([$(4, -13)$], [$(-4, -13)$], [$(4, 19)$], [$(8, 3)$])

#q(5, 2)[What is the remainder when $x^3 - 2x^2 + x - 5$ is divided by $x - 2$?]
#choices([$3$], [$5$], [$-3$], [$-5$])

#q(6, 2)[Which is the complete factorization of $x^3 - 27$?]
#choices([$(x - 3)(x^2 - 3x + 9)$], [$(x - 3)(x^2 + 3x + 9)$], [$(x + 3)(x^2 - 3x + 9)$], [$(x - 3)^3$])

#q(7, 2)[Simplify $(x^2 - 9)/(x^2 + 5x + 6)$, for values where it is defined.]
#choices([$(x - 3)/(x + 2)$], [$(x + 3)/(x + 2)$], [$(x - 3)/(5x + 6)$], [$-9/(5x + 6)$])

#q(8, 2)[Solve $sqrt(x + 7) = x - 5$.]
#choices([$x = 2$ only], [$x = 2$ and $x = 9$], [No solution], [$x = 9$ only])

#q(9, 2)[Solve $3^(x + 1) = 81$.]
#choices([$x = 2$], [$x = 3$], [$x = 4$], [$x = 27$])

#q(10, 2)[Evaluate $log_2 32 + log_3 9$.]
#choices([$5$], [$6$], [$7$], [$12$])

#q(11, 2)[Which expression is equivalent to $log(a^2 b)$, where $a, b > 0$?]
#choices([$2 log a + log b$], [$(log a)^2 + log b$], [$2(log a + log b)$], [$log(2a) + log b$])

#q(12, 2)[An arithmetic series has first term 4, common difference 3, and 20 terms. What is its sum?]
#choices([$610$], [$1220$], [$1300$], [$650$])

#q(13, 2)[What is the 8th term of the geometric sequence $5, 10, 20, 40, dots$?]
#choices([$320$], [$640$], [$1280$], [$80$])

#q(14, 2)[Convert $150°$ to radians.]
#choices([$(2 pi)/3$], [$(3 pi)/4$], [$(5 pi)/6$], [$(5 pi)/3$])

#q(15, 2)[The graph of $y = f(x)$ is shifted 3 units left and 2 units down. Which equation represents the new graph?]
#choices([$y = f(x + 3) - 2$], [$y = f(x - 3) + 2$], [$y = f(x - 3) - 2$], [$y = f(x + 3) + 2$])

#pagebreak()

= Section II: Short Answer
_Show all work. Each question is worth 5 points (40 points total)._

#v(0.5em)

#q(16, 5)[Solve $2x^2 - 3x - 4 = 0$ using the quadratic formula. Give exact answers.]
#v(9em)

#q(17, 5)[Solve the system algebraically and write each solution as an ordered pair.
$ y = x^2 - 4x + 3 quad "and" quad y = x - 1 $]
#v(9em)

#q(18, 5)[Divide $2x^3 - 3x^2 - 8x + 12$ by $x - 2$. Then factor the cubic completely and list all of its zeros.]
#v(9em)

#pagebreak()

#q(19, 5)[Solve and check for extraneous solutions:
$ 1/x + 1/(x + 2) = 3/4 $]
#v(9em)

#q(20, 5)[An account with \$500 earns 4% interest compounded annually, so its balance after $t$ years is $500(1.04)^t$. Use logarithms to find how many years it takes for the balance to reach \$1000. Round to the nearest tenth of a year.]
#v(9em)

#q(21, 5)[Solve and check for extraneous solutions:
$ log_3 (x + 2) + log_3 (x - 4) = 3 $]
#v(9em)

#q(22, 5)[Without a calculator, find the exact value of each expression.
+ (2 pts) $sin (2 pi)/3$
+ (2 pts) $cos (5 pi)/4$
+ (1 pt) $tan pi/3$
]
#v(5em)

#q(23, 5)[Scores on a placement test are approximately normally distributed with mean 72 and standard deviation 8. Use the 68–95–99.7 rule to estimate the percent of students who scored between 64 and 88. Explain your reasoning.]
#v(7em)

#pagebreak()

= Section III: Extended Response
_Show all work and justify your answers. Each question is worth 10 points (30 points total)._

#v(0.5em)

#q(24, 10)[A ball is thrown upward from a platform. Its height in feet after $t$ seconds is
$ h(t) = -16t^2 + 48t + 64. $
+ (1 pt) What is the height of the platform?
+ (3 pts) Find the maximum height of the ball and the time at which it occurs.
+ (3 pts) After how many seconds does the ball hit the ground?
+ (3 pts) During what time interval is the ball higher than 84 feet? Show your algebra.
]
#v(14em)

#pagebreak()

#q(25, 10)[Let $f(x) = 2x + 3$ and $g(x) = x^2 - 1$.
+ (2 pts) Find $(f compose g)(x)$ and simplify.
+ (2 pts) Find $(g compose f)(x)$ and simplify.
+ (3 pts) Find $f^(-1)(x)$, then verify your answer by showing that $f(f^(-1)(x)) = x$.
+ (3 pts) Is $g$ a one-to-one function? Justify your answer. Then give a restriction on the domain of $g$ that makes it one-to-one.
]
#v(18em)

#pagebreak()

#q(26, 10)[Consider the rational function
$ f(x) = (x + 1)/((x - 2)(x + 3)). $
+ (2 pts) State the domain of $f$.
+ (2 pts) Find the equations of all vertical asymptotes.
+ (2 pts) Find the equation of the horizontal asymptote and explain how you found it.
+ (2 pts) Find the $x$-intercept(s) and the $y$-intercept.
+ (2 pts) Use the space below to sketch the graph. Draw the asymptotes as dashed lines, plot the intercepts, and show the end behavior near each vertical asymptote.
]
#v(0.5em)
#rect(width: 100%, height: 9cm, stroke: 0.5pt + gray)

#align(center)[#text(style: "italic")[End of exam. Please check your work if time remains.]]

#pagebreak()

= Answer Key and Scoring Guide
_Teacher copy. Total: 100 points._

== Section I: Multiple Choice (2 points each, 30 total)

#table(
  columns: (auto,) + (1fr,) * 15,
  align: center,
  [*Q*], [1], [2], [3], [4], [5], [6], [7], [8], [9], [10], [11], [12], [13], [14], [15],
  [*Ans*], [B], [D], [C], [A], [C], [B], [A], [D], [B], [C], [A], [D], [B], [C], [A],
)

#v(0.5em)
*Brief justifications*

+ $2x - 3 = 7$ gives $x = 5$; $2x - 3 = -7$ gives $x = -2$.
+ $3 - 12i + 2i - 8i^2 = 3 - 10i + 8 = 11 - 10i$.
+ Discriminant $= 36 - 52 = -16 < 0$, so two nonreal complex solutions.
+ $x = 8 / 2 = 4$ and $f(4) = 16 - 32 + 3 = -13$.
+ Remainder theorem: $f(2) = 8 - 8 + 2 - 5 = -3$.
+ Difference of cubes: $a^3 - b^3 = (a - b)(a^2 + a b + b^2)$.
+ $((x - 3)(x + 3))/((x + 2)(x + 3)) = (x - 3)/(x + 2)$.
+ Squaring gives $x^2 - 11x + 18 = 0$, so $x = 2$ or $x = 9$. Checking, $x = 2$ is extraneous ($3 != -3$), so only $x = 9$.
+ $x + 1 = 4$, so $x = 3$.
+ $5 + 2 = 7$.
+ Product and power rules for logarithms.
+ $a_20 = 4 + 19(3) = 61$, so $S_20 = 20(4 + 61)/2 = 650$.
+ $a_8 = 5 dot 2^7 = 640$.
+ $150 dot pi/180 = (5 pi)/6$.
+ Left 3 means $x -> x + 3$; down 2 means subtract 2 from the output.

#pagebreak()

== Section II: Short Answer (5 points each, 40 total)

*16.* $x = (3 plus.minus sqrt(41))/4$.
- 2 pts: correct substitution $a = 2$, $b = -3$, $c = -4$ into the formula
- 2 pts: correct discriminant $9 + 32 = 41$ and simplification
- 1 pt: both solutions stated

*17.* Set equal: $x^2 - 4x + 3 = x - 1$, so $x^2 - 5x + 4 = 0$, so $(x - 1)(x - 4) = 0$. Solutions: $(1, 0)$ and $(4, 3)$.
- 2 pts: setting up and simplifying the equation
- 2 pts: solving for both $x$-values
- 1 pt: both $y$-values found correctly as ordered pairs

*18.* Quotient $2x^2 + x - 6$ with remainder 0. Factored form: $(x - 2)(2x - 3)(x + 2)$. Zeros: $x = 2$, $x = 3/2$, $x = -2$.
- 2 pts: correct division (synthetic or long)
- 2 pts: complete factorization
- 1 pt: all three zeros

*19.* Multiply by $4x(x + 2)$: $4(x + 2) + 4x = 3x(x + 2)$, so $3x^2 - 2x - 8 = 0$, so $(3x + 4)(x - 2) = 0$. Solutions: $x = 2$ and $x = -4/3$. Both check (neither makes a denominator zero).
- 2 pts: clearing fractions correctly
- 2 pts: solving the quadratic
- 1 pt: check and conclusion

*20.* $500(1.04)^t = 1000$, so $(1.04)^t = 2$, so $t = ln 2 / ln 1.04 approx 17.7$ years.
- 1 pt: correct equation
- 2 pts: isolating the exponential and taking logarithms correctly
- 2 pts: correct value with units, rounded

*21.* $log_3 ((x + 2)(x - 4)) = 3$, so $(x + 2)(x - 4) = 27$, so $x^2 - 2x - 35 = 0$, so $(x - 7)(x + 5) = 0$. Check: $x = -5$ makes the logarithm arguments negative, so it is extraneous. Solution: $x = 7$.
- 1 pt: combining logarithms
- 1 pt: rewriting in exponential form
- 1 pt: solving the quadratic
- 2 pts: rejecting $x = -5$ with justification and stating $x = 7$

*22.* (a) $sqrt(3)/2$ (2 pts) #h(1em) (b) $-sqrt(2)/2$ (2 pts) #h(1em) (c) $sqrt(3)$ (1 pt)

*23.* $64$ is one standard deviation below the mean ($72 - 8$). $88$ is two standard deviations above ($72 + 16$). The percent is $34% + 47.5% = 81.5%$, so about 81.5% of students.
- 2 pts: identifying $-1$ and $+2$ standard deviations
- 2 pts: correct use of 34% and 47.5%
- 1 pt: correct total with explanation

#pagebreak()

== Section III: Extended Response (10 points each, 30 total)

*24. Projectile motion*
+ *(1 pt)* $h(0) = 64$ feet.
+ *(3 pts)* $t = -48/(2(-16)) = 1.5$ s (1 pt). $h(1.5) = -36 + 72 + 64 = 100$ ft (2 pts).
+ *(3 pts)* Solve $-16t^2 + 48t + 64 = 0$, so $t^2 - 3t - 4 = 0$, so $(t - 4)(t + 1) = 0$. Reject $t = -1$. The ball lands at $t = 4$ s (1 pt for setup, 1 pt for solving, 1 pt for rejecting the negative root).
+ *(3 pts)* $-16t^2 + 48t + 64 > 84$ gives $-16t^2 + 48t - 20 > 0$, so $4t^2 - 12t + 5 < 0$, so $(2t - 1)(2t - 5) < 0$. The ball is above 84 ft for $0.5 < t < 2.5$ seconds (1 pt for the inequality, 1 pt for the roots, 1 pt for the interval).

*25. Functions*
+ *(2 pts)* $(f compose g)(x) = 2(x^2 - 1) + 3 = 2x^2 + 1$.
+ *(2 pts)* $(g compose f)(x) = (2x + 3)^2 - 1 = 4x^2 + 12x + 8$.
+ *(3 pts)* $f^(-1)(x) = (x - 3)/2$ (2 pts). Verification: $f((x - 3)/2) = (x - 3) + 3 = x$ (1 pt).
+ *(3 pts)* No. For example $g(2) = g(-2) = 3$, so $g$ fails the horizontal line test (2 pts). Restricting the domain to $x >= 0$ (or to $x <= 0$) makes $g$ one-to-one (1 pt).

*26. Rational function*
+ *(2 pts)* All real numbers except $x = 2$ and $x = -3$.
+ *(2 pts)* Vertical asymptotes: $x = 2$ and $x = -3$.
+ *(2 pts)* $y = 0$, because the degree of the numerator (1) is less than the degree of the denominator (2).
+ *(2 pts)* $x$-intercept: $(-1, 0)$. $y$-intercept: $f(0) = 1/(-6)$, so $(0, -1/6)$. (1 pt each)
+ *(2 pts)* The sketch should show these features (1 pt for asymptotes and intercepts, 1 pt for correct behavior):
  - As $x -> -3^-$, $f -> -infinity$; as $x -> -3^+$, $f -> +infinity$.
  - As $x -> 2^-$, $f -> -infinity$; as $x -> 2^+$, $f -> +infinity$.
  - The left tail approaches $y = 0$ from below, and the right tail approaches $y = 0$ from above.
  - The graph passes through $(-1, 0)$ and $(0, -1/6)$ in the middle branch.

#v(1em)
*Grading note:* Award partial credit for correct method with arithmetic errors, and apply "error carried forward" when later steps are consistent with an earlier mistake.