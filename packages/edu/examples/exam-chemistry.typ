// request: A short chemistry exam on balancing equations for grade 9, 30 minutes.
#show: exam.with(
  title: [Chemical Reactions],
  subject: [Chemistry],
  grade: [Grade 9],
  duration: [30 minutes],
  instructions: [Answer *all* questions. Write balanced equations with state symbols where asked.],
)

= Section A: Multiple choice

#question(points: 1)[
  Which equation is balanced?
  #mcq(ce("H2 + O2 -> H2O"), ce("2H2 + O2 -> 2H2O"), ce("H2 + 2O2 -> 2H2O"), answer: 2)
]

#question(points: 1)[
  What is the charge on a sulfate ion, #ce("SO4^2-")?
  #mcq([$+2$], [$-1$], [$-2$], [$0$], answer: 3)
]

= Section B: Balancing

#question(points: 4)[
  Balance these equations.
  + #ce("Na + Cl2 -> NaCl")
    #answer-lines(count: 1, answer: ce("2Na + Cl2 -> 2NaCl"))
  + #ce("CH4 + O2 -> CO2 + H2O")
    #answer-lines(count: 1, answer: ce("CH4 + 2O2 -> CO2 + 2H2O"))
]

#question(points: 4)[
  Describe what you would see when #ce("CaCO3(s)") is added to #ce("HCl(aq)"), and write the
  balanced equation.
  #answer-lines(count: 4, answer: [Bubbles of gas; the solid dissolves. #ce("CaCO3(s) + 2HCl(aq) -> CaCl2(aq) + H2O(l) + CO2(g)")])
]

#rubric(
  ([Balanced equation], [Correct, with states], [Correct], [One error], [Not balanced]),
  ([Observations], [Two, explained], [Two], [One], [None]),
  points: (2, 1.5, 1, 0),
)
