#set page(margin: (x: 2.5cm, y: 2cm))
#set text(size: 11pt)
#set par(justify: true, leading: 0.75em)

#let passage = (
  [The lighthouse stood at the very end of the island, where the grass gave way to black rock and the rock gave way to the sea. For ninety years it had warned ships away from the reef, and for the last forty of those years the warning had been kept by one man: Elias Marr.],
  [Every evening, Elias climbed the hundred and twelve steps to the lamp room. He trimmed the wick, polished the great glass lens until it shone like a second moon, and wound the clockwork that turned the light. Then he sat by the window with a mug of tea and watched the beam sweep across the water — once every ten seconds, all night long.],
  [People in the village thought he must be lonely. "Don't you get bored?" the baker's daughter asked him once. Elias smiled. "Bored? Every night the sea is different. Some nights it is glass. Some nights it is a mountain range. And somewhere out there, there is always someone who is glad I am awake."],
  [When the letter came saying the light would be made automatic, the village held a party in his honour. Elias came, shook every hand, and ate two slices of cake. But that night, people noticed a small figure walking along the cliff path towards the lighthouse, carrying a mug of tea.],
)

#align(center)[
  #text(15pt)[*Reading Comprehension: The Keeper*]

  _Read the story carefully, then answer the questions._
]

#v(0.5em)

#block(inset: (left: 2.2em))[
  #for (i, p) in passage.enumerate() [
    #place(dx: -2.2em, text(8pt, fill: gray)[¶#(i + 1)])
    #p

  ]
]

#line(length: 100%, stroke: 0.5pt + gray)

== Questions

=== Retrieval

+ How many steps did Elias climb each evening? #h(1fr) (1 mark)
+ How often did the beam sweep across the water? #h(1fr) (1 mark)
+ List *three* jobs Elias did in the lamp room. #h(1fr) (3 marks)

=== Vocabulary

4. In paragraph 2, the lens "shone like a second moon". What does this comparison suggest about the lens? #h(1fr) (2 marks)
5. Find and copy one word from paragraph 1 that means _a ridge of rock just below the surface of the sea_. #h(1fr) (1 mark)

=== Inference

6. Why do you think Elias says "Every night the sea is different"? Use evidence from the text. #h(1fr) (3 marks)
7. How do you think Elias felt about the light becoming automatic? Explain using the last paragraph. #h(1fr) (3 marks)

=== Author's craft

8. The final sentence does not tell us directly where Elias is going. Why might the author have chosen to end the story this way? #h(1fr) (3 marks)

#v(1fr)
#align(right)[*Total: 17 marks*]
