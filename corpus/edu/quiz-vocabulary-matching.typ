#set page(margin: 2cm)
#set text(size: 12pt)

#let words = ("ecosystem", "predator", "habitat", "producer", "decomposer", "adaptation")
#let defs = (
  "an organism that breaks down dead material",
  "a feature that helps a living thing survive",
  "an animal that hunts other animals for food",
  "the natural home of a plant or animal",
  "an organism that makes its own food",
  "a community of living things and their environment",
)

#align(center)[*Vocabulary Matching: Ecosystems*]

Draw a line from each word to its meaning, or write the letter in the box.

#v(0.5em)

#grid(
  columns: (auto, 2em, 1fr),
  column-gutter: 1em,
  row-gutter: 1.1em,
  ..words
    .zip(defs)
    .enumerate()
    .map(((i, (w, d))) => (
      [#(i + 1). *#w*],
      box(width: 1.5em, height: 1.5em, stroke: 0.6pt),
      [#numbering("A", i + 1). #d],
    ))
    .flatten(),
)

#v(1.5em)

== Use the words

Complete each sentence with a word from the list above.

1. Mushrooms are an example of a \_\_\_\_\_\_\_\_\_\_.
2. A polar bear's thick fur is an \_\_\_\_\_\_\_\_\_\_ to the cold.
3. Grass is a \_\_\_\_\_\_\_\_\_\_ because it uses sunlight to make food.

#v(1fr)
#align(right, text(9pt)[Key: 1F 2C 3D 4E 5A 6B])
