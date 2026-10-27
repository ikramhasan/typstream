#show: worksheet.with(title: [Area and Perimeter of Rectangles and Triangles], subject: [Mathematics], grade: [Grade 6], info: ("name", "class", "roll"))
#import "@preview/cetz:0.5.3"

#instructions[
  - Area is the space inside a shape. Give area in square centimetres, $"cm"^2$.
  - Perimeter is the distance all the way around a shape. Give it in centimetres, cm.
  - The triangle's height is the perpendicular distance from the base to the top point (the dashed line).
]

= Part A: Rectangles and triangles

#question(points: 4)[
  A rectangle is 8 cm long and 5 cm wide.
  #cetz.canvas({
    import cetz.draw: *
    rect((0, 0), (4, 2.5))
    content((2, -0.5), [$8 "cm"$])
    content((4.6, 1.25), [$5 "cm"$])
  })

  + Find the area of the rectangle.
    #answer-lines(count: 1, answer: [$8 times 5 = 40$, so the area is $40 "cm"^2$.])
  + Find the perimeter of the rectangle.
    #answer-lines(count: 1, answer: [$8 + 5 + 8 + 5 = 26$, so the perimeter is 26 cm.])
]

#question(points: 4)[
  The triangle below has a base of 6 cm and a height of 4 cm. Its two other sides are each 5 cm long.
  #cetz.canvas({
    import cetz.draw: *
    line((0, 0), (6, 0), (3, 4), close: true)
    line((3, 0), (3, 4), stroke: (dash: "dashed"))
    content((3, -0.6), [$6 "cm"$])
    content((3.5, 2), [$4 "cm"$])
    content((1.1, 2.6), [$5 "cm"$])
    content((4.9, 2.6), [$5 "cm"$])
  })

  + Find the area of the triangle. Use $"area" = 1/2 times "base" times "height"$.
    #answer-space(height: 3em, answer: [$1/2 times 6 times 4 = 12$, so the area is $12 "cm"^2$.])
  + Find the perimeter of the triangle.
    #answer-space(height: 3em, answer: [$5 + 5 + 6 = 16$, so the perimeter is 16 cm.])
]

= Part B: Problems

#question(points: 3)[
  A rectangular garden is 12 m long and 7 m wide. A gardener wants to put a fence all the way around it, and to cover the inside with grass. Find:
  + the length of fencing needed;
    #answer-lines(count: 1, answer: [$12 + 7 + 12 + 7 = 38$ m])
  + the area of grass needed.
    #answer-lines(count: 1, answer: [$12 times 7 = 84$, so $84 "m"^2$])
]

#question(points: 2)[
  A rectangle has an area of $36 "cm"^2$ and a width of 4 cm. Find its length and its perimeter.
  #answer-space(height: 4em, answer: [Length: $36 div 4 = 9$ cm. Perimeter: $9 + 4 + 9 + 4 = 26$ cm.])
]

#question(points: 2)[
  Two triangles have the same base of 10 cm. Triangle X has a height of 3 cm and triangle Y has a height of 6 cm. Which triangle has the larger area, and how much larger is it?
  #answer-space(height: 4em, answer: [Triangle X: $1/2 times 10 times 3 = 15 "cm"^2$. Triangle Y: $1/2 times 10 times 6 = 30 "cm"^2$. Triangle Y has the larger area, by $15 "cm"^2$.])
]

#answer-key()