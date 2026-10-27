#import "@preview/cetz:0.5.3"

#show: exam.with(
  title: [Kinematics and Newton's Laws],
  subject: [Physics],
  grade: [Grade 11],
  duration: [90 minutes],
  instructions: [
    Answer *all* questions. Show your working and include units in every numerical answer.
    Use $g = 9.8 "m/s"^2$. Calculators are allowed.
  ],
)

#let incline-diagram(forces: false) = cetz.canvas(length: 0.8cm, {
  import cetz.draw: *
  // wedge and block (incline angle 30 degrees)
  line((0, 0), (6, 0), (6, 3.46), close: true, fill: luma(235))
  line((2.598, 1.5), (3.637, 2.1), (3.037, 3.139), (1.998, 2.539), close: true, fill: white)
  arc((1.5, 0), start: 0deg, stop: 30deg, radius: 1.5)
  content((1.95, 0.35), [$theta$])
  content((4.6, 0.5), [$m = 5.0 "kg"$])
  if forces {
    // weight
    line((2.818, 2.32), (2.818, 0.4), mark: (end: ">", fill: red), stroke: red + 1pt)
    content((3.25, 0.8), text(fill: red)[$m g$])
    // normal force
    line((2.818, 2.32), (1.918, 3.879), mark: (end: ">", fill: blue), stroke: blue + 1pt)
    content((1.5, 4.1), text(fill: blue)[$F_N$])
    // friction, up the slope
    line((2.818, 2.32), (4.1, 3.06), mark: (end: ">", fill: green.darken(30%)), stroke: green.darken(30%) + 1pt)
    content((4.45, 3.35), text(fill: green.darken(30%))[$f$])
  }
})

= Section A: Multiple choice

#question(points: 1)[
  A car accelerates uniformly from rest at $3 "m/s"^2$ for 4 s. What is its final speed?
  #mcq([$7 "m/s"$], [$12 "m/s"$], [$24 "m/s"$], [$48 "m/s"$], answer: 2)
]

#question(points: 1)[
  On a velocity–time graph, the slope of the line represents
  #mcq([displacement], [distance], [acceleration], [speed], answer: 3)
]

#question(points: 1)[
  A hockey puck slides across frictionless ice at constant velocity. The net force on the puck is
  #mcq([in the direction of motion], [zero], [equal to its weight], [opposite to its motion], answer: 2)
]

#question(points: 1)[
  A net force of 20 N acts on a 5 kg object. Its acceleration is
  #mcq([$0.25 "m/s"^2$], [$4 "m/s"^2$], [$15 "m/s"^2$], [$100 "m/s"^2$], answer: 2)
]

#question(points: 1)[
  A ball is thrown vertically upward. At the highest point of its path (ignoring air resistance),
  #mcq(
    [its velocity is zero and its acceleration is zero],
    [its velocity is zero and its acceleration is $9.8 "m/s"^2$ downward],
    [its velocity is upward and its acceleration is zero],
    [its velocity and acceleration are both upward],
    answer: 2,
    columns: 1,
  )
]

#question(points: 1)[
  The Earth pulls on a book on a table with a force of 10 N downward. According to Newton's third law, the book pulls on the Earth with a force of
  #mcq([0 N], [10 N upward], [10 N downward], [5 N upward], answer: 2)
]

= Section B: Short answer

#question(points: 4)[
  A cyclist speeds up from $4 "m/s"$ to $10 "m/s"$ in 3 s with constant acceleration.
  + Calculate the acceleration.
    #answer-space(height: 4em, answer: [$a = (v - u)/t = (10 - 4)/3 = 2 "m/s"^2$])
  + Calculate the distance travelled in these 3 s.
    #answer-space(height: 4em, answer: [$s = (u + v)/2 dot t = (4 + 10)/2 times 3 = 21 "m"$])
]

