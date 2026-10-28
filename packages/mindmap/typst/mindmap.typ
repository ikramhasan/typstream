// Mind maps (#28): a centre topic and its branches, written as a markup list, drawn in plain
// Typst (no CeTZ: its first canvas costs 100–260 ms while streaming) and wrapped in an island
// marker, so typstream's renderers can mount the interactive map over the drawing. The drawing is
// what prints and exports.
//
// Everything a stream cut can leave must compile and draw what it has: `#mindmap[]` draws
// nothing, a half-typed label is a node, an option cut mid-value falls back to its default.
// The marker's data (`_data`) holds every resolved value (colours, sizes, weights, sides), so
// the interactive map shows what the drawing shows without re-deriving the defaults.
#import "island.typ": _island

// Colours of the top-level branches, in turn. `react/layout.ts` draws with the data's colours,
// so this is the only copy.
#let _palette = ("#2563eb", "#16a34a", "#d97706", "#db2777", "#7c3aed", "#0891b2", "#dc2626", "#4d7c0f").map(rgb)
// Branches of a text-focused map, and the centre of both styles.
#let _neutral = rgb("#475569")
#let _centre = rgb("#1e293b")

// The key of a `topic`'s options in the metadata it leaves in its label.
#let _key = "typstream-mindmap-topic"

#let _seq = [a *b*].func()
#let _space = [ ].func()
#let _styled = [#set text(red); a].func()

/// A colour from a colour or a hex string (`"#ef4444"`, with or without `#`, 3, 4, 6 or 8
/// digits); `none` for anything else, e.g. a hex string cut mid-stream.
#let _color(v) = {
  if type(v) == color { return v }
  if type(v) != str { return none }
  let hex = v.trim().trim("#", at: start)
  if hex.len() in (3, 4, 6, 8) and hex.match(regex("^[0-9a-fA-F]+$")) != none { rgb("#" + hex) }
}

/// A text size from a length, or a bare number in points (what a stream cut leaves of `14pt`).
#let _size(v) = if type(v) == length { v } else if type(v) in (int, float) { v * 1pt }

/// A font weight: `"bold"`, `"regular"` (or `"normal"`), or a number from 100 to 900.
#let _weight(v) = {
  if v in ("bold", "regular") { v } else if v == "normal" { "regular" } else if type(v) == int {
    calc.clamp(v, 100, 900)
  }
}

/// Options for one node of a `mindmap`: wrap the node's label in it, the centre's (the text
/// before the list) or an item's. Every option has a default, so set only what matters.
///
/// - label (content): The node's text: a keyword or a short phrase.
/// - color (color, str): The node's colour, a Typst colour or a hex string (`"#ef4444"`): its
///   border, tint and the lines to its children. Nodes below it take it too, unless they set
///   their own. Give colours a reason (one per theme, red for risks), never at random.
/// - size (length): Text size. Default: by level, from the map's `text-size`.
/// - weight (str): `"bold"` or `"regular"`. The centre and the main branches are bold.
/// - image (content): An `image(...)` above the label, with `alt` as its caption:
///   `image("https://…/leaf.jpg", alt: "A leaf")`. Only on two to four key nodes, and only when
///   it shows the idea; text-focused maps show none.
/// - collapsed (bool): Its branches start hidden. The interactive map opens them on a click;
///   the drawing shows how many there are.
///
/// ```example
/// #mindmap[
///   #topic(size: 16pt)[Water cycle]
///   - #topic(color: "#0891b2")[Evaporation]
///     - Heat from the sun
///   - #topic(collapsed: true)[Condensation]
///     - Clouds
///     - Dew
///   - Precipitation
/// ]
/// ```
#let topic(..label, color: none, size: none, weight: none, image: none, collapsed: false) = {
  let options = (
    color: _color(color),
    size: _size(size),
    weight: _weight(weight),
    image: if type(image) == content and image.func() == std.image { image },
    collapsed: collapsed == true,
  )
  [#metadata(((_key): options))#label.pos().join()]
}

