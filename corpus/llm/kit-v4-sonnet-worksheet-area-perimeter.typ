#show: worksheet.with(
  title: [Area and Perimeter of Rectangles and Triangles],
  subject: [Mathematics],
  grade: [Grade 6],
  instructions: [Answer all questions. Show your working and write the correct units. Diagrams are not drawn to scale.],
)
#import "@preview/cetz:0.5.3"

#callout(kind: "remember", title: [Formulas])[
  - Rectangle: perimeter $P = 2(l + w)$, area $A = l times w$
  - Triangle: perimeter $P = a + b + c$ (add all three sides), area $A = 1/2 times b times h$

  The height $h$ of a triangle is measured at a right angle to the base $b$.
]

= Part A: Rectangles

#question(points: 3)[
  Look at the rectangle.

  #align(center)[
    #cetz.canvas({
      import cetz.draw: *
      rect((0, 0), (4, 2.5))
      content((2, -0.45), [$8 "cm"$])
      content((-0.6, 1.25), [$5 "cm"$])
    })
  ]

  + Find the perimeter. #answer-space(height: 3em, answer: [$P = 2(8 + 5) = 26 "cm"$])
  + Find the area. #answer-space(height: 3em, answer: [$A = 8 times 5 = 40 "cm"^2$])
]

#question(points: 2)[
  A rectangular pool is shown below.

  #align(center)[
    #cetz.canvas({
      import cetz.draw: *
      rect((0, 0), (5, 2))
      content((2.5, -0.45), [$12 "m"$])
      content((-0.6, 1), [$7 "m"$])
    })
  ]

  The perimeter is #blank(answer: [$38 "m"$]) and the area is #blank(answer: [$84 "m"^2$]).
]

#question(points: 2)[
  The area of this rectangle is $48 "cm"^2$. Its length is $8 "cm"$. Find the missing width.

  #align(center)[
    #cetz.canvas({
      import cetz.draw: *
      rect((0, 0), (4, 2))
      content((2, -0.45), [$8 "cm"$])
      content((-0.5, 1), [$?$])
      content((2, 1), [$A = 48 "cm"^2$])
    })
  ]

  #answer-space(height: 3.5em, answer: [$w = 48 div 8 = 6 "cm"$])
]

= Part B: Triangles

#question(points: 2)[
  Find the area of the triangle. The dashed line is the height.

  #align(center)[
    #cetz.canvas({
      import cetz.draw: *
      line((0, 0), (5, 0), (3, 3), close: true)
      line((3, 0), (3, 3), stroke: (dash: "dashed"))
      line((3, 0.3), (3.3, 0.3), (3.3, 0))
      content((2.5, -0.45), [$10 "cm"$])
      content((3.15, 1.5), [$6 "cm"$], anchor: "west")
    })
  ]

  #answer-space(height: 3.5em, answer: [$A = 1/2 times 10 times 6 = 30 "cm"^2$])
]

#question(points: 4)[
  This is a right-angled triangle.

  #align(center)[
    #cetz.canvas({
      import cetz.draw: *
      line((0, 0), (4, 0), (0, 3), close: true)
      line((0.3, 0), (0.3, 0.3), (0, 0.3))
      content((2, -0.45), [$8 "cm"$])
      content((-0.6, 1.5), [$6 "cm"$])
      content((2.1, 1.65), [$10 "cm"$], anchor: "south-west")
    })
  ]

  + Find the perimeter. #answer-space(height: 3em, answer: [$P = 8 + 6 + 10 = 24 "cm"$])
  + Find the area, using the two sides that form the right angle as base and height. #answer-space(height: 3em, answer: [$A = 1/2 times 8 times 6 = 24 "cm"^2$])
]

#question(points: 1)[
  A triangle has base $12 "cm"$ and height $5 "cm"$. What is its area?
  #mcq([$60 "cm"^2$], [$30 "cm"^2$], [$17 "cm"^2$], [$34 "cm"^2$], answer: 2)
]

= Part C: Problem solving

#question(points: 4)[
  A rectangular garden is $15 "m"$ long and $9 "m"$ wide.

  #align(center)[
    #cetz.canvas({
      import cetz.draw: *
      rect((0, 0), (5, 3))
      content((2.5, -0.45), [$15 "m"$])
      content((-0.6, 1.5), [$9 "m"$])
      content((2.5, 1.5), [Garden])
    })
  ]

  + How much fencing is needed to go all the way around the garden?
    #answer-space(height: 3em, answer: [$P = 2(15 + 9) = 48 "m"$])
  + One bag of grass seed covers $27 "m"^2$. How many bags are needed to cover the whole garden?
    #answer-space(height: 4em, answer: [$A = 15 times 9 = 135 "m"^2$, and $135 div 27 = 5$ bags.])
]

#question(points: 2)[
  A triangular sail has a base of $4 "m"$ and a height of $6 "m"$. Explain how to find its area, then calculate it.
  #answer-lines(count: 3, answer: [Use $A = 1/2 times b times h = 1/2 times 4 times 6 = 12 "m"^2$.])
]