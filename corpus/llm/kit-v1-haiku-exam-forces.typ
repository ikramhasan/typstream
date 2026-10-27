#show: exam.with(
  title: [Kinematics and Newton's Laws],
  subject: [Physics],
  grade: [Grade 11],
  duration: [90 minutes],
  instructions: [Answer *all* questions. Take $g = 9.8$ m/s$^2$ where needed. Show your working for every calculation.],
)

= Section A: Concepts

#question(points: 2)[
  Which of these quantities is a vector?
  #mcq([Speed], [Distance], [Displacement], [Mass], answer: 3)
]

#question(points: 2)[
  #true-false(answer: false)[An object with zero net force acting on it must be at rest.]
]

#question(points: 3)[
  Complete the sentences.
  + Newton's second law states that $F_"net" = $ #blank(width: 5em, answer: [$m a$]).
  + The SI unit of force is the #blank(width: 5em, answer: [newton]), written N.
  + Mass is a measure of an object's #blank(width: 6em, answer: [inertia]).
]

= Section B: Kinematics

#question(points: 4)[
  A car accelerates uniformly from $5$ m/s to $25$ m/s in $8$ s.
  + Calculate its acceleration.
    #answer-space(height: 4em, answer: [$a = (v - u)/t = (25 - 5)/8 = 2.5$ m/s$^2$])
  + Calculate the distance it travels in this time.
    #answer-space(height: 4em, answer: [$s = (u + v)/2 dot t = (5 + 25)/2 dot 8 = 120$ m])
]

#question(points: 4)[
  A ball is thrown horizontally at $10$ m/s from the top of a cliff $20$ m high. Ignore air resistance.
  + Calculate the time taken to reach the ground.
    #answer-space(height: 4em, answer: [$t = sqrt(2h/g) = sqrt(40/9.8) approx 2.0$ s])
  + Calculate the horizontal distance from the base of the cliff where the ball lands.
    #answer-space(height: 4em, answer: [$x = v_x t = 10 dot 2.02 approx 20$ m])
]

= Section C: Newton's laws and forces

#question(points: 3)[
  The diagram shows a block resting on a smooth-looking incline at angle $theta$ to the horizontal.
  Label the forces acting on the block, then name each force and state its direction.

  #cetz.canvas({
    import cetz.draw: *
    // incline
    line((0, 0), (6, 0), (0, 3), (0, 0))
    content((5.3, 0.35), [$theta$])
    // block
    group({
      translate((3, 1.5))
      rotate(z: -26.57deg)
      rect((-0.4, 0), (0.4, 0.8), fill: luma(220))
    })
    let o = (3.18, 1.86)
    // weight
    line(o, (3.18, -0.14), mark: (end: ">"))
    content((3.7, 0.7), [$m g$])
    // normal
    line(o, (3.98, 3.46), mark: (end: ">"))
    content((4.5, 3.2), [$N$])
    // friction (if block is held by friction)
    line(o, (1.93, 2.49), mark: (end: ">"))
    content((1.4, 2.9), [$f$])
  })

  #answer-lines(count: 2, answer: [Weight $m g$ acts vertically downward. Normal force $N$ acts perpendicular to the surface, away from it. Friction $f$ acts up the slope, parallel to the surface.])
]

#question(points: 6)[
  A block of mass $4.0$ kg slides down a rough incline at $30 degree$ to the horizontal. The coefficient of kinetic friction between the block and the incline is $0.20$.
  + Calculate the normal force on the block.
    #answer-space(height: 4em, answer: [$N = m g cos 30 degree = 4.0 dot 9.8 dot 0.866 approx 34$ N])
  + Calculate the kinetic friction force.
    #answer-space(height: 4em, answer: [$f = mu_k N = 0.20 dot 33.9 approx 6.8$ N])
  + Calculate the acceleration of the block down the incline.
    #answer-space(height: 5em, answer: [$a = (m g sin 30 degree - f)/m = (19.6 - 6.8)/4.0 approx 3.2$ m/s$^2$])
]

#question(points: 3)[
  Explain, using Newton's first law, why passengers lurch forward when a bus brakes suddenly.
  #answer-lines(count: 3, answer: [The passengers are moving at the bus's velocity. When the bus slows, their bodies have no net force to slow them, so by inertia they continue moving forward relative to the bus.])
]