#set page(paper: "us-letter", margin: (x: 1.8cm, y: 1.8cm), numbering: "1")
#set text(size: 10.5pt)
#set par(justify: false, leading: 0.6em)

#align(center)[
  #text(size: 20pt, weight: "bold")[Causes of the French Revolution] \
  #text(size: 11pt)[Cornell-Style Study Notes]
]

#v(0.5em)

#grid(
  columns: (1fr, 1fr, 1fr),
  [*Name:* #box(width: 70%, line(length: 100%))],
  [*Date:* #box(width: 70%, line(length: 100%))],
  [*Class:* #box(width: 70%, line(length: 100%))],
)

#v(0.5em)
*Essential question:* Why did a crisis in royal finances in the 1780s turn into a revolution that overthrew the monarchy?

#v(0.8em)

#table(
  columns: (5cm, 1fr),
  stroke: 0.6pt + gray,
  inset: 8pt,
  align: (left + top, left + top),
  fill: (x, y) => if y == 0 { luma(230) } else if x == 0 { rgb("#eef3fb") } else { none },

  [*Cues / Questions*], [*Notes*],

  [What was the Old Regime (_Ancien Régime_)? \ \ Who were the three estates?],
  [
    - France before 1789: absolute monarchy, society divided by birth into three "estates."
    - *First Estate:* clergy (~1% of population). Owned about 10% of the land, was exempt from most taxes, and collected the tithe.
    - *Second Estate:* nobility (~2%). Held top posts in the army, church, and government; exempt from the main direct tax (the _taille_); collected feudal dues.
    - *Third Estate:* everyone else (~97%): peasants, urban workers, and the bourgeoisie (merchants, lawyers, professionals). Paid nearly all the taxes.
  ],

  [Why was the social system a cause? \ \ Who was the bourgeoisie, and what did they want?],
  [
    - Privilege based on birth, not merit, which created resentment.
    - Wealthy bourgeoisie were educated and often richer than nobles, but were shut out of high office and status.
    - Peasants paid the tithe to the Church, feudal dues to lords, and taxes to the king (the _taille_, the salt tax or _gabelle_).
    - Result: a large, angry Third Estate with leaders ready to demand change.
  ],

  [How did money problems push France toward crisis? \ \ What reforms were tried?],
  [
    - *Huge royal debt* from costly wars, especially the Seven Years' War and support for the American Revolution (1778–83).
    - By the late 1780s, roughly half of the royal budget went to paying interest on the debt.
    - Tax system was unfair and inefficient: those most able to pay (nobles, clergy) paid the least.
    - Finance ministers *Turgot, Necker, Calonne,* and *Brienne* proposed reforms, including taxing the privileged. Nobles and the _parlements_ blocked them.
    - The *Assembly of Notables* (1787) refused to approve new taxes.
    - Only remaining option: call the *Estates-General*, which had not met since 1614.
  ],

  [How did food shortages make things worse?],
  [
    - Poor harvests in 1788 (after a hailstorm and a harsh winter) drove up the price of bread.
    - Urban workers spent as much as 80% of their income on bread.
    - Unemployment and hunger in 1788–89 fueled riots and unrest in towns and countryside.
  ],

  [What was wrong with the political system? \ \ Why was the king ineffective?],
  [
    - *Absolute monarchy:* king claimed authority by divine right, with no elected body to check his power.
    - *Louis XVI:* well-meaning but indecisive; he gave in to pressure from court and nobles and wavered on reform.
    - *Marie Antoinette:* Austrian-born and unpopular; became a symbol of royal extravagance ("Madame Deficit").
    - The courts (_parlements_) defended noble privilege and resisted reform, so government was stuck.
  ],

  [Which Enlightenment ideas mattered? \ \ How did the American Revolution fit in?],
  [
    - *Locke:* natural rights (life, liberty, property); government rests on consent.
    - *Montesquieu:* separation of powers to prevent tyranny.
    - *Voltaire:* criticized intolerance and Church and royal abuses; defended free speech.
    - *Rousseau:* popular sovereignty and the "general will."
    - Ideas spread through salons, pamphlets, and cafés, so many people began to question the king's authority and inherited privilege.
    - American Revolution showed that Enlightenment ideals could be put into practice.
  ],

  [What were the immediate triggers in 1789?],
  [
    - *May 1789:* Estates-General meets at Versailles. Dispute over voting: by _order_ (1 vote per estate, which favors the privileged) or by _head_ (which favors the Third Estate).
    - *June 17:* Third Estate declares itself the *National Assembly*.
    - *June 20:* *Tennis Court Oath*: members vow not to disband until France has a constitution.
    - *July 14:* Parisians *storm the Bastille*, seeking weapons and gunpowder; a symbol of royal tyranny.
    - *Late July–Aug:* the "Great Fear" spreads in the countryside; feudal privileges abolished (Aug 4).
    - *Aug 26:* _Declaration of the Rights of Man and of the Citizen_ issued.
  ],
)

#v(0.8em)

#block(
  width: 100%,
  stroke: 0.8pt + black,
  inset: 10pt,
  radius: 3pt,
)[
  *Key Terms* \
  #table(
    columns: (1fr, 1fr, 1fr),
    stroke: none,
    inset: 3pt,
    [_Ancien Régime_], [Estates-General], [Tennis Court Oath],
    [Bourgeoisie], [_Taille_ and tithe], [Popular sovereignty],
    [_Parlements_], [Great Fear], [Rights of Man],
  )
]

#v(0.8em)

#block(
  width: 100%,
  stroke: 0.8pt + black,
  inset: 10pt,
  radius: 3pt,
)[
  *Summary* (write 3–4 sentences in your own words) \
  #v(0.5em)
  #line(length: 100%, stroke: 0.5pt + gray)
  #v(1.4em)
  #line(length: 100%, stroke: 0.5pt + gray)
  #v(1.4em)
  #line(length: 100%, stroke: 0.5pt + gray)
  #v(1.4em)
  #line(length: 100%, stroke: 0.5pt + gray)
  #v(0.5em)

  _Model summary:_ The French Revolution grew from several overlapping causes. An unequal social order left the Third Estate paying most taxes while the privileged paid little. Wars and an inefficient tax system created a debt crisis, and the weak monarchy could not push through reform. Bad harvests raised the price of bread, and Enlightenment ideas gave people a language to challenge the old order. The calling of the Estates-General in 1789 set off the events that became the Revolution.
]

#v(0.8em)

*Self-quiz (cover the notes column and answer from the cues):*

+ Name the three estates and give one privilege or burden of each.
+ Give two reasons for France's financial crisis.
+ Why did the Estates-General's voting rules cause a conflict?
+ Which Enlightenment thinker is linked to separation of powers?
+ Which cause do you think was most important? Explain in two sentences.
#v(3em)