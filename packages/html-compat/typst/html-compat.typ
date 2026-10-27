// html-compat: makes Typst 0.15.1's HTML export lose no content.
//
// The HTML export drops layout elements it can't express ("grid was ignored
// during HTML export"), and with them the text inside. These show rules map
// each one to HTML styled by html-compat.css (classes prefixed `ts-`), or to an
// inline SVG (`html.frame`) where the element is a drawing. Coverage matrix and
// decisions: PLAN.md §6.5, issue #15.
//
// Usage, before the document:
//
//   #import "/@typstream/html-compat.typ": html-compat, layout
//   #show: html-compat
//
// Every rule acts only when `target()` is "html". Inside `html.frame` the
// target is "paged", so framed content lays out as usual, and paged output is
// the same with or without this file.

/// The width `layout` reports in HTML, where there is no page: the text width of
/// a default A4 page (21 cm minus 2 × 2.5 cm margins). Height likewise.
#let compat-size = (width: 453.54pt, height: 700.16pt)

// ---------------------------------------------------------------------------
// Values → CSS

// str() writes negative numbers with U+2212; CSS needs a hyphen-minus.
#let _num(x) = str(calc.round(float(x), digits: 3)).replace("\u{2212}", "-")

/// A length, ratio or relative length as CSS; `none` for `auto`, `none` and fractions.
#let _len(l) = {
  if type(l) == length {
    let (pt, em) = (l.abs.pt(), l.em)
    if em == 0 { _num(pt) + "pt" } else if pt == 0 { _num(em) + "em" } else {
      "calc(" + _num(pt) + "pt + " + _num(em) + "em)"
    }
  } else if type(l) == ratio {
    _num(float(l) * 100) + "%"
  } else if type(l) == relative {
    if l.ratio == 0% { _len(l.length) } else if l.length == 0pt { _len(l.ratio) } else {
      "calc(" + _len(l.ratio) + " + " + _len(l.length) + ")"
    }
  } else { none }
}

/// A paint as a CSS color or gradient; `none` for tilings and `none`/`auto`.
#let _paint(p, gradients: true) = {
  if type(p) == color { return p.to-hex() }
  if type(p) != gradient { return none }
  let stops = p.stops().map(((c, r)) => c.to-hex() + " " + _len(r)).join(", ")
  if not gradients { p.stops().first().first().to-hex() } else if p.kind() == gradient.linear {
    // Typst's 0deg points right, CSS's points up.
    "linear-gradient(" + _num(p.angle().deg() + 90) + "deg, " + stops + ")"
  } else if p.kind() == gradient.radial {
    "radial-gradient(" + stops + ")"
  } else {
    "conic-gradient(" + stops + ")"
  }
}

/// A stroke as a CSS border (`1pt solid #000000`), or `none`. `auto` is the given default.
#let _stroke(s, default: none) = {
  if s == auto { s = default }
  if s == none { return none }
  let s = stroke(s)
  let width = if s.thickness == auto { 1pt } else { s.thickness }
  let paint = if s.paint == auto { black } else { s.paint }
  let style = if s.dash in (auto, none) { "solid" } else if (
    type(s.dash) == dictionary and s.dash.array.contains("dot")
  ) { "dotted" } else { "dashed" }
  _len(width) + " " + style + " " + _paint(paint, gradients: false)
}

/// Expands a sides dictionary (`(x: .., top: .., rest: ..)`) or a single value to all four sides.
#let _sides(v, default: none) = {
  let sides = ("top", "right", "bottom", "left")
  if type(v) != dictionary { return sides.map(s => (s, v)).to-dict() }
  let rest = v.at("rest", default: default)
  let x = v.at("x", default: rest)
  let y = v.at("y", default: rest)
  (
    top: v.at("top", default: y),
    right: v.at("right", default: x),
    bottom: v.at("bottom", default: y),
    left: v.at("left", default: x),
  )
}

