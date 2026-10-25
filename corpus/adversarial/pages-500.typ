#set page(paper: "a5", numbering: "1 / 1")

// A short source that lays out 500 pages: paging and page-diffing at scale.
#for i in range(1, 501) [
  = Flashcard #i

  What is $#i times #(calc.rem(i, 12) + 1)$?

  #v(1fr)
  #align(right)[Answer: #(i * (calc.rem(i, 12) + 1))]
  #if i < 500 { pagebreak() }
]
