#show: handout.with(
  title: [Causes of the French Revolution],
  subtitle: [Cornell-style study notes],
  subject: [History],
  grade: [Grade 10],
)

#let cornell(..rows) = table(
  columns: (1fr, 2.6fr),
  inset: 9pt,
  stroke: (x, y) => (
    bottom: 0.5pt + luma(180),
    right: if x == 0 { 0.8pt + luma(100) } else { none },
  ),
  fill: (x, y) => if y == 0 { luma(235) } else { none },
  table.header([*Cues and questions*], [*Notes*]),
  ..rows.pos().flatten(),
)

#callout(kind: "tip", title: [How to use these notes])[
  Cover the right-hand column and try to answer each cue question from memory. Then check your answer, and write your own summary at the bottom of the page.
]

#cornell(
  (
    [
      *1. Social inequality* \
      What were the three Estates?
    ],
    [
      France was divided into three legal "orders" under the _Ancien Régime_:
      - *First Estate:* the clergy, under 1% of the people. It owned about 10% of the land and paid almost no tax.
      - *Second Estate:* the nobility, about 2% of the people. It held the top posts in the army and the Church, and was largely exempt from taxes.
      - *Third Estate:* everyone else, about 97%, from wealthy merchants to peasants. It paid the *taille* (land tax), the *gabelle* (salt tax) and the tithe to the Church.
      The Third Estate carried the tax burden but had little political power.
    ],
  ),
  (
    [
      *2. Financial crisis* \
      Why was the government nearly bankrupt?
    ],
    [
      - Costly wars, especially the Seven Years' War and support for the American Revolution, left huge debts.
      - Interest on the debt took up a large share of the yearly budget.
      - The court at Versailles was expensive, and its spending was highly visible.
      - The tax system was unfair and inefficient, so the Crown could not raise enough money.
      - Ministers (Turgot, Necker, Calonne) proposed reforms, but nobles and the _parlements_ blocked them.
      The king called the *Estates-General* in 1789 to approve new taxes. It had not met since 1614.
    ],
  ),
  (
    [
      *3. Enlightenment ideas* \
      Which thinkers challenged the old order?
    ],
    [
      - *Locke:* people have natural rights to life, liberty and property.
      - *Montesquieu:* power should be divided between branches of government.
      - *Rousseau:* government depends on the "general will" of the people.
      - *Voltaire:* defended freedom of speech and religion and criticised Church privilege.
      These ideas spread through salons, pamphlets and cafés. They undermined the belief that kings ruled by divine right and that birth should decide status.
    ],
  ),
  (
    [
      *4. Economic hardship* \
      How did food prices fuel anger?
    ],
    [
      - Poor harvests in 1788 sent grain and bread prices sharply upward.
      - Urban workers spent most of their wages on bread, so many went hungry.
      - Peasants faced feudal dues, tithes and taxes even in bad years.
      - Unemployment rose in towns, and hunger turned into public anger.
    ],
  ),
  (
    [
      *5. Weak leadership* \
      How did the monarchy add to the crisis?
    ],
    [
      - *Louis XVI* was indecisive and gave way to pressure from court factions.
      - *Marie Antoinette* was unpopular, seen as extravagant and foreign (she was Austrian).
      - The monarchy lost public trust, so it could not manage reform.
    ],
  ),
  (
    [
      *6. Immediate triggers (1789)* \
      What turned the crisis into revolution?
    ],
    [
      - *May:* the Estates-General meets. A dispute arises over voting by order (which favours the privileged) or by head (which favours the Third Estate).
      - *June 17:* the Third Estate declares itself the *National Assembly*.
      - *June 20:* the *Tennis Court Oath*: members swear not to disband until France has a constitution.
      - *July 14:* the *Storming of the Bastille*, a symbol of royal power.
    ],
  ),
)

#v(1em)

#callout(kind: "remember", title: [Key terms])[
  *Ancien Régime:* the old social and political order before 1789. \
  *Estates-General:* the assembly of the three Estates. \
  *Divine right:* the belief that a king's authority comes from God. \
  *Tennis Court Oath:* the pledge to write a constitution.
]

#v(0.5em)

#block(
  width: 100%,
  stroke: 0.8pt + luma(100),
  inset: 12pt,
  radius: 3pt,
)[
  *Summary* (write in your own words, in 3 to 4 sentences)
  #answer-lines(
    count: 4,
    answer: [Long-term causes were an unequal society, state debt and Enlightenment ideas that questioned royal power. Bad harvests and weak leadership made things worse. In 1789 the dispute in the Estates-General led the Third Estate to form the National Assembly and begin the Revolution.],
  )
]