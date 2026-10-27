#show: exam.with(
  title: [Kinematics and Newton's Laws],
  subject: [Physics],
  grade: [Grade 11],
  duration: [1 hour],
  instructions: [Answer *all* questions. Take $g = 9.8$ "m/s"^2 and show your working. Give answers to two significant figures unless told otherwise.],
)

#import "@preview/cetz:0.5.3"

= Section A: Kinematics

#question(points: 6)[
  A car starts from rest and accelerates uniformly at $3$ "m/s"^2 for $8$ s.
  + Find the car's final velocity.
    #answer-space(height: 3em, answer: [$v = u + a t = 0 + 3 times 8 = 24$ "m/s"])
  + Find the distance travelled in this time.
    #answer-space(height: 3em, answer: [$s = u t + 1/2 a t^2 = 0 + 1/2 dot 3 dot 8^2 = 96$ m])
]

#question(points: 2)[
  A ball is thrown straight up at $15$ "m/s". Which expression gives the time to reach its highest point?
  #mcq($t = 15 / 9.8$ s, $t = 9.8 / 15$ s, $t = 15 dot 9.8$ s, $t = 2 dot 15 / 9.8$ s, answer: 1)
]

= Section B: Newton's laws on an incline

#question(points: 1)[
  Draw and label the free-body diagram for the block in the figure. Forces to show: weight, normal force and friction.
  #align(center)[
    #cetz.canvas({
      import cetz.draw: *
      // Incline
      line((0, 0), (5, 2.5), (5, 0), close: true, fill: luma(235), stroke: 1pt)
      // Angle arc at the bottom left of the slope
      arc((1.2, 0), start: 0deg, stop: 26.6deg, radius: 1.2)
      content((1.9, 0.25), [$theta$])
      // Block resting on the slope (upright on the surface)
      line((2.142, 1.071), (2.858, 1.429), (2.5, 2.144), (1.784, 1.786), close: true, fill: luma(200), stroke: 1pt)
      // Forces from the block's centre (2.32, 1.61)
      line((2.32, 1.61), (2.32, -0.39), mark: (end: ">"), stroke: 1.2pt)
      content((2.75, 0.6), [$m g$])
      line((2.32, 1.61), (1.65, 2.95), mark: (end: ">"), stroke: 1.2pt)
      content((1.2, 2.9), [$N$])
      line((2.32, 1.61), (3.39, 2.15), mark: (end: ">"), stroke: 1.2pt)
      content((3.6, 2.5), [$f$])
    })
  ]
  #answer-space(height: 2em, answer: [Weight $m g$ vertically down; normal force $N$ perpendicular to the surface; friction $f$ up the slope, opposing motion.])
]

#question(points: 6)[
  A $5$ kg block slides down a frictionless plane inclined at $30 degree$ to the horizontal.
  + Show that the acceleration down the plane is $a = g sin theta$, and calculate its value.
    #answer-space(height: 5em, answer: [Along the slope: $m g sin theta = m a$, so $a = g sin theta = 9.8 times 0.5 = 4.9$ "m/s"^2 down the slope.])
  + Calculate the normal force on the block.
    #answer-space(height: 3em, answer: [$N = m g cos theta = 5 times 9.8 times cos 30 degree approx 42$ N])
]

#question(points: 6)[
  The same block now experiences kinetic friction with coefficient $mu_k = 0.20$ on the slope.
  + Calculate the friction force.
    #answer-space(height: 3em, answer: [$f = mu_k N = 0.20 times 42.4 approx 8.5$ N])
  + Calculate the block's acceleration down the slope.
    #answer-space(height: 5em, answer: [$F_"net" = m g sin theta - f = 24.5 - 8.5 = 16.0$ N, so $a = F_"net" / m = 16.0 / 5 = 3.2$ "m/s"^2 down the slope.])
]

#question(points: 2)[
  State Newton's third law and give one example of it acting on the block and the slope.
  #answer-lines(count: 2, answer: [For every force on body A from body B, there is an equal and opposite force on B from A. Example: the block pushes into the slope with a force equal to the normal force, and the slope pushes back on the block with the same magnitude.])
]

#answer-key()