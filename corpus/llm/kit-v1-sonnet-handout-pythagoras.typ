#show: handout.with(
  title: [The Pythagorean Theorem],
  subtitle: [Finding missing sides of right triangles],
  subject: [Mathematics],
  grade: [Grade 8],
)

#import "@preview/cetz:0.5.3"

#let right-triangle(la, lb, lc) = cetz.canvas({
  import cetz.draw: *
  line((0, 0), (4, 0), (0, 3), close: true, stroke: 1pt + black, fill: rgb("#eef3fb"))
  rect((0, 0), (0.35, 0.35), stroke: 0.7pt)
  content((2, -0.4), la)
  content((-0.4, 1.5), lb)
  content((2.4, 1.9), lc)
})

== The big idea

A *right triangle* has one angle of exactly $90°$. The side opposite the right angle is the longest side and is called the *hypotenuse*. The other two sides are called the *legs*.

#align(center)[
  #right-triangle($a$, $b$, $c$)
  #v(-0.3em)
  #text(size: 0.9em)[Legs $a$ and $b$ meet at the right angle (the small square). The hypotenuse is $c$.]
]

#callout(kind: "definition", title: [The Pythagorean theorem])[
  In any right triangle, the square of the hypotenuse equals the sum of the squares of the legs:
  $ a^2 + b^2 = c^2 $
]

== Why it works

Draw a square on each side of the triangle. The area of the square on the hypotenuse, $c^2$, is exactly equal to the areas of the two smaller squares added together, $a^2 + b^2$. For the triangle with sides $3$, $4$ and $5$:
$ 3^2 + 4^2 = 9 + 16 = 25 = 5^2 $

== Worked example 1: finding the hypotenuse

#callout(kind: "example", title: [Example 1])[
  The legs of a right triangle are $6$ cm and $8$ cm. Find the hypotenuse.

  #align(center)[#right-triangle($6$ cm, $8$ cm, $c = ?$)]

  *Step 1.* Write the formula: $a^2 + b^2 = c^2$.

  *Step 2.* Substitute the legs: $6^2 + 8^2 = c^2$.

  *Step 3.* Square and add: $36 + 64 = 100$, so $c^2 = 100$.

  *Step 4.* Take the square root: $c = sqrt(100) = 10$.

  *Answer:* The hypotenuse is $10$ cm.
]

== Worked example 2: finding a leg

#callout(kind: "example", title: [Example 2])[
  The hypotenuse is $13$ m and one leg is $5$ m. Find the other leg.

  *Step 1.* Substitute into $a^2 + b^2 = c^2$: $5^2 + b^2 = 13^2$.

  *Step 2.* Square the known sides: $25 + b^2 = 169$.

  *Step 3.* Subtract $25$ from both sides: $b^2 = 169 - 25 = 144$.

  *Step 4.* Take the square root: $b = sqrt(144) = 12$.

  *Answer:* The other leg is $12$ m.
]

== Common Pythagorean triples

Sets of whole numbers that satisfy $a^2 + b^2 = c^2$ are called *Pythagorean triples*.

#align(center)[
  #table(
    columns: 4,
    align: center,
    [*$a$*], [*$b$*], [*$c$*], [*Check*],
    [3], [4], [5], [$9 + 16 = 25$],
    [5], [12], [13], [$25 + 144 = 169$],
    [8], [15], [17], [$64 + 225 = 289$],
    [7], [24], [25], [$49 + 576 = 625$],
  )
]

Multiples of a triple also work: doubling $3, 4, 5$ gives $6, 8, 10$.

== Watch out

#callout(kind: "warning", title: [Common mistakes])[
  - The hypotenuse is *always* opposite the right angle, so it is always the longest side. Never put a leg in place of $c$.
  - When finding a leg, *subtract*: $b^2 = c^2 - a^2$.
  - Do not forget the last step. $c^2 = 100$ means $c = 10$, not $100$.
  - The theorem only works for *right* triangles.
]

#callout(kind: "remember")[
  Identify the hypotenuse first. Then write $a^2 + b^2 = c^2$, substitute, solve for the unknown square, and finish by taking the square root.
]