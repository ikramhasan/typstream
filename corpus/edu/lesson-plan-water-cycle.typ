#set page(paper: "a4", margin: 1.8cm, flipped: false)
#set text(size: 10.5pt)
#set table(stroke: 0.5pt + luma(160), inset: 7pt)

#let accent = rgb("#1565c0")
#show heading: set text(fill: accent)
#let field(name, value) = (text(fill: accent, weight: "bold")[#name], value)

= Lesson Plan: The Water Cycle

#table(
  columns: (auto, 1fr, auto, 1fr),
  ..field("Subject", "Science"),
  ..field("Grade", "4"),
  ..field("Duration", "50 minutes"),
  ..field("Teacher", "Mr. Okafor"),
  ..field("Date", "Tuesday, week 6"),
  ..field("Room", "Lab 2"),
)

== Learning objectives

By the end of the lesson, students will be able to:
+ name the four main stages of the water cycle (evaporation, condensation, precipitation, collection);
+ explain how the sun's energy drives the cycle;
+ model the water cycle in a sealed bag and record observations.

== Success criteria

- [x] I can label a water cycle diagram.
- [x] I can describe what happens to water at each stage.
- [x] I can predict what will happen in my water-cycle bag.

_Note: the boxes above are deliberately written as Markdown task items; Typst renders them as plain list text._

== Materials

#columns(2)[
  - Zip-lock bags (1 per pair)
  - Blue food colouring
  - Permanent markers
  - Tape
  #colbreak()
  - Water cycle diagram handout
  - Exit tickets
  - Video: "Where does rain come from?" (4 min)
]

== Lesson sequence

#table(
  columns: (auto, 1fr, 1fr, auto),
  table.header([*Time*], [*Teacher activity*], [*Student activity*], [*Assessment*]),
  [0–5 min],
  [Hook: show a cold glass of water with droplets outside. Ask "Where did the water come from?"],
  [Think–pair–share ideas.],
  [Listen to explanations],
  [5–15 min],
  [Introduce the four stages with the diagram and video.],
  [Label the handout diagram while watching.],
  [Check labels],
  [15–35 min],
  [Demonstrate the bag model; circulate and question.],
  [In pairs, draw sun, cloud and sea on a bag, add coloured water, tape to a sunny window. Predict and record.],
  [Prediction sheet],
  [35–45 min],
  [Discuss: where is the energy coming from? What would change on a cloudy day?],
  [Share predictions; connect to the stages.],
  [Questioning],
  [45–50 min],
  [Hand out exit tickets.],
  [Answer: "Explain one stage in your own words."],
  [Exit ticket],
)

== Differentiation

/ Support: Word bank and partially labelled diagram; pair with a confident reader.
/ Extension: Explain why the water in the bag stays blue but the droplets on top are clear.
/ EAL: Picture cards for each stage with key vocabulary in home languages.

== Homework

Observe a puddle over two days and write two sentences about what happens to it and why.

#v(1fr)
#line(length: 100%, stroke: accent)
#text(size: 9pt)[*Reflection (after the lesson):* What went well? What would I change next time?]
