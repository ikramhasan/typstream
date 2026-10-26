// What the offline replay streams: a worksheet like the ones the instructions
// ask for, written as a model writes Typst (headings, prose, inline and display
// math, a table, lists).
export const WORKSHEET = `= The Pythagorean theorem
_Grade 8 · Worksheet 4 · 30 minutes_

== Warm-up
In a right triangle the side opposite the right angle is the *hypotenuse*. The theorem says that the
square on the hypotenuse equals the sum of the squares on the other two sides:

$ a^2 + b^2 = c^2 $

where $c$ is the hypotenuse and $a$ and $b$ are the legs. The converse holds too: if $a^2 + b^2 = c^2$
for the sides of a triangle, the triangle has a right angle.

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
