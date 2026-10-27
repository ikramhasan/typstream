#show: exam.with(
  title: [Kinematics and Newton's Laws],
  subject: [Physics],
  grade: [Grade 11],
  duration: [90 minutes],
  instructions: [
    Answer *all* questions. Show your working and include units in numerical answers.
    Use $g = 9.8$ #unit("m/s^2") unless told otherwise. Calculators are allowed.
  ],
)

#import "@preview/cetz:0.5.3"
#import "@preview/unify:0.8.1": num, qty, unit

= Section A: Concepts

#question(points: 1)[
  The slope of a velocity–time graph represents
  #mcq([displacement], [acceleration], [distance travelled], [force], answer: 2)
]

#question(points: 1)[
  A car starts from rest and accelerates uniformly at #qty("2", "m/s^2") for 5 s. How far does it travel?
  #mcq([#qty("10", "m")], [#qty("12.5", "m")], [#qty("25", "m")], [#qty("50", "m")], answer: 3)
]

#question(points: 1)[
  A ball is thrown vertically upward. At its highest point (ignoring air resistance), which statement is correct?
  #mcq(
    [Its velocity is zero and its acceleration is zero.],
    [Its velocity is zero and its acceleration is $9.8$ #unit("m/s^2") downward.],
    [Its velocity is upward and its acceleration is zero.],
    [Its velocity is zero and its acceleration is $9.8$ #unit("m/s^2") upward.],
    answer: 2,
    columns: 1,
  )
]

#question(points: 1)[
  According to Newton's first law, if the net force on an object is zero, then
  #mcq(
    [it must be at rest],
    [it must be accelerating],
    [it must be speeding up],
    [it moves with constant velocity (possibly zero)],
    answer: 4,
    columns: 1,
  )
]

#question(points: 1)[
  Two forces of #qty("6", "N") and #qty("8", "N") act on an object at right angles to each other. The magnitude of the resultant force is
  #mcq([#qty("2", "N")], [#qty("10", "N")], [#qty("14", "N")], [#qty("48", "N")], answer: 2)
]

#question(points: 1)[
  A book rests on a table. The Earth pulls the book downward with its weight. Which force is the Newton's third law reaction to this weight?
  #mcq(
    [The table pushing up on the book],
    [The book pressing down on the table],
    [The book pulling the Earth upward],
    [The air pushing down on the book],
    answer: 3,
    columns: 1,
  )
]

#question(points: 2)[
  Mark each statement true or false.
  #true-false(answer: true)[An object can have zero velocity and non-zero acceleration at the same instant.]
  #true-false(answer: false)[Mass and weight are the same quantity measured in different units.]
]

= Section B: Kinematics

#question(points: 5)[
  A car travelling at #qty("20", "m/s") brakes uniformly and comes to rest in 8.0 s.
  + Calculate the acceleration of the car.
    #answer-space(height: 4em, answer: [$a = (v - u)/t = (0 - 20)/8.0 = -2.5$ #unit("m/s^2") (a deceleration of #qty("2.5", "m/s^2")).])
  + Calculate the distance the car travels while braking.
    #answer-space(height: 5em, answer: [$s = (u + v)/2 dot t = (20 + 0)/2 times 8.0 = 80$ m.])
]

#question(points: 5)[
  A ball is thrown horizontally at #qty("12", "m/s") from the edge of a cliff #qty("45", "m") high. Ignore air resistance.
  + How long does the ball take to reach the ground?
    #answer-space(height: 5em, answer: [Vertically: $h = 1/2 g t^2$, so $t = sqrt(2 times 45 / 9.8) = 3.03$ s.])
  + How far from the base of the cliff does it land?
    #answer-space(height: 4em, answer: [$x = v_x t = 12 times 3.03 = 36.4$ m.])
]

#question(points: 5)[
  The graph shows the velocity of a cyclist moving in a straight line.

  #align(center, cetz.canvas({
    import cetz.draw: *
    line((0, 0), (7.7, 0), mark: (end: "stealth", fill: black))
    line((0, 0), (0, 3.8), mark: (end: "stealth", fill: black))
    line((0, 3.2), (2, 3.2), stroke: (dash: "dashed", paint: gray))
    line((2, 0), (2, 3.2), stroke: (dash: "dashed", paint: gray))
    line((5, 0), (5, 3.2), stroke: (dash: "dashed", paint: gray))
    line((0, 0), (2, 3.2), (5, 3.2), (7, 0), stroke: 1.5pt + blue)
    content((0, -0.4), [0])
    content((2, -0.4), [4])
    content((5, -0.4), [10])
    content((7, -0.4), [14])
    content((-0.4, 3.2), [8])
    content((8.3, 0), [$t$ (s)])
    content((0.2, 4.1), [$v$ (m/s)])
  }))

  + Find the cyclist's acceleration during the first 4 s.
    #answer-space(height: 4em, answer: [$a = Delta v / Delta t = 8 / 4 = 2$ #unit("m/s^2").])
  + Find the total distance travelled in the 14 s.
    #answer-space(height: 6em, answer: [Area under the graph: $1/2 times 4 times 8 + 6 times 8 + 1/2 times 4 times 8 = 16 + 48 + 16 = 80$ m.])
]

