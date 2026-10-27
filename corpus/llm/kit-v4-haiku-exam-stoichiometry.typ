#show: exam.with(
  title: [Stoichiometry and the Mole],
  subject: [Chemistry],
  grade: [Grade 11],
  duration: [45 minutes],
  instructions: [Answer *all* questions. Show your working for every calculation. Use $M("H") = 1.01$, $M("C") = 12.01$, $M("O") = 16.00$, $M("Na") = 22.99$, $M("Cl") = 35.45$ and $N_A = 6.02 times 10^23$ #h(0.2em) mol$"^(-1)$ where needed.],
)

= Section A: Multiple choice

#question(points: 1)[
  What is the number of particles in one mole of any substance?
  #mcq([$6.02 times 10^22$], [$6.02 times 10^23$], [$1.00 times 10^23$], [$3.01 times 10^23$], answer: 2)
]

#question(points: 1)[
  What is the molar mass of carbon dioxide, #ce("CO2")?
  #mcq([$12.01$ g mol$"^(-1)"$], [$28.02$ g mol$"^(-1)"$], [$44.01$ g mol$"^(-1)"$], [$56.02$ g mol$"^(-1)"$], answer: 3)
]

#question(points: 1)[
  Which equation is correctly balanced?
  #mcq(
    ce("N2 + 3H2 -> 2NH3"),
    ce("N2 + H2 -> NH3"),
    ce("2N2 + H2 -> 2NH3"),
    ce("N2 + 2H2 -> NH3"),
    answer: 1,
  )
]

= Section B: The mole and mass

#question(points: 2)[
  Calculate the mass of $0.50$ mol of sodium chloride, #ce("NaCl"). Molar mass of #ce("NaCl") is $58.44$ g mol$"^(-1)"$.
  #blank(width: 6em, answer: [$29.2$ g])
  #answer[$n = m / M$, so $m = n M = 0.50 times 58.44 = 29.2$ g.]
]

#question(points: 3)[
  Calculate the number of molecules in $5.00$ g of water, #ce("H2O"). The molar mass of water is $18.02$ g mol$"^(-1)"$.
  #answer-space(height: 5em, answer: [$n = 5.00 / 18.02 = 0.277$ mol. Molecules $= 0.277 times 6.02 times 10^23 = 1.67 times 10^23$.])
]

= Section C: Balancing and reacting quantities

#question(points: 2)[
  Balance the equation for the combustion of propane.
  #ce("C3H8 + O2 -> CO2 + H2O")
  #answer-lines(count: 1, answer: ce("C3H8 + 5O2 -> 3CO2 + 4H2O"))
]

#question(points: 4)[
  Hydrogen and oxygen react to form water:
  #ce("2H2 + O2 -> 2H2O")

  + Calculate the amount, in moles, of hydrogen in $4.00$ g of #ce("H2"). Molar mass $= 2.02$ g mol$"^(-1)"$.
    #answer-lines(count: 1, answer: [$4.00 / 2.02 = 1.98$ mol])
  + Using the equation, calculate the mass of water that forms from this hydrogen, assuming all of it reacts.
    #answer-space(height: 5em, answer: [Water $= 1.98$ mol, since 2 mol H2 gives 2 mol H2O. Mass $= 1.98 times 18.02 = 35.7$ g.])
]

= Section D: Limiting reagent and yield

#question(points: 4)[
  $4.00$ g of hydrogen is mixed with $32.0$ g of oxygen and the mixture is ignited, as in #ce("2H2 + O2 -> 2H2O").

  + Identify the limiting reagent and justify your answer.
    #answer-lines(count: 2, answer: [Moles of H2 = 1.98 mol, moles of O2 = 1.00 mol. Oxygen needed for 1.98 mol H2 is 0.99 mol, which is less than 1.00 mol available, so hydrogen is limiting, with oxygen in excess.])
  + State the theoretical yield of water in grams.
    #blank(width: 6em, answer: [$35.7$ g])
]

#question(points: 3)[
  In a practical, the actual yield of water was $30.0$ g. Using the theoretical yield from the previous question, calculate the percentage yield.
  #answer-space(height: 5em, answer: [Percentage yield $= 30.0 / 35.7 times 100 = 84.0%$.])
]

= Section E: Solutions

#question(points: 3)[
  $25.0$ mL of $0.100$ mol L$"^(-1)"$ hydrochloric acid is exactly neutralised by sodium hydroxide, according to #ce("HCl + NaOH -> NaCl + H2O").
  Calculate the number of moles of sodium hydroxide that react.
  #answer-space(height: 5em, answer: [Moles of HCl $= 0.100 times 0.0250 = 2.50 times 10^(-3)$ mol. The mole ratio is 1:1, so NaOH $= 2.50 times 10^(-3)$ mol.])
]

#question(points: 2)[
  Explain why the mole is useful in chemistry, in one or two sentences.
  #answer-lines(count: 2, answer: [The mole links the number of particles to a measurable mass, so reacting amounts can be compared using the balanced equation.])
]