/// Expands a corner radius dictionary or single value to the four corners.
#let _corners(v) = {
  let corners = ("top-left", "top-right", "bottom-right", "bottom-left")
  if type(v) != dictionary { return corners.map(c => (c, v)).to-dict() }
  let rest = v.at("rest", default: none)
  let (top, bottom, left, right) = ("top", "bottom", "left", "right").map(k => v.at(k, default: rest))
  (
    top-left: v.at("top-left", default: if top != rest { top } else { left }),
    top-right: v.at("top-right", default: if top != rest { top } else { right }),
    bottom-right: v.at("bottom-right", default: if bottom != rest { bottom } else { right }),
    bottom-left: v.at("bottom-left", default: if bottom != rest { bottom } else { left }),
  )
}

/// `(property: value)` pairs as a `style` attribute value; `none` values are left out.
#let _css(..props) = {
  let decls = props.named().pairs().filter(((_, v)) => v != none).map(((k, v)) => k + ": " + v)
  if decls.len() == 0 { none } else { decls.join("; ") }
}

/// Four sides or corners (top/top-left first, clockwise) as one CSS shorthand value, or `none` if all are zero.
#let _shorthand(values) = {
  let css = values.map(v => if v in (none, auto) { none } else { _len(v) }).map(v => if v == none { "0pt" } else { v })
  if css.all(v => v == "0pt") { none } else if css.all(v => v == css.first()) { css.first() } else { css.join(" ") }
}

/// Fill, stroke, inset and radius of a box-like element as CSS declarations.
#let _box-props(fill: none, stroke: none, stroke-default: none, inset: none, radius: none) = {
  let props = (:)
  let bg = _paint(fill)
  if bg != none { props.insert("background", bg) }
  let strokes = _sides(stroke).pairs().map(((side, s)) => (side, _stroke(s, default: stroke-default)))
  if strokes.all(((_, s)) => s == strokes.first().last()) {
    if strokes.first().last() != none { props.insert("border", strokes.first().last()) }
  } else {
    for (side, s) in strokes { if s != none { props.insert("border-" + side, s) } }
  }
  let padding = _shorthand(_sides(inset).values())
  if padding != none { props.insert("padding", padding) }
  let radius = _shorthand(_corners(radius).values())
  if radius != none { props.insert("border-radius", radius) }
  props
}

#let _style(props) = _css(..props)

/// A container's inset per side as the custom properties `place` anchors to (`--ts-inset-left`, …;
/// html-compat.css): Typst places inside the inset, CSS against the padding box. Zero sides are left
/// to the stylesheet, which resets all four on every element a `.ts-place` positions against.
#let _inset-vars(inset) = {
  let vars = (:)
  for (side, v) in _sides(inset) {
    let css = _len(v)
    if css not in (none, "0pt", "0%") { vars.insert("--ts-inset-" + side, css) }
  }
  vars
}

// Markers for rules that must know where they are. Typst has no "am I in math" or "am I
// inline" query, so the rules that start such a region set a property that only paged
// line breaking reads (and HTML has none) to an unlikely value, readable in `context`.
#let _in-math = 100.0001%
#let _inline = 100.0001%
#let _mark-math(body) = { set text(costs: (runt: _in-math)); body }
#let _mark-inline(body) = { set text(costs: (widow: _inline)); body }

/// An HTML element with a class and an optional style; unset attributes are left out. Needs
/// context: inside an inline element (a box) a `div` would end the paragraph around it in
/// the browser's parser, so it becomes a `span` with class `ts-b` (display: block).
#let _el(tag, class, style: none, body) = {
  if tag == "div" and text.costs.widow == _inline { (tag, class) = ("span", class + " ts-b") }
  let attrs = (class: class)
  if style != none { attrs.insert("style", style) }
  html.elem(tag, attrs: attrs, if body == none { [] } else { body })
}

/// The CSS `text-align` for a horizontal alignment, or `none`.
#let _text-align(a) = {
  if a == auto or a == none { return none }
  let x = if a.axis() == "horizontal" { a } else if a.axis() == "vertical" { none } else { a.x }
  if x == none { none } else { repr(x) }
}

/// The flexbox `justify-content` for a vertical alignment (in a column), or `none`.
#let _vertical-align(a) = {
  if a == auto or a == none { return none }
  let y = if a.axis() == "vertical" { a } else if a.axis() == "horizontal" { none } else { a.y }
  if y == top or y == none { none } else if y == horizon { "center" } else { "flex-end" }
}

