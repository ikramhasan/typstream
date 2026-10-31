// What the offline replay streams: a worksheet like the ones the instructions
// ask for, written as a model writes Typst (headings, prose, inline and display
// math, a CeTZ drawing, a table, lists, a mind map), and the same worksheet
// revised, as the answer to a follow-up.
export const WORKSHEET = `#import "@preview/cetz:0.5.3"

= The Pythagorean theorem
_Grade 8 · Worksheet 4 · 30 minutes_

== Warm-up
In a right triangle the side opposite the right angle is the *hypotenuse*. The theorem says that the
square on the hypotenuse equals the sum of the squares on the other two sides:

$ a^2 + b^2 = c^2 $

where $c$ is the hypotenuse and $a$ and $b$ are the legs. The converse holds too: if $a^2 + b^2 = c^2$
for the sides of a triangle, the triangle has a right angle.

#align(center, cetz.canvas({
  import cetz.draw: *
  line((0, 0), (4, 0), (4, 3), close: true)
  rect((3.6, 0), (4, 0.4))
  content((2, -0.4), [$a$])
  content((4.4, 1.5), [$b$])
  content((1.7, 1.8), [$c$])
}))

== At a glance
#mindmap[
  Pythagorean theorem
  - Sides
    - Legs $a$, $b$
    - Hypotenuse $c$
  - Uses
    - Distances
    - Diagonals
  - Converse
    - Testing right angles
]

== Worked example
A ladder $5$ m long leans against a wall with its foot $3$ m from the wall. How high does it reach?

$ h = sqrt(5^2 - 3^2) = sqrt(25 - 9) = sqrt(16) = 4 $

So the ladder reaches $4$ m up the wall.

== Practice
+ The legs of a right triangle are $6$ cm and $8$ cm. Find the hypotenuse.
+ A rectangle is $9$ cm wide and $12$ cm long. How long is its diagonal?
+ Is a triangle with sides $7$, $24$ and $25$ a right triangle? Explain.
+ A square has a diagonal of $10$ cm. Find the length of its side.

== Pythagorean triples
Whole numbers with $a^2 + b^2 = c^2$ are called *Pythagorean triples*. Complete the table.

#table(columns: 4, [$a$], [$b$], [$c$], [$a^2 + b^2$],
  [3], [4], [5], [25], [5], [12], [13], [169], [8], [15], [], [], [9], [], [41], [])

== Challenge
- Show that $(m^2 - n^2, 2 m n, m^2 + n^2)$ is a triple for any whole numbers $m > n > 0$.
- Find a triple whose smallest number is $20$.
- Explain why no triple has both legs odd and the hypotenuse even.
`;

/**
 * The offline answer to a follow-up: the whole worksheet again, as the kit asks for every answer, with
 * a longer ladder in the worked example and whole numbers in the last practice question.
 */
export const REVISED = WORKSHEET.replace(
  `A ladder $5$ m long leans against a wall with its foot $3$ m from the wall. How high does it reach?

$ h = sqrt(5^2 - 3^2) = sqrt(25 - 9) = sqrt(16) = 4 $

So the ladder reaches $4$ m up the wall.`,
  `A ladder $13$ m long leans against a wall with its foot $5$ m from the wall. How high does it reach?
The ladder is the hypotenuse, so we subtract the square of the other leg from its square.

$ h = sqrt(13^2 - 5^2) = sqrt(169 - 25) = sqrt(144) = 12 $

So the ladder reaches $12$ m up the wall: a 5, 12, 13 triangle.`,
).replace(
  "+ A square has a diagonal of $10$ cm. Find the length of its side.",
  "+ A square has sides of $5$ cm. Find the length of its diagonal, to one decimal place.",
);
