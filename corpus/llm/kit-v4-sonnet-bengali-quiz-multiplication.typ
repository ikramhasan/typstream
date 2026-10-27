#show: quiz.with(
  lang: "bn",
  title: [গুণের কুইজ],
  subject: [গণিত],
  grade: [তৃতীয় শ্রেণি],
  instructions: [সব প্রশ্নের উত্তর দাও। প্রয়োজনে হিসাব করে দেখাও।],
)

#question(points: 1)[
  গুণ করো: $3 times 4 =$ #blank(answer: [12])
]

#question(points: 1)[
  গুণ করো: $5 times 6 =$ #blank(answer: [30])
]

#question(points: 1)[
  $7 times 2$ কত?
  #mcq([$12$], [$14$], [$16$], [$9$], answer: 2)
]

#question(points: 1)[
  #true-false(answer: true)[$4 times 5 = 20$]
]

#question(points: 1)[
  শূন্যস্থান পূরণ করো: $6 times #blank(answer: [7]) = 42$
]

#question(points: 1)[
  বারবার যোগকে গুণের আকারে লেখো:
  $4 + 4 + 4 = 3 times #blank(answer: [4]) = #blank(answer: [12])$
]

#question(points: 4)[
  সঠিক উত্তরের সাথে মেলাও।
  #matching(
    ([$2 times 5$], [$10$]),
    ([$3 times 6$], [$18$]),
    ([$4 times 8$], [$32$]),
    ([$9 times 3$], [$27$]),
  )
]

#question(points: 3)[
  একটি ঝুড়িতে ৪টি আম আছে। এমন ৫টি ঝুড়িতে মোট কতটি আম আছে? হিসাব করে লেখো।
  #answer-space(height: 5em, answer: [$4 times 5 = 20$, মোট ২০টি আম।])
]

#answer-key()