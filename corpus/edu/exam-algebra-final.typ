#set document(title: "Algebra I — Final Examination")
#set page(
  paper: "a4",
  margin: (top: 2.5cm, bottom: 2.5cm, x: 2cm),
  header: context {
    if counter(page).get().first() > 1 [
      #set text(9pt)
      Algebra I Final #h(1fr) Candidate no.: #box(width: 3cm, stroke: (bottom: 0.4pt))
    ]
  },
  footer: context [
    #set text(9pt)
    #h(1fr) #counter(page).display() #h(1fr)
  ],
)
#set text(size: 11pt)
#let marks = (20, 30, 25)

#set heading(numbering: "A.")
#show heading.where(level: 1): it => block(above: 1.6em, below: 1em)[
  #set text(13pt, weight: "bold")
  Section #counter(heading).display(it.numbering) #it.body
  #h(1fr) #text(weight: "regular", size: 10pt)[(#marks.at(counter(heading).get().first() - 1) marks)]
]

#let pts(n) = h(1fr) + text(size: 9pt)[[#n]]
#let work-space(h) = v(h)

#align(center)[
  #text(20pt, weight: "bold")[Algebra I — Final Examination]

  #v(0.4em)
  Time allowed: *2 hours* #h(2em) Total: *#marks.sum() marks*
]

#rect(width: 100%, inset: 10pt, stroke: 0.6pt)[
  *Instructions*
  - Answer *all* questions in Sections A and B, and *two* questions from Section C.
  - Show all your working. Answers without working may not receive full marks.
  - Calculators are *not* allowed in Section A.
]

#table(
  columns: (1fr,) * 4,
  align: center,
  [*Section*], [*A*], [*B*], [*C*],
  [*Marks*], ..marks.map(m => [\_\_\_ / #m]),
)

= Short answer

+ Simplify $3x + 4y - x + 2y$. #pts(2)
  #work-space(2em)
+ Expand and simplify $(x + 3)(x - 5)$. #pts(2)
  #work-space(2em)
+ Factorise completely $6x^2 - 9x$. #pts(2)
  #work-space(2em)
+ Solve $5(2x - 1) = 3x + 16$. #pts(3)
  #work-space(3em)
+ Evaluate $2a^2 - b$ when $a = -3$ and $b = 4$. #pts(2)
  #work-space(2em)
+ Write $0.000 042$ in standard form. #pts(1)
+ Solve the inequality $4 - 3x <= 19$ and show the solution on a number line. #pts(3)
  #work-space(4em)
+ Make $r$ the subject of $V = 4/3 pi r^3$. #pts(3)
  #work-space(3em)
+ The $n$th term of a sequence is $3n - 2$. Is 100 a term of this sequence? Explain. #pts(2)

#pagebreak()

= Structured questions

+ Solve the simultaneous equations #pts(6)
  $ cases(2x + 3y = 12, 5x - y = 13) $
  #work-space(6em)

+ The quadratic $y = x^2 - 4x - 5$. #pts(10)
  + Factorise $x^2 - 4x - 5$.
  + Write down the roots of $x^2 - 4x - 5 = 0$.
  + Find the coordinates of the turning point by completing the square.
  + Sketch the graph, labelling the intercepts and turning point.
  #work-space(10em)

+ Use the quadratic formula #pts(6)
  $ x = (-b plus.minus sqrt(b^2 - 4a c)) / (2a) $
  to solve $2x^2 + 3x - 7 = 0$, giving your answers to 2 decimal places.
  #work-space(6em)

+ A rectangle has length $(2x + 1)$ cm and width $(x - 2)$ cm. Its area is $25 "cm"^2$. #pts(8)
  + Show that $2x^2 - 3x - 27 = 0$.
  + Solve the equation and find the perimeter of the rectangle.
  #work-space(8em)

#pagebreak()

= Extended response

_Answer any two questions._

+ *Functions.* Let $f(x) = 2x - 3$ and $g(x) = x^2 + 1$. #pts(12.5)
  + Find $f(g(2))$ and $g(f(2))$.
  + Find $f^(-1)(x)$.
  + Solve $f(g(x)) = 15$.

+ *Exponents.* Simplify, giving answers with positive indices. #pts(12.5)
  $ (a) space (2x^3)^4 quad (b) space (x^5 y^(-2)) / (x^2 y^3) quad (c) space (27 x^6)^(2/3) $

+ *Modelling.* A phone plan costs £12 per month plus 5p per text. Another costs £20 per month with unlimited texts. #pts(12.5)
  + Write an equation for the cost $C$ of each plan for $t$ texts.
  + For how many texts do the plans cost the same?
  + Which plan would you recommend for someone who sends 250 texts a month? Justify.

#align(center)[#v(2em) *END OF EXAMINATION*]
