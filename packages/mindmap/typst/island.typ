// The island marker (PLAN §8.4, `ISLAND_MARKER` in @typstream/core): what typstream's renderers
// mount an interactive component over. The marker wraps its fallback, the Typst drawing, which is
// what prints, exports and shows wherever nothing mounts.
//
// - HTML: a `typstream-island` element with the island's name and its data as JSON, around the
//   drawing as one inline SVG (`html.frame`). Typst writes it as a block of its own.
// - Paged: a zero-size `metadata` labelled `<typstream-island>` at the top left of a full-width,
//   unbreakable block; its value has the name, the data, the block's size in points (Typst
//   gives a position as a point only) and the document's content it came from. The engine
//   finds it in the laid-out document.

/// Wraps `fallback` in an island marker named `name`, carrying `data` (JSON-encodable).
/// `source` is content the document wrote (the island function's argument): the engine locates
/// the island in the document by its spans, since the marker itself is made here. `height`, a
/// function of the available width, saves measuring a fallback whose height is known.
#let _island(name, data, fallback, source: none, height: none) = context if target() == "html" {
  html.elem("typstream-island", attrs: (name: name, props: json.encode(data, pretty: false)), html.frame(fallback))
} else {
  layout(size => {
    let height = if height == none { measure(fallback, width: size.width).height } else { height(size.width) }
    block(breakable: false, width: 100%, {
      let value = (name: name, data: data, width: size.width / 1pt, height: height / 1pt, source: source)
      [#metadata(value)<typstream-island>]
      fallback
    })
  })
}
