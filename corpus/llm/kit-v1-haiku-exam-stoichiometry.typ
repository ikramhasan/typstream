#show: exam.with(
  title: [Stoichiometry and the Mole],
  subject: [Chemistry],
  grade: [Grade 11],
  duration: [45 minutes],
  instructions: [Answer *all* questions. Show your working for every calculation. Relative atomic masses: H = 1.0, C = 12.0, N = 14.0, O = 16.0, Mg = 24.3.],
)

= Section A: Multiple choice

#question(points: 1)[
  What is the molar mass of #ce("CO2")?
  #mcq([28 g mol$""^(-1)$], [44 g mol$""^(-1)$], [32 g mol$""^(-1)$], [40 g mol$""^(-1)$], answer: 2)
]

#question(points: 1)[
  How many moles are in 36 g of water, #ce("H2O")? (M = 18 g mol$""^(-1)$)
  #mcq([0.5 mol], [2 mol], [18 mol], [648 mol], answer: 2)
]

#question(points: 1)[
  Which equation is balanced?
  #mcq(
    ce("N2 + H2 -> NH3"),
    ce("N2 + 3H2 -> 2NH3"),
    ce("2N2 + H2 -> NH3"),
    ce("N2 + 2H2 -> NH4"),
    answer: 2,
  )
]

#question(points: 1)[
  The number of particles in one mole of any substance is called:
  #mcq([Avogadro's constant], [the molar volume], [the empirical formula], [Faraday's constant], answer: 1)
]

= Section B: Calculations

#question(points: 4)[
  Balance each equation.
  + #ce("Fe + O2 -> Fe2O3")
    #answer-lines(count: 1, answer: ce("4Fe + 3O2 -> 2Fe2O3"))
  + #ce("C3H8 + O2 -> CO2 + H2O")
    #answer-lines(count: 1, answer: ce("C3H8 + 5O2 -> 3CO2 + 4H2O"))
]

#question(points: 4)[
  Magnesium burns in oxygen according to #ce("2Mg + O2 -> 2MgO"). Calculate the mass of magnesium oxide
  formed when 6.0 g of magnesium burns completely.
  #answer-space(height: 6em, answer: [
    $n("Mg") = 6.0 / 24.3 = 0.247$ mol. From the equation, $n("MgO") = n("Mg") = 0.247$ mol.
    $M("MgO") = 24.3 + 16.0 = 40.3$ g mol$""^(-1)$, so mass $= 0.247 times 40.3 approx 9.95$ g.
  ])
]

#question(points: 5)[
  Hydrogen and oxygen react according to #ce("2H2 + O2 -> 2H2O"). A reaction vessel contains 4.0 g of
  hydrogen and 16.0 g of oxygen.
  + Identify the limiting reagent. Show your working.
    #answer-space(height: 5em, answer: [
      $n("H2") = 4.0 / 2.0 = 2.0$ mol; $n("O2") = 16.0 / 32.0 = 0.50$ mol.
      Ratio needed is 2 mol H$_2$ : 1 mol O$_2$, so 0.50 mol O$_2$ needs 1.0 mol H$_2$. Hydrogen is in excess,
      so *oxygen is the limiting reagent*.
    ])
  + Calculate the mass of water produced.
    #answer-lines(count: 2, answer: [0.50 mol O$_2$ gives 1.0 mol H$_2$O, and $1.0 times 18.0 = 18$ g.])
]

#question(points: 3)[
  Calculate the mass of sodium hydroxide, NaOH (M = 40.0 g mol$""^(-1)$), needed to prepare 250 cm$""^3$ of
  a 0.50 mol dm$""^(-3)$ solution.
  #answer-space(height: 4em, answer: [
    $n = c times V = 0.50 times 0.250 = 0.125$ mol; mass $= 0.125 times 40.0 = 5.0$ g.
  ])
]

#question(points: 3)[
  The theoretical yield of a reaction is 10.0 g of product. The actual yield is 8.2 g. Calculate the
  percentage yield.
  #answer-space(height: 3em, answer: [$8.2 / 10.0 times 100 = 82%$])
]

#question(points: 2)[
  Decide whether each statement is true or false.
  #true-false(answer: true)[The molar mass of a compound is measured in g mol$""^(-1)$.]
  #true-false(answer: false)[The empirical formula always gives the actual number of atoms in a molecule.]
]

#answer-key()