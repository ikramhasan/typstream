= Counting

// Each layout iteration reads the counter's final value and raises it, so
// introspection never settles. Typst stops after five attempts with a warning.
#let c = counter("runaway")
#context c.update(c.final().first() + 1)

The counter is #context c.final().first().
