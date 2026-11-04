// request: A grade 9 civics handout on where a town's budget goes, with a Sankey diagram of the money's flow.
= Where the town's money goes

Every year the town council decides how to spend what it collects. The diagram follows each dollar from where it comes from to what it pays for.

#figure(kind: image, caption: [The town's budget, in thousands of dollars.])[
  ```mermaid
  sankey-beta

  Property tax,Budget,700
  Grants,Budget,250
  Fees,Budget,50
  Budget,Schools,450
  Budget,Roads,200
  Budget,Parks,100
  Budget,Police and fire,250
  ```
]

== Questions

+ Which source brings in the most money?
+ What share of the budget goes to schools?
+ If grants fell by half, which services would you cut, and why?
