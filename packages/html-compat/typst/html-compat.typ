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

/// A length, ratio or relative length as CSS; `none` for `auto`, `none` and fractions. Em lengths are resolved
/// where Typst resolves them, against the text size of the element they are on (a heading's), which the HTML
/// element needn't have.
#let _len(l) = {
  if type(l) == length {
    _num(l.to-absolute().pt()) + "pt"
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
  // The colour space it interpolates in (Typst's default is Oklab).
  let space = (oklab: "oklab", oklch: "oklch", srgb: "srgb", linear-rgb: "srgb-linear", hsl: "hsl", hsv: "hsl", cmyk: "srgb", luma: "srgb").at(repr(p.space()), default: "oklab")
  if not gradients { p.stops().first().first().to-hex() } else if p.kind() == gradient.linear {
    // Typst's 0deg points right, CSS's points up.
    "linear-gradient(" + _num(p.angle().deg() + 90) + "deg in " + space + ", " + stops + ")"
  } else if p.kind() == gradient.radial {
    "radial-gradient(in " + space + ", " + stops + ")"
  } else {
    "conic-gradient(in " + space + ", " + stops + ")"
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

/// A stroke's thickness, or `none`. `auto` is the given default's.
#let _stroke-width(s, default: none) = {
  if s == auto { s = default }
  if s == none { return none }
  let s = stroke(s)
  if s.thickness == auto { 1pt } else { s.thickness }
}

/// Fill, stroke, inset and radius of a box-like element as CSS declarations. Typst draws a stroke centred on the
/// element's edge, half of it outside, and the stroke takes no room: the inset is measured from the edge. A CSS
/// border would take room inside the box, so strokes are drawn by the element's `::before` (html-compat.css,
/// `.ts-stroked`), half their width past each edge, from custom properties: each side's border (`--ts-bt`, …) and
/// width (`--ts-wt`, …).
#let _box-props(fill: none, stroke: none, stroke-default: none, inset: none, radius: none) = {
  let props = (:)
  let bg = _paint(fill)
  if bg != none { props.insert("background", bg) }
  for (side, s) in _sides(stroke) {
    let css = _stroke(s, default: stroke-default)
    if css == none { continue }
    let k = side.first()
    props.insert("--ts-b" + k, css)
    props.insert("--ts-w" + k, _len(_stroke-width(s, default: stroke-default)))
  }
  let padding = _shorthand(_sides(inset).values())
  if padding != none { props.insert("padding", padding) }
  let radius = _shorthand(_corners(radius).values())
  if radius != none { props.insert("border-radius", radius) }
  props
}

/// `.ts-stroked` when `props` (from `_box-props`) draw a stroke, for an element's class.
#let _stroked(props) = if props.keys().any(k => k in ("--ts-bt", "--ts-br", "--ts-bb", "--ts-bl")) { " ts-stroked" } else { "" }

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

/// The text size where it is, as CSS, when it isn't the stylesheet's (11pt): an element's spacing in `em` (its
/// margins, the spaces between its text's spans) is in its own text size, as Typst's is.
#let _size() = {
  let size = text.size.to-absolute()
  if size != 11pt { _len(size) }
}

/// Whether content is only inline: text and what goes in a line with it.
#let _inline-only(c) = {
  if type(c) == str { return true }
  if type(c) != content { return false }
  let f = c.func()
  if f == [].func() { return c.children.all(_inline-only) }
  if f == text(1pt)[].func() { return _inline-only(c.child) }
  if f in (strong, emph, link, highlight, underline, strike, overline, sub, super, smallcaps) { return _inline-only(c.body) }
  f in (text, [ ].func(), linebreak, box, h, smartquote) or (f in (raw, math.equation) and not c.block)
}

/// A list after a blank line isn't attached to the paragraph before it (typst-layout's LIST_RULE attaches a tight
/// list only to a paragraph it follows directly), which the HTML can't tell: an empty `.ts-start` goes between them,
/// as the renderer's `data-typstream-start` marks the document's top-level blocks.
#let _flat(c) = if c.func() == [].func() { c.children.map(_flat).flatten() } else { (c,) }
#let _mark-starts(body) = {
  if type(body) != content or body.func() != [].func() { return body }
  let out = ()
  let after = false
  for c in _flat(body) {
    if c.func() == parbreak { after = true; out.push(c); continue }
    if c == [ ] { out.push(c); continue }
    if after and c.func() in (list.item, enum.item, terms.item) { out.push(html.elem("div", attrs: (class: "ts-start"))) }
    after = false
    out.push(c)
  }
  out.join()
}

/// An HTML element with a class and an optional style; unset attributes are left out. Needs
/// context: inside an inline element (a box) a `div` would end the paragraph around it in
/// the browser's parser, so it becomes a `span` with class `ts-b` (display: block). Its text
/// size goes with it, and lists after blank lines in its body are marked (`_mark-starts`).
#let _el(tag, class, style: none, role: none, body) = {
  if tag == "div" and text.costs.widow == _inline { (tag, class) = ("span", class + " ts-b") }
  let attrs = (class: class)
  let size = _size()
  if size != none { style = (style, "font-size: " + size).filter(x => x != none).join("; ") }
  if style != none { attrs.insert("style", style) }
  if role != none { attrs.insert("role", role) }
  html.elem(tag, attrs: attrs, if body == none { [] } else { _mark-starts(body) })
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
  // Closures capture by value: `taken` is passed in.
  let free(taken, x, y, cs, rs) = {
    if x + cs > ncols { return false }
    for dx in range(cs) { for dy in range(rs) { if str(x + dx) + "," + str(y + dy) in taken { return false } } }
    true
  }
  let (cells, hlines, vlines) = ((), (), ())
  let (cx, cy) = (0, 0)
  // Header and footer cells are laid out where they appear, which is first and last in practice.
  let flat = children.map(c => {
    let head = c.func() in (grid.header, table.header)
    if "children" in c.fields() { c.children.map(x => (x, head)) } else { ((c, false),) }
  }).flatten().chunks(2)
  for (c, head) in flat {
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
      while not free(taken, x, y, cs, rs) { y += 1 }
    } else if y != auto {
      x = 0
      while not free(taken, x, y, cs, rs) and x < ncols { x += 1 }
      if x >= ncols { x = 0 }
    } else {
      (x, y) = (cx, cy)
      while not free(taken, x, y, cs, rs) {
        x += 1
        if x >= ncols { (x, y) = (0, y + 1) }
      }
      (cx, cy) = (x + cs, y)
      if cx >= ncols { (cx, cy) = (0, cy + 1) }
    }
    for dx in range(cs) { for dy in range(rs) { taken.insert(str(x + dx) + "," + str(y + dy), true) } }
    cells.push((x: x, y: y, colspan: cs, rowspan: rs, cell: c, header: head))
  }
  (cells, hlines, vlines)
}