// ---------------------------------------------------------------------------
// Frames: drawings become inline SVG

/// The text in content, for the accessible label of a frame (SVG glyphs aren't text).
#let _plain(c) = {
  if type(c) == str { return c }
  if type(c) == array { return c.map(_plain).join() }
  if type(c) != content { return "" }
  if c.func() in ([ ].func(), linebreak, parbreak) { return " " }
  if c.func() == math.equation { return _plain(c.body) }
  let f = c.fields()
  if "text" in f and type(f.text) == str { return f.text }
  // Supplements ("Figure", "Equation") are Typst's words, not the drawing's.
  let _ = f.remove("supplement", default: none)
  f.values().filter(v => type(v) in (content, array)).map(_plain).join(default: "")
}

/// `body` as an inline SVG, wrapped so it scales down to the container and keeps its text for screen readers.
#let _frame(body, inline: false) = {
  let label = _plain(body).trim()
  // A drawing with no text has nothing to read out: hidden, rather than an image without a name.
  let attrs = if label != "" { (class: "ts-frame", role: "img", aria-label: label) } else {
    (class: "ts-frame", aria-hidden: "true")
  }
  // Needs context, like _el: a block frame inside a box is a span too.
  let tag = if inline { "span" } else if text.costs.widow == _inline { attrs.class += " ts-b"; "span" } else { "div" }
  html.elem(tag, attrs: attrs, html.frame(body))
}

/// Whether `pred` holds for content or anything inside it.
#let _find(c, pred) = {
  if type(c) == array { return c.any(x => _find(x, pred)) }
  if type(c) != content { return false }
  if pred(c) { return true }
  c.fields().values().any(v => type(v) in (content, array) and _find(v, pred))
}

/// Whether content is only `place`d pieces (and space): a hand-made diagram, positioned
/// in absolute terms, which a picture keeps intact and CSS boxes don't.
#let _is-canvas(c) = {
  if type(c) != content { return false }
  let parts = if c.func() == [].func() and "children" in c.fields() { c.children } else { (c,) }
  let placed = parts.filter(p => p.func() == place and not p.fields().at("float", default: false))
  placed.len() > 0 and parts.all(p => p in placed or p.func() in ([ ].func(), parbreak, linebreak))
}

/// Whether content is only text: words, spaces and line breaks, styled, strong, emphasized….
/// Placed, its box is then Typst's text box, cap height to baseline (`ts-place-text`).
#let _only-text(c) = {
  if type(c) != content { return false }
  let func = c.func()
  if func in (text, [ ].func(), smartquote, linebreak) { return true }
  let f = c.fields()
  if func == [].func() { f.at("children", default: ()).all(_only-text) }
  else if "child" in f and "styles" in f { _only-text(f.child) }
  else if func in (strong, emph, underline, overline, strike, highlight, smallcaps, sub, super) { _only-text(f.body) }
  else { false }
}

// Elements that only make sense as a picture.
#let _drawings = (curve, polygon, circle, ellipse, image)

/// Whether content contains a drawing that HTML can't express (a curve, a
/// positioned `place`, a non-horizontal line …), without looking inside nested
/// blocks and boxes, which their own rules handle. CeTZ canvases are blocks of
/// `place`d paths, so they match.
#let _has-drawing(c) = {
  if type(c) != content { return false }
  let func = c.func()
  if func in (curve, polygon) { return true }
  // Content that hasn't been shown yet only has the fields that were set explicitly.
  let f = c.fields()
  if func == line and (f.at("angle", default: 0deg) != 0deg or f.at("end", default: none) != none) { return true }
  if func == place and not f.at("float", default: false) {
    return _has-drawing(c.body) or (type(c.body) == content and c.body.func() in _drawings)
  }
  if func in (block, box) { return false }
  if "children" in f { f.children.any(_has-drawing) }
  else if "body" in f { _has-drawing(f.body) }
  else if "child" in f { _has-drawing(f.child) }
  else { false }
}

// ---------------------------------------------------------------------------
// Grid: a CSS grid, with Typst's cell placement