= Section C: Newton's laws

#question(points: 4)[
  A #qty("1200", "kg") car is driven by an engine force of #qty("3000", "N") against a total resistive force of #qty("600", "N").
  + Find the net force on the car.
    #answer-space(height: 3em, answer: [$F_"net" = 3000 - 600 = 2400$ N.])
  + Find the car's acceleration.
    #answer-space(height: 3em, answer: [$a = F_"net" / m = 2400 / 1200 = 2.0$ #unit("m/s^2").])
]

#question(points: 4)[
  A #qty("60", "kg") student stands on a weighing scale in a lift.
  + Calculate the scale reading (the normal force) when the lift accelerates upward at #qty("1.5", "m/s^2").
    #answer-space(height: 4em, answer: [$N - m g = m a$, so $N = m(g + a) = 60 times (9.8 + 1.5) = 678$ N.])
  + What does the scale read when the lift moves upward at a constant speed? Explain.
    #answer-space(height: 4em, answer: [$a = 0$, so $N = m g = 60 times 9.8 = 588$ N. The forces are balanced.])
]

#question(points: 10)[
  A #qty("5.0", "kg") block slides down a rough incline that makes an angle $theta = 30°$ with the horizontal. The coefficient of kinetic friction is $mu_k = 0.20$. The free-body diagram shows the three forces on the block: the normal force $N$, the friction force $f$ and the weight $m g$.

  #align(center, cetz.canvas({
    import cetz.draw: *
    line((0, 0), (6, 0), (6, 3.464), close: true, fill: luma(240), stroke: 1pt)
    group({
      translate((2.4, 1.85))
      rotate(30deg)
      rect((-0.5, -0.4), (0.5, 0.4), fill: white, stroke: 1pt)
    })
    // normal force
    line((2.4, 1.85), (1.65, 3.15), mark: (end: "stealth", fill: red), stroke: 1.2pt + red)
    content((1.35, 3.3), text(fill: red)[$N$])
    // friction (up the slope)
    line((2.4, 1.85), (3.35, 2.4), mark: (end: "stealth", fill: green.darken(30%)), stroke: 1.2pt + green.darken(30%))
    content((3.7, 2.55), text(fill: green.darken(30%))[$f$])
    // weight
    line((2.4, 1.85), (2.4, 0.25), mark: (end: "stealth", fill: blue), stroke: 1.2pt + blue)
    content((2.8, 0.55), text(fill: blue)[$m g$])
    // angle
    arc((1.2, 0), start: 0deg, stop: 30deg, radius: 1.2)
    content((1.65, 0.25), [$30°$])
  }))

  + Describe the origin and direction of each of the forces $N$, $f$ and $m g$.
    #answer-lines(count: 3, answer: [$N$: contact force from the surface, perpendicular to the incline and away from it. $f$: friction from the surface, parallel to the incline and up the slope (opposing the sliding). $m g$: gravitational pull of the Earth, vertically downward.])
  + Calculate the components of the weight parallel and perpendicular to the incline.
    #answer-space(height: 5em, answer: [$m g = 5.0 times 9.8 = 49$ N. Parallel: $m g sin 30° = 24.5$ N. Perpendicular: $m g cos 30° = 42.4$ N.])
  + Find the normal force and the friction force.
    #answer-space(height: 5em, answer: [$N = m g cos 30° = 42.4$ N. $f = mu_k N = 0.20 times 42.4 = 8.5$ N.])
  + Find the acceleration of the block down the incline.
    #answer-space(height: 6em, answer: [$F_"net" = m g sin 30° - f = 24.5 - 8.5 = 16.0$ N. $a = F_"net" / m = 16.0 / 5.0 = 3.2$ #unit("m/s^2") down the slope.])
]

#question(points: 4)[
  A student says: "Action and reaction forces are equal and opposite, so they always cancel and nothing could ever accelerate." Explain the mistake in this reasoning.
  #answer-lines(count: 4, answer: [Action and reaction forces act on _different_ objects, so they cannot cancel each other. Only the forces acting on a single object determine that object's acceleration. If the net external force on it is non-zero, it accelerates.])
]

#question(points: 5)[
  Two blocks of mass #qty("4.0", "kg") and #qty("6.0", "kg") are joined by a light rope on a smooth horizontal table. A horizontal force of #qty("20", "N") pulls the #qty("6.0", "kg") block, so the #qty("4.0", "kg") block is pulled along behind it.
  + Find the acceleration of the blocks.
    #answer-space(height: 4em, answer: [$a = F / (m_1 + m_2) = 20 / 10 = 2.0$ #unit("m/s^2").])
  + Find the tension in the rope joining the blocks.
    #answer-space(height: 4em, answer: [The tension alone accelerates the #qty("4.0", "kg") block: $T = m_1 a = 4.0 times 2.0 = 8.0$ N.])
]