/// Whether content takes the whole width it is given, wherever it is: a grid or a table with fractional or
/// relative columns, something given a relative width, fractional spacing. A block around it is as wide as its
/// region in Typst, where CSS would shrink it to its content (`width: fit-content`) and collapse those columns.
#let _expands(c) = _find(c, e => {
  let f = e.fields()
  let rel(w) = type(w) in (ratio, relative, fraction)
  if e.func() in (grid, table) {
    let cols = f.at("columns", default: ())
    type(cols) == array and cols.any(rel)
  } else if e.func() in (block, box, rect, square, line, image) { rel(f.at("width", default: f.at("length", default: auto))) }
  else if e.func() == h { type(f.amount) == fraction }
  else { false }
})

/// A grid or a table as a CSS grid with Typst's tracks, gutters and cell placement. A table keeps its semantics
/// through ARIA roles: its rows are `display: contents`, so their cells are the grid's items.
#let _grid(it, table: false) = {
  let columns = if type(it.columns) == int { (auto,) * it.columns } else if it.columns.len() == 0 { (auto,) } else { it.columns }
  let rows = if type(it.rows) == int { (auto,) * it.rows } else { it.rows }
  let (cells, hlines, vlines) = _place-cells(it.children, columns.len())
  // Gutters per gap, the last repeated. One for all gaps is CSS's gap; differing ones become tracks of their own
  // between the columns (or rows), the cells spanning them.
  let ncols = columns.len()
  let nrows = calc.max(rows.len(), ..cells.map(c => c.y + c.rowspan), 1)
  let gutters(g, n) = range(calc.max(n - 1, 0)).map(i => if g.len() == 0 { 0pt } else { g.at(calc.min(i, g.len() - 1)) })
  let (cg, rg) = (gutters(it.column-gutter, ncols), gutters(it.row-gutter, nrows))
  let (col-tracks, row-tracks) = (cg.dedup().len() > 1, rg.dedup().len() > 1)
  let interleave(tracks, gaps) = tracks.enumerate().map(((i, t)) => if i < gaps.len() { (t, _len(gaps.at(i))) } else { (t,) }).flatten()
  let row-track(i) = if rows.len() == 0 { auto } else { rows.at(calc.min(i, rows.len() - 1)) }
  // A cell spanning auto columns that needs more room than they have: Typst gives what is missing to the last auto
  // column it spans (typst-layout's grid, measure_auto_columns), where CSS would share it out. That column is given
  // at least its own widest cell and what is missing (`minmax(…, auto)`); the others stay `auto`, as wide as the
  // browser sets their text.
  let pick-at(c, name) = { let v = c.cell.fields().at(name, default: auto); if v == auto { _per-cell(it.at(name), c.x, c.y) } else { v } }
  let natural(c) = {
    let inset = _sides(pick-at(c, "inset"), default: 0pt)
    let side(s) = {
      let v = inset.at(s)
      if type(v) == length { v.to-absolute() } else if type(v) == relative and v.ratio == 0% { v.length.to-absolute() } else { 0pt }
    }
    measure(c.cell.fields().body).width + side("left") + side("right")
  }
  let spanning = cells.filter(c => c.colspan > 1 and range(c.x, calc.min(c.x + c.colspan, ncols)).any(i => columns.at(i) == auto))
  let widths = columns.map(_ => 0pt)
  let least = columns.map(_ => none)
  if spanning.len() > 0 {
    for c in cells {
      if c.colspan == 1 and columns.at(c.x) == auto and not _expands(c.cell.fields().body) {
        widths.at(c.x) = calc.max(widths.at(c.x), natural(c))
      }
    }
    for c in spanning {
      let spanned = range(c.x, calc.min(c.x + c.colspan, ncols))
      if spanned.any(i => columns.at(i) != auto and type(columns.at(i)) != length) or _expands(c.cell.fields().body) { continue }
      let have = spanned.map(i => if columns.at(i) == auto { widths.at(i) } else { columns.at(i).to-absolute() }).sum()
      have += range(c.x, spanned.last()).map(i => cg.at(i, default: 0pt)).sum(default: 0pt)
      let last = spanned.filter(i => columns.at(i) == auto).last()
      let need = natural(c) - have
      if need > 0pt {
        widths.at(last) += need
        least.at(last) = widths.at(last)
      }
    }
  }
  let tracks = columns.enumerate().map(((i, t)) => if least.at(i) != none { "minmax(" + _len(least.at(i)) + ", auto)" } else { _track(t) })
  let container = _css(
    grid-template-columns: if col-tracks { interleave(tracks, cg).join(" ") } else { tracks.join(" ") },
    grid-template-rows: if row-tracks { interleave(range(nrows).map(i => _track(row-track(i))), rg).join(" ") } else if rows.len() > 0 { rows.map(_track).join(" ") },
    // Typst's auto columns take their natural width and don't stretch to fill: the grid is as wide as they are.
    justify-content: if columns.all(t => type(t) != fraction) { "start" },
    width: if columns.all(t => type(t) != fraction and type(t) != ratio and type(t) != relative) { "fit-content" },
    column-gap: if not col-tracks and cg.len() > 0 { _len(cg.first()) },
    row-gap: if not row-tracks and rg.len() > 0 { _len(rg.first()) },
  )
  // A cell's place: every other track when gutters are tracks.
  let area(start, span, tracks) = if tracks { (2 * start + 1, 2 * span - 1) } else { (start + 1, span) }
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
    let (row, rows-spanned) = area(y, c.rowspan, row-tracks)
    let (col, cols-spanned) = area(x, c.colspan, col-tracks)
    props.insert("grid-area", str(row) + " / " + str(col) + " / span " + str(rows-spanned) + " / span " + str(cols-spanned))
    props.insert("text-align", _text-align(align))
    let valign = _vertical-align(align)
    let role = if not table { none } else if c.header { "columnheader" } else { "cell" }
    let class = "ts-cell" + _stroked(props) + if c.header { " ts-head" } + if valign != none { " ts-valign" }
    if valign != none { props.insert("justify-content", valign) }
    let cell = _el("div", class, style: _style(props), role: role,
      // Flex would make every inline run its own item; one wrapper keeps the text flowing.
      if valign == none { f.body } else { _el("div", "ts-valign-body", f.body) })
    ((y: y, cell: cell),)
  }
  if body == none { body = () }
  if not table { return _el("div", "ts-grid", style: container, body.map(c => c.cell).join()) }
  // Rows for the table's semantics, in the order of their first cells.
  let rows = body.map(c => c.y).dedup()
  _el("div", "ts-grid ts-table", style: container, role: "table", for y in rows {
    _el("div", "ts-row", role: "row", body.filter(c => c.y == y).map(c => c.cell).join())
  })
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
  // A float stays in the flow, its content aligned as placed, with its clearance from the flow after it. One
  // across the page's columns (`scope: "parent"`) is the pages' to put over them (`.ts-float-parent`).
  if it.float {
    let x = _text-align(it.alignment)
    let style = _css(text-align: if x != none and x != "start" { x }, margin-block-end: _len(it.clearance))
    return _el("div", "ts-place ts-float" + if it.scope == "parent" { " ts-float-parent" }, style: style, it.body)
  }
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
// Text: what Typst's HTML export leaves out of it
//
// html-compat.css gives the document Typst's defaults as the engine's layout profile (#129) sets them on pages: the
// base font at 11pt in black, lines 1.3em apart, paragraphs 0.56em apart. The export writes `strong`, `emph` and a
// few decorations as elements and drops the rest of a text's style (its size, colour, font, weight …): text that
// differs from the defaults is a span carrying it.

