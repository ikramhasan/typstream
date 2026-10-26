// @typstream/edu: the vocabulary typstream teaches the model for worksheets, quizzes, exams,
// lesson plans and handouts (PLAN §8.3). Every function renders in the paged and the HTML target,
// in English, Arabic and Bengali. Answers appear only when `sys.inputs.showAnswers` is "true".
//
// The engine preloads this module (`#import …: *`), so documents call `#question` and friends
// directly. Only the names imported here are public; helpers start with `_`.

#import "templates.typ": exam, handout, lesson-plan, quiz, worksheet
#import "questions.typ": matching, mcq, question, true-false
#import "answers.typ": answer, answer-key, answer-lines, answer-space, blank
#import "blocks.typ": callout, instructions, learning-objectives, rubric, student-info
#import "drawings.typ": coordinate-plane, graph-paper, number-line
#import "chem.typ": ce
