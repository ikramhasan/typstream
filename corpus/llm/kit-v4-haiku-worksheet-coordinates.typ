#show: worksheet.with(
  title: [Plotting Points on the Coordinate Plane],
  subject: [Mathematics],
  grade: [Grade 7],
  instructions: [Each point is written as an ordered pair $(x, y)$. The first number is the horizontal position, measured from the origin along the $x$-axis. The second number is the vertical position, measured along the $y$-axis. Remember that moving left or down gives a negative number.],
)

= Section A: Reading coordinates

#question(points: 4)[
  Look at the coordinate plane below. Write the coordinates of each labelled point.
  #coordinate-plane(
    x: (-6, 6),
    y: (-6, 6),
    points: ((3, 2, [A]), (-4, 1, [B]), (-2, -3, [C]), (0, -5, [D]), (5, -1, [E])),
  )
  + Point A: #blank(width: 6em, answer: [(3, 2)])
  + Point B: #blank(width: 6em, answer: [(-4, 1)])
  + Point C: #blank(width: 6em, answer: [(-2, -3)])
  + Point D: #blank(width: 6em, answer: [(0, -5)])
]

#question(points: 1)[
  Which point lies on the $x$-axis?
  #mcq([A], [B], [D], [E], answer: 3)
]

= Section B: Plotting points

#question(points: 6)[
  On the empty coordinate plane below, plot and label each point.
  + $F(4, -3)$
  + $G(-5, 4)$
  + $H(0, 6)$
  + $J(-2, -2)$

  #coordinate-plane(x: (-6, 6), y: (-6, 6))
  #answer[F is 4 right and 3 down. G is 5 left and 4 up. H lies on the $y$-axis, 6 up. J is 2 left and 2 down, in quadrant III.]
]

#question(points: 1)[
  In which quadrant is the point $(-3, 5)$?
  #mcq([Quadrant I], [Quadrant II], [Quadrant III], [Quadrant IV], answer: 2)
]

#question(points: 1)[
  #true-false(answer: false)[The point $(-2, 3)$ lies in quadrant IV.]
]

= Section C: Problem solving

#question(points: 2)[
  A point starts at $(1, -2)$. It moves 3 units left and then 2 units up. Write the coordinates of its new position.
  #answer-space(height: 3em, answer: [Left 3 gives $(-2, -2)$; up 2 gives $(-2, 0)$. The new position is $(-2, 0)$.])
  Final position: #blank(width: 6em, answer: [(-2, 0)])
]

#question(points: 3)[
  Two points are $P(2, 4)$ and $Q(2, -1)$. Explain how you can tell that the segment joining them is vertical, and state how many units long it is.
  #answer-lines(count: 2, answer: [Both points have the same $x$-coordinate, 2, so the segment runs up and down. It is $4 - (-1) = 5$ units long.])
]

#callout(kind: "remember")[
  Points with the same $x$-coordinate lie on a vertical line. Points with the same $y$-coordinate lie on a horizontal line.
]