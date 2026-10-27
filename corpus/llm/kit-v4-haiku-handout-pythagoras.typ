#import "@preview/cetz:0.5.3"
#show: handout.with(title: [The Pythagorean Theorem], subtitle: [Key ideas and a worked example], subject: [Mathematics])

= What is it?

The Pythagorean theorem links the three sides of a *right triangle*. A right triangle has one angle of exactly $90°$. The two sides that form the right angle are called the *legs*. The side opposite the right angle is the longest side, called the *hypotenuse*.

#callout(kind: "definition")[
  In a right triangle with legs $a$ and $b$ and hypotenuse $c$:
  $ a^2 + b^2 = c^2 $
]

#align(center)[
  #cetz.canvas({
    import cetz.draw: *
    line((0, 0), (4, 0), (0, 3), close: true, stroke: 1.2pt)
    line((0, 0), (0.4, 0), (0.4, 0.4), (0, 0.4), stroke: 0.6pt)
    content((2, -0.5), [$a$ = 4 "cm"])
    content((-0.6, 1.5), [$b$ = 3 "cm"])
    content((2.4, 1.8), [$c$ (hypotenuse)])
  })
]

= How to use it

+ Label the legs and the hypotenuse. The hypotenuse is always the side opposite the right angle.
+ Square the two legs and add the results.
+ If you know the hypotenuse, square it and subtract the square of the known leg.
+ Take the square root at the end, and give the length with its unit.

= Worked example

#callout(kind: "example")[
  A right triangle has legs $3$ cm and $4$ cm. Find the hypotenuse.

  + Write the theorem: $c^2 = a^2 + b^2$.
  + Substitute: $c^2 = 3^2 + 4^2 = 9 + 16 = 25$.
  + Take the square root: $c = sqrt(25) = 5$.

  The hypotenuse is $5$ cm.
]

#callout(kind: "remember")[
  The theorem only works for right triangles. Always check that the side you call $c$ is opposite the right angle.
]

= Try it yourself

#question(points: 2)[
  A right triangle has legs $6$ cm and $8$ cm. Find the hypotenuse.
  #answer-space(height: 4em, answer: [$c^2 = 36 + 64 = 100$, so $c = 10$ cm.])
]

#question(points: 2)[
  The hypotenuse of a right triangle is $13$ cm and one leg is $5$ cm. Find the other leg.
  #answer-space(height: 4em, answer: [$b^2 = 169 - 25 = 144$, so $b = 12$ cm.])
]