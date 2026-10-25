#set page(margin: 2cm)
#set text(size: 11pt)

// Upright chemical formulas in math: #ce("H_2O") style via a small helper.
#let ce(body) = $upright(body)$
#let yields = $stretch(->, size: #150%)$
#let eq-row(lhs, rhs) = ($lhs$, $yields$, $rhs$)

= Balancing Chemical Equations

*Law of conservation of mass:* atoms are neither created nor destroyed in a chemical reaction,
so each element must have the same number of atoms on both sides.

== Steps

+ Write the unbalanced equation with correct formulas.
+ Count the atoms of each element on both sides.
+ Add *coefficients* (never change subscripts!) to balance one element at a time.
+ Check that all elements, and the total charge, balance.

== Example

Unbalanced: $ce("Fe") + ce("O")_2 -> ce("Fe")_2 ce("O")_3$

#table(
  columns: 3,
  align: center,
  [*Element*], [*Left*], [*Right*],
  [Fe], [1], [2],
  [O], [2], [3],
)

Balanced: $ 4 ce("Fe") + 3 ce("O")_2 -> 2 ce("Fe")_2 ce("O")_3 $

== Practice

Balance each equation by writing coefficients in the boxes.

#let sq = box(width: 1.2em, height: 1.2em, stroke: 0.5pt, baseline: 20%)

#table(
  columns: (auto, 1fr),
  stroke: none,
  row-gutter: 0.6em,
  [1.], [#sq $ce("H")_2$ + #sq $ce("Cl")_2$ $->$ #sq $ce("HCl")$],
  [2.], [#sq $ce("Na")$ + #sq $ce("H")_2 ce("O")$ $->$ #sq $ce("NaOH")$ + #sq $ce("H")_2$],
  [3.], [#sq $ce("C")_3 ce("H")_8$ + #sq $ce("O")_2$ $->$ #sq $ce("CO")_2$ + #sq $ce("H")_2 ce("O")$],
  [4.], [#sq $ce("Al")$ + #sq $ce("HCl")$ $->$ #sq $ce("AlCl")_3$ + #sq $ce("H")_2$],
  [5.], [#sq $ce("CaCO")_3$ $->$ #sq $ce("CaO")$ + #sq $ce("CO")_2$],
  [6.], [#sq $ce("Cu")$ + #sq $ce("AgNO")_3$ $->$ #sq $ce("Cu")(ce("NO")_3)_2$ + #sq $ce("Ag")$],
)

== Ionic equations

Spectator ions cancel. For silver chloride precipitating:

$
  ce("Ag")^+ (a q) + ce("NO")_3^- (a q) + ce("Na")^+ (a q) + ce("Cl")^- (a q)
  &-> ce("AgCl") (s) + ce("Na")^+ (a q) + ce("NO")_3^- (a q) \
  ce("Ag")^+ (a q) + ce("Cl")^- (a q) &-> ce("AgCl") (s)
$

== Equilibrium

For the Haber process,
$ ce("N")_2 (g) + 3 ce("H")_2 (g) harpoons.rtlb 2 ce("NH")_3 (g) quad Delta H = -92 "kJ/mol" $

the equilibrium constant is

$ K_c = [ce("NH")_3]^2 / ([ce("N")_2][ce("H")_2]^3) $

*Question:* Predict the effect on the yield of ammonia of (a) increasing pressure, (b) increasing temperature. Explain using Le Chatelier's principle.

#v(4em)

#text(size: 9pt, fill: gray)[Answers: 1) 1,1,2 2) 2,2,2,1 3) 1,5,3,4 4) 2,6,2,3 5) 1,1,1 6) 1,2,1,2]
