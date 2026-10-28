// Teaching content: callouts, instructions, learning objectives, rubrics, student fields.
#import "util.typ": _array, _el, _half, _html, _rule
#import "i18n.typ": _field-label, _word, _words

#let _kinds = (
  note: rgb("#2563eb"),
  tip: rgb("#15803d"),
  warning: rgb("#c2410c"),
  definition: rgb("#7c3aed"),
  example: rgb("#0f766e"),
  remember: rgb("#b45309"),
)

// A thin square frame with its title on the first line (#130). A DOCX export writes it as a one-cell table, which
// Word can draw: square corners, a border on every side, a cell margin. The title rode on the top edge before, which
// Word can't place. It doesn't break across pages, as the table's row doesn't. It prints in black and white.
#let _framed(color, title, body) = block(
  width: 100%,
  above: 0.46em,
  below: 0.46em,
  // The first line box holds 0.4em above the capitals, the last 0.25em below the baseline (the engine's layout
  // profile, #129): the inset looks even on both.
  inset: (x: 10pt, top: 4pt, bottom: 5.5pt),
  stroke: 0.8pt + color,
  breakable: false,
  {
    if title != none { block(below: 0.4em, title) }
    body
  },
)

/// A highlighted box for a note, tip, warning, definition, worked example or something to
/// remember. Its title defaults to the kind's name in the document's language.
///
/// - kind (str): One of "note", "tip", "warning", "definition", "example", "remember".
/// - title (content, auto, none): The box's title.
///
/// ```example
/// #callout(kind: "definition")[A *prime number* has exactly two factors: 1 and itself.]
/// ```
#let callout(kind: "note", title: auto, body) = {
  let kind = if kind in _kinds { kind } else { "note" }
  let color = _kinds.at(kind)
  context {
    let title = if title == auto { _word(kind) } else { title }
    if _html() {
      _el("aside", ("edu-callout", "edu-" + kind), role: "note", {
        if title != none { _el("div", "edu-callout-title", title) }
        body
      })
    } else {
      _framed(color, if title != none { text(weight: "bold", fill: color, title) }, body)
    }
  }
}

/// Instructions for students, in a framed box titled "Instructions" in the document's language.
///
/// ```example
/// #instructions[
///   - Answer *all* questions.
///   - Show your working.
/// ]
/// ```
#let instructions(body) = context {
  if _html() {
    _el("aside", ("edu-callout", "edu-instructions"), role: "note", {
      _el("div", "edu-callout-title", _word("instructions"))
      body
    })
  } else {
    _framed(_rule, strong(_word("instructions")), body)
  }
}

/// What students will learn, as a titled box. Write the objectives as a list.
///
/// ```example
/// #learning-objectives[
///   - Describe the stages of the water cycle.
///   - Explain how the Sun drives evaporation.
/// ]
/// ```
#let learning-objectives(body) = callout(kind: "tip", title: context _word("objectives"), body)

// A table cell's body, in smaller text if one of its words is wider than the column. Typst breaks a line only at a
// space, and the engine's layout profile turns hyphenation off (#129), so a word such as "Counterargument" in a narrow
// column would run into the next one, where Word would break it mid-word. The text shrinks, in half points as Word
// sets it, until the widest word fits; cells whose words fit keep their size.
#let _fit-words(body) = layout(size => {
  // The widest word: the body with every space a line break.
  let widest = measure({
    show regex("\s+"): linebreak()
    show [ ].func(): linebreak()
    body
  }).width
  if widest <= size.width { return body }
  set text(size: calc.max(5pt, calc.floor(text.size.to-absolute() / 0.5pt * size.width / widest) * 0.5pt))
  body
})

/// A grading rubric: one row per criterion, one column per level. Give each criterion as
/// `(name, description for the first level, the next level, …)`.
///
/// - levels (array, auto): Level names, best first. `auto`: four levels named in the document's language.
/// - points (array, auto, none): Points per level. `auto` counts down to 1; `none` hides them.
///
/// ```example
/// #rubric(
///   ([Thesis], [Clear and arguable.], [Clear.], [Vague.], [Missing.]),
///   ([Evidence], [Strong, cited.], [Relevant.], [Thin.], [None.]),
/// )
/// ```
#let rubric(..criteria, levels: auto, points: auto) = context {
  let criteria = criteria.pos().map(c => if type(c) == array { c } else { (c,) })
  let levels = if levels == auto { _words.at(text.lang, default: _words.en).levels } else { _array(levels) }
  let n = levels.len()
  let points = if points == auto { range(n, 0, step: -1) } else if points != none { _array(points) }
  let head(i) = if points == none { levels.at(i) } else { [#levels.at(i) (#points.at(i, default: ""))] }
  let cells(c) = range(n).map(i => c.at(i + 1, default: []))
  if _html() {
    _el("table", "edu-rubric", {
      html.elem("thead", html.elem("tr", {
        html.elem("th", attrs: (scope: "col"), _word("criteria"))
        for i in range(n) { html.elem("th", attrs: (scope: "col"), head(i)) }
      }))
      html.elem("tbody", for c in criteria {
        html.elem("tr", {
          html.elem("th", attrs: (scope: "row"), c.at(0, default: []))
          for cell in cells(c) { html.elem("td", cell) }
        })
      })
    })
  } else {
    set text(size: _half(0.9))
    table(
      columns: (1.1fr,) + (1fr,) * n,
      inset: 6pt,
      stroke: 0.5pt + _rule,
      fill: (x, y) => if y == 0 { luma(235) } else if x == 0 { luma(248) },
      table.header(..(strong(_word("criteria")), ..range(n).map(i => strong(head(i)))).map(_fit-words)),
      ..criteria.map(c => (strong(c.at(0, default: [])), ..cells(c)).map(_fit-words)).flatten(),
    )
  }
}

/// Lines for students to write their name, the date, their class, and so on. Known fields are
/// "name", "date", "class", "section", "roll", "score" and "teacher", labelled in the document's
/// language; any other text is used as its own label. The name field gets the most room.
///
/// ```example
/// #student-info("name", "class", "roll")
/// ```
#let student-info(..fields) = context {
  let fields = if fields.pos().len() == 0 { ("name", "date", "class") } else { fields.pos() }
  if _html() {
    _el("div", "edu-info", for f in fields {
      _el("span", "edu-field", [#_field-label(f):#_el("span", "edu-blank", [ ])])
    })
  } else {
    let width(f) = if f == "name" { 2.2fr } else { 1fr }
    block(above: 0.36em, below: 0.36em, grid(
      columns: fields.map(f => (auto, width(f))).flatten(),
      // Tight between a label and its line, wider between fields.
      column-gutter: range(fields.len() * 2 - 1).map(i => if calc.even(i) { 0.4em } else { 1.2em }),
      // A line's cell holds no text, so at the top it would sit level with the middle of its label. At the
      // bottom, it meets the label's baseline (where a text line's frame ends) and its stroke falls 0.25em
      // below, as a blank's does in a sentence.
      align: bottom,
      ..fields
        .map(f => (
          [#_field-label(f):],
          box(width: 100%, stroke: (bottom: 0.5pt + _rule), outset: (bottom: 0.25em), h(1fr)),
        ))
        .flatten(),
    ))
  }
}
