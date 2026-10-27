#set page(paper: "a4", margin: 2cm, numbering: "1")
#set text(size: 11pt)
#set par(justify: false)

#let q(n, body, space: 4em) = block(breakable: false)[
  *#n.* #h(0.4em) #body
  #v(space)
]

= Solving Linear Equations in One Variable
*Grade 8 Mathematics*

Name: #box(width: 8cm, line(length: 100%)) #h(1em) Date: #box(width: 3cm, line(length: 100%))

#v(0.5em)

*Instructions:* Solve each equation and show every step of your working in the space provided. Perform the same operation on both sides of the equation. Check your answers by substituting them back into the original equation. The questions get harder as you go.

== Section A: One-Step Equations

#q(1)[$x + 7 = 15$]
#q(2)[$y - 9 = 4$]
#q(3)[$6m = 42$]
#q(4)[$n / 5 = 8$]

== Section B: Two-Step Equations

#q(5)[$3x + 5 = 20$]
#q(6)[$4y - 7 = 21$]
#q(7)[$x / 3 + 2 = 9$]
#q(8)[$5 - 2n = -7$]

== Section C: Variables on Both Sides

#q(9, space: 5em)[$7x - 4 = 3x + 12$]
#q(10, space: 5em)[$5a + 8 = 2a - 7$]
#q(11, space: 5em)[$9 - 4k = 2k + 21$]
#q(12, space: 5em)[$3(x + 4) = 21$]

== Section D: Brackets and Fractions

#q(13, space: 6em)[$2(3x - 1) = 4x + 10$]
#q(14, space: 6em)[$5(y - 2) - 3 = 2(y + 4)$]
#q(15, space: 6em)[$(2x + 1) / 3 = 5$]
#q(16, space: 6em)[$x / 2 + x / 3 = 10$]
#q(17, space: 6em)[$(x + 1) / 2 = (2x - 5) / 3$]

== Section E: Word Problems

For each problem, define a variable, write an equation, solve it, and answer in a sentence.

#q(18, space: 7em)[A number is multiplied by 4 and then 9 is added. The result is 37. What is the number?]

#q(19, space: 7em)[Sam is 3 years older than twice Priya's age. Together their ages add up to 27. How old is each person?]

#q(20, space: 7em)[The length of a rectangle is 5 cm more than its width. The perimeter is 46 cm. Find the length and the width.]

== Section F: Challenge

#q(21, space: 8em)[Solve: $ (3x - 1) / 2 - (x + 2) / 3 = 7 $]

#q(22, space: 7em)[A student solved $3x + 6 = 18$ like this:

  $ 3x + 6 &= 18 \
    3x &= 24 \
    x &= 8 $

  Find the mistake, explain what went wrong, and give the correct solution.]

#pagebreak()

= Answer Key

#table(
  columns: (auto, 1fr, auto, 1fr),
  inset: 7pt,
  align: left,
  [*Q*], [*Answer*], [*Q*], [*Answer*],
  [1], [$x = 8$], [12], [$x = 3$],
  [2], [$y = 13$], [13], [$x = 6$],
  [3], [$m = 7$], [14], [$y = 7$],
  [4], [$n = 40$], [15], [$x = 7$],
  [5], [$x = 5$], [16], [$x = 12$],
  [6], [$y = 7$], [17], [$x = 13$],
  [7], [$x = 21$], [18], [$4n + 9 = 37$, so $n = 7$],
  [8], [$n = 6$], [19], [Priya is 8, Sam is 19],
  [9], [$x = 4$], [20], [Width 9 cm, length 14 cm],
  [10], [$a = -5$], [21], [$x = 7$],
  [11], [$k = -2$], [22], [Should subtract 6 (not add): $3x = 12$, so $x = 4$],
)