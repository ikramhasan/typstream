// mermaid's conformance suite (#135): its prompt examples and a diagram of each kind teachers' documents use must
// look the same in the paged view, Typst's PDF and the DOCX export (where a diagram is a picture with its labels on
// it), and the HTML target as the pages.
import type { ConformanceSuite } from "@typstream/conformance";
import { htmlCompat } from "@typstream/html-compat";
import { MERMAID_VERSION, mermaid, mermaidExamples } from "../../src/index";

/** One diagram of each kind, in a figure. */
const KINDS: Record<string, string> = {
  "class diagram": `classDiagram
  Animal <|-- Bird
  Animal <|-- Fish
  Animal : +int legs
  Animal : +eat()
  Bird : +fly()
  Fish : +swim()`,
  "state diagram": `stateDiagram-v2
  [*] --> Solid
  Solid --> Liquid: melts
  Liquid --> Gas: boils
  Gas --> Liquid: condenses
  Liquid --> Solid: freezes`,
  "entity relationship diagram": `erDiagram
  STUDENT ||--o{ ENROLMENT : has
  COURSE ||--o{ ENROLMENT : includes
  STUDENT { string name int year }`,
  timeline: `timeline
  title Space exploration
  1957 : Sputnik 1
  1969 : Apollo 11 lands on the Moon
  1990 : Hubble telescope
  2021 : James Webb telescope`,
  "Gantt chart": `gantt
  title Science project
  dateFormat YYYY-MM-DD
  section Plan
  Choose a question :a1, 2026-01-05, 3d
  Research :after a1, 5d
  section Do
  Experiment :2026-01-15, 4d
  Write up :2026-01-20, 3d`,
  "quadrant chart": `quadrantChart
  title Study habits
  x-axis Low effort --> High effort
  y-axis Low impact --> High impact
  quadrant-1 Do more
  quadrant-2 Plan
  quadrant-3 Drop
  quadrant-4 Delegate
  Flashcards: [0.3, 0.8]
  Rereading: [0.4, 0.2]
  Practice tests: [0.7, 0.9]`,
  "XY chart": `xychart
  title "Rainfall (mm)"
  x-axis [Jan, Feb, Mar, Apr, May]
  y-axis "mm" 0 --> 120
  bar [80, 65, 90, 40, 30]
  line [80, 65, 90, 40, 30]`,
  "user journey": `journey
  title A school morning
  section Before school
    Wake up: 3: Student
    Breakfast: 4: Student, Parent
  section At school
    First lesson: 5: Student, Teacher`,
  "mind map": `mindmap
  root((Energy))
    Renewable
      Solar
      Wind
    Fossil
      Coal
      Gas`,
};

export const suite: ConformanceSuite = {
  name: `mermaid-${MERMAID_VERSION}`,
  plugins: [htmlCompat, mermaid],
  examples: [
    ...mermaidExamples.map((e) => ({ name: `example: ${e.title}`, source: e.output })),
    ...Object.entries(KINDS).map(([name, diagram]) => ({
      name: `kind: ${name}`,
      source: `#figure(kind: image, caption: [Example: ${name}.])[\n\`\`\`mermaid\n${diagram}\n\`\`\`\n]\n`,
    })),
  ],
};