/// The web font a family is registered as in the browser (dom's `webFontFamily`), then the family itself.
#let _family(f) = {
  let name = if type(f) == dictionary { f.name } else { f }
  "typstream-" + lower(name).replace(regex("[^a-z0-9]+"), "-") + ", \"" + name + "\""
}

#let _weights = (thin: 100, extralight: 200, light: 300, regular: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900)

/// The current text style's differences from the document's defaults, as CSS declarations. Needs context.
#let _text-props() = {
  let props = (:)
  let size = text.size.to-absolute()
  if size != 11pt { props.insert("font-size", _len(size)) }
  if text.fill != black { props.insert("color", _paint(text.fill, gradients: false)) }
  let fonts = if type(text.font) == array { text.font } else { (text.font,) }
  if fonts.map(f => lower(if type(f) == dictionary { f.name } else { f })) != ("libertinus serif",) {
    props.insert("font-family", fonts.map(_family).join(", "))
  }
  let weight = if type(text.weight) == str { _weights.at(text.weight, default: 400) } else { text.weight }
  if weight != 400 { props.insert("font-weight", str(weight)) }
  if text.style != "normal" { props.insert("font-style", text.style) }
  if text.tracking != 0pt { props.insert("letter-spacing", _len(text.tracking)) }
  // Typst's word spacing is a share of the space's width (0.25em in Libertinus Serif) plus a length.
  let spacing = text.spacing
  let extra = (float(spacing.ratio) - 1) * 0.25em + spacing.length
  if extra != 0em { props.insert("word-spacing", _len(extra)) }
  // A positive baseline shift moves text down.
  if text.baseline != 0pt { props.insert("position", "relative"); props.insert("top", _len(text.baseline)) }
  props
}

/// Typst sets a line that holds only a line break (`\ \`) from the cap height to the baseline: the profile's text
/// edges don't reach it, as it has no text. In HTML it would be a whole line. The second break of a pair becomes a
/// block that tall (`.ts-empty-line`), which ends the line before it as the break did.
#let _empty-lines(body) = {
  if type(body) != content or body.func() != [].func() or "children" not in body.fields() { return body }
  if body.children.filter(c => c.func() == linebreak).len() < 2 { return body }
  let after-break = false
  let out = ()
  for c in body.children {
    if c.func() == linebreak and after-break {
      out.push(html.elem("span", attrs: (class: "ts-empty-line")))
      continue
    }
    // Typst drops the spaces that start a line.
    if c == [ ] { if not after-break { out.push(c) }; continue }
    after-break = c.func() == linebreak
    out.push(c)
  }
  out.join()
}


/// The current text's line box when its edges aren't the layout profile's (1.054em above the baseline, 0.246em below):
/// how far it reaches above and below the baseline, measured. `none` with the profile's. Needs context.
#let _edges() = {
  // The profile's, or Typst's defaults where it isn't in front (a compile outside the engine): CSS's line.
  let (top, bottom) = (text.top-edge, text.bottom-edge)
  if (top, bottom) in ((1.054em, -0.246em), ("cap-height", "baseline")) { return none }
  // Show-set rules: the layout profile's (and edu's own) are, and a set rule wouldn't win over them.
  let above = measure({ show text: set text(bottom-edge: "baseline"); [X] }).height
  let below = measure({ show text: set text(top-edge: "baseline"); [X] }).height
  (above, below)
}

