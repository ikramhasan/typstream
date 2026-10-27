#show: worksheet.with(
  title: [Solving Linear Equations in One Variable],
  subject: [Mathematics],
  grade: [Grade 8],
  instructions: [Answer *all* questions. Show each step of your working in the space provided. Check your answers by substituting them back into the equation.],
)

#callout(kind: "remember")[
  To solve an equation, do the same thing to both sides until the variable is alone.
  Use inverse operations: undo addition with subtraction, and multiplication with division.
  Example: $3x + 4 = 19$ gives $3x = 15$, so $x = 5$.
]

= Part A: One- and two-step equations

#question(points: 1)[
  Solve $x + 7 = 15$.
  #answer-space(height: 3em, answer: [$x = 15 - 7 = 8$])
]

#question(points: 1)[
  Solve $5 x = 40$.
  #answer-space(height: 3em, answer: [$x = 40 div 5 = 8$])
]

#question(points: 2)[
  Solve $3 x - 5 = 16$.
  #answer-space(height: 4em, answer: [$3 x = 21$, so $x = 7$.])
]

#question(points: 2)[
  Solve $x/4 + 3 = 9$.
  #answer-space(height: 4em, answer: [$x/4 = 6$, so $x = 24$.])
]

#question(points: 1)[
  Which value of $x$ solves $2 x + 9 = 1$?
  #mcq([$x = 5$], [$x = -4$], [$x = 4$], [$x = -5$], answer: 2)
]

= Part B: Variables on both sides and brackets

#question(points: 3)[
  Solve $7 x - 4 = 3 x + 12$.
  #answer-space(height: 5em, answer: [$4 x = 16$, so $x = 4$.])
]

#question(points: 3)[
  Solve $4(x - 3) = 20$.
  #answer-space(height: 5em, answer: [$x - 3 = 5$, so $x = 8$. (Or expand: $4 x - 12 = 20$, $x = 8$.)])
]

#question(points: 3)[
  Solve $2(3 x + 1) = 5 x + 9$.
  #answer-space(height: 5em, answer: [$6 x + 2 = 5 x + 9$, so $x = 7$.])
]

#question(points: 2)[
  Fill in the missing steps to solve $5 x + 8 = 2 x - 7$.

  $5 x - 2 x = -7 - #blank(answer: [$8$])$

  $3 x = #blank(answer: [$-15$])$

  $x = #blank(answer: [$-5$])$
]

= Part C: Fractions and word problems

#question(points: 3)[
  Solve $(2 x + 1)/3 = (x + 4)/2$.
  #answer-space(height: 6em, answer: [Cross-multiply: $2(2 x + 1) = 3(x + 4)$, so $4 x + 2 = 3 x + 12$ and $x = 10$.])
]

#question(points: 3)[
  Solve $x/2 - x/3 = 4$.
  #answer-space(height: 6em, answer: [Multiply by 6: $3 x - 2 x = 24$, so $x = 24$.])
]

#question(points: 4)[
  A number is multiplied by 3 and then 8 is subtracted. The result is the same as when the number is added to 10. Write an equation and find the number.
  #answer-space(height: 6em, answer: [$3 x - 8 = x + 10$, so $2 x = 18$ and $x = 9$.])
]

#question(points: 4)[
  A taxi charges a fixed fee of \$5 plus \$2 per kilometre. Another taxi charges no fixed fee but \$3.50 per kilometre. For what distance do both taxis cost the same?
  #answer-space(height: 6em, answer: [$5 + 2 x = 3.5 x$, so $5 = 1.5 x$ and $x = 10/3 approx 3.33$ km.])
]

#question(points: 3)[
  Explain the mistake in this solution, then solve correctly.

  $3(x + 2) = 18 arrow.r 3 x + 2 = 18 arrow.r 3 x = 16 arrow.r x = 16/3$
  #answer-lines(count: 2, answer: [The 3 was not multiplied by 2: $3(x + 2) = 3 x + 6$. Correct: $3 x = 12$, so $x = 4$.])
]

#answer-key()