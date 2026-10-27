#set page(paper: "us-letter", margin: 2cm, numbering: "1 / 1")
#set text(size: 11pt)
#set enum(numbering: "(a)")
#set par(spacing: 1em)

#let mk(n) = [#h(1fr) *[#n marks]*]

// Draws a force arrow on a canvas. All coordinates are in cm, measured from
// the top-left corner of the canvas (y increases downward).
#let arrow(x0, y0, vx, vy, col: black) = {
  let mag = calc.sqrt(vx * vx + vy * vy)
  let ux = vx / mag
  let uy = vy / mag
  let x1 = x0 + vx
  let y1 = y0 + vy
  let hl = 0.28
  let hw = 0.11
  let bx = x1 - hl * ux
  let by = y1 - hl * uy
  place(top + left, line(
    start: (x0 * 1cm, y0 * 1cm),
    end: (x1 * 1cm, y1 * 1cm),
    stroke: 1.5pt + col,
  ))
  place(top + left, polygon(
    fill: col,
    stroke: none,
    (x1 * 1cm, y1 * 1cm),
    ((bx - hw * uy) * 1cm, (by + hw * ux) * 1cm),
    ((bx + hw * uy) * 1cm, (by - hw * ux) * 1cm),
  ))
}

#align(center)[
  #text(size: 17pt, weight: "bold")[Grade 11 Physics] \
  #text(size: 14pt, weight: "bold")[Unit Exam: Kinematics and Newton's Laws of Motion]
]

#v(0.5em)

#table(
  columns: (1fr, 1fr, 1fr),
  stroke: 0.6pt,
  inset: 8pt,
  [*Name:* #v(1.2em)], [*Date:* #v(1.2em)], [*Class:* #v(1.2em)],
  [*Time allowed:* 75 minutes], [*Total marks:* 50], [*Score:* #h(1fr) / 50],
)

#v(0.5em)

== Instructions

- Answer all questions. Show all work for Sections B and C, including formulas, substitutions, and units.
- Use $g = 9.8$ m/s² (downward) unless told otherwise.
- Give numerical answers to three significant figures unless otherwise specified.
- Ignore air resistance in all questions.
- A scientific calculator is permitted.

== Formula Sheet

#table(
  columns: (1fr, 1fr),
  stroke: 0.5pt,
  inset: 8pt,
  align: center + horizon,
  [$ v = v_0 + a t $], [$ Delta x = v_0 t + 1/2 a t^2 $],
  [$ v^2 = v_0^2 + 2 a Delta x $], [$ Delta x = (v_0 + v)/2 dot t $],
  [$ F_"net" = m a $], [$ F_g = m g $],
  [$ f_k = mu_k F_N $], [$ f_s <= mu_s F_N $],
)

#pagebreak()

= Section A: Multiple Choice #h(1fr) [8 marks]

_Circle the letter of the best answer. Each question is worth 1 mark._

*1.* Which of the following is a vector quantity?

(A) distance #h(1.5em) (B) speed #h(1.5em) (C) displacement #h(1.5em) (D) time

#v(0.6em)

*2.* On a velocity-time graph, a horizontal line at a nonzero velocity represents an object that is:

(A) at rest #h(1.5em) (B) moving with constant velocity #h(1.5em) (C) speeding up uniformly #h(1.5em) (D) slowing down uniformly

#v(0.6em)

*3.* A car starts from rest and accelerates uniformly at 3.0 m/s² for 4.0 s. How far does it travel?

(A) 6.0 m #h(1.5em) (B) 12 m #h(1.5em) (C) 24 m #h(1.5em) (D) 48 m

#v(0.6em)

*4.* A ball is thrown straight up. At the very top of its path, the ball's velocity and acceleration are:

(A) $v = 0$, $a = 0$ #h(1.5em) (B) $v = 0$, $a = 9.8$ m/s² downward #h(1.5em) (C) $v = 9.8$ m/s upward, $a = 0$ #h(1.5em) (D) $v = 9.8$ m/s downward, $a = 9.8$ m/s² downward

