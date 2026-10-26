// Drawings worksheets need: number lines, graph paper, coordinate planes. Native shapes, so they
// need no package; in HTML each is one inline SVG (`html.frame`) with a description for screen
// readers. They run left to right in every language, as in printed maths in Arabic and Bengali.
#import "util.typ": _array, _drawing, _faint, _length, _pairs, _rule

/// A number as a label: whole floats without ".0", and a real minus sign.
#let _num(v) = {
  let v = if type(v) == float { calc.round(v, digits: 6) } else { v }
  if type(v) == float and v == calc.round(v) { str(int(v)) } else { str(v) }
}

/// A label centred on a point, given in the drawing's coordinates.
#let _label-at(x, y, body, size: 0.8em) = place(top + left, dx: x - 1.5cm, dy: y, box(width: 3cm, align(
  center,
  text(size: size, body),
)))

#let _dot(x, y, open: false, r: 3pt) = place(top + left, dx: x - r, dy: y - r, circle(
  radius: r,
  fill: if open { white } else { black },
  stroke: if open { 1pt + black } else { none },
))

/// A horizontal arrowhead at (x, y), pointing right (`dir: 1`) or left (`dir: -1`).
#let _arrow-x(x, y, dir: 1) = place(top + left, polygon(
  fill: black,
  (x, y),
  (x - dir * 6pt, y - 3pt),
  (x - dir * 6pt, y + 3pt),
))

/// A vertical arrowhead at (x, y), pointing up.
#let _arrow-up(x, y) = place(top + left, polygon(fill: black, (x, y), (x - 3pt, y + 6pt), (x + 3pt, y + 6pt)))

/// A number line with ticks every `step`, numbered, with arrows at both ends. Mark answers or
/// examples with filled `points` and hollow `open-points` (as in inequalities), and name values
/// with `marks`.
///
/// - from (int, float): Leftmost value.
/// - to (int, float): Rightmost value.
/// - step (int, float): Distance between ticks.
/// - length (length): Length of the line.
/// - labels (auto, none, array): Which ticks are numbered. `auto` numbers every tick (every 5th or
///   10th on long lines); `none` numbers none, for students to fill in; an array lists values,
///   or `(value, label)` pairs such as `(0.5, $1/2$)`.
/// - points (array): Values marked with a filled dot.
/// - open-points (array): Values marked with a hollow dot.
/// - marks (array): `(value, label)` pairs written above the line.
///
/// ```example
/// #number-line(from: -5, to: 5, points: (2,), open-points: (-1,), marks: ((2, [A]),))
/// ```
#let number-line(
  from: 0,
  to: 10,
  step: 1,
  length: 12cm,
  labels: auto,
  points: (),
  open-points: (),
  marks: (),
) = context {
  if to <= from or step <= 0 { return }
  let number(v) = type(v) in (int, float)
  let points = _array(points).filter(number)
  let open-points = _array(open-points).filter(number)
  let marks = _pairs(marks).filter(m => m.len() > 0 and number(m.at(0))).map(m => (m.at(0), m.at(1, default: none)))
  let count = calc.min(int(calc.floor((to - from) / step + 1e-9)), 400)
  let length = _length(length, 12cm).to-absolute()
  let pad = 0.7cm
  let x(v) = pad + (v - from) / (to - from) * length
  let y = 0.9cm
  let value(i) = from + i * step
  let every = if count <= 20 { 1 } else if count <= 60 { 5 } else { 10 }
  // Labels as (value, content) pairs.
  let labelled = if labels == none { () } else if labels == auto {
    range(count + 1).filter(i => calc.rem(i, every) == 0).map(i => (value(i), _num(value(i))))
  } else {
    _array(labels)
      .map(l => if type(l) == array { (l.at(0, default: none), l.at(1, default: none)) } else { (l, none) })
      .filter(((v, _)) => number(v))
      .map(((v, l)) => (v, if l == none { _num(v) } else { l }))
  }
  let description = (
    "Number line from " + _num(from) + " to " + _num(to) + ", step " + _num(step)
      + if points.len() > 0 { "; points at " + points.map(_num).join(", ") } else { "" }
      + if open-points.len() > 0 { "; open points at " + open-points.map(_num).join(", ") } else { "" }
  )
  let drawing = box(width: length + 2 * pad, height: 1.6cm, {
    place(top + left, line(start: (0.15cm, y), end: (length + 2 * pad - 0.15cm, y), stroke: 0.8pt))
    _arrow-x(length + 2 * pad - 0.1cm, y)
    _arrow-x(0.1cm, y, dir: -1)
    for i in range(count + 1) {
      let tall = labels == auto and calc.rem(i, every) == 0
      place(top + left, line(start: (x(value(i)), y - 4pt), end: (x(value(i)), y + if tall { 5pt } else { 4pt }), stroke: 0.6pt))
    }
    for (v, l) in labelled { _label-at(x(v), y + 7pt, l) }
    for (v, l) in marks {
      place(top + left, line(start: (x(v), y - 6pt), end: (x(v), y + 6pt), stroke: 1.2pt))
      if l != none { _label-at(x(v), y - 22pt, l, size: 0.9em) }
    }
    for v in points { _dot(x(v), y) }
    for v in open-points { _dot(x(v), y, open: true) }
  })
  block(above: 1em, below: 1em, _drawing(drawing, label: description))
}