/// The parts of a content value, with sequences (and set rules' bodies) opened.
#let _parts(it) = {
  if it == none { () } else if type(it) != content { (it,) } else if it.func() == _seq {
    it.children.map(_parts).flatten()
  } else if it.func() == _styled { _parts(it.child) } else { (it,) }
}

#let _blank(it) = type(it) == content and it.func() in (_space, parbreak, linebreak)

/// A node from its content: the label (with a `topic`'s options taken out) and the list items
/// that are its children. Labels are trimmed; items with nothing in them are dropped.
#let _tree(body) = {
  let label = ()
  let options = (:)
  let children = ()
  for p in _parts(body) {
    if type(p) == content and p.func() in (list.item, enum.item) { children.push(p.body) } else if (
      type(p) == content and p.func() in (list, enum)
    ) { children += p.children.map(c => c.body) } else if (
      type(p) == content and p.func() == metadata and type(p.value) == dictionary and _key in p.value
    ) { options = p.value.at(_key) } else { label.push(p) }
  }
  while label.len() > 0 and _blank(label.first()) { _ = label.remove(0) }
  while label.len() > 0 and _blank(label.last()) { _ = label.pop() }
  let children = children.map(_tree).filter(c => c != none)
  if label.len() == 0 and children.len() == 0 and options.at("image", default: none) == none { return none }
  (label: if label.len() == 0 { [] } else { label.join() }, options: options, children: children)
}

// Unicode sub- and superscripts, for the plain text of `H_2 O` and `x^2`.
#let _subs = (
  "0": "\u{2080}", "1": "\u{2081}", "2": "\u{2082}", "3": "\u{2083}", "4": "\u{2084}",
  "5": "\u{2085}", "6": "\u{2086}", "7": "\u{2087}", "8": "\u{2088}", "9": "\u{2089}",
  "+": "\u{208A}", "-": "\u{208B}", "\u{2212}": "\u{208B}", "=": "\u{208C}", "(": "\u{208D}", ")": "\u{208E}",
)
#let _sups = (
  "0": "\u{2070}", "1": "\u{00B9}", "2": "\u{00B2}", "3": "\u{00B3}", "4": "\u{2074}",
  "5": "\u{2075}", "6": "\u{2076}", "7": "\u{2077}", "8": "\u{2078}", "9": "\u{2079}",
  "+": "\u{207A}", "-": "\u{207B}", "\u{2212}": "\u{207B}", "=": "\u{207C}", "(": "\u{207D}", ")": "\u{207E}",
  "n": "\u{207F}", "i": "\u{2071}",
)

/// `s` in Unicode sub- or superscript characters, or after `mark` when one has none.
#let _script(s, table, mark) = {
  if s == "" { return "" }
  let chars = s.clusters()
  if chars.all(c => c in table) { chars.map(c => table.at(c)).join() } else { mark + s }
}

/// The plain text of a label, for the interactive map: formatting dropped, math's sub- and
/// superscripts as Unicode (`H₂O`), fractions as `a/b`. Spaces in math only separate names
/// (`H_2 O` is H₂O), so they are dropped there.
#let _plain(it, math: false) = {
  let plain(c) = _plain(c, math: math)
  if it == none { "" } else if type(it) == str { it } else if type(it) == symbol { str(it) } else if (
    type(it) != content
  ) { "" } else if it.func() == metadata { "" } else if it.func() == _space { if math { "" } else { " " } } else if (
    it.func() in (linebreak, parbreak)
  ) { " " } else if it.func() == smartquote { if it.double { "\"" } else { "'" } } else if (
    it.func() == std.math.equation
  ) { _plain(it.body, math: true) } else if it.func() == std.math.attach {
    let get(f) = plain(it.at(f, default: none))
    plain(it.base) + _script(get("b") + get("br"), _subs, "_") + _script(get("t") + get("tr"), _sups, "^")
  } else if it.func() == std.math.frac { plain(it.num) + "/" + plain(it.denom) } else if it.func() == std.math.root {
    "\u{221A}" + plain(it.radicand)
  } else if it.has("text") { plain(it.text) } else if it.has("children") {
    it.children.map(plain).join(default: "")
  } else if it.has("body") { plain(it.body) } else if it.has("child") { plain(it.child) } else { "" }
}

