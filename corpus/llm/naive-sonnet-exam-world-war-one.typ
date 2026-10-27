#set page(paper: "a4", margin: 2cm, numbering: "1 / 1")
#set text(size: 11pt)
#set par(justify: true)

#let answer-lines(n) = for i in range(n) {
  v(1.5em)
  line(length: 100%, stroke: 0.5pt + gray)
}

#let source(title, body) = block(
  width: 100%,
  inset: 10pt,
  stroke: 0.8pt + black,
  radius: 3pt,
  fill: luma(245),
)[
  *#title* \
  #body
]

#align(center)[
  #text(size: 18pt, weight: "bold")[Grade 10 History Examination] \
  #text(size: 14pt)[World War I: Causes, Experience and Consequences]
]

#v(0.5em)

Name: #box(width: 8cm, line(length: 100%)) #h(1em) Date: #box(width: 3cm, line(length: 100%))

#v(0.5em)

#table(
  columns: (1fr, 1fr, 1fr),
  align: center,
  [*Time allowed*], [*Total marks*], [*Sections*],
  [75 minutes], [50], [A (source-based): 30 marks \ B (essay): 20 marks],
)

*Instructions*
- Answer all questions in both sections.
- Read each source carefully before answering the questions that follow it.
- Use evidence from the sources and your own knowledge where asked.
- Write in full sentences. The marks shown in brackets are a guide to how much detail is needed.

#pagebreak(weak: true)

= Section A: Source-Based Questions (30 marks)

== Part 1: The Outbreak of War

#source[Source A: Sir Edward Grey, British Foreign Secretary, on the eve of war (3 August 1914, as later recalled in his memoirs)][
  "The lamps are going out all over Europe; we shall not see them lit again in our lifetime."
]

#v(0.5em)

+ Identify the message Grey is expressing in Source A. #h(1fr) *(2)*
  #answer-lines(2)

+ Explain how the alliance system helped turn a regional crisis in the Balkans into a European war. Refer to at least *two* alliances or countries in your answer. #h(1fr) *(3)*
  #answer-lines(4)

== Part 2: Recruitment and Propaganda

#source[Source B: British recruitment poster, 1914][
  _Description:_ A poster shows Lord Kitchener, the Secretary of State for War, in military uniform. He stares directly at the viewer and points his finger forward. The large caption reads: *"BRITONS: Lord Kitchener WANTS YOU. Join your country's army! God save the King."*
]

#v(0.5em)

+ State *two* techniques used in Source B to persuade men to enlist. #h(1fr) *(2)*
  #answer-lines(2)

+ Explain why governments on all sides made such heavy use of propaganda during the war. Use Source B and your own knowledge. #h(1fr) *(4)*
  #answer-lines(5)

#pagebreak(weak: true)

== Part 3: Life in the Trenches

#source[Source C: Wilfred Owen, "Dulce et Decorum Est" (written 1917, published 1920)][
  "If in some smothering dreams you too could pace \
  Behind the wagon that we flung him in, \
  And watch the white eyes writhing in his face, \
  His hanging face, like a devil's sick of sin; \
  \
  My friend, you would not tell with such high zest \
  To children ardent for some desperate glory, \
  The old Lie: Dulce et decorum est \
  Pro patria mori."

  _Note: The Latin phrase means "It is sweet and fitting to die for one's country."_
]

#v(0.5em)

+ What does Owen call "the old Lie" in Source C? #h(1fr) *(2)*
  #answer-lines(2)

+ Owen was a soldier who served on the Western Front. Explain how this affects the *usefulness* of Source C for a historian studying soldiers' experiences of the war. Consider both strengths and limitations. #h(1fr) *(4)*
  #answer-lines(5)

== Part 4: The Widening of the War

#source[Source D: Extract from the Zimmermann Telegram, sent by German Foreign Secretary Arthur Zimmermann to the German ambassador in Mexico (January 1917)][
  "We intend to begin on the first of February unrestricted submarine warfare. We shall endeavor in spite of this to keep the United States of America neutral. In the event of this not succeeding, we make Mexico a proposal of alliance on the following basis: make war together, make peace together, generous financial support and an understanding on our part that Mexico is to reconquer the lost territory in Texas, New Mexico, and Arizona."
]

#v(0.5em)

+ According to Source D, what did Germany offer Mexico? #h(1fr) *(2)*
  #answer-lines(2)

+ Explain how the telegram, together with unrestricted submarine warfare, contributed to the United States entering the war in April 1917. #h(1fr) *(3)*
  #answer-lines(4)

#pagebreak(weak: true)

== Part 5: The Peace Settlement

#source[Source E: Article 231 of the Treaty of Versailles (1919)][
  "The Allied and Associated Governments affirm and Germany accepts the responsibility of Germany and her allies for causing all the loss and damage to which the Allied and Associated Governments and their nationals have been subjected as a consequence of the war imposed upon them by the aggression of Germany and her allies."
]

#v(0.5em)

+ What is Germany being made to accept in Source E? #h(1fr) *(3)*
  #answer-lines(3)

+ "The peace settlement of 1919 was fair and brought lasting peace." \
  Using Source E and your own knowledge, explain how far you agree with this statement. Refer to at least *two* terms of the Treaty of Versailles. #h(1fr) *(5)*
  #answer-lines(7)

#pagebreak(weak: true)

= Section B: Essay (20 marks)

Choose *one* statement of the two below only if your teacher has instructed you to. Otherwise, answer the question as set.

*Essay question:*

#block(
  width: 100%,
  inset: 10pt,
  stroke: 1pt + black,
  radius: 3pt,
)[
  "World War I was caused more by long-term tensions in Europe than by the assassination of Archduke Franz Ferdinand in 1914."

  To what extent do you agree with this statement?
]

#v(0.5em)

In your essay you should:
- Write an introduction that states your position clearly.
- Discuss the *long-term causes* (for example militarism, alliances, imperialism and nationalism).
- Discuss the *short-term trigger* (the assassination, the July Crisis and the decisions of the great powers).
- Support each point with specific historical evidence.
- Reach a balanced, supported conclusion that answers the question.

#v(0.5em)

*Marking guide*

#table(
  columns: (2fr, 1fr),
  align: (left, center),
  [*Criteria*], [*Marks*],
  [Argument and clear position throughout], [5],
  [Accurate, detailed historical knowledge], [6],
  [Analysis of long-term causes and the trigger, with a weighing of their importance], [5],
  [Structure, clarity and conclusion], [4],
  [*Total*], [*20*],
)

#v(0.5em)

#answer-lines(16)

#v(2em)
#align(center)[_End of examination_]