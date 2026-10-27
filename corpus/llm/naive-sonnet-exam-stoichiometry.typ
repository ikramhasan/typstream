#set page(paper: "a4", margin: 2cm, numbering: "1 / 1")
#set text(size: 11pt)
#set par(justify: false)

#let bl = box(width: 1.6em, height: 0.9em, stroke: (bottom: 0.6pt))

#align(center)[
  #text(size: 18pt, weight: "bold")[Grade 11 Chemistry Test]\
  #text(size: 14pt)[Stoichiometry and the Mole]
]

#v(0.5em)

#grid(
  columns: (1fr, 1fr),
  row-gutter: 1em,
  [*Name:* #box(width: 70%, line(length: 100%))],
  [*Date:* #box(width: 70%, line(length: 100%))],
  [*Time allowed:* 45 minutes],
  [*Total:* 50 marks],
)

#v(0.5em)

*Instructions*
- Answer all questions. Show all work for calculation questions; marks are given for method, correct units and significant figures.
- Use the data below. Round final answers to 3 significant figures unless told otherwise.
- A scientific calculator is permitted.

#rect(width: 100%, inset: 8pt, radius: 3pt)[
  *Data*\
  Molar masses (g/mol): H = 1.01, C = 12.01, N = 14.01, O = 16.00, Na = 22.99, Mg = 24.31, Al = 26.98, S = 32.07, Cl = 35.45, Ca = 40.08, Fe = 55.85\
  Avogadro's constant: $6.02 times 10^23$ particles/mol #h(1em) Molar volume of a gas at STP: 22.4 L/mol
]

== Part A: Multiple Choice #h(1fr) _(8 marks)_

Circle the letter of the best answer. Each question is worth 1 mark.

*1.* What is the molar mass of calcium hydroxide, $"Ca(OH)"_2$?
#pad(left: 1.5em)[
  (A) 57.09 g/mol #h(1em) (B) 74.10 g/mol #h(1em) (C) 91.11 g/mol #h(1em) (D) 114.18 g/mol
]

*2.* Which sample contains the greatest number of particles?
#pad(left: 1.5em)[
  (A) 1.00 mol of He atoms \
  (B) $6.02 times 10^23$ molecules of $"H"_2"O"$ \
  (C) 10.0 g of He atoms \
  (D) 0.50 mol of Ne atoms
]

*3.* In a balanced chemical equation, the coefficients represent:
#pad(left: 1.5em)[
  (A) the mole ratio of reactants and products \
  (B) the masses, in grams, of reactants and products \
  (C) the number of atoms within each formula \
  (D) the number of electrons transferred
]

*4.* The limiting reactant in a chemical reaction is the reactant that:
#pad(left: 1.5em)[
  (A) has the smallest molar mass \
  (B) is present in the greatest mass \
  (C) is always a solid \
  (D) is completely used up first and determines the amount of product formed
]

*5.* What is the sum of the coefficients when this equation is balanced as shown? #h(1em) $"C"_3"H"_8 + 5"O"_2 -> 3"CO"_2 + 4"H"_2"O"$
#pad(left: 1.5em)[
  (A) 9 #h(2em) (B) 12 #h(2em) (C) 13 #h(2em) (D) 15
]

*6.* What is the mass of 0.250 mol of NaCl?
#pad(left: 1.5em)[
  (A) 7.30 g #h(1.5em) (B) 14.6 g #h(1.5em) (C) 29.2 g #h(1.5em) (D) 234 g
]

*7.* A reaction has a theoretical yield of 10.0 g. A student collects 8.0 g of product. What is the percent yield?
#pad(left: 1.5em)[
  (A) 8.0% #h(1.5em) (B) 20% #h(1.5em) (C) 125% #h(1.5em) (D) 80%
]

*8.* What volume does 0.500 mol of $"O"_2$ gas occupy at STP?
#pad(left: 1.5em)[
  (A) 11.2 L #h(1.5em) (B) 22.4 L #h(1.5em) (C) 5.6 L #h(1.5em) (D) 44.8 L
]

== Part B: Balancing Equations #h(1fr) _(6 marks)_

Write the missing coefficients to balance each equation. Write a "1" if the coefficient is 1. Each equation is worth 1 mark.

#v(0.3em)

*9.* $#bl "N"_2 + #bl "H"_2 -> #bl "NH"_3$

#v(0.3em)

