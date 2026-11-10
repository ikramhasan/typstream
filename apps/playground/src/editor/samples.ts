// Documents the editor playground opens: plain markup, lists and a table, and an edu exam.

import exam from "../../../../packages/edu/examples/exam-chemistry.typ?raw";

const worksheet = `= Fractions practice

Write your name at the top. Answer every question in the space given.

== Warm-up

+ What is half of 10?
+ Shade a quarter of the circle.
+ Which is bigger, 2/3 or 3/4?

Things you need:

- a pencil
- a ruler

#table(
  columns: 3,
  [Fraction], [Decimal], [Percent],
  [1/2], [0.5], [50%],
  [1/4], [0.25], [25%],
)

Some *bold* text, some _emphasis_ and a final paragraph.
`;

const blank = "";

export const SAMPLES: Record<string, string> = { worksheet, exam, blank };
