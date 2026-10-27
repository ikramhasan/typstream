#set page(margin: 1.8cm)
#set text(size: 11pt)

#let plane(n: 6, u: 0.58cm, pts: ()) = {
  let r = 2.2pt
  box(width: 2 * n * u, height: 2 * n * u, {
    for i in range(0, 2 * n + 1) {
      let s = if i == n { 1.2pt + black } else { 0.4pt + luma(190) }
      place(top + left, dx: i * u, dy: 0pt, line(start: (0pt, 0pt), end: (0pt, 2 * n * u), stroke: s))
      place(top + left, dx: 0pt, dy: i * u, line(start: (0pt, 0pt), end: (2 * n * u, 0pt), stroke: s))
    }
    for k in range(-n, n + 1) {
      if k != 0 {
        place(top + left, dx: (n + k) * u - 3pt, dy: n * u + 2pt, text(size: 7pt)[#k])
        place(top + left, dx: n * u - 9pt, dy: (n - k) * u - 4pt, text(size: 7pt)[#k])
      }
    }
    for p in pts {
      place(top + left, dx: (n + p.at(1)) * u - r, dy: (n - p.at(2)) * u - r, circle(radius: r, fill: black))
      place(top + left, dx: (n + p.at(1)) * u + 3pt, dy: (n - p.at(2)) * u - 11pt, text(size: 9pt, weight: "bold")[#p.at(0)])
    }
  })
}

#align(center)[
  #text(size: 18pt, weight: "bold")[Plotting and Reading Points in the Coordinate Plane]
]

#v(0.5em)
Name: #box(width: 6cm, line(length: 100%)) #h(1fr) Date: #box(width: 3cm, line(length: 100%))

#v(0.5em)
*Remember:* An ordered pair $(x, y)$ tells you where a point is. The first number $x$ tells you how far to move left or right from the origin $(0, 0)$. The second number $y$ tells you how far to move up or down.

The axes split the plane into four quadrants: I (top right), II (top left), III (bottom left), IV (bottom right).

== Part A: Reading Coordinates

Look at the grid. Write the coordinates of each point and tell which quadrant it is in. If it lies on an axis, write "x-axis" or "y-axis."

#grid(
  columns: (auto, 1fr),
  gutter: 1.5em,
  plane(pts: (("A", 3, 2), ("B", -4, 3), ("C", -2, -5), ("D", 5, -3), ("E", 0, 4), ("F", -6, 0))),
  table(
    columns: (auto, 1fr, 1fr),
    inset: 9pt,
    align: center + horizon,
    [*Point*], [*Coordinates*], [*Quadrant or axis*],
    [A], [], [],
    [B], [], [],
    [C], [], [],
    [D], [], [],
    [E], [], [],
    [F], [], [],
  ),
)

#v(1em)
== Part B: Plotting Points

Plot and label each point on the grid below.

#grid(
  columns: (auto, 1fr),
  gutter: 1.5em,
  plane(),
  [
    + $G(2, 5)$
    + $H(-3, -1)$
    + $I(4, 0)$
    + $J(0, -4)$
    + $K(-5, 2)$
    + $L(1, -6)$

    #v(0.8em)
    Which of these points lie on an axis? \
    #line(length: 100%)
  ],
)

#pagebreak()

== Part C: Thinking It Through

+ Three corners of a rectangle are at $(1, 1)$, $(5, 1)$ and $(5, 4)$. What are the coordinates of the fourth corner?
  #v(2.5em)

+ Point $P$ is at $(3, -2)$. If you reflect $P$ across the x-axis, where does it land?
  #v(2.5em)

+ Point $Q$ is at $(-4, 3)$ and point $R$ is at $(2, 3)$. Both are joined by a horizontal segment. How long is the segment $Q R$? Explain how you know.
  #v(3.5em)

+ Without plotting, tell which quadrant each point is in.
  #table(
    columns: 4,
    inset: 9pt,
    align: center,
    [$(-7, 2)$], [$(8, 9)$], [$(-3, -6)$], [$(4, -1)$],
    [], [], [], [],
  )

+ Maria says that $(2, 5)$ and $(5, 2)$ are the same point. Is she right? Explain.
  #v(3.5em)

+ *Challenge:* I am a point in Quadrant IV. My $x$-coordinate is 3 more than my $y$-coordinate's opposite, and my $y$-coordinate is $-2$. What are my coordinates?
  #v(3.5em)

#v(1fr)
#line(length: 100%, stroke: 0.5pt + luma(150))

== Answer Key (for teachers)

*Part A:* A$(3, 2)$ QI; B$(-4, 3)$ QII; C$(-2, -5)$ QIII; D$(5, -3)$ QIV; E$(0, 4)$ y-axis; F$(-6, 0)$ x-axis.

*Part B:* I and J lie on axes (I on the x-axis, J on the y-axis). All other points are in quadrants: G in I, H in III, K in II, L in IV.

*Part C:* (1) $(1, 4)$. (2) $(3, 2)$. (3) 6 units, since the $y$-coordinates match and $2 - (-4) = 6$. (4) II, I, III, IV. (5) No. The order matters: $(2, 5)$ is 2 right and 5 up, while $(5, 2)$ is 5 right and 2 up. (6) $x = 3 + 2 = 5$, so the point is $(5, -2)$.