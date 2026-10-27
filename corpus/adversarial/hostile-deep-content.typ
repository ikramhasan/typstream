= Boxes

// Content nested 100,000 deep, built by a loop (the parser's depth limit only
// applies to source). Native typst overflows its stack; in the engine, the
// worker traps and is replaced.
#let c = [x]
#for i in range(100000) { c = box(c) }
#c
