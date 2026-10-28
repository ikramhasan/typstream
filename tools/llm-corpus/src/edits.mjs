// Edit requests (#34): what a teacher asks of a document that exists, over kit-v4 Sonnet
// documents in corpus/llm. Each names the blocks it should change by a piece of text in them
// (`targets`), or says the model should ask (`ask`): the request doesn't say which part it means.
// An addition names the block it goes after and, in `may`, the block after that: a model may
// quote either, and the measurement accepts both. `instruction` is the request as a selection edit (the teacher
// highlighted the first target), for requests with one target.

/**
 * @typedef {{ id: string, document: string, request: string, targets?: string[], may?: string[],
 *   ask?: boolean, instruction?: string }} EditRequest
 */

/** @type {EditRequest[]} */
export const EDIT_REQUESTS = [
  // A quiz of ten questions that all start alike: quoting must take enough of one.
  {
    id: "capitals-harder",
    document: "kit-v4-sonnet-quiz-european-capitals",
    request: "Make the question about Spain harder: ask about the capital of a less well-known country instead.",
    targets: ["capital of Spain"],
    instruction: "make it harder: ask about the capital of a less well-known country instead",
  },
  {
    id: "capitals-add",
    document: "kit-v4-sonnet-quiz-european-capitals",
    request: "Add a question about the capital of Norway after the one about Sweden.",
    targets: ["capital of Sweden"],
    may: ["capital of Ireland"],
  },
  {
    id: "capitals-delete",
    document: "kit-v4-sonnet-quiz-european-capitals",
    request: "Remove the question about Greece.",
    targets: ["capital of Greece"],
  },
  {
    id: "capitals-title",
    document: "kit-v4-sonnet-quiz-european-capitals",
    request: 'Change the title to "Capitals of Europe" and the grade to Grade 7.',
    targets: ["title: [European Capitals]"],
    instruction: 'change the title to "Capitals of Europe" and the grade to Grade 7',
  },
  {
    id: "capitals-ask",
    document: "kit-v4-sonnet-quiz-european-capitals",
    request: "Make that question easier.",
    ask: true,
  },
  // A worksheet with a callout, two parts and word problems.
  {
    id: "decimals-fix-answer",
    document: "kit-v4-sonnet-worksheet-decimals",
    request: "The answer to 2.5 × 0.4 should be written as 1.0, not 1. Fix it.",
    targets: ["2.5 times 0.4"],
    instruction: "write the answer as 1.0, not 1",
  },
  {
    id: "decimals-callout",
    document: "kit-v4-sonnet-worksheet-decimals",
    request: "Rewrite the reminder box so a grade 5 student understands it more easily, and give a second example.",
    targets: ['#callout(kind: "remember")'],
    instruction: "rewrite it so a grade 5 student understands it more easily, and give a second example",
  },
  {
    id: "decimals-word-problem",
    document: "kit-v4-sonnet-worksheet-decimals",
    request: "Add a third word problem about buying fruit at the end of Part B.",
    targets: ["rectangular garden"],
    may: ["#answer-key()"],
  },
  {
    id: "decimals-two-edits",
    document: "kit-v4-sonnet-worksheet-decimals",
    request: "Change question 1 to 0.7 × 0.3 and question 2 to 0.9 × 0.6, with the right answers.",
    targets: ["0.4 times 0.3", "0.6 times 0.7"],
  },
  // A rubric: one block, a table of rows.
  {
    id: "rubric-criterion",
    document: "kit-v4-sonnet-rubric-argumentative-essay",
    request: "Add a fifth criterion for use of sources and citations, and update the total.",
    targets: ["#rubric(", "The total is out of 16"],
  },
  {
    id: "rubric-simpler",
    document: "kit-v4-sonnet-rubric-argumentative-essay",
    request: "Rewrite the Organization row in simpler language for grade 7 students.",
    targets: ["[Organization]"],
  },
  {
    id: "rubric-ask",
    document: "kit-v4-sonnet-rubric-argumentative-essay",
    request: "Fix the wording there.",
    ask: true,
  },
  // A worksheet in three parts, the questions numbered by edu.
  {
    id: "equations-harder",
    document: "kit-v4-sonnet-worksheet-linear-equations",
    request: "Make Part A a bit harder: use negative numbers in its first two questions.",
    targets: ["Solve $x + 7 = 15$", "Solve $5 x = 40$"],
  },
  {
    id: "equations-hint",
    document: "kit-v4-sonnet-worksheet-linear-equations",
    request: "In the last question, add a hint reminding students to expand the brackets first.",
    targets: ["Explain the mistake"],
    instruction: "add a hint reminding students to expand the brackets first",
  },
  {
    id: "equations-points",
    document: "kit-v4-sonnet-worksheet-linear-equations",
    request: "Question 12 should be worth 5 points.",
    targets: ["A number is multiplied by 3"],
    instruction: "make it worth 5 points",
  },
  {
    id: "equations-delete-part",
    document: "kit-v4-sonnet-worksheet-linear-equations",
    request: "Remove Part C entirely.",
    targets: ["= Part C", "(2 x + 1)/3", "x/2 - x/3", "A number is multiplied", "A taxi charges", "Explain the mistake"],
  },
  // An exam with chemistry, a data box and a rubric.
  {
    id: "stoichiometry-replace",
    document: "kit-v4-sonnet-exam-stoichiometry",
    request: "Replace the question about the molar mass of CaCO3 with one about the molar mass of NaOH.",
    targets: ['molar mass of #ce("CaCO3")'],
    instruction: "ask about the molar mass of NaOH instead",
  },
  {
    id: "stoichiometry-data",
    document: "kit-v4-sonnet-exam-stoichiometry",
    request: "Add the molar masses N = 14 and S = 32 to the data box.",
    targets: ['Molar masses ($"g/mol"$)'],
    instruction: "add the molar masses N = 14 and S = 32",
  },
  {
    id: "stoichiometry-duration",
    document: "kit-v4-sonnet-exam-stoichiometry",
    request: "The exam is 60 minutes now.",
    targets: ["duration: [45 minutes]"],
  },
  {
    id: "stoichiometry-ask",
    document: "kit-v4-sonnet-exam-stoichiometry",
    request: "That calculation is wrong, fix it.",
    ask: true,
  },
  // Arabic, asked in Arabic and in English.
  {
    id: "solar-add",
    document: "kit-v4-sonnet-arabic-quiz-solar-system",
    request: "أضف سؤالًا عن أبعد كوكب عن الشمس بعد السؤال عن أكبر كوكب.",
    targets: ["ما هو أكبر كوكب"],
    may: ["أي كوكب له حلقات"],
  },
  {
    id: "solar-translate",
    document: "kit-v4-sonnet-arabic-quiz-solar-system",
    request: "Translate the question about the red planet into English. Keep the rest in Arabic.",
    targets: ["بالكوكب الأحمر"],
    instruction: "translate it into English",
  },
  // A lesson plan: headings, lists, a table and an exit ticket.
  {
    id: "water-timing",
    document: "kit-v4-sonnet-lesson-plan-water-cycle",
    request: "Make stage 4, the guided activity, 15 minutes, and stage 5 only 5 minutes.",
    targets: ["== 4. Guided activity", "== 5. Share and exit ticket"],
  },
  {
    id: "water-exit-question",
    document: "kit-v4-sonnet-lesson-plan-water-cycle",
    request: "Add a fourth exit ticket question asking students where water collects.",
    targets: ["never runs out of water"],
    may: ["= Differentiation"],
  },
];
