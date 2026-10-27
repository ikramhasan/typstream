#show: worksheet.with(
  title: [Mean, Median, Mode and Range],
  subject: [Mathematics (Statistics)],
  grade: [Grade 9],
  instructions: [Answer all questions. Show your working where space is given. Calculators are allowed.],
)

#callout(kind: "remember")[
  - *Mean* = sum of all values $div$ number of values.
  - *Median* = middle value when the data are in order. With an even number of values, it is the mean of the two middle values.
  - *Mode* = the value that occurs most often.
  - *Range* = largest value $-$ smallest value.
]

= Part A: Test scores

Ten students sat a mathematics test marked out of 100.

#align(center)[
  #table(
    columns: 11,
    align: center,
    inset: 6pt,
    [*Student*], [A], [B], [C], [D], [E], [F], [G], [H], [I], [J],
    [*Score*], [72], [85], [90], [68], [85], [77], [94], [85], [60], [74],
  )
]

#question(points: 2)[
  Write the scores in order from lowest to highest.
  #answer-lines(count: 1, answer: [60, 68, 72, 74, 77, 85, 85, 85, 90, 94])
]

#question(points: 2)[
  Find the *mode* and the *range* of the scores.
  + Mode: #blank(answer: [85])
  + Range: #blank(answer: [$94 - 60 = 34$])
]

#question(points: 2)[
  Calculate the *mean* score.
  #answer-space(height: 4em, answer: [Sum $= 790$, so mean $= 790 div 10 = 79$.])
]

#question(points: 2)[
  Find the *median* score.
  #answer-space(height: 4em, answer: [The 5th and 6th values are 77 and 85, so the median is $(77 + 85) div 2 = 81$.])
]

#question(points: 2)[
  Student K scored 20 and joins the group. Without calculating, say which of the mean, median and mode will change the most, and explain why.
  #answer-lines(count: 2, answer: [The mean. It uses every value, so a very low score pulls it down. The median moves only slightly and the mode stays 85.])
]

= Part B: Frequency table

A class of 20 students took a short quiz marked out of 10.

#align(center)[
  #table(
    columns: 7,
    align: center,
    inset: 6pt,
    [*Score*], [5], [6], [7], [8], [9], [10],
    [*Frequency*], [2], [3], [5], [6], [3], [1],
  )
]

#question(points: 1)[
  What is the modal score?
  #mcq([6], [7], [8], [9], answer: 3)
]

#question(points: 3)[
  Calculate the mean score.
  #answer-space(height: 5em, answer: [$(5 times 2 + 6 times 3 + 7 times 5 + 8 times 6 + 9 times 3 + 10 times 1) div 20 = 148 div 20 = 7.4$])
]

#question(points: 3)[
  Find the median score. Explain how you found it.
  #answer-space(height: 5em, answer: [With 20 values, the median is the mean of the 10th and 11th. The 10th value is 7 and the 11th is 8, so the median is $7.5$.])
]

#question(points: 1)[
  Find the range of the quiz scores: #blank(answer: [$10 - 5 = 5$])
]

= Part C: Problem solving

#question(points: 3)[
  The mean of five test scores is 80. Four of the scores are 78, 85, 72 and 90. Find the fifth score.
  #answer-space(height: 5em, answer: [Total $= 5 times 80 = 400$. The four known scores sum to $325$, so the fifth score is $400 - 325 = 75$.])
]

#question(points: 2)[
  Decide whether each statement is true or false.
  #true-false(answer: true)[A data set can have more than one mode.]
  #true-false(answer: false)[The median must always be one of the values in the data set.]
]

#question(points: 3)[
  Class X has scores 70, 72, 75, 78, 80. Class Y has scores 50, 65, 75, 85, 100. Both classes have a mean of 75. Which class has more consistent scores? Use the range to support your answer.
  #answer-lines(count: 3, answer: [Class X. Its range is $80 - 70 = 10$, while Class Y's range is $100 - 50 = 50$. The smaller range shows the scores are closer together.])
]

#answer-key()