/// Squared paper for drawing graphs, shapes or bar charts, with a darker line every `major` squares.
///
/// - cols (int): Squares across.
/// - rows (int): Squares down.
/// - step (length): Side of a square.
/// - major (int, none): Darker line every this many squares; `none` for none.
///
/// ```example
/// #graph-paper(cols: 20, rows: 8)
/// ```
#let graph-paper(cols: 30, rows: 10, step: 5mm, major: 5) = context {
  let cols = if type(cols) == int { calc.clamp(cols, 1, 200) } else { 30 }
  let rows = if type(rows) == int { calc.clamp(rows, 1, 200) } else { 10 }
  let step = _length(step, 5mm).to-absolute()
  let w = cols * step
  let h = rows * step
  let stroke(i, last) = if i == 0 or i == last or (major != none and calc.rem(i, major) == 0) { 0.6pt + _rule } else {
    0.3pt + _faint
  }
  let drawing = box(width: w, height: h, {
    for i in range(cols + 1) { place(top + left, line(start: (i * step, 0pt), end: (i * step, h), stroke: stroke(i, cols))) }
    for j in range(rows + 1) { place(top + left, line(start: (0pt, j * step), end: (w, j * step), stroke: stroke(j, rows))) }
  })
  block(above: 1em, below: 1em, _drawing(drawing, label: "Graph paper, " + str(cols) + " by " + str(rows) + " squares"))
}

