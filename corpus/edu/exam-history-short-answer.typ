#set page(margin: (x: 2.5cm, y: 2cm), footer: context align(center, counter(page).display()))
#set text(size: 11pt)
#set par(justify: true, first-line-indent: 0em)

#let lines(n) = {
  for _ in range(n) {
    v(0.7em)
    line(length: 100%, stroke: 0.4pt + luma(170))
  }
}
#let source(label, body) = block(
  inset: (left: 1em, rest: 0.6em),
  stroke: (left: 2pt + luma(120)),
)[*Source #label* \ #emph(body)]

= The Industrial Revolution, 1750–1900

*History — Year 9 Assessment* #h(1fr) *Time:* 45 minutes

Read the sources carefully, then answer *all* questions. Marks are shown in brackets.

== Sources

#source("A")[
  "The workers are packed into the mill from six in the morning until seven at night, with
  only half an hour for dinner. Children of eight years old are among them."
  — Report to Parliament, 1832
]

#source("B")[
  "The railway has shrunk the country. A journey that took my grandfather three days by coach
  is made by me in a single afternoon."
  — Letter from a Manchester merchant, 1851
]

#source("C")[
  "We, the undersigned, demand a vote for every man of twenty-one years of age, of sound mind,
  and not undergoing punishment for crime."
  — The People's Charter, 1838
]

== Questions

+ What does *Source A* suggest about working conditions in textile mills? *[4]*
  #lines(4)

+ How useful is *Source B* to a historian studying the impact of the railways? Use the source and your own knowledge. *[6]*
  #lines(6)

+ Explain *two* reasons why the population of British towns grew rapidly after 1800. *[6]*
  #lines(6)

+ Using *Source C*, explain what the Chartists wanted and why some people opposed them. *[6]*
  #lines(6)

+ "The Industrial Revolution improved life for ordinary people." How far do you agree? *[12]*

  _You should refer to working conditions, living conditions, transport and political change._
  #lines(14)

#v(1em)
#align(center)[_Spelling, punctuation and grammar are assessed in question 5._ *[+4]*]
