= Plotting Points and Reading Coordinates

*Grade 7 Mathematics* #h(1fr) Name: #box(width: 6cm, line(length: 100%)) Date: #box(width: 3cm, line(length: 100%))

== Part A: Vocabulary

Fill in each blank using the words in the box: _origin_, _x-axis_, _y-axis_, _ordered pair_, _quadrant_.

+ The horizontal number line in a coordinate plane is the #box(width: 3cm, line(length: 100%)).
+ The vertical number line is the #box(width: 3cm, line(length: 100%)).
+ The point $(0, 0)$, where the two axes meet, is the #box(width: 3cm, line(length: 100%)).
+ A pair of numbers $(x, y)$ that names one point is called an #box(width: 3cm, line(length: 100%)).
+ The plane is divided into four regions called #box(width: 3cm, line(length: 100%)).

== Part B: Reading Coordinates

The grid below has the origin at its center. Each square is one unit. The letters mark points. Write the ordered pair for each point.

#let pts = ((3, 2, [A]), (-2, 4, [B]), (-4, -3, [C]), (0, 0, [D]), (4, -1, [E]))
#let lab(x, y) = {
  let h = pts.find(p => p.at(0) == x and p.at(1) == y)
  if h != none { h.at(2) } else { [] }
}
#let cells = {
  let out = ()
  for yy in range(9) {
    for xx in range(9) {
      out.push(box(width: 18pt, height: 18pt, align(center + horizon, lab(xx - 4, 4 - yy))))
    }
  }
  out
}

#align(center, grid(columns: 9, stroke: 0.5pt, ..cells))

+ Point A is at #box(width: 3cm, line(length: 100%)).
+ Point B is at #box(width: 3cm, line(length: 100%)).
+ Point C is at #box(width: 3cm, line(length: 100%)).
+ Point D is at #box(width: 3cm, line(length: 100%)).
+ Point E is at #box(width: 3cm, line(length: 100%)).

== Part C: Plotting Points

Plot each point on the blank grid below. Label each point with its letter. Use the same origin at the center. Start from the origin: move along the $x$-axis first, then up or down along the $y$-axis.

#table(
  columns: 3,
  [*Point*], [*Ordered pair*], [*Quadrant or axis*],
  [F], [$(2, 3)$], [#v(1em)],
  [G], [$(-3, 1)$], [#v(1em)],
  [H], [$(-1, -4)$], [#v(1em)],
  [J], [$(4, 0)$], [#v(1em)],
)

#v(1em)

#align(center, grid(columns: 9, stroke: 0.5pt, ..range(81).map(i => box(width: 18pt, height: 18pt))))

== Part D: Think About It

+ Two points have the same $x$-coordinate. What do they have in common, and how are they different?
  #v(2em)
+ Explain why the point $(-5, 2)$ is in a different place than $(5, 2)$. Describe the path from the origin to each point.
  #v(2em)
+ Max says the point $(3, -2)$ is in Quadrant I. Is he correct? Explain your reasoning.
  #v(2em)
+ A treasure is buried at $(-4, 6)$. Describe two different ways a map reader could find it using the grid and the axes.
  #v(2em)

== Challenge

+ Plot the points $(1, 1)$, $(1, -3)$, $(-2, -3)$, and $(-2, 1)$ on a grid. Connect them in order and then back to the first point. What shape do you get, and what is its area in square units?
  #v(2em)