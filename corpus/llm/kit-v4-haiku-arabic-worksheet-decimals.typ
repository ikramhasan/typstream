#show: worksheet.with(
  lang: "ar",
  title: [الكسور العشرية],
  subject: [الرياضيات],
  grade: [الصف السادس],
  info: ("name", "class", "date"),
  instructions: [أجب عن جميع الأسئلة. أظهر خطوات الحل كلما طُلب ذلك.],
)

#callout(kind: "remember")[
  الكسر العشري له جزء صحيح وجزء عشري يفصل بينهما الفاصلة. مثلاً: $3/10 = 0.3$ و $25/100 = 0.25$.
]

= الجزء الأول: التحويل والمقارنة

#question(points: 1)[
  اكتب $3/10$ على صورة كسر عشري: #blank(width: 4em, answer: [0.3])
]

#question(points: 1)[
  اكتب $7/100$ على صورة كسر عشري: #blank(width: 4em, answer: [0.07])
]

#question(points: 1)[
  أي العبارات التالية صحيحة؟
  #mcq([$0.6 > 0.45$], [$0.6 < 0.45$], [$0.6 = 0.06$], [$0.45 > 0.6$], answer: 1)
]

#question(points: 1)[
  #true-false(answer: true)[$0.5 = 0.50$]
]

#question(points: 2)[
  رتب الأعداد التالية من الأصغر إلى الأكبر: $0.8$، $0.08$، $0.75$، $0.7$

  #answer-lines(count: 1, answer: [$0.08 < 0.7 < 0.75 < 0.8$])
]

= الجزء الثاني: العمليات الحسابية

#question(points: 2)[
  احسب: $2.45 + 1.3 =$ #blank(width: 4em, answer: [3.75])
]

#question(points: 2)[
  احسب: $6.2 - 3.85 =$ #blank(width: 4em, answer: [2.35])
]

#question(points: 2)[
  احسب: $0.4 times 0.5 =$ #blank(width: 4em, answer: [0.2])
]

#question(points: 3)[
  احسب ناتج القسمة $3.6 div 0.6$ مع إظهار خطوات الحل.
  #answer-space(height: 4em, answer: [نضرب البسط والمقام في 10: $36 div 6 = 6$.])
]

= الجزء الثالث: مسائل كلامية

#question(points: 3)[
  اشترت سلمى $4$ دفاتر ثمن الدفتر الواحد منها $1.75$ ريال. ما المبلغ الذي دفعته سلمى؟
  #answer-space(height: 4em, answer: [$4 times 1.75 = 7$ ريالات.])
]

#question(points: 3)[
  يركض أحمد مسافة $2.4$ كم كل يوم. ما المسافة التي يركضها في $5$ أيام؟
  #answer-space(height: 4em, answer: [$2.4 times 5 = 12$ كم.])
]

= الجزء الرابع: التمثيل على خط الأعداد

#question(points: 2)[
  عيّن العدد $0.7$ على خط الأعداد التالي.
  #number-line(from: 0, to: 1, step: 0.1, labels: ((0, $0$), (0.5, $0.5$), (1, $1$)), points: (0.7,))
]

#answer-key()