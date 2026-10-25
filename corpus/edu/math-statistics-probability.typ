#set page(margin: 2cm, numbering: "1")
#set text(size: 11pt)
#set heading(numbering: "1.")

#let data = (12, 15, 15, 18, 20, 21, 21, 21, 24, 26, 27, 30, 33, 35, 41)
#let mean(xs) = xs.sum() / xs.len()
#let median(xs) = {
  let s = xs.sorted()
  let n = s.len()
  if calc.odd(n) { s.at(int(n / 2)) } else { (s.at(n / 2 - 1) + s.at(n / 2)) / 2 }
}
#let variance(xs) = {
  let m = mean(xs)
  xs.map(x => calc.pow(x - m, 2)).sum() / xs.len()
}

= Statistics and Probability Review

== Measures of centre and spread

The minutes spent on homework by 15 students last night were:

#align(center, data.map(str).join(", "))

#table(
  columns: (1fr, 1fr, 1fr),
  align: (left, center, left),
  table.header([*Measure*], [*Value*], [*Formula*]),
  [Mean], [#calc.round(mean(data), digits: 2)], [$overline(x) = 1/n sum_(i=1)^n x_i$],
  [Median], [#median(data)], [middle value of the ordered data],
  [Mode], [21], [most frequent value],
  [Range], [#(calc.max(..data) - calc.min(..data))], [$x_max - x_min$],
  [Std. deviation], [#calc.round(calc.sqrt(variance(data)), digits: 2)], [$sigma = sqrt(1/n sum (x_i - overline(x))^2)$],
)

== Frequency table

#let bins = ((10, 19), (20, 29), (30, 39), (40, 49))
#table(
  columns: 4,
  align: center,
  table.header([*Minutes*], [*Tally*], [*Frequency*], [*Relative frequency*]),
  ..bins
    .map(((lo, hi)) => {
      let f = data.filter(x => x >= lo and x <= hi).len()
      ([#lo–#hi], [#("|" * f)], [#f], [$#f / #data.len()$])
    })
    .flatten(),
)

== Probability

+ A bag contains 5 red, 3 blue and 2 green counters. One counter is taken at random.
  $ P("red") = 5/10 = 1/2, quad P("not blue") = 1 - 3/10 = 7/10 $

+ Two fair dice are rolled. Find the probability that the total is 7.
  #table(
    columns: 7,
    align: center,
    inset: 4pt,
    [$+$], ..range(1, 7).map(i => [*#i*]),
    ..for a in range(1, 7) {
      ([*#a*],) + range(1, 7).map(b => if a + b == 7 { table.cell(fill: yellow)[#(a + b)] } else [#(a + b)])
    },
  )
  $ P("total" = 7) = 6/36 = 1/6 $

+ Events $A$ and $B$ are independent with $P(A) = 0.4$ and $P(B) = 0.25$. Find $P(A inter B)$ and $P(A union B)$.
  $
    P(A inter B) &= P(A) P(B) = 0.1 \
    P(A union B) &= P(A) + P(B) - P(A inter B) = 0.55
  $

== Normal distribution

If $X tilde N(mu, sigma^2)$, then about 68% of values lie within $mu plus.minus sigma$ and 95% within $mu plus.minus 2 sigma$.

$ f(x) = 1/(sigma sqrt(2 pi)) e^(-1/2 ((x - mu)/sigma)^2) $

*Exercise:* Heights of adult women are approximately $N(165, 7^2)$ cm. What percentage are taller than 179 cm?
