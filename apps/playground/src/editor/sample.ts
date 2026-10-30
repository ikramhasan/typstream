/** The document the editor page opens with: a worksheet using edu's components. */
export const SAMPLE = `#show: worksheet.with(title: [Fractions], subject: [Mathematics], grade: [Year 5])

#instructions[Answer every question. Show your working.]

= Adding fractions

To add two fractions with the *same denominator*, add the numerators and keep the denominator:
$a/c + b/c = (a + b)/c$.

#question(points: 2)[What is $1/4 + 2/4$? #blank(answer: [$3/4$])]

#question(points: 1)[
  Which fraction is equal to $1/2$?
  #mcq([$2/3$], [$3/6$], [$3/4$], answer: 2)
]

== Word problems

+ Mia ate $1/3$ of a pizza and Tom ate $1/3$. How much did they eat _together_?
+ A ribbon is $3/4$ m long. You cut off $1/4$ m. How long is it now?

$ 3/4 - 1/4 = 2/4 = 1/2 $

#callout(kind: "tip")[Simplify your answer when you can.]
`;
