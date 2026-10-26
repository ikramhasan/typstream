// Questions: numbered questions with points, multiple choice, true/false, matching.
#import "util.typ": _accent, _answers-shown, _config, _el, _html, _plain, _question, _rule
#import "i18n.typ": _letter, _letter-pattern, _points-text, _word
#import "answers.typ": _record

/// A numbered question. Numbers run through the whole document; points, when given, appear at
/// the end of the line and count towards the template's total. Put the question's answer space
/// (`blank`, `answer-lines`, `mcq`, …) inside it. Sub-parts are a numbered list (`+ …`), lettered
/// `(a)`, `(b)`, ….
///
/// - points (int, none): Points the question is worth.
///
/// ```example
/// #question(points: 2)[
///   What is $3/4$ of 20?
///   #answer-space(height: 3em, answer: [15])
/// ]
/// ```
#let question(points: none, body) = {
  _question.step()
  if points != none { [#metadata(points) <edu-points>] }
  context {
    let n = numbering("1.", _question.get().first())
    let pts = if points != none { [(#_points-text(points, word: _config.get().points-label))] }
    set enum(numbering: _letter-pattern())
    if _html() {
      _el("div", "edu-question", {
        _el("span", "edu-number", n)
        _el("div", "edu-body", body)
        if pts != none { _el("span", "edu-points", pts) }
      })
    } else {
      block(width: 100%, above: 1.4em, below: 1.4em, grid(
        columns: (2em, 1fr, auto),
        column-gutter: 0.4em,
        strong(n),
        body,
        if pts != none { text(size: 0.85em, fill: _rule, pts) },
      ))
    }
  }
}

/// The 1-based indices an `answer` names: `2`, `(1, 3)` or a letter such as `"b"`.
#let _choices(answer) = {
  if answer == none { return () }
  let index(a) = if type(a) == int { a } else if type(a) == str {
    let letter = lower(a.trim().trim("(").trim(")"))
    let i = if letter.len() == 1 { "abcdefghijklmnopqrstuvwxyz".position(letter) }
    if i == none { none } else { i + 1 }
  } else { none }
  (if type(answer) == array { answer } else { (answer,) }).map(index).filter(i => i != none)
}

/// A choice marker, circled in the accent color when it is a shown answer.
#let _marker(m, correct) = if correct {
  box(stroke: 0.7pt + _accent, radius: 0.6em, inset: (x: 0.2em), outset: (y: 0.15em), text(fill: _accent, m))
} else { m }

/// Multiple-choice options, lettered (a), (b), … in the document's language. Give each option as
/// its own content argument. `answer` is the correct option's number, counting from 1, or an
/// array of numbers when several are correct.
///
/// - answer (int, array, none): The correct option(s), 1-based.
/// - columns (int, auto): Options per row. `auto` fits short options on one or two rows.
///
/// ```example
/// #question(points: 1)[
///   Which planet is closest to the Sun?
///   #mcq([Venus], [Mercury], [Mars], [Earth], answer: 2)
/// ]
/// ```
#let mcq(..options, answer: none, columns: auto) = {
  let options = options.pos()
  if options.len() == 0 { return }
  let picks = _choices(answer)
  if picks.len() > 0 { _record("mcq", context picks.map(_letter).join(", ")) }
  let shown = _answers-shown
  let cols = if columns != auto { columns } else {
    let longest = calc.max(..options.map(o => _plain(o).clusters().len()))
    if longest <= 12 { calc.min(options.len(), 4) } else if longest <= 30 { calc.min(options.len(), 2) } else { 1 }
  }
  context {
    let pattern = _letter-pattern()
    if _html() {
      _el("ol", ("edu-mcq", "edu-cols-" + str(cols)), for (i, o) in options.enumerate() {
        let correct = shown and (i + 1) in picks
        _el("li", if correct { "edu-correct" }, {
          _el("span", "edu-marker", numbering(pattern, i + 1))
          [ ]
          o
        })
      })
    } else {
      block(above: 0.8em, below: 0.8em, grid(
        columns: (1fr,) * cols,
        column-gutter: 1em,
        row-gutter: 0.75em,
        ..options
          .enumerate()
          .map(((i, o)) => {
            let correct = shown and (i + 1) in picks
            grid(
              columns: (auto, 1fr),
              column-gutter: 0.45em,
              _marker(numbering(pattern, i + 1), correct),
              if correct { text(fill: _accent, o) } else { o },
            )
          }),
      ))
    }
  }
}

/// A statement to mark true or false.
///
/// - answer (bool, none): Whether the statement is true.
///
/// ```example
/// #true-false(answer: false)[The Sun orbits the Earth.]
/// ```
#let true-false(answer: none, body) = {
  let value = if type(answer) == str { lower(answer) in ("true", "t", "yes") } else { answer }
  if value != none { _record("true-false", context _word(if value { "true" } else { "false" })) }
  let shown = _answers-shown and value != none
  context {
    let choice(key) = (key, shown and value == (key == "true"))
    let choices = (choice("true"), choice("false"))
    if _html() {
      _el("div", "edu-tf", {
        _el("span", "edu-tf-statement", body)
        _el("span", "edu-tf-choices", for (key, correct) in choices {
          _el("span", if correct { ("edu-choice", "edu-correct") } else { "edu-choice" }, _word(key))
        })
      })
    } else {
      block(above: 0.7em, below: 0.7em, grid(
        columns: (1fr, auto),
        column-gutter: 1em,
        body,
        choices.map(((key, correct)) => _marker(_word(key), correct)).join(h(1em)),
      ))
    }
  }
}