#v(0.6em)

*5.* A hockey puck slides across very smooth ice and slows down only very slightly. Which law best explains why it does not stop immediately?

(A) Newton's first law #h(1.5em) (B) Newton's second law #h(1.5em) (C) Newton's third law #h(1.5em) (D) the law of gravitation

#v(0.6em)

*6.* A net force of 20 N acts on a 5.0 kg object. The acceleration of the object is:

(A) 0.25 m/s² #h(1.5em) (B) 4.0 m/s² #h(1.5em) (C) 15 m/s² #h(1.5em) (D) 100 m/s²

#v(0.6em)

*7.* The Earth pulls on you with a gravitational force of 700 N downward. According to Newton's third law, the force you exert on the Earth is:

(A) 0 N #h(1.5em) (B) much less than 700 N #h(1.5em) (C) 700 N upward #h(1.5em) (D) 700 N downward

#v(0.6em)

*8.* A 2.0 kg object is taken to the Moon, where $g = 1.6$ m/s². On the Moon, the object has:

(A) mass 2.0 kg, weight 3.2 N #h(1.5em) (B) mass 0.33 kg, weight 3.2 N #h(1.5em) (C) mass 2.0 kg, weight 19.6 N #h(1.5em) (D) mass 3.2 kg, weight 2.0 N

#pagebreak()

= Section B: Kinematics #h(1fr) [15 marks]

*Question 9* #mk(5)

A car accelerates uniformly from rest to 25 m/s in 8.0 s.

+ Calculate the magnitude of the car's acceleration. #mk(2)
  #v(4em)
+ Calculate the distance the car travels during these 8.0 s. #mk(2)
  #v(4em)
+ What is the car's average velocity during this time? #mk(1)
  #v(2em)

*Question 10* #mk(4)

A stone is dropped from a bridge that is 45 m above the surface of a river.

+ How long does it take the stone to reach the water? #mk(2)
  #v(4em)
+ What is the speed of the stone just before it hits the water? #mk(2)
  #v(4em)

#pagebreak()

*Question 11* #mk(6)

A cyclist's velocity is measured during a 12 s trip along a straight road. The velocity changes at a steady rate between the times listed in the table.

#align(center)[
  #table(
    columns: 5,
    inset: 8pt,
    align: center,
    [*Time (s)*], [0], [4], [10], [12],
    [*Velocity (m/s)*], [0], [8.0], [8.0], [0],
  )
]

+ Find the acceleration of the cyclist during each of the three intervals: 0–4 s, 4–10 s, and 10–12 s. #mk(3)
  #v(7em)
+ Find the total displacement of the cyclist during the 12 s. (Hint: use areas on a velocity-time graph.) #mk(3)
  #v(7em)

#pagebreak()

= Section C: Newton's Laws #h(1fr) [27 marks]

*Question 12* #mk(7)

A 20 kg crate is pushed to the right along a rough horizontal floor by a constant horizontal force of 100 N. The coefficient of kinetic friction between the crate and the floor is $mu_k = 0.30$.

+ In the box below, the crate is represented by a dot. Draw and label a free-body diagram showing all forces acting on the crate. #mk(3)

  #align(center)[
    #box(width: 7cm, height: 5cm, stroke: 0.8pt)[
      #place(center + horizon, circle(radius: 3pt, fill: black))
    ]
  ]

+ Calculate the force of kinetic friction on the crate. #mk(2)
  #v(4em)
+ Calculate the acceleration of the crate. #mk(2)
  #v(4em)

#pagebreak()

*Question 13* #mk(12)

A 5.0 kg block slides down a rough incline that makes an angle of $theta = 30 degree$ with the horizontal. The coefficient of kinetic friction between the block and the incline is $mu_k = 0.20$. The diagram below shows the block and three of the forces acting on it, labelled A, B, and C.