*10.* $#bl "Fe" + #bl "O"_2 -> #bl "Fe"_2"O"_3$

#v(0.3em)

*11.* $#bl "C"_2"H"_6 + #bl "O"_2 -> #bl "CO"_2 + #bl "H"_2"O"$

#v(0.3em)

*12.* $#bl "Al" + #bl "HCl" -> #bl "AlCl"_3 + #bl "H"_2$

#v(0.3em)

*13.* $#bl "Ca(OH)"_2 + #bl "H"_3"PO"_4 -> #bl "Ca"_3("PO"_4)_2 + #bl "H"_2"O"$

#v(0.3em)

*14.* $#bl "Pb(NO"_3)_2 + #bl "KI" -> #bl "PbI"_2 + #bl "KNO"_3$

== Part C: The Mole #h(1fr) _(12 marks)_

Show your work.

*15.* Calculate the molar mass of aluminum sulfate, $"Al"_2("SO"_4)_3$. #h(1fr) _(2 marks)_
#v(5em)

*16.* What is the mass of 3.50 mol of carbon dioxide, $"CO"_2$? #h(1fr) _(2 marks)_
#v(5em)

*17.* How many moles are present in 85.0 g of ammonia, $"NH"_3$? #h(1fr) _(2 marks)_
#v(5em)

*18.* How many molecules are in 9.00 g of water, $"H"_2"O"$? #h(1fr) _(3 marks)_
#v(6em)

*19.* Calculate the percent by mass of iron in iron(III) oxide, $"Fe"_2"O"_3$. #h(1fr) _(3 marks)_
#v(6em)

== Part D: Stoichiometry #h(1fr) _(24 marks)_

Show all work, including the mole ratio you use.

*20.* Ammonia is made by the reaction $"N"_2 + 3"H"_2 -> 2"NH"_3$. How many moles of $"NH"_3$ can be produced from 4.50 mol of $"H"_2$? #h(1fr) _(2 marks)_
#v(5em)

*21.* Aluminum reacts with hydrochloric acid: #h(1em) $2"Al" + 6"HCl" -> 2"AlCl"_3 + 3"H"_2$

(a) What mass of hydrogen gas is produced when 5.40 g of aluminum reacts completely? #h(1fr) _(4 marks)_
#v(7em)

(b) What volume does this hydrogen gas occupy at STP? #h(1fr) _(2 marks)_
#v(4em)

*22.* Magnesium burns in oxygen: #h(1em) $2"Mg" + "O"_2 -> 2"MgO"$ \
A mixture of 6.00 g of Mg and 5.00 g of $"O"_2$ is ignited.

(a) Determine the limiting reactant. #h(1fr) _(3 marks)_
#v(7em)

(b) Calculate the mass of MgO formed. #h(1fr) _(2 marks)_
#v(5em)

(c) Calculate the mass of the excess reactant remaining. #h(1fr) _(2 marks)_
#v(6em)

*23.* Limestone decomposes when heated: #h(1em) $"CaCO"_3 -> "CaO" + "CO"_2$ \
A student heats 25.0 g of $"CaCO"_3$ and collects 12.0 g of CaO.

(a) Calculate the theoretical yield of CaO. #h(1fr) _(3 marks)_
#v(6em)

(b) Calculate the percent yield. #h(1fr) _(2 marks)_
#v(4em)

*24.* Propane burns according to $"C"_3"H"_8 + 5"O"_2 -> 3"CO"_2 + 4"H"_2"O"$. What mass of $"CO"_2$ is produced when 11.0 g of propane burns completely in excess oxygen? #h(1fr) _(4 marks)_
#v(8em)

#align(center)[_End of test_]

#pagebreak()

= Answer Key and Marking Guide

== Part A (1 mark each)

#table(
  columns: 8,
  align: center,
  [*1*], [*2*], [*3*], [*4*], [*5*], [*6*], [*7*], [*8*],
  [B], [C], [A], [D], [C], [B], [D], [A],
)

== Part B (1 mark each; all coefficients must be correct)

#table(
  columns: (auto, 1fr),
  [*Q*], [*Balanced equation*],
  [9], [$"N"_2 + 3"H"_2 -> 2"NH"_3$],
  [10], [$4"Fe" + 3"O"_2 -> 2"Fe"_2"O"_3$],
  [11], [$2"C"_2"H"_6 + 7"O"_2 -> 4"CO"_2 + 6"H"_2"O"$],
  [12], [$2"Al" + 6"HCl" -> 2"AlCl"_3 + 3"H"_2$],
  [13], [$3"Ca(OH)"_2 + 2"H"_3"PO"_4 -> "Ca"_3("PO"_4)_2 + 6"H"_2"O"$],
  [14], [$"Pb(NO"_3)_2 + 2"KI" -> "PbI"_2 + 2"KNO"_3$],
)

