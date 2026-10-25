#set page(margin: 2cm, numbering: "1")
#set text(size: 11pt)

#let q-counter = counter("question")
#let answers = state("answers", ())

// A multiple-choice question. `correct` is the index of the right option.
#let mcq(question, options, correct: 0) = {
  q-counter.step()
  answers.update(a => a + (correct,))
  block(breakable: false, below: 1.2em)[
    #context [*#q-counter.display().* #question]
    #pad(left: 1.2em)[
      #grid(
        columns: (1fr, 1fr),
        row-gutter: 0.6em,
        ..options.enumerate().map(((i, o)) => [#("ABCD".at(i))) #o])
      )
    ]
  ]
}

#align(center)[
  #text(17pt)[*World Geography Quiz*] \
  #text(fill: luma(90))[Grade 8 · 10 questions · 15 minutes]
]

Choose the *one* best answer for each question.

#mcq([What is the longest river in Africa?], ([Congo], [Niger], [Nile], [Zambezi]), correct: 2)
#mcq([Which country has the largest population in South America?], ([Argentina], [Brazil], [Colombia], [Peru]), correct: 1)
#mcq([Mount Everest lies on the border of Nepal and which other country?], ([India], [Bhutan], [China], [Pakistan]), correct: 2)
#mcq([What is the capital city of Australia?], ([Sydney], [Melbourne], [Perth], [Canberra]), correct: 3)
#mcq([Which ocean is the largest?], ([Atlantic], [Indian], [Pacific], [Arctic]), correct: 2)
#mcq([The Sahara Desert is located mainly in which region?], ([North Africa], [Southern Africa], [Middle East], [Central Asia]), correct: 0)
#mcq([Which line of latitude is at $0 degree$?], ([Tropic of Cancer], [Equator], [Prime Meridian], [Arctic Circle]), correct: 1)
#mcq([Which of these countries is landlocked?], ([Bolivia], [Chile], [Portugal], [Vietnam]), correct: 0)
#mcq([The Danube flows into which sea?], ([Baltic Sea], [Black Sea], [North Sea], [Caspian Sea]), correct: 1)
#mcq([Which continent has the most countries?], ([Asia], [Europe], [Africa], [South America]), correct: 2)

#pagebreak()

== Answer key

#context {
  let keys = answers.final()
  table(
    columns: keys.len(),
    align: center,
    ..range(1, keys.len() + 1).map(i => [*#i*]),
    ..keys.map(k => "ABCD".at(k)),
  )
}
