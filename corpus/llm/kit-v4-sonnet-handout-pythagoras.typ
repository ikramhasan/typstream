#show: handout.with(
  title: [The Pythagorean Theorem],
  subtitle: [Finding missing sides of right triangles],
  subject: [Mathematics],
  grade: [Grade 8],
)
#import "@preview/cetz:0.5.3"

= The big idea

A *right triangle* has one angle of exactly $90°$. The two sides that form the right angle are the *legs*. The side opposite the right angle is the *hypotenuse*. It is always the longest side.

#align(center)[
  #cetz.canvas({
    import cetz.draw: *
    line((0, 0), (4, 0), (0, 3), close: true, stroke: 1.2pt)
    line((0.3, 0), (0.3, 0.3), (0, 0.3))
    content((-0.4, 1.5), [$a$])
    content((2, -0.4), [$b$])
    content((2.3, 1.85), [$c$])
    content((5.6, 1.5), [leg: $a$ and $b$ \ hypotenuse: $c$])
  })
]

#callout(kind: "definition", title: [Pythagorean theorem])[
  In a right triangle with legs $a$ and $b$ and hypotenuse $c$,
  $ a^2 + b^2 = c^2 $
  The squares on the two legs add up to the square on the hypotenuse.
]

= Why it works

Take the triangle with legs $3$ and $4$. The squares on the legs have areas $3^2 = 9$ and $4^2 = 16$. Together that is $9 + 16 = 25$, which is the area of a square with side $5$. So the hypotenuse is $5$.

= Worked example 1: finding the hypotenuse

#callout(kind: "example")[
  A right triangle has legs of $6 "cm"$ and $8 "cm"$. Find the hypotenuse.

  #align(center)[
    #cetz.canvas({
      import cetz.draw: *
      line((0, 0), (4, 0), (0, 3), close: true, stroke: 1.2pt)
      line((0.3, 0), (0.3, 0.3), (0, 0.3))
      content((-0.8, 1.5), [$6 "cm"$])
      content((2, -0.45), [$8 "cm"$])
      content((2.6, 1.9), [$c = ?$])
    })
  ]

  *Step 1.* Write the theorem: $a^2 + b^2 = c^2$.

  *Step 2.* Substitute the legs: $6^2 + 8^2 = c^2$.

  *Step 3.* Calculate: $36 + 64 = 100$, so $c^2 = 100$.

  *Step 4.* Take the square root: $c = sqrt(100) = 10 "cm"$.
]

= Worked example 2: finding a leg

#callout(kind: "example")[
  The hypotenuse of a right triangle is $13 "m"$ and one leg is $5 "m"$. Find the other leg.

  *Step 1.* Substitute into $a^2 + b^2 = c^2$: $5^2 + b^2 = 13^2$.

  *Step 2.* Rearrange: $b^2 = 13^2 - 5^2 = 169 - 25 = 144$.

  *Step 3.* Take the square root: $b = sqrt(144) = 12 "m"$.
]

#callout(kind: "warning")[
  - Always put $c$, the hypotenuse, alone on one side. It is the side opposite the right angle.
  - When you look for a *leg*, you *subtract*. When you look for the *hypotenuse*, you *add*.
  - The theorem only works for right triangles.
]

= Common Pythagorean triples

Sets of whole numbers that satisfy $a^2 + b^2 = c^2$ are called Pythagorean triples.

#align(center)[
  #table(
    columns: 4,
    align: center,
    [*$a$*], [*$b$*], [*$c$*], [*Check*],
    [$3$], [$4$], [$5$], [$9 + 16 = 25$],
    [$5$], [$12$], [$13$], [$25 + 144 = 169$],
    [$8$], [$15$], [$17$], [$64 + 225 = 289$],
    [$7$], [$24$], [$25$], [$49 + 576 = 625$],
  )
]

#callout(kind: "tip")[
  Multiplying a triple by any whole number gives another triple. For example, $3, 4, 5$ becomes $6, 8, 10$.
]

= Remember

#callout(kind: "remember")[
  $ a^2 + b^2 = c^2 $
  The hypotenuse $c$ is opposite the right angle and is the longest side.
]