/// A coordinate plane on a square grid, with numbered x and y axes. Plot `points` as `(x, y)` or
/// `(x, y, label)`.
///
/// - x (array): The x range, `(min, max)`.
/// - y (array): The y range, `(min, max)`.
/// - unit (length): Size of one unit.
/// - grid (bool): Draw grid lines.
/// - labels (bool): Number the axes.
/// - points (array): Points to plot.
///
/// ```example
/// #coordinate-plane(x: (-4, 4), y: (-3, 3), points: ((1, 2, [A]), (-3, -1, [B])))
/// ```
#let coordinate-plane(x: (-5, 5), y: (-5, 5), unit: 7mm, grid: true, labels: true, points: ()) = context {
  let (x, y) = (_array(x), _array(y))
  let (x0, x1) = (int(x.at(0, default: -5)), int(x.at(1, default: 5)))
  let (y0, y1) = (int(y.at(0, default: -5)), int(y.at(1, default: 5)))
  if x1 <= x0 or y1 <= y0 { return }
  // A point still being typed, `(1,)`, has no y yet.
  let points = _pairs(points).filter(p => p.len() >= 2 and p.slice(0, 2).all(v => type(v) in (int, float)))
  // Keep a runaway range from drawing thousands of lines.
  let (x0, x1, y0, y1) = (calc.max(x0, x1 - 60), x1, calc.max(y0, y1 - 60), y1)
  let u = _length(unit, 7mm).to-absolute()
  let pad = 0.8cm
  let px(v) = pad + (v - x0) * u
  let py(v) = pad + (y1 - v) * u
  let w = (x1 - x0) * u + 2 * pad
  let h = (y1 - y0) * u + 2 * pad
  // The axes cross at the origin, or at the nearest edge when 0 is out of range.
  let ox = px(calc.clamp(0, x0, x1))
  let oy = py(calc.clamp(0, y0, y1))
  let every(span) = if span <= 14 { 1 } else if span <= 30 { 2 } else { 5 }
  let description = (
    "Coordinate plane, x from " + str(x0) + " to " + str(x1) + ", y from " + str(y0) + " to " + str(y1)
      + if points.len() > 0 {
        "; points " + points.map(p => "(" + _num(p.at(0)) + ", " + _num(p.at(1)) + ")").join(", ")
      } else { "" }
  )
  let drawing = box(width: w, height: h, {
    if grid {
      for i in range(x0, x1 + 1) { place(top + left, line(start: (px(i), py(y1)), end: (px(i), py(y0)), stroke: 0.3pt + _faint)) }
      for j in range(y0, y1 + 1) { place(top + left, line(start: (px(x0), py(j)), end: (px(x1), py(j)), stroke: 0.3pt + _faint)) }
    }
    place(top + left, line(start: (px(x0) - 0.4cm, oy), end: (px(x1) + 0.5cm, oy), stroke: 0.8pt))
    place(top + left, line(start: (ox, py(y0) + 0.4cm), end: (ox, py(y1) - 0.5cm), stroke: 0.8pt))
    _arrow-x(px(x1) + 0.55cm, oy)
    _arrow-up(ox, py(y1) - 0.55cm)
    _label-at(px(x1) + 0.55cm, oy + 3pt, text(style: "italic")[x])
    place(top + left, dx: ox + 5pt, dy: py(y1) - 0.75cm, text(size: 0.8em, style: "italic")[y])
    if labels {
      for i in range(x0, x1 + 1) {
        if i != 0 and calc.rem(i, every(x1 - x0)) == 0 {
          place(top + left, line(start: (px(i), oy - 2pt), end: (px(i), oy + 2pt), stroke: 0.6pt))
          _label-at(px(i), oy + 4pt, _num(i), size: 0.7em)
        }
      }
      for j in range(y0, y1 + 1) {
        if j != 0 and calc.rem(j, every(y1 - y0)) == 0 {
          place(top + left, line(start: (ox - 2pt, py(j)), end: (ox + 2pt, py(j)), stroke: 0.6pt))
          place(top + left, dx: ox - 1.05cm, dy: py(j) - 0.5em, box(width: 1cm, align(right, text(size: 0.7em, _num(j)))))
        }
      }
      if x0 <= 0 and 0 <= x1 and y0 <= 0 and 0 <= y1 {
        place(top + left, dx: ox - 1.05cm, dy: oy + 2pt, box(width: 1cm, align(right, text(size: 0.7em, "0"))))
      }
    }
    for p in points {
      _dot(px(p.at(0)), py(p.at(1)), r: 2.2pt)
      if p.len() > 2 { place(top + left, dx: px(p.at(0)) + 4pt, dy: py(p.at(1)) - 1.15em, text(size: 0.85em, p.at(2))) }
    }
  })
  block(above: 1em, below: 1em, _drawing(drawing, label: description))
}
