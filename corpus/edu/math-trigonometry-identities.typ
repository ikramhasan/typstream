#set page(margin: 2cm)
#set text(size: 11pt)
#set math.equation(numbering: "(1.1)", supplement: [Eq.])
#set heading(numbering: "1.")

= Trigonometric Identities — Reference and Practice

== Fundamental identities

$ sin^2 theta + cos^2 theta = 1 $ <pyth>
$ tan theta = (sin theta)/(cos theta), quad cot theta = 1/(tan theta) $
$ 1 + tan^2 theta = sec^2 theta, quad 1 + cot^2 theta = csc^2 theta $ <pyth-tan>

Dividing @pyth by $cos^2 theta$ gives @pyth-tan.

== Sum and difference formulas

$
  sin(alpha plus.minus beta) &= sin alpha cos beta plus.minus cos alpha sin beta \
  cos(alpha plus.minus beta) &= cos alpha cos beta minus.plus sin alpha sin beta \
  tan(alpha plus.minus beta) &= (tan alpha plus.minus tan beta)/(1 minus.plus tan alpha tan beta)
$ <sum-diff>

== Double-angle formulas

Setting $alpha = beta = theta$ in @sum-diff:

$
  sin 2 theta &= 2 sin theta cos theta \
  cos 2 theta &= cos^2 theta - sin^2 theta \
  &= 2 cos^2 theta - 1 \
  &= 1 - 2 sin^2 theta
$

== Exact values

#let r(body) = math.display(body)
#table(
  columns: 6,
  align: center + horizon,
  inset: 7pt,
  table.header([$theta$], [$0$], [$pi/6$], [$pi/4$], [$pi/3$], [$pi/2$]),
  [$sin theta$], [$0$], [$1/2$], [$sqrt(2)/2$], [$sqrt(3)/2$], [$1$],
  [$cos theta$], [$1$], [$sqrt(3)/2$], [$sqrt(2)/2$], [$1/2$], [$0$],
  [$tan theta$], [$0$], [$sqrt(3)/3$], [$1$], [$sqrt(3)$], [undefined],
)

== Practice

Prove each identity.

+ $(1 - cos 2x)/(sin 2x) = tan x$
+ $sin^4 x - cos^4 x = -cos 2x$
+ $(sin x)/(1 - cos x) - (sin x)/(1 + cos x) = 2 cot x$
+ $cos 3x = 4 cos^3 x - 3 cos x$

== Worked proof of (1)

$
  (1 - cos 2x)/(sin 2x)
  &= (1 - (1 - 2 sin^2 x))/(2 sin x cos x) \
  &= (2 sin^2 x)/(2 sin x cos x) \
  &= (sin x)/(cos x) = tan x quad square
$

== Solving equations

Solve $2 sin^2 x - sin x - 1 = 0$ for $0 <= x < 2 pi$.

Let $u = sin x$. Then $2u^2 - u - 1 = (2u + 1)(u - 1) = 0$, so $u = -1/2$ or $u = 1$:

$ x in {pi/2, (7 pi)/6, (11 pi)/6} $
