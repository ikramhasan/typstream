#show: worksheet.with(title: [Mean, Median, Mode and Range], subject: [Mathematics], grade: [Grade 9], info: ("name", "class", "date"))

#instructions[
  - Use the test scores in the table to answer every question.
  - Show your working for each calculation.
]

#callout(kind: "remember")[
  - *Mean* = sum of the values $div$ number of values.
  - *Median* = the middle value when the values are in order (for an even count, the mean of the two middle values).
  - *Mode* = the value that occurs most often.
  - *Range* = largest value $-$ smallest value.
]

= Test scores

#align(center)[
  #table(
    columns: (auto, auto, auto, auto, auto),
    align: center,
    [Student], [A], [B], [C], [D],
    [1], [12], [15], [9], [15],
    [2], [18], [11], [15], [20],
    [3], [14], [9], [15], [12],
  )
]

Ten students took the test. Their scores are: 12, 15, 9, 15, 18, 11, 15, 20, 9, 14.

#question(points: 2)[
  Calculate the mean score. The total of all ten scores is 138.
  #answer-space(height: 3em, answer: [$"mean" = 138 / 10 = 13.8$])
  The mean score is #blank(width: 4em, answer: [13.8]).
]

#question(points: 2)[
  Write the scores in order from smallest to largest, then find the median.
  #answer-space(height: 4em, answer: [9, 9, 11, 12, 14, 15, 15, 15, 18, 20. The two middle values are 14 and 15, so the median is $(14 + 15) / 2 = 14.5$.])
]

#question(points: 1)[
  Which score is the mode?
  #mcq([$9$], [$14$], [$15$], [$20$], answer: 3)
]

#question(points: 1)[
  Find the range of the scores.
  #answer-space(height: 2em, answer: [$20 - 9 = 11$])
]

#question(points: 3)[
  A student who missed the test takes it later and scores 25. The class now has eleven scores.
  + Find the new mean, to one decimal place.
    #answer-space(height: 3em, answer: [The new total is $138 + 25 = 163$, so the mean is $163 / 11 approx 14.8$.])
  + Find the new median.
    #answer-space(height: 3em, answer: [The median is the 6th of 11 ordered values, which is 15.])
]

#question(points: 3)[
  The teacher says the median is a better summary of these scores than the mean. Do you agree? Use the scores to justify your answer.
  #answer-lines(count: 4, answer: [Answers will vary. A good answer notes that the mean is pulled up by the score of 20, and that the median 14.5 sits near the middle of the scores. The test with 25 shows how one extreme value moves the mean much more than the median.])
]

#answer-key()