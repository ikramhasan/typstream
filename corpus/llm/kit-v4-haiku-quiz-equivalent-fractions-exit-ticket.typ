#show: quiz.with(
  title: [Exit Ticket: Equivalent Fractions],
  subject: [Mathematics],
  grade: [Grade 5],
  info: ("name", "date", "class"),
  instructions: [Answer all three questions. Show your thinking where space is given.],
)

#question(points: 1)[
  Fill in the missing numerator so the fractions are equivalent:
  $1/2 = #blank(answer: [3])/6$
]

#question(points: 1)[
  Which fraction is equivalent to $3/4$?
  #mcq([$6/7$], [$4/3$], [$6/8$], [$3/8$], answer: 3)
]

#question(points: 2)[
  True or false: $2/5$ and $4/10$ are equivalent fractions. Explain how you know.
  #true-false(answer: true)[$2/5$ and $4/10$ are equivalent.]
  #answer-space(height: 3em, answer: [Multiply the numerator and denominator of $2/5$ by 2 to get $4/10$, so they name the same amount.])
]