// Words edu writes itself (field labels, callout titles, True/False, points), in the launch
// languages: English, Arabic and Bengali (#1). Picked by `text.lang`, English otherwise.
// The Arabic and Bengali wording is a first draft and needs a native speaker's review.

#let _words = (
  en: (
    name: "Name",
    date: "Date",
    class: "Class",
    section: "Section",
    roll: "Roll no.",
    score: "Score",
    teacher: "Teacher",
    subject: "Subject",
    grade: "Grade",
    duration: "Duration",
    total: "Total",
    answer: "Answer",
    answer-key: "Answer key",
    instructions: "Instructions",
    objectives: "Learning objectives",
    note: "Note",
    tip: "Tip",
    warning: "Warning",
    definition: "Definition",
    example: "Example",
    remember: "Remember",
    "true": "True",
    "false": "False",
    criteria: "Criteria",
    candidate: "Candidate",
    levels: ("Exemplary", "Proficient", "Developing", "Beginning"),
  ),
  ar: (
    name: "الاسم",
    date: "التاريخ",
    class: "الفصل",
    section: "الشعبة",
    roll: "رقم الجلوس",
    score: "الدرجة",
    teacher: "المعلم",
    subject: "المادة",
    grade: "الصف",
    duration: "الزمن",
    total: "المجموع",
    answer: "الإجابة",
    answer-key: "مفتاح الإجابة",
    instructions: "التعليمات",
    objectives: "أهداف التعلم",
    note: "ملاحظة",
    tip: "نصيحة",
    warning: "تنبيه",
    definition: "تعريف",
    example: "مثال",
    remember: "تذكر",
    "true": "صح",
    "false": "خطأ",
    criteria: "المعيار",
    candidate: "الطالب",
    levels: ("متميز", "متقن", "نام", "مبتدئ"),
  ),
  bn: (
    name: "নাম",
    date: "তারিখ",
    class: "শ্রেণি",
    section: "শাখা",
    roll: "রোল নং",
    score: "প্রাপ্ত নম্বর",
    teacher: "শিক্ষক",
    subject: "বিষয়",
    grade: "শ্রেণি",
    duration: "সময়",
    total: "মোট",
    answer: "উত্তর",
    answer-key: "উত্তরমালা",
    instructions: "নির্দেশনা",
    objectives: "শিখনফল",
    note: "লক্ষ করো",
    tip: "পরামর্শ",
    warning: "সতর্কতা",
    definition: "সংজ্ঞা",
    example: "উদাহরণ",
    remember: "মনে রাখো",
    "true": "সত্য",
    "false": "মিথ্যা",
    criteria: "মানদণ্ড",
    candidate: "পরীক্ষার্থী",
    levels: ("চমৎকার", "দক্ষ", "উন্নয়নশীল", "প্রারম্ভিক"),
  ),
)

/// The word for `key` in the current language. Needs context.
#let _word(key) = _words.at(text.lang, default: _words.en).at(key, default: _words.en.at(key, default: key))

/// A student-field label: a known key (`"name"`) in the current language, anything else as given.
#let _field-label(field) = if type(field) == str and field in _words.en { _word(field) } else { field }

/// "2 points" in the current language, or with the template's own word (`points-label`).
#let _points-text(n, word: auto) = {
  if type(word) == function { return word(n) }
  if word != auto { return [#n #word] }
  if text.lang == "ar" {
    // Arabic counts nouns by number: 1 and 2 have their own forms, 3–10 take the plural.
    if n == 1 { "درجة واحدة" } else if n == 2 { "درجتان" } else if n >= 3 and n <= 10 { [#n درجات] } else { [#n درجة] }
  } else if text.lang == "bn" { [#n নম্বর] } else if n == 1 { "1 point" } else { [#n points] }
}

/// Marker pattern for options and sub-parts: `(a)`, `(أ)`, `(ক)`.
#let _letter-pattern() = if text.lang == "ar" { "(أ)" } else if text.lang == "bn" { "(ক)" } else { "(a)" }

/// The marker of the `i`th option (1-based), without parentheses: `a`, `أ`, `ক`.
#let _letter(i) = numbering(if text.lang == "ar" { "أ" } else if text.lang == "bn" { "ক" } else { "a" }, i)

/// The text direction in effect: `text.dir` is `auto` unless set, so derive it from the language as Typst does.
#let _dir() = if text.dir != auto { text.dir } else if text.lang in ("ar", "fa", "he", "ur", "ps", "sd", "ug", "yi", "dv") {
  rtl
} else { ltr }

/// The physical side where lines start: `"left"` in LTR text, `"right"` in RTL (strokes and radii are physical).
#let _start-side() = if _dir() == rtl { "right" } else { "left" }
