#import "@preview/cetz:0.5.3"

= Coordinates and angles

Every part of this page needs something a strict policy could block: the engine
is WebAssembly in a worker, the Bengali word (জ্যামিতি) needs a font fetched on
demand, the diagram is a Typst package fetched from this origin, and the layout
below arrives as inline styles.

#grid(
  columns: (1fr, 1fr),
  gutter: 1em,
  [*1.* Plot $(2, 3)$ and $(-1, 4)$.], [*2.* Find the angle $theta$ with $tan theta = 3 / 4$.],
)

$ sin^2 theta + cos^2 theta = 1 $

#align(center, cetz.canvas({
  import cetz.draw: *
  line((0, 0), (3, 0), mark: (end: ">"))
  line((0, 0), (0, 2), mark: (end: ">"))
  line((0, 0), (2.4, 1.8))
  content((0.9, 0.3), $theta$)
}))

See #link("https://typst.app/docs")[the Typst documentation].
