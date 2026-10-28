// Answer spaces and answers. Answers appear only when the input `showAnswers` is "true":
// written into the space in the accent color, and listed by `answer-key()`.
#import "util.typ": _accent, _answers-shown, _css, _el, _half, _html, _length, _question, _rule, _tight
#import "i18n.typ": _start-side, _word

/// Records an answer for `answer-key()`, under the question it is in.
#let _record(kind, value) = [#metadata((kind: kind, value: value)) <edu-answer>]

/// An inline blank to fill in, e.g. in a sentence or after an equals sign. When answers are shown,
/// the answer is written on it.
///
/// - width (length): Width of the line. It grows to fit a shown answer.
/// - answer (content, none): The expected answer.
///
/// ```example
/// Water boils at #blank(answer: [100]) °C at sea level.
/// ```
#let blank(width: 4em, answer: none) = {
  if answer != none { _record("blank", answer) }
  let width = _length(width, 4em)
  let shown = _answers-shown and answer != none
  context if _html() {
    _el("span", "edu-blank", if shown { _el("span", "edu-ink", answer) } else { [ ] }, style: "min-width: " + _css(width))
  } else {
    let body = if shown { text(fill: _accent, answer) } else { none }
    let w = if shown { calc.max(width.to-absolute(), measure(body).width + 0.6em.to-absolute()) } else { width }
    box(width: w, stroke: (bottom: 0.5pt + _rule), outset: (bottom: 0.25em), inset: (x: 0.3em), _tight(align(center, body)))
  }
}

/// Ruled lines for a written answer of a sentence or more, across the full width.
///
/// - count (int): Number of lines.
/// - spacing (length): Distance between lines.
/// - answer (content, none): A model answer, written on the lines when answers are shown.
///
/// ```example
/// Explain why the Moon has phases.
/// #answer-lines(count: 3, answer: [We see different parts of its sunlit half as it orbits Earth.])
/// ```
#let answer-lines(count: 3, spacing: 2em, answer: none) = {
  if answer != none { _record("lines", answer) }
  let spacing = _length(spacing, 2em)
  let count = if type(count) == int { calc.clamp(count, 0, 200) } else { 3 }
  let shown = _answers-shown and answer != none
  context if _html() {
    _el(
      "div",
      "edu-lines",
      if shown { _el("span", "edu-ink", answer) } else { none },
      style: "min-height: " + _css(spacing * count) + "; --edu-line: " + _css(spacing),
    )
  } else {
    // One block per line, a pitch tall with the rule at its bottom: a DOCX export writes each as an empty paragraph
    // at exact line spacing with a bottom border (#130). Each sticks to the next, as Word's "keep with next" keeps
    // the paragraphs together on a page when they fit.
    let pitch = spacing.to-absolute()
    let rule(last) = block(width: 100%, height: pitch, above: 0pt, below: 0pt, sticky: not last, stroke: (
      bottom: 0.4pt + _rule,
    ))
    block(above: 0.8em, below: 0.8em, layout(size => {
      let written = 0
      if shown {
        // The answer at the lines' pitch, a line box per line with its baseline 0.246em above the bottom, where the
        // rules would be. Word draws a paragraph's border under its last line only, so the answer's lines have no
        // rules: the ones it leaves follow it. Show-set rules win over the engine's layout profile (#129).
        let lines = {
          set text(fill: _accent)
          show text: set text(top-edge: pitch - 0.246em, bottom-edge: -0.246em)
          show par: set par(leading: 0pt)
          block(width: 100%, above: 0pt, below: 0pt, sticky: count > 0, pad(x: 0.3em, answer))
        }
        written = calc.ceil(measure(block(width: size.width, lines)).height / pitch - 0.001)
        lines
      }
      for i in range(written, count) { rule(i == count - 1) }
    }))
  }
}

/// Empty space for working, a drawing or a calculation.
///
/// - height (length): Height of the space. It grows to fit a shown answer.
/// - boxed (bool): Draw a frame around the space.
/// - answer (content, none): A worked answer, written in the space when answers are shown.
///
/// ```example
/// Solve $3x + 4 = 19$. Show your working.
/// #answer-space(height: 5em, answer: [$3x = 15$, so $x = 5$.])
/// ```
#let answer-space(height: 4em, boxed: false, answer: none) = {
  if answer != none { _record("space", answer) }
  let height = _length(height, 4em)
  let shown = _answers-shown and answer != none
  let stroke = if boxed { 0.5pt + _rule } else { none }
  context if _html() {
    _el(
      "div",
      if boxed { ("edu-space", "edu-boxed") } else { "edu-space" },
      if shown { _el("div", "edu-ink", answer) } else { none },
      style: "min-height: " + _css(height),
    )
  } else if shown {
    // Unbreakable, as the one-cell table a DOCX export writes for it stays on one page (#130).
    layout(size => {
      let inner = block(width: size.width, inset: 6pt, text(fill: _accent, answer))
      let tall = calc.max(height.to-absolute(), measure(inner).height)
      block(width: 100%, height: tall, stroke: stroke, breakable: false, inner)
    })
  } else {
    block(width: 100%, height: height, stroke: stroke, breakable: false)
  }
}

/// A worked solution or explanation, shown only when answers are shown. Use it for anything a
/// teacher's copy should add: full solutions, marking notes, expected points.
///
/// ```example
/// #answer[The ratio is $3 : 4$ because both sides divide by 5.]
/// ```
#let answer(body) = {
  _record("answer", body)
  if _answers-shown { context if _html() {
    _el("div", "edu-answer", [#_el("span", "edu-answer-label", _word("answer") + ":") #body])
  } else {
    let side = _start-side()
    // A DOCX export writes it as paragraphs with a border on the starting side and shading (#130). Paragraph borders
    // have no room above or below the text, and break across pages as the paragraphs do: no inset there.
    block(
      width: 100%,
      inset: (x: 8pt),
      fill: _accent.lighten(92%),
      stroke: ((side): 2pt + _accent),
      text(fill: _accent)[*#_word("answer"):* #body],
    )
  } }
}

/// The answers to every question, by question number, for a key at the end of the document.
/// Like every answer it appears only when answers are shown, so it is safe in a student's copy.
///
/// - title (content, auto): Heading of the key. `auto` is "Answer key" in the document's language.
///
/// ```example
/// #answer-key()
/// ```
#let answer-key(title: auto) = {
  if not _answers-shown { return }
  context {
    let entries = query(<edu-answer>)
    if entries.len() == 0 { return }
    let heading-text = if title == auto { _word("answer-key") } else { title }
    // Group answers under their question's number, in document order; 0 is outside any question.
    let groups = ()
    for e in entries {
      let n = _question.at(e.location()).first()
      if groups.len() > 0 and groups.last().at(0) == n { groups.at(-1).at(1).push(e.value.value) } else {
        groups.push((n, (e.value.value,)))
      }
    }
    let items = groups.map(((n, values)) => {
      let body = values.join([; ])
      if n == 0 { body } else { [*#numbering("1.", n)* #body] }
    })
    if _html() {
      _el("section", "edu-key", {
        html.elem("h2", heading-text)
        for item in items { html.elem("p", item) }
      })
    } else {
      block(width: 100%, above: 0.86em, {
        text(weight: "bold", size: _half(1.2), heading-text)
        set text(fill: _accent)
        for item in items { block(above: 0.06em, item) }
      })
    }
  }
}