/// Resolves a grid property that may be a single value, an array (cycled by column) or a function of `(x, y)`.
#let _per-cell(v, x, y) = {
  if type(v) == function { v(x, y) } else if type(v) == array { if v.len() == 0 { none } else { v.at(calc.rem(x, v.len())) } } else { v }
}

/// A grid track size as CSS.
#let _track(t) = {
  if t == auto { "auto" } else if type(t) == fraction { "minmax(0, " + _num(t / 1fr) + "fr)" } else { _len(t) }
}

/// Places cells like Typst's grid layout: explicit `x`/`y` first come first, the rest in
/// reading order at the next free position. Returns `(cells, hlines, vlines)`, each cell
/// with `x`, `y`, `colspan`, `rowspan` and the original `cell`.
#let _place-cells(children, ncols) = {
  let taken = (:)
  let free(x, y, cs, rs) = {
    if x + cs > ncols { return false }
    for dx in range(cs) { for dy in range(rs) { if str(x + dx) + "," + str(y + dy) in taken { return false } } }
    true
  }
  let (cells, hlines, vlines) = ((), (), ())
  let (cx, cy) = (0, 0)
  // Header and footer cells are laid out where they appear, which is first and last in practice.
  let flat = children.map(c => if "children" in c.fields() { c.children } else { (c,) }).flatten()
  for c in flat {
    let f = c.fields()
    if c.func() in (grid.hline, table.hline) {
      hlines.push((y: f.at("y", default: auto), cell: c, at: if cx == 0 { cy } else { cy + 1 }))
      continue
    }
    if c.func() in (grid.vline, table.vline) {
      vlines.push((x: f.at("x", default: auto), cell: c, at: cx))
      continue
    }
    let cs = calc.min(f.at("colspan", default: 1), ncols)
    let rs = f.at("rowspan", default: 1)
    let (x, y) = (f.at("x", default: auto), f.at("y", default: auto))
    if x != auto and y != auto {
      (cx, cy) = (cx, cy)
    } else if x != auto {
      y = cy
      while not free(x, y, cs, rs) { y += 1 }
    } else if y != auto {
      x = 0
      while not free(x, y, cs, rs) and x < ncols { x += 1 }
      if x >= ncols { x = 0 }
    } else {
      (x, y) = (cx, cy)
      while not free(x, y, cs, rs) {
        x += 1
        if x >= ncols { (x, y) = (0, y + 1) }
      }
      (cx, cy) = (x + cs, y)
      if cx >= ncols { (cx, cy) = (0, cy + 1) }
    }
    for dx in range(cs) { for dy in range(rs) { taken.insert(str(x + dx) + "," + str(y + dy), true) } }
    cells.push((x: x, y: y, colspan: cs, rowspan: rs, cell: c))
  }
  (cells, hlines, vlines)
}

#let _grid(it) = {
  let columns = if type(it.columns) == int { (auto,) * it.columns } else if it.columns.len() == 0 { (auto,) } else { it.columns }
  let rows = if type(it.rows) == int { (auto,) * it.rows } else { it.rows }
  let (cells, hlines, vlines) = _place-cells(it.children, columns.len())
  let gap(g) = if g.len() == 0 { none } else { _len(g.first()) }
  let container = _css(
    grid-template-columns: columns.map(_track).join(" "),
    grid-template-rows: if rows.len() > 0 { rows.map(_track).join(" ") },
    // Typst's auto columns take their natural width and don't stretch to fill.
    justify-content: if columns.all(t => type(t) != fraction) { "start" },
    column-gap: gap(it.column-gutter),
    row-gap: gap(it.row-gutter),
  )
  let body = for c in cells {
    let (x, y) = (c.x, c.y)
    let f = c.cell.fields()
    let pick(name) = { let v = f.at(name, default: auto); if v == auto { _per-cell(it.at(name), x, y) } else { v } }
    let stroke = pick("stroke")
    // Lines drawn with grid.hline / grid.vline become borders of the cells next to them.
    for line in hlines {
      let at = if line.y == auto { line.at } else { line.y }
      if at == y { stroke = (if type(stroke) == dictionary { stroke } else { (rest: stroke) }) + (top: line.cell.at("stroke", default: 1pt + black)) }
    }
    for line in vlines {
      let at = if line.x == auto { line.at } else { line.x }
      if at == x { stroke = (if type(stroke) == dictionary { stroke } else { (rest: stroke) }) + (left: line.cell.at("stroke", default: 1pt + black)) }
    }
    let align = pick("align")
    let props = _box-props(fill: pick("fill"), stroke: stroke, inset: pick("inset"))
    props.insert("grid-area", str(y + 1) + " / " + str(x + 1) + " / span " + str(c.rowspan) + " / span " + str(c.colspan))
    props.insert("text-align", _text-align(align))
    let valign = _vertical-align(align)
    if valign == none { _el("div", "ts-cell", style: _style(props), f.body) } else {
      // Flex would make every inline run its own item; one wrapper keeps the text flowing.
      props.insert("justify-content", valign)
      _el("div", "ts-cell ts-valign", style: _style(props), _el("div", "ts-valign-body", f.body))
    }
  }
  _el("div", "ts-grid", style: container, body)
}

