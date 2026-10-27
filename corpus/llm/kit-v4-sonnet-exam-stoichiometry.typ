#show: exam.with(
  title: [Stoichiometry and the Mole],
  subject: [Chemistry],
  grade: [Grade 11],
  duration: [45 minutes],
  instructions: [Answer *all* questions. Show your working for calculations and give answers with units. Use a calculator where needed.],
)

#callout(kind: "note", title: [Data])[
  Molar masses ($"g/mol"$): H = 1, C = 12, O = 16, Na = 23, Mg = 24, Cl = 35.5, Ca = 40. \
  Avogadro constant: $6.02 times 10^23 "mol"^(-1)$. Molar volume of a gas at STP: $22.4 "L/mol"$.
]

= Section A: Multiple choice

#question(points: 1)[
  How many particles are in one mole of a substance?
  #mcq([$6.02 times 10^23$], [$6.02 times 10^(-23)$], [$22.4 times 10^23$], [$1.66 times 10^24$], answer: 1)
]

#question(points: 1)[
  What is the molar mass of #ce("CaCO3")?
  #mcq([$68 "g/mol"$], [$84 "g/mol"$], [$100 "g/mol"$], [$116 "g/mol"$], answer: 3)
]

#question(points: 1)[
  Which equation is correctly balanced?
  #mcq(ce("Al + O2 -> Al2O3"), ce("2Al + 3O2 -> 2Al2O3"), ce("4Al + 3O2 -> 2Al2O3"), ce("4Al + 2O2 -> 2Al2O3"), answer: 3)
]

#question(points: 1)[
  How many moles are in $36 "g"$ of water, #ce("H2O")?
  #mcq([$0.5 "mol"$], [$1.0 "mol"$], [$2.0 "mol"$], [$18 "mol"$], answer: 3)
]

#question(points: 1)[
  What volume do $2.0 "mol"$ of any gas occupy at STP?
  #mcq([$11.2 "L"$], [$22.4 "L"$], [$44.8 "L"$], [$67.2 "L"$], answer: 3)
]

= Section B: Balancing equations

#question(points: 4)[
  Balance each equation by writing the full balanced equation on the line.
  + #ce("Fe + O2 -> Fe2O3")
    #answer-lines(count: 1, answer: ce("4Fe + 3O2 -> 2Fe2O3"))
  + #ce("C3H8 + O2 -> CO2 + H2O")
    #answer-lines(count: 1, answer: ce("C3H8 + 5O2 -> 3CO2 + 4H2O"))
  + #ce("Al + HCl -> AlCl3 + H2")
    #answer-lines(count: 1, answer: ce("2Al + 6HCl -> 2AlCl3 + 3H2"))
  + #ce("Na + H2O -> NaOH + H2")
    #answer-lines(count: 1, answer: ce("2Na + 2H2O -> 2NaOH + H2"))
]

= Section C: Calculations

#question(points: 3)[
  Using the data above, calculate:
  + the mass of $0.25 "mol"$ of #ce("NaCl");
    #answer-space(height: 3.5em, answer: [$M = 58.5 "g/mol"$; $m = 0.25 times 58.5 = 14.6 "g"$])
  + the number of molecules in $0.50 "mol"$ of #ce("CO2");
    #answer-space(height: 3.5em, answer: [$0.50 times 6.02 times 10^23 = 3.01 times 10^23$ molecules])
  + the number of moles in $11.0 "g"$ of #ce("CO2").
    #answer-space(height: 3.5em, answer: [$M = 44 "g/mol"$; $n = 11.0 div 44 = 0.25 "mol"$])
]

#question(points: 3)[
  Hydrogen burns in oxygen: #ce("2H2 + O2 -> 2H2O"). What mass of water forms when $8.0 "g"$ of hydrogen burns completely?
  #answer-space(height: 7em, answer: [$n(#ce("H2")) = 8.0 div 2 = 4.0 "mol"$. The ratio #ce("H2") : #ce("H2O") is $1 : 1$, so $n(#ce("H2O")) = 4.0 "mol"$. $m = 4.0 times 18 = 72 "g"$.])
]

#question(points: 3)[
  Propane burns completely: #ce("C3H8 + 5O2 -> 3CO2 + 4H2O"). Calculate the mass of carbon dioxide produced from $22 "g"$ of propane.
  #answer-space(height: 7em, answer: [$M(#ce("C3H8")) = 44 "g/mol"$, so $n = 22 div 44 = 0.50 "mol"$. The ratio is $1 : 3$, so $n(#ce("CO2")) = 1.5 "mol"$. $m = 1.5 times 44 = 66 "g"$.])
]

#question(points: 4)[
  Magnesium reacts with oxygen: #ce("2Mg + O2 -> 2MgO"). A student heats $4.8 "g"$ of magnesium with $4.0 "g"$ of oxygen.
  + Determine the limiting reagent.
    #answer-space(height: 6em, answer: [$n(#ce("Mg")) = 4.8 div 24 = 0.20 "mol"$; $n(#ce("O2")) = 4.0 div 32 = 0.125 "mol"$. $0.20 "mol"$ Mg needs only $0.10 "mol"$ #ce("O2"), so oxygen is in excess and *magnesium is limiting*.])
  + Calculate the mass of #ce("MgO") formed.
    #answer-space(height: 4em, answer: [$n(#ce("MgO")) = 0.20 "mol"$; $m = 0.20 times 40 = 8.0 "g"$.])
]

#question(points: 3)[
  Calcium carbonate decomposes on heating: #ce("CaCO3(s) -> CaO(s) + CO2(g)"). Heating $25.0 "g"$ of #ce("CaCO3") gives $12.6 "g"$ of #ce("CaO"). Calculate the percentage yield.
  #answer-space(height: 7em, answer: [$n(#ce("CaCO3")) = 25.0 div 100 = 0.250 "mol"$, so the theoretical $m(#ce("CaO")) = 0.250 times 56 = 14.0 "g"$. Percentage yield $= 12.6 div 14.0 times 100 = 90%$.])
]

#rubric(
  ([Method (Section C)], [Correct mole ratio and steps shown], [Minor slip in steps], [Ratio or steps unclear], [No working]),
  ([Units and accuracy], [Correct units and significant figures], [One unit or rounding error], [Several errors], [No units]),
  points: (3, 2, 1, 0),
)