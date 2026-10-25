#set text(size: 12pt)

= Mixed-direction text

English sentence with an Arabic phrase مرحبا بالعالم in the middle, and a number 2025 after it.

#text(lang: "ar")[
  جملة عربية تحتوي على English words وأرقام 123 و ٤٥٦ ومعادلة $x^2 + 1 = 0$ في الوسط.
]

#text(lang: "he")[
  משפט בעברית עם מילה באנגלית (Typst) וסוגריים [מרובעים] ומספר 3.14.
]

Parentheses and punctuation at direction boundaries: (عربي), "עברית", [mixed: abc عربي def].

#table(
  columns: 3,
  [English], [العربية], [עברית],
  [one], [واحد], [אחת],
  [two], [اثنان], [שתיים],
)

- List item with عربي at the end
- عنصر قائمة with English at the end

#text(dir: rtl)[Forced RTL paragraph with English only.]

#text(dir: ltr, lang: "ar")[فقرة عربية بإجبار الاتجاه من اليسار إلى اليمين.]