// ---------------------------------------------------------------------------
// Placement: absolutely positioned, relative to the nearest mapped container

/// The sign of a placement offset (a relative length): -1, 0 or 1. A ratio of the
/// container counts as more than any length, its size being unknown here.
#let _sign(d) = {
  let (r, l) = if type(d) == relative { (float(d.ratio), d.length) } else if type(d) == ratio { (float(d), 0pt) } else { (0, d) }
  let v = if r != 0 { r } else { l.to-absolute().pt() }
  if v > 0 { 1 } else if v < 0 { -1 } else { 0 }
}

#let _place(it) = {
  if it.float { return _el("div", "ts-place ts-float", it.body) }
  let a = it.alignment
  let (x, y) = if a == auto { (start, none) } else if a.axis() == "horizontal" { (a, none) } else if a.axis() == "vertical" { (start, a) } else { (a.x, a.y) }
  // Inside the container's inset, as Typst places: its sides are custom properties (`_inset-vars`).
  let mid(from, to) = "calc(50% + (var(--ts-inset-" + from + ") - var(--ts-inset-" + to + ")) / 2)"
  let props = (:)
  let shift = ("0", "0")
  if x in (right, end) { props.insert("right", "var(--ts-inset-right)") } else if x == center { props.insert("left", mid("left", "right")); shift.at(0) = "-50%" } else { props.insert("left", "var(--ts-inset-left)") }
  if y == bottom { props.insert("bottom", "var(--ts-inset-bottom)") } else if y == horizon { props.insert("top", mid("top", "bottom")); shift.at(1) = "-50%" } else if y == top { props.insert("top", "var(--ts-inset-top)") }
  let dx = _len(it.dx)
  let dy = _len(it.dy)
  let transform = ()
  if shift != ("0", "0") { transform.push("translate(" + shift.join(", ") + ")") }
  if dx not in (none, "0pt") or dy not in (none, "0pt") { transform.push("translate(" + (dx, dy).map(d => if d == none { "0" } else { d }).join(", ") + ")") }
  if transform.len() > 0 { props.insert("transform", transform.join(" ")) }
  // Offset away from the edge it's anchored to (`bottom` with a positive dy), the
  // piece sits outside its container, on the page: the theme keeps the page's
  // colors for it rather than a fill's (a shape's dimension labels).
  let out = (x in (right, end) and _sign(it.dx) > 0 or x in (left, start) and _sign(it.dx) < 0
    or y == bottom and _sign(it.dy) > 0 or y == top and _sign(it.dy) < 0)
  // Text aligned to an edge or the middle lands where Typst puts it only with Typst's text box (a
  // label `dy: 1.2em` below a shape). Not without a vertical alignment: on the flow's line, the
  // untrimmed box shares the next paragraph's baseline, as in Typst.
  let text-box = y != none and _only-text(it.body)
  _el("div", "ts-place" + if out { " ts-place-out" } + if text-box { " ts-place-text" }, style: _style(props), it.body)
}

// ---------------------------------------------------------------------------
// The show rules


