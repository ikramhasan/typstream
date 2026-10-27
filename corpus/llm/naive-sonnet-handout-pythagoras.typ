= The Pythagorean Theorem

== The big idea

A *right triangle* has one angle of exactly $90°$. The side opposite the right angle is the longest side and is called the *hypotenuse*. The other two sides are called the *legs*.

The Pythagorean theorem says that in any right triangle,

$ a^2 + b^2 = c^2 $

where $a$ and $b$ are the lengths of the legs and $c$ is the length of the hypotenuse.

== A labelled right triangle

#align(center)[
  #box(width: 6.5cm, height: 5cm, {
    // triangle
    place(top + left, polygon(
      fill: rgb("#e8f1fb"),
      stroke: 1.2pt + black,
      (0.8cm, 4cm), (5.8cm, 4cm), (0.8cm, 0.8cm),
    ))
    // right-angle marker
    place(top + left, dx: 0.8cm, dy: 3.5cm,
      rect(width: 0.5cm, height: 0.5cm, stroke: 0.8pt + black))
    // side labels
    place(top + left, dx: 3.2cm, dy: 4.15cm)[*$a$*]
    place(top + left, dx: 0.35cm, dy: 2.2cm)[*$b$*]
    place(top + left, dx: 3.5cm, dy: 1.9cm)[*$c$*]
    // vertex labels
    place(top + left, dx: 0.3cm, dy: 4.15cm)[$C$]
    place(top + left, dx: 5.95cm, dy: 3.8cm)[$B$]
    place(top + left, dx: 0.5cm, dy: 0.2cm)[$A$]
  })
]

#align(center)[
  _The right angle is at $C$. Sides $a$ and $b$ are the legs; side $c$ is the hypotenuse._
]

== Key points

- The theorem works *only* for right triangles.
- The hypotenuse $c$ is always opposite the right angle and is always the longest side.
- If you know any two sides, you can find the third.

== Worked example 1: finding the hypotenuse

*Problem.* A right triangle has legs $a = 6$ cm and $b = 8$ cm. Find the hypotenuse $c$.

+ Write the formula: $ a^2 + b^2 = c^2 $
+ Substitute the known values: $ 6^2 + 8^2 = c^2 $
+ Square each leg: $ 36 + 64 = c^2 $
+ Add: $ 100 = c^2 $
+ Take the square root of both sides: $ c = sqrt(100) = 10 $

*Answer:* the hypotenuse is $10$ cm.

== Worked example 2: finding a missing leg

*Problem.* A right triangle has hypotenuse $c = 13$ cm and one leg $a = 5$ cm. Find the other leg $b$.

+ Write the formula: $ a^2 + b^2 = c^2 $
+ Substitute: $ 5^2 + b^2 = 13^2 $
+ Square: $ 25 + b^2 = 169 $
+ Subtract $25$ from both sides: $ b^2 = 144 $
+ Take the square root: $ b = sqrt(144) = 12 $

*Answer:* the missing leg is $12$ cm.

== Common Pythagorean triples

Sets of whole numbers that satisfy $a^2 + b^2 = c^2$ are called _Pythagorean triples_.

#table(
  columns: 4,
  align: center,
  [*$a$*], [*$b$*], [*$c$*], [*Check*],
  [3], [4], [5], [$9 + 16 = 25$],
  [5], [12], [13], [$25 + 144 = 169$],
  [8], [15], [17], [$64 + 225 = 289$],
  [7], [24], [25], [$49 + 576 = 625$],
)

== Practice

+ A right triangle has legs $a = 9$ and $b = 12$. Find $c$.
  #v(4em)

+ A right triangle has $a = 15$ and $c = 17$. Find $b$.
  #v(4em)

+ A ladder $10$ m long leans against a wall. Its base is $6$ m from the wall. How high up the wall does the ladder reach?
  #v(4em)

+ A triangle has sides $7$, $10$ and $12$. Is it a right triangle? Explain using the theorem.
  #v(4em)

== Answer line

Name: #box(width: 6cm, line(length: 100%)) #h(1em) Date: #box(width: 3cm, line(length: 100%))