= Diagram

// An SVG "billion laughs": nine levels of ten `use`s each, 10^9 rectangles once
// expanded. usvg refuses it (nodes limit).
#let svg = "<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'><g id='a0'><rect width='1' height='1'/></g>"
#for level in range(1, 10) {
  svg += "<g id='a" + str(level) + "'>" + ("<use href='#a" + str(level - 1) + "'/>") * 10 + "</g>"
}
#(svg += "<use href='#a9'/></svg>")
#image(bytes(svg), width: 2cm)