/// Applies html-compat to a document: `#show: html-compat`.
#let html-compat(doc) = {
  let html-only(rule) = it => context if target() == "html" { rule(it) } else { it }

  // Layout containers.
  show grid: html-only(_grid)
  // text-align moves the text; the class moves blocks (frames, shapes, tables) the same way.
  show align: html-only(it => {
    let x = _text-align(it.alignment)
    _el("div", "ts-align" + if x != none { " ts-align-" + x }, style: _css(text-align: x), it.body)
  })
  show stack: html-only(it => {
    let dir = (ltr: "row", rtl: "row-reverse", ttb: "column", btt: "column-reverse").at(repr(it.dir))
    let spacing = _len(it.spacing)
    let items = for child in it.children {
      if type(child) == fraction { _el("div", "ts-spacer", style: "flex-grow: " + _num(child / 1fr), none) }
      else if type(child) in (length, ratio, relative) { _el("div", "ts-spacer", style: "flex-basis: " + _len(child), none) }
      else { _el("div", "ts-stack-item", child) }
    }
    _el("div", "ts-stack", style: _css(flex-direction: dir, gap: spacing), items)
  })
  show columns: html-only(it => _el("div", "ts-columns", style: _css(column-count: str(it.count), column-gap: _len(it.gutter)), it.body))
  show colbreak: html-only(it => _el("div", "ts-colbreak", none))
  show pagebreak: html-only(it => _el("div", "ts-pagebreak", none))
  show place: html-only(_place)
  show pad: html-only(it => _el("div", "ts-pad", style: _css(
    padding: ("top", "right", "bottom", "left").map(s => _len(it.at(s))).map(v => if v == none { "0" } else { v }).join(" "),
  ), it.body))

  // Spacing. Fractional spacing has no HTML equivalent; it becomes a gap. In math
  // (`quad` is h(1em)) MathML has its own spacing, so h is left alone there. Weak
  // spacing is Typst's own (an inline quote has some) and is left alone everywhere:
  // wrapped in `context`, it no longer collapses, which changes paged layout.
  show v.where(weak: false): html-only(it => {
    let h = _len(it.amount)
    _el("div", "ts-v", style: if h != none { "height: " + h }, none)
  })
  show h.where(weak: false): html-only(it => {
    if text.costs.runt == _in-math { return it }
    let w = _len(it.amount)
    if w == none { _el("span", "ts-hfill", none) } else { _el("span", "ts-h", style: "width: " + w, none) }
  })

  // Containers with a look. Blocks Typst makes for its own HTML elements (headings, lists, …) pass through.
  show block: html-only(it => {
    if type(it.body) != content or it.body.func() == html.elem { return it }
    if _has-drawing(it.body) or _is-canvas(it.body) { return _frame(it) }
    let props = _box-props(fill: it.fill, stroke: it.stroke, inset: it.inset, radius: it.radius) + _inset-vars(it.inset)
    props.insert("width", _len(it.width))
    props.insert("height", _len(it.height))
    if it.clip { props.insert("overflow", "hidden") }
    _el("div", "ts-block", style: _style(props), it.body)
  })
  show box: html-only(it => {
    if type(it.body) == content and (_has-drawing(it.body) or _is-canvas(it.body)) { return _frame(it, inline: true) }
    let props = _box-props(fill: it.fill, stroke: it.stroke, inset: it.inset, radius: it.radius) + _inset-vars(it.inset)
    props.insert("width", _len(it.width))
    props.insert("height", _len(it.height))
    if it.clip { props.insert("overflow", "hidden") }
    let shift = _len(it.baseline.shift)
    if shift not in (none, "0pt") { props.insert("vertical-align", "calc(-1 * " + shift + ")") }
    _el("span", "ts-box" + if type(it.width) == fraction { " ts-fr" }, style: _style(props), _mark-inline(it.body))
  })

  // Shapes with content are boxes; without, they are drawn boxes. Circles and ellipses round them.
  let shape(class, extra: (:)) = it => {
    let fields = it.fields()
    let props = _box-props(
      fill: it.fill,
      stroke: it.stroke,
      stroke-default: if it.fill == none { 1pt + black },
      inset: if it.body != none { it.inset },
      radius: if it.func() in (rect, square) { it.radius },
    ) + if it.body != none { _inset-vars(it.inset) }
    let size = if it.func() == circle and fields.at("radius", default: auto) != auto { 2 * it.radius } else { fields.at("size", default: auto) }
    props.insert("width", _len(if size != auto { size } else { fields.at("width", default: auto) }))
    props.insert("height", _len(if size != auto { size } else { fields.at("height", default: auto) }))
    _el("div", "ts-shape " + class, style: _style(props + extra), it.body)
  }
  show rect: html-only(shape("ts-rect"))
  show square: html-only(shape("ts-square", extra: (aspect-ratio: "1")))
  show circle: html-only(shape("ts-circle", extra: (border-radius: "50%", aspect-ratio: "1")))
  show ellipse: html-only(shape("ts-ellipse", extra: (border-radius: "50%")))
  show line: html-only(it => {
    if it.angle != 0deg or it.end != none or it.start != (0% + 0pt, 0% + 0pt) { return _frame(it) }
    _el("div", "ts-line", style: _css(width: _len(it.length), border-top: _stroke(it.stroke, default: 1pt + black)), none)
  })
  show curve: html-only(it => _frame(it, inline: true))
  show polygon: html-only(it => _frame(it, inline: true))

  // Transforms are blocks in Typst too; CSS transforms them without affecting layout, as Typst does.
  let transformed(transform) = it => _el("div", "ts-transform", style: "transform: " + transform(it), it.body)
  show move: html-only(transformed(it => "translate(" + (_len(it.dx), _len(it.dy)).map(d => if d == none { "0" } else { d }).join(", ") + ")"))
  show rotate: html-only(transformed(it => "rotate(" + _num(it.angle.deg()) + "deg)"))
  show scale: html-only(transformed(it => "scale(" + _num(float(it.x)) + ", " + _num(float(it.y)) + ")"))
  show skew: html-only(transformed(it => "skew(" + _num(-it.ax.deg()) + "deg, " + _num(-it.ay.deg()) + "deg)"))
  show hide: html-only(it => _el("span", "ts-hide", _mark-inline(it.body)))
  // A box(width: 1fr) has no width in HTML; the repeats fill what CSS gives it and are clipped.
  show repeat: html-only(it => _el("span", "ts-repeat", ((it.body,) * 60).join()))

  // Tables are native HTML tables; their cells carry Typst's resolved fill, alignment and inset.
  show table.cell: html-only(it => {
    let props = _box-props(fill: it.fill, inset: it.inset)
    props.insert("text-align", _text-align(it.align))
    let unstroked = it.stroke == none or (type(it.stroke) == dictionary and it.stroke.values().all(s => s == none))
    _el("div", "ts-cell" + if unstroked { " ts-no-stroke" }, style: _style(props), it.body)
  })

  // Lists numbered with a pattern HTML's <ol> can't show ("a)", "(i)"): explicit markers.
  show enum: html-only(it => {
    if type(it.numbering) != str or it.numbering in ("1.", "1") or it.full { return it }
    let n = if it.start == auto { 1 } else { it.start }
    let items = for item in it.children {
      let number = item.fields().at("number", default: auto)
      if number not in (auto, none) { n = number }
      html.elem("li", html.span(class: "ts-marker", numbering(it.numbering, n)) + item.body)
      n += 1
    }
    html.elem("ol", attrs: (class: "ts-enum"), items)
  })

  // Math: numbered block equations show their number; equations with cancel() are drawn;
  // overline becomes an accent, which MathML has.
  show math.overline: html-only(it => math.accent(it.body, "‾"))
  show math.equation: html-only(it => {
    if _find(it.body, c => c.func() == math.cancel) { return _frame(it, inline: not it.block) }
    // A set rule doesn't survive `return`, so the marked equation is the block's value.
    let marked = _mark-math(it)
    if not it.block or it.numbering == none { marked } else {
      _el("div", "ts-equation", marked + _el("span", "ts-equation-number", counter(math.equation).display(it.numbering)))
    }
  })

  doc
}

/// `layout` in HTML calls `func` with `compat-size` (there is no page to measure), so its
/// content stays HTML. In paged output it is Typst's `layout`.
#let layout(func) = context if target() == "html" { func(compat-size) } else { std.layout(func) }
