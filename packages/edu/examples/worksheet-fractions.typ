// request: A grade 5 worksheet on adding fractions with unlike denominators, with an answer key.
#show: worksheet.with(title: [Adding Fractions], subject: [Mathematics], grade: [Grade 5])

#callout(kind: "remember")[
  To add fractions with different denominators, rewrite them with a common denominator first:
  $1/2 + 1/3 = 3/6 + 2/6 = 5/6$.
]

= Part A: Practice

#question(points: 1)[$1/4 + 2/4 =$ #blank(answer: $3/4$)]
#question(points: 2)[$1/2 + 1/3 =$ #blank(answer: $5/6$)]
#question(points: 2)[$2/5 + 1/10 =$ #blank(answer: $1/2$)]

#question(points: 1)[
  Which sum is greater than 1?
  #mcq([$1/2 + 1/4$], [$2/3 + 1/2$], [$1/5 + 3/5$], [$1/3 + 1/3$], answer: 2)
]

#question(points: 1)[
  Mark the point $3/4$ on the number line.
  #number-line(from: 0, to: 1, step: 0.25, labels: ((0, $0$), (0.5, $1/2$), (1, $1$)))
  #answer[The point is three ticks right of 0, halfway between $1/2$ and $1$.]
]

= Part B: Word problems

#question(points: 3)[
  Maya ate $1/4$ of a pizza and her brother ate $3/8$ of it. How much of the pizza did they eat
  altogether? Show your working.
  #answer-space(height: 5em, answer: [$1/4 + 3/8 = 2/8 + 3/8 = 5/8$ of the pizza.])
]

#question(points: 2)[
  #true-false(answer: false)[$1/2 + 1/2 = 2/4$]
  #true-false(answer: true)[$3/6$ is the same as $1/2$.]
]

#answer-key()
