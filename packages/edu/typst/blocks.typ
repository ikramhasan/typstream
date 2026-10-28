// Teaching content: callouts, instructions, learning objectives, rubrics, student fields.
#import "util.typ": _array, _el, _html, _rule, _tight
#import "i18n.typ": _field-label, _start-side, _word, _words

#let _kinds = (
  note: rgb("#2563eb"),
  tip: rgb("#15803d"),
  warning: rgb("#c2410c"),
  definition: rgb("#7c3aed"),
  example: rgb("#0f766e"),
  remember: rgb("#b45309"),
)

// A thin frame with its label set into the top edge on the starting side, like a fieldset's
// legend: it groups without filling the page with colour, and it prints in black and white.
#let _framed(color, label, body) = context {
  let side = _start-side()
  // Less than the frame's look suggests: the first line box holds 0.4em above the capitals, the last 0.25em below
  // the baseline (the engine's layout profile, #129).
  let inset = (x: 11pt, top: if label == none { 4.6pt } else { 6.6pt }, bottom: 6.3pt)
  // The label's box covers the stroke in the page's colour.
  let paper = if page.fill in (auto, none) { white } else { page.fill }
  block(
    width: 100%,
    above: if label == none { 0.46em } else { 0.96em },
    below: 0.46em,
    inset: inset,
    stroke: 0.8pt + color,
    radius: 4pt,
    {
      if label != none {
        let tab = box(fill: paper, inset: (x: 4pt, y: 1pt), _tight(label))
        // Centred on the stroke: half the label's height above the frame's top edge.
        let h = measure(tab).height
        let (align, dx) = if side == "left" { (left, -4pt) } else { (right, 4pt) }
        place(top + align, dx: dx, dy: -inset.top - h / 2, tab)
      }
      body
    },
  )
}

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

// A table cell's body, hyphenated if one of its words is wider than the column. Typst breaks a
// line only at a space unless it may hyphenate, and hyphenation is off in ragged text, so a word
// such as "Counterargument" in a narrow column would run into the next one. Cells whose words fit
// keep their line breaks: hyphenating every cell would split words that fit on the next line.
#let _fit-words(body) = layout(size => {
  // The widest word: the body with every space a line break.
  let widest = measure({
    show regex("\s+"): linebreak()
    show [ ].func(): linebreak()
    body
  }).width
  if widest > size.width { text(hyphenate: true, body) } else { body }
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
    set text(size: 0.9em)
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
