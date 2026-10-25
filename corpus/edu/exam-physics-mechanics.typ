#set page(margin: 2cm, numbering: "1 / 1")
#set text(size: 11pt)
#set math.equation(numbering: "(1)")
#set figure(gap: 0.8em)

#let unit(u) = math.upright(u)
#let given(..pairs) = table(
  columns: 2,
  stroke: none,
  inset: (x: 6pt, y: 3pt),
  ..pairs.pos().flatten(),
)

#align(center)[
  #text(18pt)[*Physics: Forces and Motion*] \
  End-of-unit test · 50 marks · 60 minutes
]

*Useful equations*

$ v = u + a t $ <eq-v>
$ s = u t + 1/2 a t^2 $ <eq-s>
$ v^2 = u^2 + 2 a s $ <eq-v2>
$ F = m a $ <eq-newton>

Take $g = 9.8 unit("m/s")^2$ unless stated otherwise.

== Question 1 — Kinematics [12 marks]

A cyclist starts from rest and accelerates uniformly at $1.5 unit("m/s")^2$ for $8.0 unit("s")$.

#given(
  [$u$], [$0 unit("m/s")$],
  [$a$], [$1.5 unit("m/s")^2$],
  [$t$], [$8.0 unit("s")$],
)

+ Use @eq-v to calculate the cyclist's final speed. #h(1fr) [3]
+ Use @eq-s to calculate the distance travelled. #h(1fr) [3]
+ The cyclist then brakes and stops in $6.0 unit("m")$. Use @eq-v2 to find the deceleration. #h(1fr) [4]
+ State one assumption you made in part (c). #h(1fr) [2]

== Question 2 — Velocity–time graphs [10 marks]

#figure(
  table(
    columns: 7,
    align: center,
    table.header([$t$ (s)], [0], [2], [4], [6], [8], [10]),
    [$v$ (m/s)], [0], [4], [8], [8], [8], [0],
  ),
  caption: [Velocity of a lift during one journey.],
) <tab-lift>

+ Describe the motion of the lift between 0 s and 4 s, using @tab-lift. #h(1fr) [2]
+ Calculate the acceleration during the first 4 s. #h(1fr) [2]
+ Calculate the total distance travelled by the lift. #h(1fr) [4]
+ Sketch the velocity–time graph. #h(1fr) [2]

#rect(width: 100%, height: 5cm, stroke: (dash: "dotted"))[#align(center + horizon)[_graph area_]]

== Question 3 — Newton's laws [16 marks]

#figure(
  {
    set align(center)
    box(width: 8cm, height: 3cm)[
      #place(center + horizon, rect(width: 2.6cm, height: 1.4cm, fill: luma(225))[#align(center + horizon)[$m = 1200 unit("kg")$]])
      #place(left + horizon, dx: 0.2cm)[$arrow.l$ friction]
      #place(right + horizon, dx: -0.2cm)[thrust $arrow.r$]
      #place(bottom, line(length: 100%))
    ]
  },
  caption: [Horizontal forces on a car.],
) <fig-car>

The car in @fig-car has a driving force of $3000 unit("N")$ and experiences a resistive force of $600 unit("N")$.

+ Calculate the resultant force. #h(1fr) [2]
+ Using @eq-newton, calculate the acceleration. #h(1fr) [3]
+ Explain, using Newton's third law, why the car's tyres push backwards on the road. #h(1fr) [3]
+ The resistive force increases with speed. Explain why the car reaches a top speed. #h(1fr) [4]
+ Calculate the weight of the car. #h(1fr) [2]
+ Explain the difference between mass and weight. #h(1fr) [2]

== Question 4 — Momentum [12 marks]

A $0.15 unit("kg")$ ball travelling at $20 unit("m/s")$ is caught and brought to rest in $0.05 unit("s")$.

$ p = m v quad "and" quad F = (Delta p) / (Delta t) $

+ Calculate the momentum of the ball before it is caught. #h(1fr) [2]
+ Calculate the average force on the ball. #h(1fr) [3]
+ Explain why a fielder moves their hands backwards when catching. #h(1fr) [4]
+ A $70 unit("kg")$ skater at rest throws the ball forwards at $20 unit("m/s")$. Find the skater's recoil velocity. #h(1fr) [3]