== Part C

*15.* (2 marks) $M = 2(26.98) + 3(32.07) + 12(16.00) = 53.96 + 96.21 + 192.00 = 342.17$ g/mol. (1 mark for method, 1 for answer with units.)

*16.* (2 marks) $M("CO"_2) = 44.01$ g/mol; $m = 3.50 "mol" times 44.01 "g/mol" = 154 "g"$.

*17.* (2 marks) $M("NH"_3) = 17.04$ g/mol; $n = 85.0 / 17.04 = 4.99 "mol"$.

*18.* (3 marks) $M("H"_2"O") = 18.02$ g/mol (1 mark). $n = 9.00 / 18.02 = 0.499 "mol"$ (1 mark). $N = 0.499 times 6.02 times 10^23 = 3.01 times 10^23$ molecules (1 mark).

*19.* (3 marks) $M("Fe"_2"O"_3) = 2(55.85) + 3(16.00) = 159.70$ g/mol (1 mark). Mass of Fe per mole $= 111.70$ g (1 mark). Percent Fe $= 111.70 / 159.70 times 100 = 69.9%$ (1 mark).

== Part D

*20.* (2 marks) $4.50 "mol H"_2 times (2 "mol NH"_3)/(3 "mol H"_2) = 3.00 "mol NH"_3$. (1 mark for ratio, 1 for answer.)

*21.* (a) (4 marks)
$ 5.40 "g Al" times (1 "mol Al")/(26.98 "g Al") times (3 "mol H"_2)/(2 "mol Al") times (2.02 "g H"_2)/(1 "mol H"_2) = 0.607 "g H"_2 $
(1 mark for moles of Al = 0.200 mol, 1 for mole ratio, 1 for molar mass of $"H"_2$, 1 for answer.)

(b) (2 marks) $n("H"_2) = 0.300$ mol; $V = 0.300 times 22.4 = 6.72$ L. (Accept 6.73 L.)

*22.* (a) (3 marks) $n("Mg") = 6.00 / 24.31 = 0.247$ mol; $n("O"_2) = 5.00 / 32.00 = 0.156$ mol (1 mark). Mg needed to react with all the $"O"_2$: $0.156 times 2 = 0.313$ mol, but only 0.247 mol is available (1 mark). *Mg is the limiting reactant* (1 mark). Equivalent method: compare the $"O"_2$ needed (0.123 mol) with the $"O"_2$ available (0.156 mol).

(b) (2 marks) $0.247 "mol Mg" times (2 "mol MgO")/(2 "mol Mg") times 40.31 "g/mol" = 9.95$ g MgO.

(c) (2 marks) $"O"_2$ used $= 0.247 / 2 = 0.123$ mol; $"O"_2$ left $= 0.156 - 0.123 = 0.0328$ mol; mass left $= 0.0328 times 32.00 = 1.05$ g. (Check: $9.95 + 1.05 = 11.00$ g = starting mass.)

*23.* (a) (3 marks) $M("CaCO"_3) = 100.09$ g/mol, so $n = 25.0 / 100.09 = 0.250$ mol (1 mark). Mole ratio 1 : 1 gives 0.250 mol CaO (1 mark). $m = 0.250 times 56.08 = 14.0$ g (1 mark).

(b) (2 marks) $"percent yield" = 12.0 / 14.0 times 100 = 85.7%$ (1 mark for formula, 1 for answer; accept 85.6–85.7%).

*24.* (4 marks) $M("C"_3"H"_8) = 44.11$ g/mol.
$ 11.0 "g C"_3"H"_8 times (1 "mol")/(44.11 "g") times (3 "mol CO"_2)/(1 "mol C"_3"H"_8) times (44.01 "g")/(1 "mol CO"_2) = 32.9 "g CO"_2 $
(1 mark for molar mass of propane, 1 for moles of propane, 1 for mole ratio, 1 for final mass.)

#v(1em)
*Marking notes:* deduct at most 1 mark per question for incorrect significant figures or missing units. Apply "error carried forward" where an incorrect earlier answer is used correctly in a later step.