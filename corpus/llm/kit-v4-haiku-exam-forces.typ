#show: exam.with(
  title: [Kinematics and Newton's Laws],
  subject: [Physics],
  grade: [Grade 11],
  duration: [1 hour],
  instructions: [Answer *all* questions. Use $g = 9.8 "m/s"^2$ unless told otherwise. Show your working for every calculation.],
)

#import "@preview/cetz:0.5.3"

= Section A: Kinematics

#question(points: 3)[
  A car starts from rest and accelerates uniformly at $2.5 "m/s"^2$ for $8 "s"$.
  + Find its final speed. #blank(width: 5em, answer: [$20 "m/s"$])
  + Find the distance it travels in those $8 "s"$. #blank(width: 5em, answer: [$80 "m"$])
  + #answer-space(height: 3em, answer: [$v = u + a t = 0 + 2.5 times 8 = 20 "m/s"$; $s = u t + a t^2 / 2 = 0 + 2.5 times 64 / 2 = 80 "m"$.])
]

#question(points: 4)[
  A ball is launched from level ground at $20 "m/s"$ at an angle of $30 degree$ above the horizontal. Ignore air resistance.
  + Find the time the ball takes to return to the ground.
    #answer-lines(count: 1, answer: [$t = (2 v_0 sin theta)/g = (2 times 20 times 0.5)/9.8 approx 2.0 "s"$])
  + Find the horizontal range of the ball.
    #answer-lines(count: 1, answer: [$R = (v_0^2 sin 2 theta)/g = (400 times 0.866)/9.8 approx 35 "m"$])
]

= Section B: Newton's laws

#question(points: 2)[
  Which statement is Newton's third law?
  #mcq(
    [Force equals mass times acceleration.],
    [An object stays at rest unless a net force acts on it.],
    [Every action has an equal and opposite reaction.],
    [Acceleration is inversely proportional to mass.],
    answer: 3,
  )
]

#question(points: 6)[
  A block of mass $5 "kg"$ rests on a smooth-or-rough incline at angle $theta = 30 degree$ to the horizontal. The free-body diagram below shows the forces on the block. The block slides down the slope.

  #align(center)[
    #cetz.canvas({
      import cetz.draw: *
      line((0, 0), (6, 0), (6, 3), close: true, fill: luma(230))
      content((1.25, 0.3), [$theta$])
      circle((3, 1.5), radius: 0.1, fill: black)
      line((3, 1.5), (3, 0.4), mark: (end: ">", fill: black))
      content((3.4, 0.9), [$m g$])
      line((3, 1.5), (2.46, 2.57), mark: (end: ">", fill: black))
      content((2.1, 2.5), [$N$])
      line((3, 1.5), (3.8, 1.9), mark: (end: ">", fill: black))
      content((4.1, 2.2), [$f$])
    })
  ]

  + Name the force that acts perpendicular to the slope and the force that acts along it, opposing the motion. #answer[The normal force $N$ is perpendicular to the slope; friction $f$ acts along the slope, up the incline, opposing the motion.]
  + Assume the slope is smooth ($f = 0$). Find the block's acceleration down the slope. #blank(width: 5em, answer: [$4.9 "m/s"^2$])
    #answer[$a = g sin theta = 9.8 times 0.5 = 4.9 "m/s"^2$.]
  + The slope is now rough, with kinetic friction coefficient $mu_k = 0.20$. Find the new acceleration.
    #answer-space(height: 5em, answer: [$N = m g cos theta$, $f = mu_k N$, so $a = g(sin theta - mu_k cos theta) = 9.8(0.5 - 0.2 times 0.866) approx 3.2 "m/s"^2$.])
]

= Section C: Short answer

#question(points: 2)[
  Explain why a passenger lurches forward when a bus brakes suddenly, using Newton's first law.
  #answer-lines(count: 3, answer: [The passenger's body keeps moving forward at the bus's original speed (inertia) while the bus slows down, so the passenger moves forward relative to the seat.])
]

#answer-key()