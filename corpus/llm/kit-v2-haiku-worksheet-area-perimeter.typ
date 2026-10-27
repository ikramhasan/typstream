#show: worksheet.with(title: [Area and Perimeter], subject: [Mathematics], grade: [Grade 6], info: ("name", "date", "class"))

#import "@preview/cetz:0.5.3"

#instructions[
  - Use the side lengths given on each shape.
  - Write units with every answer.
  - Show your working in the space provided.
]

#callout(kind: "remember")[
  - Perimeter is the total distance around a shape.
  - Area of a rectangle: $"length" times "width"$.
  - Area of a triangle: $1/2 times "base" times "height"$.
]

= Part A: Rectangle

#question(points: 4)[
  The rectangle below has a length of 8 cm and a width of 3 cm.

  #cetz.canvas({
    import cetz.draw: *
    rect((0, 0), (8, 3))
    content((4, -0.6), [8 cm])
    content((-0.7, 1.5), [3 cm])
  })

  + Find the perimeter of the rectangle.
    #answer-space(height: 3em, answer: [$8 + 3 + 8 + 3 = 22$ cm])
  + Find the area of the rectangle.
    #answer-space(height: 3em, answer: [$8 times 3 = 24$ $"cm"^2$])
]

= Part B: Triangle

#question(points: 5)[
  The isosceles triangle below has a base of 6 cm, two equal sides of 5 cm, and a perpendicular height of 4 cm (shown dashed).

  #cetz.canvas({
    import cetz.draw: *
    polygon((0, 0), (6, 0), (3, 4))
    line((3, 0), (3, 4), stroke: (dash: "dashed"))
    content((3, -0.6), [6 cm])
    content((0.8, 2.4), [5 cm])
    content((5.2, 2.4), [5 cm])
    content((2.3, 2), [4 cm])
  })

  + Find the perimeter of the triangle.
    #answer-space(height: 3em, answer: [$6 + 5 + 5 = 16$ cm])
  + Find the area of the triangle.
    #answer-space(height: 3em, answer: [$1/2 times 6 times 4 = 12$ $"cm"^2$])
  + Explain why the area of the triangle is half the area of a rectangle with the same base and height.
    #answer-lines(count: 2, answer: [A rectangle with the same base and height can be split by a diagonal into two identical triangles.])
]

= Part C: Problem solving

#question(points: 3)[
  A rectangular garden is 9 m long and 5 m wide. A gardener wants to put a fence around it. How many metres of fence are needed? Show your working.
  #answer-space(height: 4em, answer: [$9 + 5 + 9 + 5 = 28$ m, so 28 m of fence.])
]

#question(points: 3)[
  Two shapes both have an area of 24 cm$""^2$. One is a rectangle 8 cm by 3 cm. The other is a triangle with a base of 8 cm. What is the height of the triangle?
  #answer-space(height: 4em, answer: [$1/2 times 8 times h = 24$, so $h = 6$ cm.])
]

#answer-key()