// Math classes of the symbols Typst breaks an inline equation after (typst-layout's math/run.rs,
// `into_par_items`): binary operators and relations, as Unicode classes them.
#let _binary = "+−-±∓×·⋅÷∗∘∙∪∩∧∨⊕⊖⊗⊘⊙⋆∖⊎⊓⊔"
#let _relation = "=≠<>≤≥≦≧≪≫≈≡≢∼≃≄≅≆∝→←↔⇒⇐⇔⟶⟵⟷⟹⟸⟺↦⇌⇋⇄⇆∈∉∋∌⊂⊃⊆⊇⊊⊋∣∤∥∦≺≻⪯⪰⊢⊣⊨≐≔≕"
#let _closing = ")]}⟩⟫⌋⌉|‖"

/// The class of a top-level child of an equation's body, as far as breaking it goes.
#let _math-class(c) = {
  let t = c.fields().at("text", default: none)
  if type(t) != str or t.clusters().len() != 1 { return "normal" }
  if _binary.contains(t) { "binary" } else if _relation.contains(t) { "relation" } else if _closing.contains(t) { "closing" } else if t in "([{⟨⟪⌊⌈" { "opening" } else { "normal" }
}

/// An inline equation's body cut where Typst may break the line: after a binary operator (not before a closing
/// delimiter) and after a relation (not before another relation or a closing delimiter). A binary operator with no
/// operand before it (`-3`) is a sign, not an operator. One piece when there is no such place.
#let _math-pieces(body) = {
  if body.func() != [].func() or "children" not in body.fields() { return ((body,),) }
  let children = body.children
  let real = children.enumerate().filter(((_, c)) => c != [ ] and c.func() != h)
  let breaks = ()
  for (k, (i, c)) in real.enumerate() {
    let class = _math-class(c)
    if class not in ("binary", "relation") or k == 0 or k + 1 == real.len() { continue }
    let before = _math-class(real.at(k - 1).at(1))
    let next = _math-class(real.at(k + 1).at(1))
    if class == "binary" and (before in ("binary", "relation", "opening") or next == "closing") { continue }
    if class == "relation" and next in ("relation", "closing") { continue }
    breaks.push(i)
  }
  let pieces = ()
  let from = 0
  for i in breaks {
    pieces.push(children.slice(from, i + 1))
    from = i + 1
  }
  pieces.push(children.slice(from))
  pieces.filter(p => p.any(c => c != [ ]))
}

// ---------------------------------------------------------------------------
// Pages: what the renderer lays the HTML out on

/// The page as the renderer's pages need it (dom's `html/pages.ts`): width, height (`auto` for a page as tall as
/// its content), the margins (top, right, bottom, left) and the fill, in points, space-separated. Margins Typst
/// leaves `auto` are its default, 2.5/21 of the page's shorter side. Needs context.
#let _page-geometry() = {
  let (w, h) = (page.width, page.height)
  if page.flipped { (w, h) = (h, w) }
  let size = (x: if w == auto { 595.28pt } else { w }, y: if h == auto { 841.89pt } else { h })
  let default = 2.5 / 21 * if w == auto { size.y } else if h == auto { size.x } else { calc.min(size.x, size.y) }
  let m = page.margin
  let sides = if m == auto { (:) } else if type(m) == dictionary { m } else { (rest: m) }
  let rest = sides.at("rest", default: auto)
  let x = sides.at("x", default: rest)
  let y = sides.at("y", default: rest)
  let pick(side, fallback, axis) = {
    let v = sides.at(side, default: fallback)
    if v == auto { default } else if type(v) == ratio { float(v) * size.at(axis) } else if type(v) == relative {
      float(v.ratio) * size.at(axis) + v.length.to-absolute()
    } else { v.to-absolute() }
  }
  let left = pick("left", sides.at("inside", default: x), "x")
  let right = pick("right", sides.at("outside", default: x), "x")
  // Inside and outside margins swap on even pages (a left-to-right binding): how far the text moves there.
  let binding = if "inside" in sides or "outside" in sides { right - left } else { 0pt }
  let fill = if page.fill in (auto, none) { "none" } else { _paint(page.fill, gradients: false) }
  let pt(l) = _num(l.pt())
  let (top, bottom) = (pick("top", y, "y"), pick("bottom", y, "y"))
  let rel(r, of) = float(r.ratio) * of + r.length.to-absolute()
  // Page columns (`set page(columns: n)`): how many, and their gutter (`columns.gutter`, of the text's width).
  let gutter = columns.gutter
  let gutter = if type(gutter) == relative { rel(gutter, size.x - left - right) } else if type(gutter) == ratio { float(gutter) * (size.x - left - right) } else { gutter.to-absolute() }
  (
    pt(size.x), if h == auto { "auto" } else { pt(size.y) }, pt(top), pt(right), pt(bottom), pt(left), fill,
    pt(rel(page.header-ascent, top)), pt(rel(page.footer-descent, bottom)), str(page.columns), pt(gutter),
    pt(binding),
  ).join(" ")
}

/// What stands for the page number in a page's header and footer: the renderer writes each page's own in its place.
/// Under 4000, which Typst writes in Roman numerals without overlines.
#let _page-number = 3999

/// The page's header and footer, for the renderer to put on each page (typst-layout's pages/run.rs): as on the first
/// page and as on the others, the page number `_page-number` there. `none` when the page has neither. Needs context.
#let _page-parts() = {
  let marginal = if page.numbering == none { none } else {
    let both = type(page.numbering) != str or page.numbering.matches(regex("[1aAiI]")).len() >= 2
    // In a context of its own: after `part`'s counter update (a context's `display` reads the counter where it is).
    // The `align` inside it, so it aligns the number's text (a paragraph), not a context.
    let (numbering, x) = (page.numbering, page.number-align.x)
    context {
      let display = counter(page).display(numbering, both: both)
      if x == none { display } else { align(x, display) }
    }
  }
  let top = page.number-align.y == top
  let header = if page.header == auto { if top { marginal } } else { page.header }
  let footer = if page.footer == auto { if not top { marginal } } else { page.footer }
  if header == none and footer == none { return none }
  let part(class, body, n) = if body != none {
    counter(page).update(n)
    _el("div", class, body)
  }
  // Marked (a hyphenation cost no document sets) so the page counter's updates here aren't taken for the
  // document's (the `counter-update` rule).
  set text(costs: (hyphenation: 100.0004%))
  {
    part("ts-page-header ts-first", header, 1)
    part("ts-page-header", header, _page-number)
    part("ts-page-footer ts-first", footer, 1)
    part("ts-page-footer", footer, _page-number)
    counter(page).update(1)
  }
}