/// How many nodes are below `n`.
#let _count(n) = n.children.map(c => 1 + _count(c)).sum(default: 0)

/// A colour as `#rrggbb` (or `#rrggbbaa`), for the data.
#let _hex(c) = c.to-hex()

/// Light colours get dark text.
#let _light(c) = {
  let (r, g, b, ..) = rgb(c).components()
  0.299 * r / 100% + 0.587 * g / 100% + 0.114 * b / 100% > 0.6
}

/// A node ready to draw: its options resolved by level, its body measured. `color` is the
/// colour it inherits; `base` the map's text size.
#let _node(n, depth, color, base, text-focused) = {
  let o = n.options
  let color = if o.at("color", default: none) != none { o.color } else { color }
  let size = o.at("size", default: none)
  let size = if size == none {
    base * (if depth == 0 { 1.25 } else if depth == 1 { 1 } else { 0.9 }) * (if text-focused { 0.92 } else { 1 })
  } else { calc.clamp(size.to-absolute() / 1pt, 4, 72) * 1pt }
  let weight = o.at("weight", default: none)
  let weight = if weight != none { weight } else if depth <= 1 { "bold" } else { "regular" }
  let collapsed = o.at("collapsed", default: false) and n.children.len() > 0
  let image = if text-focused { none } else { o.at("image", default: none) }
  let fill = if depth == 0 { color } else if depth == 1 { color.lighten(85%) } else { white }
  let ink = if depth == 0 and not _light(color) { white } else { black }
  let max = base * (if text-focused { 14 } else { 10 })
  let label = text(size: size, weight: weight, fill: ink, hyphenate: false, n.label)
  let badge = if collapsed {
    box(inset: (x: 3pt, y: 1.5pt), radius: 1em, fill: if depth == 0 { white } else { color }, text(
      size: size * 0.7,
      weight: "bold",
      fill: if depth == 0 { color } else { white },
      "+" + str(_count(n)),
    ))
  }
  let line = if badge == none { label } else { stack(dir: ltr, spacing: 4pt, label, badge) }
  let natural = measure(line)
  let width = calc.min(natural.width, max)
  let body = if image == none { block(width: width, align(center, line)) } else {
    let width = calc.max(width, base * 4.5)
    block(width: width, {
      box(width: width, height: base * 3.2, clip: true, radius: 2pt, {
        set std.image(width: 100%, height: 100%, fit: "cover")
        image
      })
      v(3pt, weak: true)
      align(center, line)
    })
  }
  let pad = (x: 0.5 * size, y: 0.3 * size)
  // A label that fits on one line is its own size: measuring the block again would only repeat it.
  let (width: w, height: h) = if image == none and natural.width <= max { natural } else { measure(body) }
  (
    tree: n,
    depth: depth,
    color: color,
    size: size,
    weight: weight,
    collapsed: collapsed,
    image: image,
    w: w + 2 * pad.x,
    h: h + 2 * pad.y,
    box: box(
      width: w + 2 * pad.x,
      height: h + 2 * pad.y,
      inset: (x: pad.x, y: pad.y),
      radius: if depth == 0 { 0.4 * size + pad.y } else { 4pt },
      fill: fill,
      stroke: if depth == 0 { none } else { (if depth == 1 { 1.2pt } else { 0.8pt }) + color },
      body,
    ),
    // Below the centre, each main branch takes the next colour of the palette (all neutral when
    // text-focused). A collapsed node's branches aren't drawn, but the interactive map opens them.
    all: n.children.enumerate().map(((i, c)) => _node(c, depth + 1, if depth > 0 { color } else if text-focused {
      _neutral
    } else { _palette.at(calc.rem(i, _palette.len())) }, base, text-focused)),
  )
}

#let _children(n) = if n.collapsed { () } else { n.all }

