#set page(margin: 2cm)
#set text(size: 12pt)

#let q(n, prompt, a, b, c, d) = block(breakable: false, below: 1.2em)[
  *#n.* #prompt \
  #h(1.5em) A) #a #h(1.2em) B) #b #h(1.2em) C) #c #h(1.2em) D) #d
]

= European Capitals Quiz

*Grade 6 Geography* #h(1fr) Name: #box(width: 6cm, line(length: 100%)) #h(1em) Date: #box(width: 3cm, line(length: 100%))

*Directions:* Circle the letter of the best answer for each question. Each question is worth 1 point.

#v(1em)

#q(1, [What is the capital of France?], [Paris], [Lyon], [Brussels], [Madrid])

#q(2, [What is the capital of Italy?], [Milan], [Rome], [Venice], [Naples])

#q(3, [What is the capital of Spain?], [Barcelona], [Lisbon], [Madrid], [Seville])

#q(4, [What is the capital of Germany?], [Munich], [Hamburg], [Vienna], [Berlin])

#q(5, [What is the capital of the United Kingdom?], [Dublin], [London], [Edinburgh], [Manchester])

#q(6, [What is the capital of Greece?], [Athens], [Rome], [Istanbul], [Sofia])

#q(7, [What is the capital of Portugal?], [Porto], [Madrid], [Lisbon], [Barcelona])

#q(8, [What is the capital of Poland?], [Prague], [Warsaw], [Krakow], [Budapest])

#q(9, [What is the capital of Austria?], [Vienna], [Zurich], [Berlin], [Salzburg])

#q(10, [What is the capital of Sweden?], [Oslo], [Copenhagen], [Helsinki], [Stockholm])

#v(1fr)

Score: #box(width: 2cm, line(length: 100%)) / 10

#pagebreak()

= Answer Key (Teacher Copy)

#table(
  columns: 10,
  align: center,
  [*1*], [*2*], [*3*], [*4*], [*5*], [*6*], [*7*], [*8*], [*9*], [*10*],
  [A], [B], [C], [D], [B], [A], [C], [B], [A], [D],
)

#v(1em)

#table(
  columns: (auto, 1fr),
  [*Country*], [*Capital*],
  [France], [Paris],
  [Italy], [Rome],
  [Spain], [Madrid],
  [Germany], [Berlin],
  [United Kingdom], [London],
  [Greece], [Athens],
  [Portugal], [Lisbon],
  [Poland], [Warsaw],
  [Austria], [Vienna],
  [Sweden], [Stockholm],
)