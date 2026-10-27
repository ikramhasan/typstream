#show: quiz.with(
  title: [SI Units and Unit Conversions],
  subject: [Physics],
  grade: [Grade 10],
  instructions: [Answer *all* questions. Show your working where space is given.],
)

#question(points: 1)[
  What is the SI base unit of mass?
  #mcq([gram], [kilogram], [tonne], [newton], answer: 2)
]

#question(points: 1)[
  The newton (N), the SI unit of force, is equivalent to which combination of base units?
  #mcq([$"kg" dot "m/s"$], [$"kg" dot "m"^2 "/s"^2$], [$"kg" dot "m/s"^2$], [$"g" dot "m/s"^2$], answer: 3)
]

#question(points: 3)[
  Match each quantity to its SI unit.
  #matching(
    ([Length], [metre]),
    ([Time], [second]),
    ([Electric current], [ampere]),
    ([Temperature], [kelvin]),
  )
]

#question(points: 2)[
  Complete the conversions.
  + $2.5 "km" = #blank(answer: [2500]) "m"$
  + $350 "g" = #blank(answer: [0.35]) "kg"$
]

#question(points: 2)[
  #true-false(answer: true)[$1 "L" = 1000 "cm"^3$]
  #true-false(answer: false)[$1 "m"^2 = 100 "cm"^2$]
]

#question(points: 3)[
  Convert $36 "km/h"$ to $"m/s"$. Show your working.
  #answer-space(height: 5em, answer: [$36 times 1000 "m" div 3600 "s" = 10 "m/s"$])
]

#question(points: 3)[
  Convert $450 "cm"^2$ to $"m"^2$. Show your working.
  #answer-space(height: 5em, answer: [$1 "cm" = 0.01 "m"$, so $1 "cm"^2 = 0.0001 "m"^2$. Then $450 times 0.0001 = 0.045 "m"^2$.])
]

#question(points: 2)[
  Give one reason why scientists around the world use the SI system.
  #answer-lines(count: 2, answer: [It gives a common standard, so measurements are consistent and can be compared and shared without confusion.])
]

#answer-key()