// Spacing between levels and between siblings. `react/layout.ts` uses the same, in points.
#let _gap-x = 22pt
#let _gap-y = 6pt
#let _gap-branch = 12pt

/// Lays out `n`'s subtree growing to the right, with `n` at x = 0 and the subtree's top at y = 0:
/// every node's box with its top left, the edges, the subtree's size and `n`'s centre line.
#let _place(n) = {
  let children = _children(n)
  if children.len() == 0 {
    return (nodes: ((n: n, x: 0pt, y: 0pt),), edges: (), height: n.h, cy: n.h / 2)
  }
  let nodes = ()
  let edges = ()
  let y = 0pt
  let centres = ()
  for c in children {
    let sub = _place(c)
    let dx = n.w + _gap-x
    nodes += sub.nodes.map(m => (n: m.n, x: m.x + dx, y: m.y + y))
    edges += sub.edges.map(e => (..e, x1: e.x1 + dx, y1: e.y1 + y, x2: e.x2 + dx, y2: e.y2 + y))
    centres.push(y + sub.cy)
    y += sub.height + _gap-y
  }
  let height = y - _gap-y
  let cy = (centres.first() + centres.last()) / 2
  // A node taller than its children's span pushes them down.
  let shift = calc.max(0pt, n.h / 2 - cy)
  let nodes = nodes.map(m => (..m, y: m.y + shift))
  let edges = edges.map(e => (..e, y1: e.y1 + shift, y2: e.y2 + shift))
  let cy = cy + shift
  for (i, c) in centres.enumerate() {
    edges.push((x1: n.w, y1: cy, x2: n.w + _gap-x, y2: c + shift, color: n.color))
  }
  nodes.push((n: n, x: 0pt, y: cy - n.h / 2))
  (nodes: nodes, edges: edges, height: calc.max(height + shift, cy + n.h / 2), cy: cy)
}

/// One side of the map: its branches stacked, laid out to the right of x = 0.
#let _side(branches) = {
  let nodes = ()
  let edges = ()
  let y = 0pt
  let centres = ()
  for b in branches {
    let sub = _place(b)
    nodes += sub.nodes.map(m => (..m, y: m.y + y))
    edges += sub.edges.map(e => (..e, y1: e.y1 + y, y2: e.y2 + y))
    centres.push((y: y + sub.cy, color: b.color))
    y += sub.height + _gap-branch
  }
  (
    nodes: nodes,
    edges: edges,
    centres: centres,
    width: calc.max(0pt, ..nodes.map(m => m.x + m.n.w)),
    height: calc.max(0pt, y - _gap-branch),
  )
}

#let _edge(x1, y1, x2, y2, color) = {
  let mx = (x1 + x2) / 2
  place(top + left, curve(
    stroke: 1.2pt + color,
    curve.move((x1, y1)),
    curve.cubic((mx, y1), (mx, y2), (x2, y2)),
  ))
}

/// The marker's data for a node: everything resolved, labels as plain text.
#let _data(n, side: none, sides: ()) = {
  let image = n.image
  let d = (
    label: _plain(n.tree.label).trim(),
    color: _hex(n.color),
    size: calc.round(n.size / 1pt, digits: 2),
    weight: n.weight,
  )
  if side != none { d.side = side }
  if image != none and type(image.source) == str {
    d.image = (src: image.source, alt: if image.alt == none { "" } else { image.alt })
  }
  if n.collapsed { d.collapsed = true }
  if n.all.len() > 0 { d.children = n.all.enumerate().map(((i, c)) => _data(c, side: sides.at(i, default: none))) }
  d
}

