#show: handout.with(
  title: [Science Fair Project Rubric],
  subtitle: [Scoring guide for student projects],
  subject: [Science],
)

#student-info("name", "class", "teacher")

#callout(kind: "note", title: [How to use this rubric])[
  Score each criterion from 4 (Excellent) to 1 (Beginning). There are 7 criteria, so the total is out of *28 points*.
]

= Scientific Content

#rubric(
  ([Question and hypothesis],
    [Question is focused and testable. Hypothesis is clear and based on research.],
    [Question is testable. Hypothesis is clear but only loosely tied to research.],
    [Question is broad or hard to test. Hypothesis is vague.],
    [Question or hypothesis is missing or not testable.]),
  ([Background research],
    [Uses several reliable sources. Explains key ideas accurately in own words.],
    [Uses a few reliable sources. Most ideas are explained accurately.],
    [Uses limited sources. Some ideas are unclear or inaccurate.],
    [Little or no research shown.]),
  ([Experimental design],
    [Variables are clearly identified and controlled. Procedure is detailed and repeatable, with multiple trials.],
    [Variables are identified. Procedure is clear, with a few gaps or too few trials.],
    [Variables are confused. Procedure is incomplete.],
    [No clear procedure or control of variables.]),
  ([Data and analysis],
    [Data is accurate and organized in clear tables and graphs. Patterns are analyzed thoughtfully.],
    [Data is organized in tables or graphs. Analysis is mostly correct.],
    [Data is incomplete or poorly organized. Analysis is minimal.],
    [Little or no data, or data is not analyzed.]),
  ([Conclusion],
    [Answers the question using evidence. States whether the hypothesis was supported and suggests improvements and next steps.],
    [Answers the question using some evidence. Mentions the hypothesis.],
    [Conclusion is weakly connected to the data.],
    [Conclusion is missing or unsupported.]),
  points: (4, 3, 2, 1),
  levels: ([Excellent], [Proficient], [Developing], [Beginning]),
)

= Communication

#rubric(
  ([Display board],
    [Neat, well organized and visually engaging. All required sections are labeled and easy to follow.],
    [Organized and neat. All required sections are present.],
    [Some sections are missing or hard to read.],
    [Disorganized, with several sections missing.]),
  ([Oral presentation],
    [Speaks clearly and confidently. Explains the project and answers questions with understanding.],
    [Speaks clearly. Explains the project and answers most questions.],
    [Hard to hear or reads from the board. Answers few questions.],
    [Unable to explain the project or answer questions.]),
  points: (4, 3, 2, 1),
  levels: ([Excellent], [Proficient], [Developing], [Beginning]),
)

= Total

#v(0.5em)
Total score: #blank(width: 4em) out of 28

Teacher comments:
#answer-lines(count: 3)