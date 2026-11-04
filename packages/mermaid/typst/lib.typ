// @typstream/mermaid: Mermaid diagrams for typstream. A document writes a ```mermaid raw block;
// the plugin's preamble shows it with `mermaid-diagram`. Typst can't run pele (JavaScript), so the
// engine's worker draws each block before the compile (src/generator.ts) and mounts the result
// in this package: `diagrams.json`, by the block's text with its whitespace collapsed, and one
// SVG of shapes per drawing. Typst sets the labels itself, in the fonts pele measured them in.
//
// The engine preloads this module (`#import …: mermaid-diagram`). Helpers start with `_`.

/// The index key of a block: its text with whitespace runs collapsed (src/scan.ts's `diagramKey`).
#let _key(text) = text.replace(regex("\s+"), " ").trim()

/// One label: `(x, y, rotate, anchor, size, weight, italic, mono, fill, text)`, in the diagram's
/// units, scaled by `u`; its anchor point is on the baseline.
#let _label(l, u) = {
  let (x, y, angle, anchor, size, weight, italic, mono, fill, body) = l
  let t = text(
    font: if mono { "DejaVu Sans Mono" } else { "Libertinus Serif" },
    size: size * u,
    weight: weight,
    style: if italic { "italic" } else { "normal" },
    fill: rgb(fill),
    body,
  )
  let w = measure(t).width
  let dx = if anchor == "middle" { -w / 2 } else if anchor == "end" { -w } else { 0pt }
  let line = box(width: 0pt, height: 0pt, place(dx: dx, box(width: w, t)))
  place(dx: x * u, dy: y * u, if angle == 0 { line } else { rotate(angle * 1deg, origin: top + left, reflow: false, line) })
}

/// The diagram at `s` points per unit: the shapes as an image, the labels on them.
#let _box(d, s) = {
  let u = s * 1pt
  box(width: d.w * u, height: d.h * u, {
    place(image(d.svg, width: 100%, height: 100%, alt: ""))
    // Show-set, to win over the engine's layout profile (whose line boxes would move the labels
    // off their baselines): a label's box is its baseline.
    show text: set text(top-edge: "baseline", bottom-edge: "baseline", hyphenate: false)
    show par: set par(justify: false)
    // Spaces between labels, which take no room: html-compat names its picture by the text in it.
    for l in d.labels { _label(l, u); [ ] }
  })
}

/// A drawn diagram. Sixteen of the diagram's units (pele's text size) are the text size, and it
/// shrinks to fit the width it has. In the HTML target html-compat shows it as a picture, which
/// its CSS fits to the width (HTML has no `layout`).
#let _drawing(d) = context {
  let s = text.size / 16pt
  if target() == "html" { _box(d, s) } else {
    layout(size => _box(d, calc.min(s, size.width / (d.w * 1pt))))
  }
}

/// Why a diagram couldn't be drawn (pele's message, which points at the place), above its code.
#let _error(d, it) = block(
  width: 100%,
  inset: 0.6em,
  radius: 3pt,
  stroke: 0.5pt + rgb("#dc2626"),
  {
    text(size: 0.85em, fill: rgb("#b91c1c"))[This diagram couldn't be drawn:]
    text(size: 0.85em, fill: rgb("#b91c1c"), raw(d.error, block: true))
    it
  },
)

/// Shows a ```mermaid raw block as its diagram. The preamble sets it as the show rule of every
/// such block: `#show raw.where(lang: "mermaid", block: true): mermaid-diagram`. A block the
/// worker hasn't drawn (yet, or no generator ran) shows its code.
#let mermaid-diagram(it) = {
  let d = json("diagrams.json").at(_key(it.text), default: none)
  if d == none { it } else if "error" in d { _error(d, it) } else { align(center, _drawing(d)) }
}
