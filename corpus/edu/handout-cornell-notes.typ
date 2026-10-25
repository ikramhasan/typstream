#set page(margin: 1.5cm)
#set text(size: 10.5pt)

#let cue-width = 30%

#grid(
  columns: (1fr, auto),
  [*Topic:* The French Revolution], [*Date:* #box(width: 3cm, stroke: (bottom: 0.4pt))],
)
#v(-0.4em)
#line(length: 100%, stroke: 1.2pt)

#grid(
  columns: (cue-width, 1fr),
  stroke: (x, y) => if x == 0 { (right: 0.8pt) },
  inset: (x: 8pt, y: 6pt),
  [
    #set text(fill: rgb("#37474f"))
    *Cues / Questions*

    Why was France in debt by 1789?

    #v(4em)
    What were the three estates?

    #v(5em)
    What happened on 14 July 1789?

    #v(3em)
    Key terms
  ],
  [
    *Notes*

    - Wars (Seven Years' War, American Revolution) $->$ huge debt
    - Bad harvests 1788 $->$ bread prices doubled
    - King Louis XVI called the *Estates-General* (May 1789)

    #table(
      columns: (auto, 1fr, auto),
      inset: 5pt,
      [*Estate*], [*Who*], [*% pop.*],
      [First], [Clergy], [~0.5],
      [Second], [Nobility], [~1.5],
      [Third], [Everyone else], [~98],
    )

    - Third Estate $->$ declared itself the *National Assembly* (17 June)
    - *Tennis Court Oath* (20 June): no dissolving until a constitution
    - *Storming of the Bastille* (14 July): symbol of royal tyranny falls

    / Estates-General: assembly of representatives of the three estates
    / Bastille: royal fortress and prison in Paris
    / sans-culottes: working-class radicals of Paris
  ],
)

#line(length: 100%, stroke: 1.2pt)
*Summary* (write 3–4 sentences in your own words):

#for _ in range(4) {
  v(1.1em)
  line(length: 100%, stroke: 0.4pt + luma(170))
}