#align(center)[
  #box(width: 7.5cm, height: 5.4cm)[
    // Incline
    #place(top + left, polygon(
      fill: luma(225),
      stroke: 1pt,
      (0cm, 5cm), (7cm, 5cm), (7cm, 0.96cm),
    ))
    // Block (rotated to sit flat on the incline)
    #place(top + left, dx: 2.564cm, dy: 1.88cm,
      rotate(30deg, rect(width: 1.2cm, height: 1.2cm, fill: rgb("#cfe2ff"), stroke: 1pt)))
    // Forces drawn from the centre of the block
    #arrow(3.164, 2.48, 0, 1.5, col: rgb("#c0392b"))
    #arrow(3.164, 2.48, -0.75, -1.3, col: rgb("#2471a3"))
    #arrow(3.164, 2.48, 1.04, -0.6, col: rgb("#1e8449"))
    // Labels
    #place(top + left, dx: 3.3cm, dy: 3.7cm, text(weight: "bold")[A])
    #place(top + left, dx: 1.85cm, dy: 0.7cm, text(weight: "bold")[B])
    #place(top + left, dx: 4.3cm, dy: 1.35cm, text(weight: "bold")[C])
    #place(top + left, dx: 0.9cm, dy: 4.45cm, [$theta = 30 degree$])
  ]
]

+ Name each of the forces A, B, and C. #mk(3)
  #v(1.5em)
  A: #h(1fr) #box(width: 70%, line(length: 100%)) \
  #v(0.3em)
  B: #h(1fr) #box(width: 70%, line(length: 100%)) \
  #v(0.3em)
  C: #h(1fr) #box(width: 70%, line(length: 100%))
+ Calculate the component of the block's weight acting parallel to the incline and the component acting perpendicular to the incline. #mk(2)
  #v(6em)
+ Calculate the normal force on the block and the force of kinetic friction acting on it. #mk(3)
  #v(6em)
+ Calculate the acceleration of the block down the incline. #mk(2)
  #v(6em)
+ If the incline were rougher, what is the minimum coefficient of static friction $mu_s$ that would keep this block at rest on the 30° incline? #mk(2)
  #v(6em)

#pagebreak()

*Question 14* #mk(4)

Two blocks, of mass 4.0 kg and 6.0 kg, are connected by a light rope and rest on a frictionless horizontal table. A horizontal force of 20 N pulls the 6.0 kg block, so that both blocks accelerate together.

#align(center)[
  #box(width: 11cm, height: 2.4cm)[
    #place(top + left, dx: 0cm, dy: 1.4cm, line(length: 11cm, stroke: 1.2pt))
    #place(top + left, dx: 1.2cm, dy: 0.5cm, rect(width: 2cm, height: 0.9cm, fill: rgb("#d5f5e3"), stroke: 1pt)[#align(center + horizon)[4.0 kg]])
    #place(top + left, dx: 3.2cm, dy: 0.95cm, line(length: 2.2cm, stroke: 1.2pt))
    #place(top + left, dx: 5.4cm, dy: 0.3cm, rect(width: 2.6cm, height: 1.1cm, fill: rgb("#fdebd0"), stroke: 1pt)[#align(center + horizon)[6.0 kg]])
    #arrow(8.0, 0.85, 2.2, 0, col: rgb("#c0392b"))
    #place(top + left, dx: 8.5cm, dy: 0.3cm, [20 N])
  ]
]

+ Calculate the acceleration of the two-block system. #mk(2)
  #v(5em)
+ Calculate the tension in the rope connecting the blocks. #mk(2)
  #v(5em)

*Question 15* #mk(4)

A bus is travelling at constant velocity when the driver suddenly applies the brakes. The passengers, who are not wearing seatbelts, lurch forward. Using Newton's first law, explain why this happens. Mention what a seatbelt does in this situation.

#v(1em)
#line(length: 100%)
#v(1.5em)
#line(length: 100%)
#v(1.5em)
#line(length: 100%)
#v(1.5em)
#line(length: 100%)

#v(2em)
#align(center)[*End of Exam*]