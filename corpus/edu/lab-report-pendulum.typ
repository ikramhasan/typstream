#set page(margin: 2.2cm, numbering: "1")
#set text(size: 11pt)
#set par(justify: true)
#set heading(numbering: "1.")
#set math.equation(numbering: "(1)")
#show figure.caption: set text(size: 9.5pt)

#let lengths = (0.20, 0.40, 0.60, 0.80, 1.00)
#let trials = (
  (9.0, 8.9, 9.1),
  (12.7, 12.6, 12.8),
  (15.5, 15.6, 15.4),
  (17.9, 18.0, 17.8),
  (20.1, 20.0, 20.1),
)
#let period(t) = t.sum() / t.len() / 10

#align(center)[
  #text(16pt)[*Investigating the Period of a Simple Pendulum*] \
  Physics Practical Report · Lab group 4
]

= Aim

To find how the period $T$ of a simple pendulum depends on its length $L$, and to use the results to estimate $g$.

= Theory

For small oscillations, the period of a simple pendulum is

$ T = 2 pi sqrt(L / g) $ <eq-period>

Squaring @eq-period gives $T^2 = (4 pi^2 \/ g) L$, so a graph of $T^2$ against $L$ should be a straight line through the origin with gradient $4 pi^2 \/ g$.

= Method

+ Attach a bob to a string and clamp it so the length from pivot to centre of bob is 0.20 m.
+ Displace the bob by about $10 degree$ and release.
+ Time 10 complete oscillations with a stopwatch. Repeat three times.
+ Repeat for lengths 0.40 m to 1.00 m.

*Safety:* keep the clamp stand stable with a G-clamp; wear eye protection.

= Results

#figure(
  table(
    columns: 7,
    align: center,
    table.header(
      table.cell(rowspan: 2)[$L$ (m)],
      table.cell(colspan: 3)[Time for 10 oscillations (s)],
      table.cell(rowspan: 2)[Mean (s)],
      table.cell(rowspan: 2)[$T$ (s)],
      table.cell(rowspan: 2)[$T^2$ (s²)],
      [1], [2], [3],
    ),
    ..lengths
      .zip(trials)
      .map(((l, t)) => {
        let p = period(t)
        (
          [#l],
          ..t.map(x => [#x]),
          [#calc.round(t.sum() / 3, digits: 2)],
          [#calc.round(p, digits: 3)],
          [#calc.round(p * p, digits: 3)],
        )
      })
      .flatten(),
  ),
  caption: [Measured periods for different pendulum lengths.],
) <tab-results>

#let grads = lengths.zip(trials).map(((l, t)) => calc.pow(period(t), 2) / l)
#let k = grads.sum() / grads.len()

The mean gradient of $T^2$ against $L$ from @tab-results is $k approx #calc.round(k, digits: 2) "s"^2"/m"$, giving

$ g = (4 pi^2) / k approx #calc.round(4 * calc.pow(calc.pi, 2) / k, digits: 2) "m/s"^2 $

= Evaluation

The result is close to the accepted value of $9.81 "m/s"^2$. The main sources of uncertainty were human reaction time when starting and stopping the stopwatch (reduced by timing 10 oscillations) and measuring the length to the centre of the bob.

= Conclusion

$T^2$ is directly proportional to $L$, as predicted by @eq-period.
