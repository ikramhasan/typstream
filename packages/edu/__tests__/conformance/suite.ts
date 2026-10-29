// edu's conformance suite (#135): every catalogue entry's example, every template spec and every prompt example, as a
// student's copy and with the answers shown, must look the same in the paged view, Typst's PDF and the DOCX export.
import { type ConformanceExample, type ConformanceSuite, withInputs } from "@typstream/conformance";
import { EDU_VERSION, edu, eduCatalogue, eduExamples, eduTemplates, SHOW_ANSWERS_INPUT } from "../../src/index";

/** A body for template examples, so they have questions and points to count. */
const BODY = "\n= Part A\n\n#question(points: 2)[What is $2 + 2$? #blank(answer: [4])]\n";

const examples: ConformanceExample[] = [
  ...eduCatalogue.map((d) => ({
    name: `catalogue: ${d.name}`,
    source: (d.example ?? "") + (d.example?.startsWith("#show:") ? BODY : ""),
  })),
  ...eduTemplates.map((t) => ({ name: `template: ${t.name}`, source: t.preamble + BODY })),
  ...eduExamples.map((e) => ({ name: `example: ${e.title}`, source: e.output })),
];

export const suite: ConformanceSuite = {
  name: `edu-${EDU_VERSION}`,
  plugins: [edu],
  examples: withInputs(examples, [{ [SHOW_ANSWERS_INPUT]: "false" }, { [SHOW_ANSWERS_INPUT]: "true" }]),
};
