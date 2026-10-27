#set page(flipped: true, margin: 1.5cm)
#set text(size: 10pt)
#set par(justify: false)

= Science Fair Project Rubric

*Student name:* #box(width: 14em, line(length: 100%)) #h(1em) *Project title:* #box(width: 20em, line(length: 100%)) #h(1em) *Date:* #box(width: 7em, line(length: 100%))

#v(0.5em)

Each criterion is worth the number of points shown. Judges circle the level that best matches the project and write the points earned in the Score column.

#table(
  columns: (1.4fr, 1.5fr, 1.5fr, 1.5fr, 1.5fr, 0.7fr),
  inset: 6pt,
  align: (left, left, left, left, left, center),
  fill: (x, y) => if y == 0 { rgb("#d9e8f5") } else { none },
  [*Criterion*], [*Excellent*], [*Proficient*], [*Developing*], [*Beginning*], [*Score*],

  [*Question and Hypothesis* \ (10 pts)],
  [*9–10:* Question is clear, focused, and testable. Hypothesis is specific and explains the reasoning.],
  [*7–8:* Question is testable. Hypothesis is clear but reasoning is limited.],
  [*5–6:* Question is vague or too broad. Hypothesis is unclear or not testable.],
  [*0–4:* Question or hypothesis is missing or unrelated to the project.],
  [/ 10],

  [*Background Research* \ (10 pts)],
  [*9–10:* Uses several reliable sources. Explains key concepts clearly and connects them to the project.],
  [*7–8:* Uses a few sources. Key concepts are mostly explained.],
  [*5–6:* Uses one source or sources of uneven quality. Research is only loosely connected.],
  [*0–4:* Little or no research shown.],
  [/ 10],

  [*Materials and Procedure* \ (15 pts)],
  [*14–15:* Materials are listed fully. Steps are detailed enough for someone else to repeat the experiment.],
  [*11–13:* Materials and steps are mostly complete, with minor gaps.],
  [*8–10:* Several steps or materials are missing or unclear.],
  [*0–7:* Procedure is missing or cannot be followed.],
  [/ 15],

  [*Variables and Data Collection* \ (15 pts)],
  [*14–15:* Independent, dependent, and controlled variables are identified. Multiple trials give accurate, well-organized data.],
  [*11–13:* Variables are identified. Data is organized, with few trials.],
  [*8–10:* Some variables are missing or confused. Data is incomplete or disorganized.],
  [*0–7:* No clear variables. Little or no data.],
  [/ 15],

  [*Analysis and Graphs* \ (15 pts)],
  [*14–15:* Graphs and tables are accurate, labeled, and titled. Patterns in the data are described correctly.],
  [*11–13:* Graphs are mostly accurate. Analysis describes the main pattern.],
  [*8–10:* Graphs have errors or missing labels. Analysis is superficial.],
  [*0–7:* No graphs or analysis, or they are inaccurate.],
  [/ 15],

  [*Conclusion* \ (15 pts)],
  [*14–15:* States whether the hypothesis was supported, uses data as evidence, discusses errors, and suggests next steps.],
  [*11–13:* States whether the hypothesis was supported and uses some evidence.],
  [*8–10:* Conclusion is weakly tied to the data.],
  [*0–7:* Conclusion is missing or unsupported.],
  [/ 15],

  [*Display Board* \ (10 pts)],
  [*9–10:* Neat, well organized, and easy to read. All required sections are included.],
  [*7–8:* Organized and readable, with one or two sections weak or missing.],
  [*5–6:* Cluttered or hard to follow. Several sections missing.],
  [*0–4:* Disorganized or incomplete.],
  [/ 10],

  [*Oral Presentation* \ (10 pts)],
  [*9–10:* Speaks clearly and confidently. Answers questions accurately and shows deep understanding.],
  [*7–8:* Speaks clearly. Answers most questions correctly.],
  [*5–6:* Relies on notes or reads from the board. Struggles with questions.],
  [*0–4:* Unable to explain the project.],
  [/ 10],

  table.cell(colspan: 5, align: right)[*TOTAL SCORE*],
  [*/ 100*],
)

#v(1em)

*Judge comments:*

#v(1.5em)
#line(length: 100%)
#v(1.5em)
#line(length: 100%)
#v(1.5em)
#line(length: 100%)

#v(1em)
*Judge signature:* #box(width: 16em, line(length: 100%))