// ---------------------------------------------------------------------------
// The show rules


/// Applies html-compat to a document: `#show: html-compat`.
#let html-compat(doc) = context if target() != "html" { doc } else {
  // For what lays itself out as on the pages here (the engine's runtime library's error block).
  state("typstream/html-compat").update(true)
  // In HTML only: a paged compile gets the document as it is, its pages unchanged. Inside `html.frame` the target is
  // "paged" again, where each rule leaves what it shows to Typst.
  // Show rules' functions see the styles where they apply, `target()` included: no `context` around what they leave
  // alone, which in an equation's drawing (a paged frame) would make math text a box of its own and change its size.
  let html-only(rule) = it => if target() == "html" { context rule(it) } else { it }

  // The source anchors the engine writes before each top-level block (PLAN §10.2) carry the page they are on.
  // Each block's page: its geometry, numbering, header and footer.
  show html.elem.where(tag: "typstream-anchor"): it => {
    if "data-page" in it.attrs { return it }
    context html.elem("typstream-anchor", attrs: it.attrs + (
      data-page: _page-geometry(),
      data-numbering: if page.numbering == none { "" } else if type(page.numbering) == str { page.numbering } else { "1" },
    ), _page-parts())
  }
  // Where the document sets the page counter (`counter(page).update(..)`), its value then: the renderer's pages
  // count on from it.
  show counter(page).update(0).func(): it => {
    if target() != "html" or text.costs.hyphenation == 100.0004% or it.fields().at("key", default: none) != page { return it }
    it
    context html.elem("typstream-counter", attrs: (value: str(counter(page).get().first())))
  }

  // A paragraph's empty lines (`_empty-lines`) need its body in a span (`.ts-par`), whose own paragraph, this rule's,
  // is left as it is.
  show par: html-only(it => {
    let b = it.body
    if b.func() == html.elem and b.at("tag", default: "") == "span" and b.attrs.at("class", default: "") == "ts-par" { return it }
    let body = _empty-lines(b)
    // Its text size, and its first line's indent: on every paragraph (`all`), or on one right after another.
    let indent = par.first-line-indent
    let (amount, all) = if type(indent) == dictionary { (indent.at("amount", default: 0pt), indent.at("all", default: false)) } else { (indent, false) }
    let amount = if amount == 0pt { none } else { _len(amount) }
    let style = _css(..(
      font-size: _size(),
      text-align: { let a = _text-align(align.alignment); if a != "start" { a } },
      text-indent: if all { amount },
      "--ts-indent": if not all { amount },
    ))
    if style != none { html.elem("p", attrs: (style: style) + if amount != none and not all { (class: "ts-indent") } else { (:) }, body) }
    else if body == b { it } else { html.elem("span", attrs: (class: "ts-par"), body) }
  })

  // Text in a style the defaults don't have. Not in math, which MathML styles itself.
  // Text whose line box isn't the profile's (edu's answers written on ruled lines, its tight blanks) has its own:
  // a strut that tall on the baseline (`.ts-strut`), its letters taking no line of their own (`.ts-edges`).
  show text: html-only(it => {
    if text.costs.runt == _in-math { return it }
    let props = _text-props()
    let edges = _edges()
    if edges == none {
      return if props.len() == 0 { it } else { html.span(style: _css(..props), it) }
    }
    let (above, below) = edges
    let strut = html.elem("span", attrs: (class: "ts-strut", style: "height: " + _len(above + below) + "; vertical-align: -" + _len(below)))
    let style = _css(..props)
    html.elem("span", attrs: (class: "ts-edges") + if style != none { (style: style) } else { (:) }, strut + it)
  })
  // Highlights carry their fill (the export writes a bare <mark>).
  show highlight: html-only(it => html.elem("mark", attrs: (style: "--ts-mark: " + _paint(it.fill, gradients: false)), it.body))

  // Layout containers.
  show grid: html-only(_grid)
  // text-align moves the text; the class moves blocks (frames, shapes, tables) the same way.
  // Aligned vertically (horizon, bottom), it fills the height of what holds it and puts its content there.
  show align: html-only(it => {
    let x = _text-align(it.alignment)
    let y = _vertical-align(it.alignment)
    let class = "ts-align" + if x != none { " ts-align-" + x } + if y != none { " ts-align-v" }
    // Text alone is a paragraph in Typst, spaced as one, in the size all its text has (which may not be the
    // align's): a paragraph aligned (the `par` rule reads `align`), which Typst's HTML writes only if a paragraph
    // break follows the text.
    if y == none and _inline-only(it.body) and text.costs.widow != _inline {
      // (A set rule styles what follows it in the block, not a returned value.)
      set align(it.alignment)
      it.body + parbreak()
    } else {
      _el("div", class, style: _css(text-align: x, justify-content: y), if y == none { it.body } else { _el("div", "ts-align-body", it.body) })
    }
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
  // A weak page break (`.ts-pagebreak-weak`) breaks only where the page isn't empty yet.
  show pagebreak: html-only(it => _el("div", "ts-pagebreak" + if it.weak { " ts-pagebreak-weak" }, none))
  show place: html-only(_place)
  show pad: html-only(it => _el("div", "ts-pad", style: _css(
    padding: ("top", "right", "bottom", "left").map(s => _len(it.at(s))).map(v => if v == none { "0" } else { v }).join(" "),
  ), it.body))

  // Spacing. Fractional spacing takes the rest of the line (html-compat.css). In math (`quad` is h(1em)) MathML has
  // its own spacing, so h is left alone there. Weak spacing becomes spacing too: in HTML there is no paged layout
  // its collapsing would change.
  show v: html-only(it => {
    let h = _len(it.amount)
    // Fractional spacing takes its share of what is left of the page: the renderer's pages give it.
    if type(it.amount) == fraction {
      return _el("div", "ts-v ts-vfill", style: "flex-grow: " + _num(it.amount / 1fr), none)
    }
    // Negative spacing pulls what follows up: a margin, which collapses with its neighbours' as Typst adds them.
    let negative = type(it.amount) == length and it.amount.to-absolute() < 0pt
    _el("div", "ts-v" + if it.weak { " ts-v-weak" }, style: if h != none { (if negative { "margin-block-start: " } else { "height: " }) + h }, none)
  })
  show h: html-only(it => {
    if text.costs.runt == _in-math { return it }
    let w = _len(it.amount)
    // Fractional spacing takes its share of the rest of the line: the renderer makes the run it is in a row.
    if w == none {
      html.elem("span", attrs: (class: "ts-hfill", style: "flex-grow: " + if type(it.amount) == fraction { _num(it.amount / 1fr) } else { "1" }))
    } else { _el("span", "ts-h", style: "width: " + w, none) }
  })

  // Containers with a look. Blocks Typst makes for its own HTML elements (headings, lists, …) pass through.
  // Typst's block is as wide as its content unless given a width, spaced from its neighbours by its `above` and
  // `below` (paragraph spacing when `auto`; its own, `.ts-sp`, beats its neighbours' paragraph spacing, as Typst's
  // flow collapses them). An unbreakable or sticky block tells the renderer's pages so (`.ts-whole`, `.ts-sticky`).
  show block: html-only(it => {
    // Typst's own blocks around its HTML elements (headings, lists, figures …) have no look or spacing of their own.
    let plain = (
      _box-props(fill: it.fill, stroke: it.stroke, inset: it.inset, radius: it.radius).len() == 0
        and (it.width, it.height, it.above, it.below) == (auto, auto, auto, auto) and not it.clip
    )
    if type(it.body) == content and it.body.func() == html.elem and plain { return it }
    if _has-drawing(it.body) or _is-canvas(it.body) { return _frame(it) }
    let props = _box-props(fill: it.fill, stroke: it.stroke, inset: it.inset, radius: it.radius) + _inset-vars(it.inset)
    props.insert("width", if it.width == auto and _expands(it.body) { "100%" } else { _len(it.width) })
    props.insert("height", _len(it.height))
    if it.clip { props.insert("overflow", "hidden") }
    let custom = (it.above, it.below).any(s => s != auto)
    if custom {
      // As custom properties, which html-compat.css reads: a margin in the style attribute would beat its rules
      // that drop spacing at the start and end of what holds the block.
      let gap(s) = if s == auto { _len(par.spacing) } else if type(s) == fraction { "0pt" } else { _len(s) }
      props.insert("--ts-above", gap(it.above))
      props.insert("--ts-below", gap(it.below))
    }
    let class = "ts-block" + _stroked(props) + if custom { " ts-sp" } + if it.above != auto { " ts-sp-a" } + if it.below != auto { " ts-sp-b" } + if not it.breakable { " ts-whole" } + if it.sticky { " ts-sticky" }
    _el("div", class, style: _style(props), _empty-lines(it.body))
  })
  show box: html-only(it => {
    if type(it.body) == content and (_has-drawing(it.body) or _is-canvas(it.body)) { return _frame(it, inline: true) }
    let props = _box-props(fill: it.fill, stroke: it.stroke, inset: it.inset, radius: it.radius) + _inset-vars(it.inset)
    props.insert("width", _len(it.width))
    props.insert("height", _len(it.height))
    if it.clip { props.insert("overflow", "hidden") }
    // Its baseline is a share of its height, which CSS's `vertical-align` takes of the line height: resolved here.
    let b = it.baseline.shift
    let (share, fixed) = if type(b) == ratio { (b, 0pt) } else if type(b) == relative { (b.ratio, b.length) } else { (0%, b) }
    let height = if share == 0% { 0pt } else if type(it.height) == length { it.height } else if type(it.height) == relative and it.height.ratio == 0% { it.height.length } else { measure(it).height }
    let shift = float(share) * height.to-absolute() + fixed.to-absolute()
    if shift != 0pt { props.insert("vertical-align", "-" + _len(shift)) }
    _el("span", "ts-box" + _stroked(props) + if type(it.width) == fraction { " ts-fr" }, style: _style(props), _mark-inline(it.body))
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
    _el("div", "ts-shape " + class + _stroked(props), style: _style(props + extra), it.body)
  }
  show rect: html-only(shape("ts-rect"))
  show square: html-only(shape("ts-square", extra: (aspect-ratio: "1")))
  show circle: html-only(shape("ts-circle", extra: (border-radius: "50%", aspect-ratio: "1")))
  show ellipse: html-only(shape("ts-ellipse", extra: (border-radius: "50%")))
  show line: html-only(it => {
    if it.angle != 0deg or it.end != none or it.start != (0% + 0pt, 0% + 0pt) { return _frame(it) }
    // A dashed line is drawn by Typst (its dashes aren't CSS's); a solid one is a block of no height whose
    // stroke is centred on it.
    let s = if it.stroke == auto { stroke(1pt + black) } else { stroke(it.stroke) }
    if s.dash not in (auto, none) { return _frame(it) }
    let props = _box-props(stroke: (top: it.stroke), stroke-default: 1pt + black)
    props.insert("width", _len(it.length))
    _el("div", "ts-line ts-stroked", style: _style(props), none)
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

  // A block quote as Typst lays it out on pages (typst-layout's QUOTE_RULE): padded by 1em on both sides, 2.4em above
  // it and 1.8em below, its attribution 0.9em under it at the end of the line.
  show quote.where(block: true): html-only(it => {
    let attribution = if it.attribution == none { none } else if type(it.attribution) == label {
      [— #cite(it.attribution, form: "prose")]
    } else { [— #it.attribution] }
    let quoted = if it.quotes == true { quote(block: false, quotes: true, it.body) } else { it.body }
    let size = _size()
    html.elem("blockquote", attrs: (class: "ts-quote ts-sp ts-sp-a ts-sp-b") + if size != none { (style: "font-size: " + size) } else { (:) }, _el("div", "ts-quote-body", quoted) + if attribution != none {
      _el("div", "ts-attribution", attribution)
    })
  })

  // Headings as Typst sets them on pages (typst-layout's HEADING_RULE): the number 0.3em before the title, and a
  // title of more than one line hanging after the number. Their size, weight and spacing are html-compat.css's.
  show heading: html-only(it => {
    let level = calc.min(it.level, 5)
    let tag = "h" + str(level + 1)
    // Spacing other than the layout profile's (a template's `show heading: set block(..)`).
    let gap(s, profile) = if type(s) == length and s != profile { _len(s) }
    let (above, below) = (gap(block.above, 0.71em), gap(block.below, 0.3em))
    // The stylesheet's size for the level (1.4em, 1.2em, 1em of 11pt), or the one Typst gives it.
    let size = text.size.to-absolute()
    let spacing = (
      if calc.abs((size - (1.4, 1.2).at(level - 1, default: 1) * 11pt).pt()) > 0.01 { "font-size: " + _len(size) },
      if above != none { "--ts-above: " + above },
      if below != none { "--ts-below: " + below },
    ).filter(x => x != none)
    if it.numbering == none or it.body == [] { return html.elem(tag, attrs: if spacing.len() > 0 { (style: spacing.join("; ")) } else { (:) }, it.body) }
    let number = counter(heading).display(it.numbering)
    let indent = measure(number).width + 0.3em.to-absolute()
    html.elem(tag, attrs: (style: (..spacing, "padding-inline-start: " + _len(indent), "text-indent: -" + _len(indent)).join("; ")), {
      html.elem("span", attrs: (class: "ts-heading-number", style: "margin-inline-end: 0.3em"), number)
      it.body
    })
  })

  // An outline as Typst lays it out on pages (typst-layout's OUTLINE_RULE and OUTLINE_ENTRY_RULE): its title a
  // heading, then one line per entry: its number, 0.5em, its title, a row of dots, the page, which the renderer
  // writes in (`.ts-outline-page`) once it knows where the entry's target is.
  show outline: html-only(it => {
    let titles = (en: "Contents", de: "Inhaltsverzeichnis", fr: "Table des matières", es: "Índice", it: "Indice", pt: "Sumário", nl: "Inhoudsopgave")
    let title = if it.title == auto { titles.at(text.lang, default: "Contents") } else { it.title }
    let entries = query(it.target).filter(e => e.at("outlined", default: true) and (it.depth == none or e.at("level", default: 1) <= it.depth))
    let prefix(e) = if e.numbering == none { none } else if e.func() == heading {
      numbering(e.numbering, ..counter(heading).at(e.location()))
    } else if e.func() == figure {
      [#e.supplement #numbering(e.numbering, ..e.counter.at(e.location()))]
    }
    // Each level's entries start after the widest number of the levels above (Typst's `indent: auto`).
    let gap = 0.5em.to-absolute()
    let inset = (:)
    for e in entries {
      let p = prefix(e)
      let w = if p == none { 0pt } else { measure(p).width + gap }
      let k = str(e.at("level", default: 1))
      inset.insert(k, calc.max(inset.at(k, default: 0pt), w))
    }
    html.elem("nav", attrs: (role: "doc-toc", class: "ts-outline"), {
      if title != none { heading(level: 1, numbering: none, outlined: false, bookmarked: false, title) }
      for e in entries {
        let level = e.at("level", default: 1)
        let base = range(1, level).map(l => inset.at(str(l), default: 0pt)).sum(default: 0pt)
        let p = prefix(e)
        // A figure's entry is its caption's text.
        let body = if e.func() == heading { e.body } else if e.func() == figure and e.caption != none { e.caption.body } else { e.at("body", default: []) }
        _el("div", "ts-outline-entry", style: if base != 0pt { "padding-inline-start: " + _len(base) }, link(e.location(), {
          if p != none { html.elem("span", attrs: (class: "ts-outline-prefix", style: "min-width: " + _len(inset.at(str(level)))), p) }
          html.elem("span", attrs: (class: "ts-outline-body"), body)
          html.elem("span", attrs: (class: "ts-outline-fill"), "." * 120)
          html.elem("span", attrs: (class: "ts-outline-page"), "1")
        }))
      }
    })
  })

  // Tables are laid out as grids are, with a table's semantics.
  show table: html-only(it => _grid(it, table: true))

  // Lists as Typst lays them out: a marker column as wide as the widest marker, `body-indent` after it, the items
  // `spacing` apart (`par.leading`, 0 on pages, when tight; `par.spacing` when wide). The markers are text, so they
  // are the ones Typst draws (a list's by depth, an enum's from its numbering, "a)", "(i)" …); the list keeps its
  // semantics, its markers hidden from screen readers.
  let gutter(it) = if it.spacing != auto { it.spacing } else if it.tight { par.leading } else { par.spacing }
  let list-props(it) = _css(
    padding-inline-start: if it.indent != 0pt { _len(it.indent) },
    column-gap: if it.body-indent != 0.5em { _len(it.body-indent) },
    row-gap: _len(gutter(it)),
    font-size: _size(),
  )
  let item(marker, body) = html.elem("li", html.elem("span", attrs: (class: "ts-marker", aria-hidden: "true"), marker) + _el("div", "ts-item-body", body))
  show list: html-only(it => {
    let markers = if type(it.marker) == array { it.marker } else { (it.marker,) }
    let marker = markers.at(0, default: [•])
    let marker = if type(marker) == function { marker(0) } else { marker }
    // Nested lists take the next marker.
    let rest = if markers.len() > 1 { markers.slice(1) + markers.slice(0, 1) } else { markers }
    html.elem("ul", attrs: (class: "ts-list" + if it.tight { " ts-tight" }, style: list-props(it)), {
      set list(marker: rest)
      for child in it.children { item(marker, child.body) }
    })
  })
  show enum: html-only(it => {
    let n = if it.start == auto { if it.reversed { it.children.len() } else { 1 } } else { it.start }
    let items = for child in it.children {
      let number = child.fields().at("number", default: auto)
      if number not in (auto, none) { n = number }
      item(if type(it.numbering) == str { numbering(it.numbering, n) } else { (it.numbering)(n) }, child.body)
      n += if it.reversed { -1 } else { 1 }
    }
    html.elem("ol", attrs: (class: "ts-list ts-enum" + if it.tight { " ts-tight" }, style: list-props(it)), items)
  })
  // Term lists: each term and its description a paragraph with a hanging indent, the term bold.
  show terms: html-only(it => {
    let props = _css(
      padding-inline-start: _len(it.indent + it.hanging-indent),
      text-indent: "-" + _len(it.hanging-indent),
      row-gap: _len(gutter(it)),
      font-size: _size(),
    )
    html.elem("dl", attrs: (class: "ts-terms" + if it.tight { " ts-tight" }, style: props), for child in it.children {
      // The separator in the term: a `dl`'s groups hold only terms and descriptions.
      html.elem("div", attrs: (class: "ts-term"), html.elem("dt", strong(child.term) + it.separator) + html.elem("dd", child.description))
    })
  })

  // Math as Typst draws it on pages: an SVG of the equation's frame, sitting on the line where Typst puts it (the
  // depth below the baseline is measured beside a tall strut), its MathML beside it for screen readers. A display
  // equation is centred, its number at the end of the line (typst-layout's `layout_equation_block`).
  // MathML has no overline, but an accent; nor cancel, whose drawing is in the picture.
  // A figure's gap to its caption other than Typst's default (0.65em, the stylesheet's).
  show figure: html-only(it => {
    let gap = it.gap.to-absolute()
    if calc.abs((gap - 0.65em.to-absolute()).pt()) < 0.01 { return it }
    html.elem("div", attrs: (class: "ts-figure", style: "--ts-gap: " + _len(gap)), it)
  })
  show math.overline: html-only(it => math.accent(it.body, "‾"))
  show math.cancel: html-only(it => it.body)
  show math.equation: html-only(it => {
    let mathml = html.elem("span", attrs: (class: "ts-sr"), _mark-math(it))
    if not it.block {
      // A picture per piece Typst may break the line between, each with its operator's spacing after it (an empty
      // operand keeps it), so the pieces side by side are the whole equation.
      let pieces = _math-pieces(it.body)
      let last = pieces.len() - 1
      return pieces.enumerate().map(((i, piece)) => {
        // The pieces after the first don't get the layout profile's strut (the hyphenation cost marks them): Typst
        // puts it before the equation, on its first line.
        let eq = if last == 0 { it } else if i == 0 {
          math.equation(block: false, (piece + (text(""),)).join())
        } else {
          set text(costs: (hyphenation: 100.0003%))
          math.equation(block: false, (piece + if i < last { (text(""),) } else { () }).join())
        }
        let depth = measure({
          set text(top-edge: "baseline", bottom-edge: "baseline")
          box(height: 100pt)
          eq
        }).height - 100pt
        // No deeper than a line of text: placed from the line's bottom (`.ts-flat`, see the CSS). Deeper, from the
        // baseline, so the line grows below as Typst's does.
        let lift = 0.246em.to-absolute() - depth
        let style = if lift >= -0.01pt { "--ts-lift: " + _len(calc.max(lift, 0pt)) } else { "--ts-depth: -" + _len(depth) }
        html.elem("span", attrs: (class: "ts-math" + if lift >= -0.01pt { " ts-flat" }, style: style), {
          html.elem("span", attrs: (aria-hidden: "true"), html.frame(eq))
          if i == 0 { mathml }
        })
      }).join(html.elem("wbr"))
    }
    let eq = if it.numbering == none { it } else { math.equation(block: true, numbering: none, it.body) }
    let number = if it.numbering != none { counter(math.equation).display(it.numbering) }
    // A one-line equation's number sits on its baseline, as Typst sets it (centred, it would sit lower beside a
    // fraction); the baseline is found as an inline equation's (display style) depth.
    let lines = it.body.func() == [].func() and it.body.children.any(c => c.func() == linebreak)
    let lift = if number != none and not lines {
      // Measured in frames, laid out as pages lay them out; a box holding the equation sits on its baseline.
      let depth = measure(html.frame({
        set text(top-edge: "baseline", bottom-edge: "baseline")
        box(height: 100pt)
        box(eq)
      })).height - 100pt
      // Above its baseline: the drawing's height less its depth.
      measure(html.frame(eq)).height - depth - 1.054em.to-absolute()
    }
    _el("div", "ts-equation ts-whole", {
      html.elem("div", attrs: (class: "ts-equation-body", aria-hidden: "true"), html.frame(eq))
      if number != none {
        html.elem("span", attrs: (class: "ts-equation-number") + if lift != none and lift > 0pt {
          (style: "align-self: start; margin-top: " + _len(lift))
        } else { (:) }, number)
      }
      mathml
    })
  })

  doc
  // The page count a header or footer shows (`counter(page).final()`): the renderer's, which it gives the document
  // as an input once it has laid the pages out.
  {
    set text(costs: (hyphenation: 100.0004%))
    counter(page).update(int(sys.inputs.at("typstream-page-count", default: "1")))
  }
}

/// `layout` in HTML calls `func` with `compat-size` (there is no page to measure), so its
/// content stays HTML. In paged output it is Typst's `layout`.
#let layout(func) = context if target() == "html" { func(compat-size) } else { std.layout(func) }
