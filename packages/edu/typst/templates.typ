// Document templates: page setup, a title block with student fields, page numbers. Applied as
// the document's first line, `#show: worksheet.with(title: …)`. In HTML there are no pages, so
// a template writes a <header> and no page rules (no "page set rule was ignored" warning).
#import "util.typ": _array, _config, _el, _html, _rule
#import "i18n.typ": _points-text, _word
#import "blocks.typ": instructions as _instructions, student-info

/// The sum of every question's points.
#let _total() = query(<edu-points>).map(m => m.value).sum(default: 0)

#let _template(
  body,
  title: none,
  subtitle: none,
  meta: (),
  details: (),
  info: none,
  instructions: none,
  total: false,
  running-header: false,
  paper: "a4",
  lang: auto,
  points-label: auto,
) = {
  let info = if info != none { _array(info) }
  set document(title: title) if type(title) in (str, content)
  set text(lang: lang) if lang != auto
  _config.update(c => (..c, points-label: points-label))
  context {
    let total = if total {
      let t = _total()
      if t > 0 { [#_word("total"): #_points-text(t, word: points-label)] }
    }
    let meta = meta.filter(m => m != none) + if total != none { (total,) } else { () }
    let details = details.filter(((k, v)) => v != none)
    if _html() {
      _el("header", "edu-header", {
        if title != none { html.elem("h1", title) }
        if subtitle != none { _el("p", "edu-subtitle", subtitle) }
        if meta.len() > 0 { _el("p", "edu-meta", meta.join([ · ])) }
        if details.len() > 0 {
          _el("dl", "edu-details", for (k, v) in details {
            html.elem("dt", _word(k))
            html.elem("dd", v)
          })
        }
        if info != none { student-info(..info) }
      })
      if instructions != none { _instructions(instructions) }
      body
    } else {
      set page(
        paper: paper,
        margin: (x: 2cm, top: 2cm, bottom: 2.2cm),
        header: if running-header {
          context if counter(page).get().first() > 1 {
            set text(size: 0.8em)
            [#title #h(1fr) #_word("candidate"): #box(width: 3.5cm, stroke: (bottom: 0.4pt + _rule))]
          }
        },
        footer: context {
          let pages = counter(page).final().first()
          if pages > 1 { align(center, text(size: 0.8em, [#counter(page).display() / #pages])) }
        },
      )
      show heading: set block(above: 1.5em, below: 0.9em)
      block(width: 100%, below: 1.2em, {
        align(center, {
          if title != none { block(below: 0.5em, text(size: 1.6em, weight: "bold", title)) }
          if subtitle != none { block(below: 0.5em, text(size: 1.15em, subtitle)) }
          if meta.len() > 0 { text(fill: luma(70), meta.join([ #sym.dot.c ])) }
        })
        if details.len() > 0 {
          block(above: 1em, grid(
            columns: (auto, 1fr, auto, 1fr),
            column-gutter: (0.5em, 1.5em, 0.5em),
            row-gutter: 0.6em,
            ..details.map(((k, v)) => (strong[#_word(k):], v)).flatten(),
          ))
        }
        if info != none { student-info(..info) }
        line(length: 100%, stroke: 0.6pt + _rule)
      })
      if instructions != none { _instructions(instructions) }
      body
    }
  }
}

/// A worksheet: title, subject and grade, and lines for the student's name, date and class.
/// Apply it as the document's first line.
///
/// - title (content, str, none): The worksheet's title.
/// - subject (content, str, none): E.g. "Mathematics".
/// - grade (content, str, none): E.g. "Grade 5".
/// - info (array, none): Student fields (see `student-info`); `none` for none.
/// - instructions (content, none): Instructions shown under the title.
/// - lang (str, auto): The document's language, e.g. "ar" or "bn"; sets the text language for the whole document, title included.
/// - paper (str): Paper size, e.g. "a4" or "us-letter".
/// - points-label (str, function, auto): Word for points, e.g. "marks"; `auto` is "points" in the document's language.
///
/// ```example
/// #show: worksheet.with(title: [Adding Fractions], subject: [Mathematics], grade: [Grade 5])
/// ```
#let worksheet(
  title: none,
  subject: none,
  grade: none,
  info: ("name", "date", "class"),
  instructions: none,
  lang: auto,
  paper: "a4",
  points-label: auto,
  body,
) = _template(
  body,
  title: title,
  meta: (subject, grade),
  info: info,
  instructions: instructions,
  lang: lang,
  paper: paper,
  points-label: points-label,
)

/// A quiz: like a worksheet, with the total of the questions' points under the title.
///
/// ```example
/// #show: quiz.with(title: [The Solar System], subject: [Science], grade: [Grade 4])
/// ```
#let quiz(
  title: none,
  subject: none,
  grade: none,
  info: ("name", "date", "class"),
  instructions: none,
  lang: auto,
  paper: "a4",
  points-label: auto,
  body,
) = _template(
  body,
  title: title,
  meta: (subject, grade),
  info: info,
  instructions: instructions,
  total: true,
  lang: lang,
  paper: paper,
  points-label: points-label,
)

/// An exam: title, subject, duration and total points, student fields, an instructions box, and
/// from page 2 a running header with the title and a candidate box.
///
/// - duration (content, str, none): E.g. [2 hours].
///
/// ```example
/// #show: exam.with(
///   title: [Algebra I Final Examination],
///   subject: [Mathematics],
///   duration: [2 hours],
///   instructions: [Answer *all* questions. Show your working.],
/// )
/// ```
#let exam(
  title: none,
  subject: none,
  grade: none,
  duration: none,
  info: ("name", "class", "roll"),
  instructions: none,
  lang: auto,
  paper: "a4",
  points-label: auto,
  body,
) = _template(
  body,
  title: title,
  meta: (subject, grade, if duration != none { context [#_word("duration"): #duration] }),
  info: info,
  instructions: instructions,
  total: true,
  running-header: true,
  lang: lang,
  paper: paper,
  points-label: points-label,
)

/// A lesson plan for the teacher: title and a table of subject, grade, duration, date and teacher.
/// Write objectives with `learning-objectives` and the stages as headings.
///
/// ```example
/// #show: lesson-plan.with(title: [The Water Cycle], subject: [Science], grade: [Grade 6], duration: [45 minutes])
/// ```
#let lesson-plan(
  title: none,
  subject: none,
  grade: none,
  duration: none,
  date: none,
  teacher: none,
  lang: auto,
  paper: "a4",
  body,
) = _template(
  body,
  title: title,
  details: (("subject", subject), ("grade", grade), ("duration", duration), ("date", date), ("teacher", teacher)),
  lang: lang,
  paper: paper,
)

/// A handout or notes for students: title, subtitle, and a line with the subject, grade and teacher.
///
/// ```example
/// #show: handout.with(title: [Photosynthesis], subtitle: [Key ideas], subject: [Biology])
/// ```
#let handout(
  title: none,
  subtitle: none,
  subject: none,
  grade: none,
  teacher: none,
  lang: auto,
  paper: "a4",
  body,
) = _template(
  body,
  title: title,
  subtitle: subtitle,
  meta: (subject, grade, teacher),
  lang: lang,
  paper: paper,
)
