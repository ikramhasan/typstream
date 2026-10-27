#show: exam.with(
  title: [Stoichiometry and the Mole],
  subject: [Chemistry],
  grade: [Grade 11],
  duration: [45 minutes],
  instructions: [Answer *all* questions. Show your working in calculations. Use $M(H) = 1.01$, $M(C) = 12.01$, $M(O) = 16.00$, $M(Cl) = 35.45$, $M(Al) = 26.98$, $M(H_2O) = 18.02$ g/mol where needed.],
)

= Section A: Multiple choice

#question(points: 1)[
  Which equation is balanced?
  #mcq(ce("H2 + O2 -> H2O"), ce("2H2 + O2 -> 2H2O"), ce("H2 + 2O2 -> 2H2O"), ce("2H2 + 2O2 -> H2O"), answer: 2)
]

#question(points: 1)[
  How many moles are in $18.02$ g of water?
  #mcq([$0.5$ mol], [$1.00$ mol], [$18.02$ mol], [$324.7$ mol], answer: 2)
]

#question(points: 1)[
  Avogadro's number is approximately
  #mcq([$6.02 times 10^{23}$ mol$^{-1}$], [$6.02 times 10^{23}$ g], [$3.00 times 10^8$ m/s], [$1.60 times 10^{-19}$ C], answer: 1)
]

= Section B: Short answer

#question(points: 2)[
  Balance the combustion of propane:
  #ce("C3H8(g) + O2(g) -> CO2(g) + H2O(l)")
  #answer-lines(count: 1, answer: ce("C3H8(g) + 5O2(g) -> 3CO2(g) + 4H2O(l)"))
]

#question(points: 2)[
  Define the *limiting reagent* and explain why the theoretical yield depends on it.
  #answer-lines(count: 3, answer: [The limiting reagent is the reactant that is used up first. It fixes how much product can form, so the theoretical yield is calculated from its moles.])
]

#question(points: 2)[
  Sodium hydroxide reacts with hydrochloric acid:
  #ce("NaOH(aq) + HCl(aq) -> NaCl(aq) + H2O(l)")
  #answer-lines(count: 1, answer: [1 mol NaOH reacts with 1 mol HCl, so the ratio is $1:1$.])
  State the mole ratio of NaOH to HCl.
]

= Section C: Calculations

#question(points: 4)[
  Hydrogen burns in oxygen:
  #ce("2H2(g) + O2(g) -> 2H2O(l)")
  Calculate the mass of water formed when $4.00$ g of hydrogen burns completely in excess oxygen.
  #answer-space(height: 6em, answer: [
    $n(H_2) = 4.00 / 2.02 = 1.98$ mol. Mole ratio $H_2 : H_2O = 2 : 2 = 1 : 1$, so $n(H_2O) = 1.98$ mol.
    $m(H_2O) = 1.98 times 18.02 = 35.7$ g.
  ])
]

#question(points: 4)[
  Aluminium reacts with chlorine:
  #ce("2Al(s) + 3Cl2(g) -> 2AlCl3(s)")
  A reaction vessel contains $2.00$ mol of Al and $4.00$ mol of Cl$_2$.
  + Identify the limiting reagent. Show your reasoning.
  + Calculate the moles of AlCl$_3$ formed.
  + Calculate the moles of Cl$_2$ left over.
  #answer-space(height: 7em, answer: [
    1. Al needs $2.00 times 3/2 = 3.00$ mol Cl$_2$; only $4.00$ mol is present, so Cl$_2$ is in excess and Al is limiting.
    2. $n(AlCl_3) = 2.00$ mol, from the $2 : 2$ ratio.
    3. Cl$_2$ used $= 3.00$ mol, so $4.00 - 3.00 = 1.00$ mol remains.
  ])
]

#question(points: 3)[
  A compound contains $40.0%$ carbon, $6.7%$ hydrogen and $53.3%$ oxygen by mass. Determine its empirical formula.
  #answer-space(height: 6em, answer: [
    Assume $100$ g. C: $40.0 / 12.01 = 3.33$ mol; H: $6.7 / 1.01 = 6.63$ mol; O: $53.3 / 16.00 = 3.33$ mol.
    Divide by $3.33$: C : H : O $= 1 : 2 : 1$. Empirical formula is CH$_2$O.
  ])
]

#question(points: 3)[
  Propane burns as in question 1. The theoretical yield of water from $10.0$ g of propane is $16.4$ g. In an experiment, $13.1$ g of water is collected.
  Calculate the percentage yield.
  #answer-space(height: 4em, answer: [
    % yield $= 13.1 / 16.4 times 100 = 79.9%$
  ])
]

#question(points: 3)[
  Calculate the molarity of a solution made by dissolving $0.250$ mol of NaOH in water to make $0.500$ L of solution.
  #answer-space(height: 4em, answer: [
    $c = n / V = 0.250 / 0.500 = 0.500$ mol/L (0.500 M).
  ])
]

#answer-key()