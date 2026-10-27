#set page(paper: "us-letter", margin: 1.8cm)
#set text(size: 11pt)
#set par(justify: false)

#let fillc = rgb("#e6f0fa")

// Rectangle with labelled sides
#let rectfig(w, h, top, side) = grid(
  columns: (auto, auto),
  column-gutter: 5pt,
  row-gutter: 4pt,
  [], align(center)[#top],
  align(horizon + right)[#side], rect(width: w, height: h, fill: fillc, stroke: 1pt),
)

// Triangle: bw = base width, th = height, ox = horizontal position of apex
#let tri(bw, th, ox, base: none, h: none, l: none, r: none, hline: false) = box(
  width: bw + 80pt,
  height: th + 30pt,
)[
  #place(dx: 35pt, dy: 5pt, polygon(fill: fillc, stroke: 1pt, (0pt, th), (bw, th), (ox, 0pt)))
  #if hline [
    #place(dx: 35pt + ox, dy: 5pt, line(start: (0pt, 0pt), end: (0pt, th), stroke: (thickness: 0.8pt, dash: "dashed")))
    #place(dx: 35pt + ox - 6pt, dy: 5pt + th - 6pt, rect(width: 6pt, height: 6pt, stroke: 0.6pt))
  ]
  #if ox == 0pt [
    #place(dx: 35pt, dy: 5pt + th - 6pt, rect(width: 6pt, height: 6pt, stroke: 0.6pt))
  ]
  #if base != none [
    #place(dx: 35pt + bw / 2 - 12pt, dy: th + 9pt, base)
  ]
  #if h != none [
    #place(dx: 35pt + ox + 5pt, dy: 5pt + th / 2 - 6pt, h)
  ]
  #if l != none [
    #place(dx: 35pt + ox / 2 - 32pt, dy: 5pt + th / 2 - 6pt, l)
  ]
  #if r != none [
    #place(dx: 35pt + (bw + ox) / 2 + 6pt, dy: 5pt + th / 2 - 6pt, r)
  ]
]

#let ans(label, unit) = [#label #box(width: 5em, height: 1em, stroke: (bottom: 0.6pt)) #unit]

#align(center)[
  #text(size: 18pt, weight: "bold")[Area and Perimeter: Rectangles and Triangles]
]

#v(0.5em)
Name: #box(width: 8cm, stroke: (bottom: 0.6pt), height: 1em) #h(1fr) Date: #box(width: 3.5cm, stroke: (bottom: 0.6pt), height: 1em)

#v(0.8em)

#rect(width: 100%, inset: 10pt, radius: 4pt, stroke: 1pt, fill: rgb("#fffbe6"))[
  *Remember*
  - *Perimeter* is the distance around a shape: add up all the side lengths.
  - Rectangle: $P = 2 times (l + w)$ #h(1em) and #h(1em) $A = l times w$
  - Triangle: $P = a + b + c$ #h(1em) and #h(1em) $A = 1/2 times b times h$
  - Perimeter is measured in cm, area is measured in cm#super[2]. The shapes are not drawn to scale.
]

== Part A: Rectangles

Find the perimeter and the area of each rectangle.

+ #grid(
    columns: (auto, 1fr),
    column-gutter: 2cm,
    rectfig(100pt, 60pt, [8 cm], [5 cm]),
    [
      #v(0.5em)
      #ans([Perimeter =], [cm])

      #v(0.6em)
      #ans([Area =], [cm#super[2]])
    ],
  )

#v(0.6em)

+ #grid(
    columns: (auto, 1fr),
    column-gutter: 2cm,
    rectfig(144pt, 36pt, [12 cm], [3 cm]),
    [
      #v(0.2em)
      #ans([Perimeter =], [cm])

      #v(0.6em)
      #ans([Area =], [cm#super[2]])
    ],
  )

#v(0.6em)

+ This square has all sides equal.

  #grid(
    columns: (auto, 1fr),
    column-gutter: 2cm,
    rectfig(70pt, 70pt, [6 cm], [6 cm]),
    [
      #v(0.8em)
      #ans([Perimeter =], [cm])

      #v(0.6em)
      #ans([Area =], [cm#super[2]])
    ],
  )

#v(0.6em)

+ The area of this rectangle is 36 cm#super[2]. Its width is 4 cm. What is its length?

  #grid(
    columns: (auto, 1fr),
    column-gutter: 2cm,
    rectfig(110pt, 44pt, [?], [4 cm]),
    [
      #v(0.8em)
      #ans([Length =], [cm])
    ],
  )

== Part B: Area of Triangles

The dashed line shows the height. Use $A = 1/2 times b times h$.

+ #grid(
    columns: (auto, 1fr),
    column-gutter: 1cm,
    tri(120pt, 70pt, 45pt, base: [10 cm], h: [6 cm], hline: true),
    [
      #v(1.5em)
      #ans([Area =], [cm#super[2]])
    ],
  )

+ #grid(
    columns: (auto, 1fr),
    column-gutter: 1cm,
    tri(100pt, 62pt, 70pt, base: [8 cm], h: [5 cm], hline: true),
    [
      #v(1.5em)
      #ans([Area =], [cm#super[2]])
    ],
  )

+ This is a right triangle. The two short sides are its base and height.

  #grid(
    columns: (auto, 1fr),
    column-gutter: 1cm,
    tri(110pt, 70pt, 0pt, base: [9 cm], l: [6 cm], r: [], hline: false),
    [
      #v(1.5em)
      #ans([Area =], [cm#super[2]])
    ],
  )

== Part C: Perimeter of Triangles

+ #grid(
    columns: (auto, 1fr),
    column-gutter: 1cm,
    tri(120pt, 66pt, 40pt, base: [10 cm], l: [5 cm], r: [7 cm]),
    [
      #v(1.5em)
      #ans([Perimeter =], [cm])
    ],
  )

+ #grid(
    columns: (auto, 1fr),
    column-gutter: 1cm,
    tri(110pt, 70pt, 0pt, base: [8 cm], l: [6 cm], r: [10 cm]),
    [
      #v(1.5em)
      #ans([Perimeter =], [cm])
    ],
  )

== Part D: Word Problems

+ A rectangular garden is 9 m long and 4 m wide. How much fencing is needed to go all the way around it?

  #v(3em)
  #line(length: 100%, stroke: 0.5pt)

+ A triangular sail has a base of 6 m and a height of 8 m. How much cloth is needed to make the sail?

  #v(3em)
  #line(length: 100%, stroke: 0.5pt)

+ *Challenge:* A rectangle and a triangle each have a base of 10 cm and a height of 4 cm. How many times larger is the area of the rectangle than the area of the triangle? Explain how you know.

  #v(3em)
  #line(length: 100%, stroke: 0.5pt)
  #v(1.5em)
  #line(length: 100%, stroke: 0.5pt)