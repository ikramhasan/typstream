= Data

// XML entity expansion: a "billion laughs" of 10^8 strings. roxmltree, which
// Typst parses XML and SVG with, refuses it.
#let lol = "<!ENTITY lol \"lol\">"
#for level in range(2, 10) {
  let prev = if level == 2 { "lol" } else { "lol" + str(level - 1) }
  lol += "<!ENTITY lol" + str(level) + " \"" + ("&" + prev + ";") * 10 + "\">"
}
#xml(bytes("<?xml version=\"1.0\"?><!DOCTYPE lolz [" + lol + "]><a>&lol9;</a>"))
