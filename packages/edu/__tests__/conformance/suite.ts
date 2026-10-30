// edu's conformance suite (#135): every catalogue entry's example, every template spec and every prompt example, as a
// student's copy and with the answers shown, must look the same in the paged view, Typst's PDF and the DOCX export.
import { type ConformanceExample, type ConformanceSuite, withInputs } from "@typstream/conformance";
import { EDU_VERSION, edu, eduCatalogue, eduExamples, eduTemplates, SHOW_ANSWERS_INPUT } from "../../src/index";

/** A body for template examples, so they have questions and points to count. */
const BODY = "\n= Part A\n\n#question(points: 2)[What is $2 + 2$? #blank(answer: [4])]\n";

/**
 * Components inside one another, as documents put them, where a DOCX export once broke what each alone keeps: a
 * callout's table inside a question's cell, its answer line the cell's last paragraph.
 */
const COMBINATIONS: ConformanceExample[] = [
  {
    name: "combination: answer line after a callout in a question",
    source: `#question(points: 2)[
  Read the definition, then use it in a sentence.
  #callout(kind: "definition")[*Photosynthesis* is how plants make food from light.]
  #answer-lines(count: 1, answer: [Plants use photosynthesis to grow.])
]

#question(points: 1)[Name the gas plants take in. #answer-lines(count: 1, answer: [Carbon dioxide.])]
`,
  },
  {
    name: "combination: blanks after equations that end with an operator",
    source: `#question(points: 3)[
  + $1/5 + 2/5 =$ #blank(answer: [$3/5$])
  + $3^2 + 4^2 =$ #blank(answer: [25])
]
`,
  },
];

const examples: ConformanceExample[] = [
  ...eduCatalogue.map((d) => ({
    name: `catalogue: ${d.name}`,
    source: (d.example ?? "") + (d.example?.startsWith("#show:") ? BODY : ""),
  })),
  ...eduTemplates.map((t) => ({ name: `template: ${t.name}`, source: t.preamble + BODY })),
  ...eduExamples.map((e) => ({ name: `example: ${e.title}`, source: e.output })),
  ...COMBINATIONS,
];

export const suite: ConformanceSuite = {
  name: `edu-${EDU_VERSION}`,
  plugins: [edu],
  examples: withInputs(examples, [{ [SHOW_ANSWERS_INPUT]: "false" }, { [SHOW_ANSWERS_INPUT]: "true" }]),
};
