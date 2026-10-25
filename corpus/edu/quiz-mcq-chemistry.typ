#set page(margin: (x: 2cm, y: 1.8cm))
#set text(size: 11pt)
#set enum(numbering: "1.")

#let ce(body) = math.upright(body)
#let options(..opts) = {
  set enum(numbering: "(a)")
  pad(left: 1em, columns(2, gutter: 1em, enum(..opts)))
}

= Chemistry Basics — Check Your Understanding

*Instructions:* Circle the letter of the best answer. Each question is worth 1 point.

+ What is the chemical formula for table salt?
  #options[$ce("NaCl")$][$ce("KCl")$][$ce("NaOH")$][$ce("CaCl"_2)$]

+ How many atoms are in one molecule of glucose, $ce("C"_6"H"_12"O"_6)$?
  #options[6][12][18][24]

+ Which particle has a negative charge?
  #options[proton][neutron][electron][nucleus]

+ Balance the equation: $#h(0.3em) square ce("H"_2) + ce("O"_2) -> square ce("H"_2"O")$. The coefficients are:
  #options[1, 1][2, 1][2, 2][1, 2]

+ The pH of pure water at 25 °C is:
  #options[0][7][10][14]

+ Which is an *exothermic* process?
  #options[melting ice][boiling water][burning wood][dissolving ammonium nitrate]

+ The mass number of $attach(ce("C"), tl: 14, bl: 6)$ is:
  #options[6][8][14][20]

+ What is the molar mass of $ce("CO"_2)$? ($ce("C") = 12$, $ce("O") = 16$ g/mol)
  #options[28 g/mol][32 g/mol][44 g/mol][56 g/mol]

#line(length: 100%, stroke: (dash: "dashed"))

*Bonus:* Write the balanced equation for the combustion of methane.

$ ce("CH"_4) + 2 ce("O"_2) -> ce("CO"_2) + 2 ce("H"_2"O") quad Delta H < 0 $

#v(1em)
#text(size: 9pt)[_Answers: 1a, 2d, 3c, 4c, 5b, 6c, 7c, 8c._]
