= Argumentative Essay Rubric

#set page(paper: "us-letter", flipped: true, margin: 1.5cm)
#set text(size: 9.5pt)

*Name:* #box(width: 6cm, line(length: 100%)) #h(1em) *Date:* #box(width: 3cm, line(length: 100%)) #h(1em) *Essay topic:* #box(width: 7cm, line(length: 100%))

#v(0.5em)

#table(
  columns: (2.6cm, 1fr, 1fr, 1fr, 1fr, 1.4cm),
  inset: 6pt,
  align: (left + top, left + top, left + top, left + top, left + top, center + horizon),
  fill: (x, y) => if y == 0 { rgb("#dde6f3") } else if x == 0 { rgb("#f2f2f2") } else { none },
  table.header(
    [*Criterion*],
    [*4 – Exemplary*],
    [*3 – Proficient*],
    [*2 – Developing*],
    [*1 – Beginning*],
    [*Score*],
  ),

  [*Claim and Thesis*],
  [The thesis is precise, arguable, and insightful. It establishes a clear position and previews the line of reasoning. The claim stays focused throughout the essay.],
  [The thesis is clear and arguable and takes a definite position. The claim is mostly maintained, with only minor drifting.],
  [The thesis is present but vague, overly broad, or only partly arguable. The position is sometimes unclear or inconsistent.],
  [The thesis is missing, merely states a fact or topic, or is unclear. No consistent position is evident.],
  [/4],

  [*Evidence and Reasoning*],
  [Claims are supported by relevant, credible, and well-chosen evidence. Reasoning explains clearly how the evidence supports each claim. Counterarguments are fairly stated and effectively rebutted.],
  [Claims are supported by relevant and credible evidence. Reasoning is generally sound. A counterargument is acknowledged and addressed.],
  [Evidence is limited, only loosely related, or not always credible. Reasoning is thin or has logical gaps. Counterarguments are mentioned but not answered.],
  [Evidence is missing, irrelevant, or inaccurate. Reasoning is absent or illogical. Counterarguments are ignored.],
  [/4],

  [*Organization and Coherence*],
  [The introduction engages the reader and the conclusion offers a strong sense of closure. Paragraphs are logically sequenced, and each has a clear focus. Transitions create a smooth flow of ideas.],
  [The introduction, body, and conclusion are clear. Paragraphs are logically ordered and mostly focused. Transitions are generally effective.],
  [The structure is present but uneven. Some paragraphs lack focus or are out of order. Transitions are basic or repetitive.],
  [The structure is difficult to follow. The introduction or conclusion is missing, and paragraphs lack focus. Transitions are rare or ineffective.],
  [/4],

  [*Language and Conventions*],
  [The tone is formal, persuasive, and appropriate for the audience. Word choice is precise and sentences are varied. Grammar, spelling, and punctuation are nearly error-free. Sources are cited correctly.],
  [The tone is mostly formal and appropriate. Word choice is clear and sentences are somewhat varied. There are minor errors that do not interfere with meaning. Citations are mostly correct.],
  [The tone is inconsistent. Word choice is general or repetitive. Frequent errors sometimes distract the reader. Citations are incomplete or inconsistent.],
  [The tone is inappropriate. Errors seriously interfere with meaning. Sources are not cited or are cited incorrectly.],
  [/4],

  table.cell(colspan: 5, align: right)[*Total*],
  [*/16*],
)

#v(0.8em)

*Score guide:* 15–16 Excellent #h(1em) 12–14 Proficient #h(1em) 8–11 Developing #h(1em) 4–7 Beginning

#v(0.8em)

*Teacher comments:*

#v(1.5em)
#line(length: 100%)
#v(1.5em)
#line(length: 100%)