/// A small, stable hash of text, to shuffle matching columns the same way on every compile.
#let _hash(s) = s.codepoints().fold(7, (h, c) => calc.rem(h * 31 + str.to-unicode(c), 1000003))

/// Two columns to match: give the correct pairs, each as `(left, right)`. The right column is
/// shuffled (the same way every time) and the key is worked out from the pairs, so write them
/// in their natural order, correctly matched.
///
/// ```example
/// #matching(
///   ([perro], [dog]),
///   ([gato], [cat]),
///   ([pájaro], [bird]),
/// )
/// ```
#let matching(..pairs) = {
  let pairs = pairs.pos().map(p => if type(p) == array { (p.at(0, default: []), p.at(1, default: [])) } else { (p, []) })
  let n = pairs.len()
  if n == 0 { return }
  // Shuffle the right column by a hash of its text, then rotate it to leave as few pairs as
  // possible side by side (the first rotation with the fewest wins, so it's deterministic).
  let sorted = range(n).sorted(key: i => (_hash(_plain(pairs.at(i).at(1))), i))
  let rotations = range(n).map(r => sorted.slice(r) + sorted.slice(0, r))
  let fixed(o) = range(n).filter(i => o.at(i) == i).len()
  let order = rotations.sorted(key: fixed).first()
  // position-of.at(i): where the match of left item i sits in the right column.
  let position-of = range(n).map(i => order.position(j => j == i))
  _record("matching", context range(n).map(i => [#(i + 1)–#_letter(position-of.at(i) + 1)]).join(", "))
  let shown = _answers-shown
  context {
    let pattern = _letter-pattern()
    let rows = range(n).map(i => {
      let letter = if shown { text(fill: _accent, _letter(position-of.at(i) + 1)) } else { none }
      (
        [#(i + 1).],
        pairs.at(i).at(0),
        letter,
        numbering(pattern, i + 1),
        pairs.at(order.at(i)).at(1),
      )
    })
    if _html() {
      _el("div", "edu-matching", for row in rows {
        _el("span", "edu-number", row.at(0))
        _el("span", none, row.at(1))
        _el("span", "edu-blank", if row.at(2) == none { [ ] } else { _el("span", "edu-ink", row.at(2)) })
        _el("span", "edu-marker", row.at(3))
        _el("span", none, row.at(4))
      })
    } else {
      block(above: 0.8em, below: 0.8em, grid(
        columns: (auto, 1fr, 2.5em, auto, 1fr),
        column-gutter: 0.6em,
        row-gutter: 0.9em,
        ..rows
          .map(row => (
            row.at(0),
            row.at(1),
            box(width: 100%, stroke: (bottom: 0.5pt + _rule), outset: (bottom: 0.25em), align(center, row.at(2))),
            row.at(3),
            row.at(4),
          ))
          .flatten(),
      ))
    }
  }
}
