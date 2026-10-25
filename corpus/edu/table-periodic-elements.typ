#set page(margin: 1.5cm, numbering: "1")
#set text(size: 9pt)

#let elements = (
  ("H", "Hydrogen", 1, 1.008, "nonmetal"),
  ("He", "Helium", 2, 4.003, "noble gas"),
  ("Li", "Lithium", 3, 6.94, "alkali metal"),
  ("Be", "Beryllium", 4, 9.012, "alkaline earth"),
  ("B", "Boron", 5, 10.81, "metalloid"),
  ("C", "Carbon", 6, 12.011, "nonmetal"),
  ("N", "Nitrogen", 7, 14.007, "nonmetal"),
  ("O", "Oxygen", 8, 15.999, "nonmetal"),
  ("F", "Fluorine", 9, 18.998, "halogen"),
  ("Ne", "Neon", 10, 20.180, "noble gas"),
  ("Na", "Sodium", 11, 22.990, "alkali metal"),
  ("Mg", "Magnesium", 12, 24.305, "alkaline earth"),
  ("Al", "Aluminium", 13, 26.982, "post-transition"),
  ("Si", "Silicon", 14, 28.085, "metalloid"),
  ("P", "Phosphorus", 15, 30.974, "nonmetal"),
  ("S", "Sulfur", 16, 32.06, "nonmetal"),
  ("Cl", "Chlorine", 17, 35.45, "halogen"),
  ("Ar", "Argon", 18, 39.948, "noble gas"),
  ("K", "Potassium", 19, 39.098, "alkali metal"),
  ("Ca", "Calcium", 20, 40.078, "alkaline earth"),
  ("Fe", "Iron", 26, 55.845, "transition metal"),
  ("Cu", "Copper", 29, 63.546, "transition metal"),
  ("Zn", "Zinc", 30, 65.38, "transition metal"),
  ("Br", "Bromine", 35, 79.904, "halogen"),
  ("Ag", "Silver", 47, 107.87, "transition metal"),
  ("I", "Iodine", 53, 126.90, "halogen"),
  ("Au", "Gold", 79, 196.97, "transition metal"),
  ("Hg", "Mercury", 80, 200.59, "transition metal"),
  ("Pb", "Lead", 82, 207.2, "post-transition"),
  ("U", "Uranium", 92, 238.03, "actinide"),
)

#let colors = (
  "nonmetal": rgb("#e3f2fd"),
  "noble gas": rgb("#ede7f6"),
  "alkali metal": rgb("#ffebee"),
  "alkaline earth": rgb("#fff3e0"),
  "metalloid": rgb("#e0f2f1"),
  "halogen": rgb("#f1f8e9"),
  "post-transition": rgb("#eceff1"),
  "transition metal": rgb("#fce4ec"),
  "actinide": rgb("#f9fbe7"),
)

= Reference Table: Common Elements

#table(
  columns: (auto, auto, 1fr, auto, auto, auto),
  align: (center, center, left, right, right, left),
  inset: (x: 6pt, y: 4pt),
  stroke: 0.4pt + luma(180),
  fill: (_, y) => if y > 0 { colors.at(elements.at(y - 1).at(4)) } else { luma(220) },
  table.header([*Z*], [*Symbol*], [*Name*], [*Atomic mass*], [*Protons*], [*Group*]),
  ..elements
    .map(((sym, name, z, mass, group)) => (
      [#z],
      [*#sym*],
      [#name],
      [#calc.round(mass, digits: 2)],
      [#z],
      [#group],
    ))
    .flatten(),
)

== Key

#grid(
  columns: 3,
  gutter: 6pt,
  ..colors.pairs().map(((name, c)) => box(fill: c, inset: 5pt, radius: 2pt, width: 100%)[#name]),
)

== Questions

+ Which element in the table has the greatest atomic mass?
+ How many elements in the table are halogens? Name them.
+ Calculate the number of neutrons in the most common isotope of iron ($attach("Fe", tl: 56)$).
+ The average atomic mass of all elements in this table is #calc.round(elements.map(e => e.at(3)).sum() / elements.len(), digits: 1). Check this value.
