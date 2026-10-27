#show: quiz.with(
  title: [SI Units and Conversions],
  subject: [Physics],
  grade: [Grade 10],
  instructions: [Answer all questions. Show your working for conversions.],
)

#question(points: 1)[
  Which of these is an SI base unit?
  #mcq([Newton], [Joule], [Second], [Watt], answer: 3)
]

#question(points: 1)[
  #true-false(answer: false)[The newton is an SI base unit.]
]

#question(points: 2)[
  Convert $3.5$ km to metres.
  #answer-space(height: 3em, answer: [$3.5 "km" times 1000 "m/km" = 3500$ m])
]

#question(points: 2)[
  Convert $45$ km/h to m/s.
  #answer-space(height: 4em, answer: [$45 "km/h" times (1000 "m")/(3600 "s") = 12.5$ m/s])
]

#question(points: 3)[
  Convert each quantity to the unit shown.
  + $250$ g to kg: #blank(width: 4em, answer: [$0.25$ kg])
  + $4.2$ MHz to Hz: #blank(width: 5em, answer: [$4.2 times 10^6$ Hz])
  + $1$ hour to seconds: #blank(width: 4em, answer: [$3600$ s])
]

#question(points: 1)[
  The density of a metal is $2700$ kg/m$^3$. What is this in g/cm$^3$?
  #mcq([$0.27$ g/cm$^3$], [$2.7$ g/cm$^3$], [$27$ g/cm$^3$], [$2700$ g/cm$^3$], answer: 2)
]

#question(points: 3)[
  Explain why scientists use a single system of units such as SI when sharing results.
  #answer-lines(count: 3, answer: [Everyone measures in the same units, so results can be compared, repeated and combined without error from conversion.])
]