/// A mind map: a centre topic and its branches, written as a list. The text before the list is
/// the centre; each item is a node, and items indented under it are its branches. Labels are
/// keywords or short phrases, never sentences; no two siblings share a label. Wrap a label in
/// `topic(...)` to give it a colour, size, weight, image or collapsed branches.
///
/// In typstream's viewer the map is interactive (pan, zoom, open and close branches); printed
/// and exported, it is this drawing, scaled to fit the column.
///
/// - body (content): The centre topic, then the branches as a list (`-` or `+` items, nested by
///   indentation, two spaces per level). Two or three levels for an overview, four or more for
///   detail.
/// - style (str): `"visual"`: a colour per main branch, and images. `"text-focused"`: no colours
///   or images, more text per node, for printing and revision.
/// - layout (str): `"both"`: branches on both sides of the centre. `"right"`: all on one side
///   (the left in right-to-left text), for narrow columns.
/// - text-size (length): Text size of the main branches; the centre is 1.25 times it and deeper
///   levels 0.9 times. Default: the document's.
///
/// ```example
/// #mindmap[
///   Photosynthesis
///   - Inputs
///     - Sunlight
///     - Water ($H_2 O$)
///     - Carbon dioxide
///   - Outputs
///     - Glucose
///     - Oxygen
///   - Where
///     - Chloroplasts
/// ]
/// ```
#let mindmap(..body, style: "visual", layout: "both", text-size: 1em) = context {
  let tree = _tree(body.pos().join())
  if tree == none { return }
  let text-focused = style == "text-focused"
  let one-sided = layout == "right"
  let rtl = text.dir == rtl or (text.dir == auto and text.lang in ("ar", "fa", "he", "ur", "ps", "ku", "dv", "yi"))
  let base = _size(text-size)
  let base = if base == none { text.size } else { calc.clamp(base.to-absolute() / 1pt, 4, 48) * 1pt }
  let root = _node(tree, 0, _centre, base, text-focused)
  let branches = _children(root)
  let n = branches.len()
  // Branches clockwise from the top right, as mind maps are read: the first half on the right.
  let split = if one-sided { n } else { calc.ceil(n / 2) }
  let (first, second) = (branches.slice(0, split), branches.slice(split))
  // One-sided maps grow in the text's direction.
  let (rb, lb) = if one-sided and rtl { (second, first) } else { (first, second) }
  let R = _side(rb)
  let L = _side(lb)
  let gap = 2 * _gap-x
  let H = calc.max(R.height, L.height, root.h)
  let cx = if lb.len() > 0 { L.width + gap } else { 0pt }
  let cy = H / 2
  let W = cx + root.w + (if rb.len() > 0 { gap + R.width } else { 0pt })
  let ry = (H - R.height) / 2
  let ly = (H - L.height) / 2
  let map = box(width: W, height: H, {
    let ox = cx + root.w + gap
    for c in R.centres { _edge(cx + root.w, cy, ox, ry + c.y, c.color) }
    for e in R.edges { _edge(ox + e.x1, ry + e.y1, ox + e.x2, ry + e.y2, e.color) }
    for m in R.nodes { place(top + left, dx: ox + m.x, dy: ry + m.y, m.n.box) }
    let ox = cx - gap
    for c in L.centres { _edge(cx, cy, ox, ly + c.y, c.color) }
    for e in L.edges { _edge(ox - e.x1, ly + e.y1, ox - e.x2, ly + e.y2, e.color) }
    for m in L.nodes { place(top + left, dx: ox - m.x - m.n.w, dy: ly + m.y, m.n.box) }
    place(top + left, dx: cx, dy: cy - root.h / 2, root.box)
  })
  let side(i) = if i >= split { "left" } else if one-sided and rtl { "left" } else { "right" }
  let data = (
    v: 1,
    style: if text-focused { "text-focused" } else { "visual" },
    layout: if one-sided { "right" } else { "both" },
    dir: if rtl { "rtl" } else { "ltr" },
    size: calc.round(base / 1pt, digits: 2),
    root: _data(root, sides: range(root.all.len()).map(side)),
  )
  let drawing = std.layout(size => {
    let fit = if W > size.width and W > 0pt { size.width / W } else { 1 }
    align(center, if fit < 1 { scale(fit * 100%, reflow: true, map) } else { map })
  })
  // The drawing's height at a width, as `drawing` scales it, without laying it out again.
  let height(width) = if W > width and W > 0pt { H * (width / W) } else { H }
  _island("mindmap", data, drawing, source: body.pos().at(0, default: none), height: height)
}
