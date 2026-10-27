#import "@preview/unify:0.8.1": num, qty, unit
#show: quiz.with(
  title: [SI Units and Conversions],
  subject: [Physics],
  grade: [Grade 10],
  instructions: [Answer all questions. Show your working for every calculation and include units in your answers.],
)

#question(points: 1)[
  Which of these is the SI base unit of mass?
  #mcq([Gram], [Kilogram], [Pound], [Tonne], answer: 2)
]

#question(points: 1)[
  Which quantity is measured in pascals (Pa)?
  #mcq([Force], [Pressure], [Energy], [Power], answer: 2)
]

#question(points: 2)[
  Fill in the blanks.
  + One kilometre is equal to #blank(width: 4em, answer: [1000]) metres.
  + One milligram is equal to #blank(width: 4em, answer: [0.001]) grams.
]

#question(points: 2)[
  Convert $4.5 "km"$ to metres.
  #answer-space(height: 3em, answer: [$4.5 "km" = 4500 "m"$])
]

#question(points: 2)[
  Convert $250 "cm"^2$ to square metres.
  #answer-space(height: 3em, answer: [$250 "cm"^2 = 250 times 10^(-4) "m"^2 = 0.025 "m"^2$])
]

#question(points: 3)[
  A car travels at $72 "km/h"$. Express its speed in metres per second.
  #answer-space(height: 4em, answer: [$72 "km/h" = 72000 "m" / 3600 "s" = 20 "m/s"$])
]

#question(points: 2)[
  Write the SI base-unit form of acceleration, #qty("9.81", "m/s^2") in base units, and state what the unit $"m s"^(-2)$ means.
  #answer-lines(count: 2, answer: [Acceleration is measured in $"m s"^(-2)$, metres per second squared: the change in speed in metres per second, each second.])
]

#question(points: 3)[
  A block has a mass of #qty("2.4", "kg") and a volume of #qty("0.0008", "m^3").
  + Write the formula for density.
  + Calculate its density in #unit("kg/m^3").
    #answer-space(height: 3em, answer: [$rho = m / V = 2.4 "kg" / (0.0008 "m"^3) = 3000 "kg/m"^3$])
]