#question(points: 3)[
  A stone is dropped from rest from a cliff and hits the water after 3.0 s. Ignore air resistance.
  + How high is the cliff?
    #answer-space(height: 4em, answer: [$s = 1/2 g t^2 = 1/2 (9.8)(3.0)^2 = 44.1 "m"$])
  + What is the stone's speed as it hits the water?
    #answer-space(height: 3em, answer: [$v = g t = 9.8 times 3.0 = 29.4 "m/s"$])
]

#question(points: 3)[
  State Newton's second law of motion and write it as an equation.
  #answer-lines(count: 3, answer: [The acceleration of an object is directly proportional to the net force on it and inversely proportional to its mass, in the direction of the net force: $F_"net" = m a$.])
]

#question(points: 2)[
  Decide whether each statement is true or false.
  #true-false(answer: false)[An object moving at constant speed must have zero net force acting on it.]
  #true-false(answer: true)[Mass is a measure of an object's inertia.]
]

= Section C: Structured problems

#question(points: 6)[
  A car travelling at $20 "m/s"$ brakes with a constant deceleration of $5 "m/s"^2$ until it stops.
  + How long does the car take to stop?
    #answer-space(height: 4em, answer: [$t = (v - u)/a = (0 - 20)/(-5) = 4 "s"$])
  + What is the braking distance?
    #answer-space(height: 4em, answer: [$s = (v^2 - u^2)/(2 a) = (0 - 400)/(-10) = 40 "m"$])
  + The driver's reaction time is 0.8 s, during which the car keeps moving at $20 "m/s"$. Find the total stopping distance from the moment the driver sees the hazard.
    #answer-space(height: 4em, answer: [Reaction distance $= 20 times 0.8 = 16 "m"$. Total $= 16 + 40 = 56 "m"$.])
]

#question(points: 9)[
  A block of mass 5.0 kg slides down a rough incline that makes an angle $theta = 30°$ with the horizontal. The coefficient of kinetic friction between the block and the surface is $mu = 0.20$.

  #align(center)[#incline-diagram()]

  + On the diagram, draw and label all the forces acting on the block as arrows from its centre.
    #answer[
      #align(center)[#incline-diagram(forces: true)]
      Weight $m g$ (vertically down), normal force $F_N$ (perpendicular to the surface, away from it), and kinetic friction $f$ (parallel to the surface, up the slope). One mark for each correct force with direction and label.
    ]
  + Calculate the components of the weight parallel and perpendicular to the incline.
    #answer-space(height: 5em, answer: [Parallel: $m g sin theta = 5.0 times 9.8 times 0.5 = 24.5 "N"$. Perpendicular: $m g cos theta = 5.0 times 9.8 times 0.866 = 42.4 "N"$.])
  + Find the normal force and the friction force on the block.
    #answer-space(height: 5em, answer: [$F_N = m g cos theta = 42.4 "N"$. $f = mu F_N = 0.20 times 42.4 = 8.5 "N"$.])
  + Calculate the acceleration of the block down the slope.
    #answer-space(height: 6em, answer: [$F_"net" = m g sin theta - f = 24.5 - 8.5 = 16.0 "N"$, so $a = F_"net" / m = 16.0 / 5.0 = 3.2 "m/s"^2$ down the slope.])
]

#question(points: 4)[
  A 60 kg person stands on a scale in an elevator. What does the scale read (in newtons) when the elevator
  + accelerates upward at $2.0 "m/s"^2$?
    #answer-space(height: 4em, answer: [$F_N - m g = m a$, so $F_N = m (g + a) = 60 times 11.8 = 708 "N"$.])
  + accelerates downward at $2.0 "m/s"^2$?
    #answer-space(height: 4em, answer: [$m g - F_N = m a$, so $F_N = m (g - a) = 60 times 7.8 = 468 "N"$.])
]

#rubric(
  ([Method (Section C)], [Correct law and substitution], [Minor slip in setup], [Partly correct method], [No valid method]),
  ([Units and sig. figs], [All correct], [One omission], [Several omissions], [None given]),
  points: (2, 1.5, 1, 0),
)