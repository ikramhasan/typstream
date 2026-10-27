= The Pythagorean Theorem

*Name:* #line(length: 60%) *Date:* #line(length: 25%)

== What is a right triangle?

A *right triangle* has one angle of exactly 90°, marked with a small square. The two sides that meet at the right angle are called the *legs*. The side opposite the right angle is the longest side, called the *hypotenuse*.

== The diagram

#block(width: 8cm, height: 5.4cm)[
  #place(top + left, dx: 0.8cm, dy: 0.3cm,
    polygon(fill: rgb("#eef6ff"), stroke: 1pt,
      (0cm, 0cm), (0cm, 4cm), (6cm, 4cm)))
  #place(top + left, dx: 0.8cm, dy: 3.9cm,
    rect(width: 0.4cm, height: 0.4cm, stroke: 0.8pt, fill: none))
  #place(top + left, dx: 3.3cm, dy: 4.85cm)[*$a$* (leg)]
  #place(top + left, dx: 0.1cm, dy: 2.2cm)[*$b$* (leg)]
  #place(top + left, dx: 4.4cm, dy: 1.4cm)[*$c$* (hypotenuse)]
  #place(top + left, dx: 0.2cm, dy: 4.85cm)[right angle]
]

== The theorem

For any right triangle, the square of the hypotenuse equals the sum of the squares of the two legs:

$ a^2 + b^2 = c^2 $

Here $a$ and $b$ are the legs and $c$ is the hypotenuse. To use it, rearrange the formula as needed:

- To find the hypotenuse: $c = sqrt(a^2 + b^2)$
- To find a leg: $a = sqrt(c^2 - b^2)$ or $b = sqrt(c^2 - a^2)$

== Worked example 1: finding the hypotenuse

*Problem.* A right triangle has legs of 6 cm and 8 cm. Find the hypotenuse.

+ Write the theorem: $a^2 + b^2 = c^2$.
+ Substitute the legs: $6^2 + 8^2 = c^2$.
+ Square the legs: $36 + 64 = c^2$.
+ Add: $100 = c^2$.
+ Take the positive square root: $c = sqrt(100) = 10$.

*Answer:* The hypotenuse is 10 cm.

== Worked example 2: finding a leg

*Problem.* A right triangle has a hypotenuse of 13 cm and one leg of 5 cm. Find the other leg.

+ Write the theorem: $a^2 + b^2 = c^2$.
+ Substitute the known values: $5^2 + b^2 = 13^2$.
+ Square: $25 + b^2 = 169$.
+ Subtract 25 from both sides: $b^2 = 144$.
+ Take the positive square root: $b = sqrt(144) = 12$.

*Answer:* The other leg is 12 cm.

== Tips

- The hypotenuse is always the *largest* side. If you are finding a leg, subtract; if you are finding the hypotenuse, add.
- Check that your answer is reasonable: the hypotenuse must be longer than either leg.
- Common whole-number sets, called Pythagorean triples, include 3, 4, 5; 5, 12, 13; and 8, 15, 17.

== Practice

+ A right triangle has legs of 9 cm and 12 cm. Find the hypotenuse.
  #v(2em)
+ A right triangle has legs of 7 cm and 24 cm. Find the hypotenuse.
  #v(2em)
+ A right triangle has a hypotenuse of 17 cm and one leg of 8 cm. Find the other leg.
  #v(2em)
+ A ladder 10 m long leans against a wall. Its foot is 6 m from the base of the wall. How high up the wall does the ladder reach?
  #v(3em)