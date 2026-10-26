// request: اختبار قصير للصف الخامس عن المجموعة الشمسية
#show: quiz.with(lang: "ar", title: [المجموعة الشمسية], subject: [العلوم], grade: [الصف الخامس])

#question(points: 1)[
  ما هو أقرب كوكب إلى الشمس؟
  #mcq([الزهرة], [عطارد], [المريخ], [الأرض], answer: 2)
]

#question(points: 1)[
  #true-false(answer: true)[المريخ هو الكوكب الأحمر.]
]

#question(points: 2)[
  أكمل: تدور الأرض حول #blank(width: 5em, answer: [الشمس]) مرة كل #blank(width: 4em, answer: [سنة]).
]

#question(points: 3)[
  لماذا تبدو الشمس أكبر من النجوم الأخرى في السماء؟
  #answer-lines(count: 3, answer: [لأنها أقرب نجم إلى الأرض.])
]

#callout(kind: "remember")[الشمس نجم، والقمر يدور حول الأرض.]
