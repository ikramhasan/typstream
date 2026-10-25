= Recursive numbering gone wrong

// Missing base case: Typst stops this at its call depth limit.
#let number(n) = [#n. ] + number(n + 1)

#number(1)
