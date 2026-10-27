#show: worksheet.with(
  title: [Plotting and Reading Points on the Coordinate Plane],
  subject: [Mathematics],
  grade: [Grade 7],
  instructions: [Answer all questions. Remember to give the #emph[x]-coordinate first, then the #emph[y]-coordinate. Use a pencil and a ruler where needed.],
)

#callout(kind: "definition", title: [Ordered pairs])[
  A point on the coordinate plane is written as an *ordered pair* $(x, y)$. The first number tells you how far to move right (positive) or left (negative) from the origin $(0, 0)$. The second tells you how far to move up (positive) or down (negative).
]

= Part A: Reading coordinates

#question(points: 5)[
  Use the grid to write the coordinates of each point.

  #align(center)[
    #coordinate-plane(
      x: (-5, 5),
      y: (-5, 5),
      unit: 6mm,
      points: ((3, 2, [A]), (-4, 3, [B]), (-2, -3, [C]), (4, -4, [D]), (-3, 0, [E])),
    )
  ]

  + A = (#blank(width: 2.5em, answer: [3]), #blank(width: 2.5em, answer: [2]))
  + B = (#blank(width: 2.5em, answer: [$-4$]), #blank(width: 2.5em, answer: [3]))
  + C = (#blank(width: 2.5em, answer: [$-2$]), #blank(width: 2.5em, answer: [$-3$]))
  + D = (#blank(width: 2.5em, answer: [4]), #blank(width: 2.5em, answer: [$-4$]))
  + E = (#blank(width: 2.5em, answer: [$-3$]), #blank(width: 2.5em, answer: [0]))
]

#question(points: 1)[
  In which quadrant is the point $(-4, 3)$?
  #mcq([Quadrant I], [Quadrant II], [Quadrant III], [Quadrant IV], answer: 2)
]

#question(points: 1)[
  A point has coordinates $(0, -5)$. Where does it lie?
  #mcq([On the #emph[x]-axis], [On the #emph[y]-axis], [In Quadrant III], [At the origin], answer: 2)
]

#question(points: 2)[
  Mark each statement true or false.
  #true-false(answer: true)[Both coordinates of every point in Quadrant III are negative.]
  #true-false(answer: false)[The points $(2, 5)$ and $(5, 2)$ are the same point.]
]

= Part B: Plotting points

#question(points: 4)[
  Plot and label these points on the grid below.

  $P(2, 3)$ #h(1.5em) $Q(-3, 1)$ #h(1.5em) $R(-1, -4)$ #h(1.5em) $S(4, 0)$

  #align(center)[
    #coordinate-plane(x: (-5, 5), y: (-5, 5), unit: 6mm)
  ]

  #answer[
    #align(center)[
      #coordinate-plane(
        x: (-5, 5),
        y: (-5, 5),
        unit: 6mm,
        points: ((2, 3, [P]), (-3, 1, [Q]), (-1, -4, [R]), (4, 0, [S])),
      )
    ]
  ]
]

#question(points: 3)[
  Three corners of a rectangle $A B C D$ are shown on the grid.

  #align(center)[
    #coordinate-plane(
      x: (-1, 6),
      y: (-1, 5),
      unit: 7mm,
      points: ((1, 1, [A]), (5, 1, [B]), (5, 4, [C])),
    )
  ]

  + Write the coordinates of the fourth corner, $D$.
    #answer-lines(count: 1, answer: [$D = (1, 4)$])
  + Find the length and width of the rectangle.
    #answer-lines(count: 1, answer: [Length $= 4$ units, width $= 3$ units.])
]

= Part C: Challenge

#question(points: 3)[
  Starting at the origin, a robot moves 4 units right, then 6 units up, then 7 units left. Where does it end up? Write its final position as an ordered pair and name the quadrant.
  #answer-space(height: 5em, answer: [$(4, 0) -> (4, 6) -> (-3, 6)$. The robot ends at $(-3, 6)$, in Quadrant II.])
]