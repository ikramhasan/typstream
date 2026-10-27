// What teachers ask for: one request per document the harness generates. They cover the five
// templates and rubrics, the subjects #1 names for day one (math, chemistry, diagrams), and the
// three launch languages, with the request itself in Arabic and Bengali for some. None of them
// repeats edu's own prompt examples (examples/*.typ), which the model sees in the kit.

/** @type {{ id: string, kind: string, tags: string[], request: string }[]} */
export const REQUESTS = [
  {
    id: "worksheet-decimals",
    kind: "worksheet",
    tags: ["math"],
    request: "A grade 5 math worksheet on multiplying decimals: 10 practice questions and 2 word problems, with an answer key.",
  },
  {
    id: "worksheet-linear-equations",
    kind: "worksheet",
    tags: ["math"],
    request: "A grade 8 worksheet on solving linear equations in one variable, getting harder as it goes, with room for working.",
  },
  {
    id: "worksheet-photosynthesis",
    kind: "worksheet",
    tags: ["science"],
    request: "A grade 7 science worksheet on photosynthesis with fill-in-the-blank, multiple choice and one question where students label a diagram of a leaf.",
  },
  {
    id: "worksheet-past-tense",
    kind: "worksheet",
    tags: ["language"],
    request: "A grade 4 English worksheet on past tense verbs: fill in the blanks, a matching exercise, and a short writing task.",
  },
  {
    id: "worksheet-area-perimeter",
    kind: "worksheet",
    tags: ["math", "geometry", "diagram"],
    request: "A grade 6 geometry worksheet on the area and perimeter of rectangles and triangles, with the shapes drawn and their side lengths labelled.",
  },
  {
    id: "worksheet-coordinates",
    kind: "worksheet",
    tags: ["math", "diagram"],
    request: "A grade 7 worksheet on plotting points in the coordinate plane and reading coordinates off a grid.",
  },
  {
    id: "worksheet-balancing-equations",
    kind: "worksheet",
    tags: ["chemistry"],
    request: "A grade 9 chemistry worksheet: balance 10 chemical equations, from easy to hard, with an answer key.",
  },
  {
    id: "worksheet-statistics",
    kind: "worksheet",
    tags: ["math", "table"],
    request: "A grade 9 statistics worksheet on mean, median, mode and range, using a table of test scores.",
  },
  {
    id: "worksheet-reading-comprehension",
    kind: "worksheet",
    tags: ["language"],
    request: "A grade 5 reading comprehension worksheet: a short original story (about 250 words) followed by 6 questions.",
  },
  {
    id: "quiz-european-capitals",
    kind: "quiz",
    tags: ["geography", "mcq"],
    request: "A 10-question multiple-choice quiz on European capitals for grade 6.",
  },
  {
    id: "quiz-cell-biology",
    kind: "quiz",
    tags: ["science", "true-false"],
    request: "A true/false quiz on cell biology for grade 9: 12 statements, with the answers.",
  },
  {
    id: "quiz-spanish-food",
    kind: "quiz",
    tags: ["language", "matching"],
    request: "A beginner Spanish vocabulary quiz on food: a matching section and a fill-in-the-blank section.",
  },
  {
    id: "quiz-si-units",
    kind: "quiz",
    tags: ["physics", "units"],
    request: "A short grade 10 physics quiz on SI units and unit conversions.",
  },
  {
    id: "quiz-equivalent-fractions-exit-ticket",
    kind: "quiz",
    tags: ["math"],
    request: "An exit ticket on equivalent fractions: 3 quick questions.",
  },
  {
    id: "exam-algebra-final",
    kind: "exam",
    tags: ["math", "answer-key"],
    request: "A 90-minute Algebra II final exam in three sections (multiple choice, short answer, extended response) with points for each question and an answer key.",
  },
  {
    id: "exam-stoichiometry",
    kind: "exam",
    tags: ["chemistry", "math"],
    request: "A 45-minute grade 11 chemistry test on stoichiometry and the mole, with balanced equations.",
  },
  {
    id: "exam-world-war-one",
    kind: "exam",
    tags: ["history", "sources"],
    request: "A grade 10 history exam on World War I with source-based questions and one essay question.",
  },
  {
    id: "exam-calculus-midterm",
    kind: "exam",
    tags: ["math", "answer-key"],
    request: "A 60-minute calculus midterm on limits and derivatives, with worked solutions for the teacher.",
  },
  {
    id: "exam-forces",
    kind: "exam",
    tags: ["physics", "diagram"],
    request: "A grade 11 physics exam on kinematics and Newton's laws, including a free-body diagram of a block on an inclined plane.",
  },
  {
    id: "lesson-plan-water-cycle",
    kind: "lesson-plan",
    tags: ["science"],
    request: "A 45-minute lesson plan for grade 4 on the water cycle.",
  },
  {
    id: "lesson-plan-persuasive-writing",
    kind: "lesson-plan",
    tags: ["language"],
    request: "A lesson plan for teaching persuasive writing to grade 8 over two 50-minute sessions.",
  },
  {
    id: "handout-french-revolution",
    kind: "handout",
    tags: ["history"],
    request: "Cornell-style study notes on the causes of the French Revolution.",
  },
  {
    id: "handout-pythagoras",
    kind: "handout",
    tags: ["math", "diagram"],
    request: "A handout explaining the Pythagorean theorem, with a labelled right triangle and a worked example.",
  },
  {
    id: "rubric-argumentative-essay",
    kind: "rubric",
    tags: ["rubric"],
    request: "A rubric for an argumentative essay with 4 criteria and 4 performance levels.",
  },
  {
    id: "rubric-science-fair",
    kind: "rubric",
    tags: ["rubric"],
    request: "A science fair project rubric with points for each criterion.",
  },
  {
    id: "arabic-worksheet-decimals",
    kind: "worksheet",
    tags: ["multilingual", "rtl", "math"],
    request: "اكتب ورقة عمل للصف السادس عن الكسور العشرية، مع مفتاح الإجابة.",
  },
  {
    id: "arabic-quiz-solar-system",
    kind: "quiz",
    tags: ["multilingual", "rtl", "science", "mcq"],
    request: "A short multiple-choice quiz in Arabic for grade 4 on the solar system.",
  },
  {
    id: "bengali-worksheet-plants",
    kind: "worksheet",
    tags: ["multilingual", "science"],
    // "Write a science worksheet for class 4 on the parts of a plant." Escaped: Bengali has
    // combining marks, which stay out of source files (CLAUDE.md).
    request:
      "\u099a\u09a4\u09c1\u09b0\u09cd\u09a5 \u09b6\u09cd\u09b0\u09c7\u09a3\u09bf\u09b0 \u099c\u09a8\u09cd\u09af \u0989\u09a6\u09cd\u09ad\u09bf\u09a6\u09c7\u09b0 \u0985\u0982\u09b6 \u09a8\u09bf\u09af\u09bc\u09c7 \u098f\u0995\u099f\u09bf \u09ac\u09bf\u099c\u09cd\u099e\u09be\u09a8 \u0995\u09be\u09b0\u09cd\u09af\u09aa\u09a4\u09cd\u09b0 \u09b2\u09c7\u0996\u09cb\u0964",
  },
  {
    id: "bengali-quiz-multiplication",
    kind: "quiz",
    tags: ["multilingual", "math"],
    request: "A grade 3 multiplication quiz in Bengali, 8 questions.",
  },
];
