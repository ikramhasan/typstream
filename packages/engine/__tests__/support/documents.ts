// Documents for engine tests, usable in Node and in the browser.

const section = (i: number): string => `
== Section ${i}: roots of polynomials
Let $f(x) = sum_(k=0)^n a_k x^k$ be a polynomial of degree $n$ with *real* coefficients. We study how
the roots move as the coefficients $a_k$ vary, and give a short argument for the bound
$|z| <= 1 + max_k |a_k / a_n|$. The proof is _elementary_ and uses only the triangle inequality.

$ |f(z)| >= |a_n| |z|^n - sum_(k<n) |a_k| |z|^k > 0 quad "for" |z| > R $

#table(columns: 4, [$k$], [$a_k$], [$|a_k|$], [note],
  [0], [$-1$], [1], [constant], [1], [$1/2$], [0.5], [linear], [2], [$pi$], [3.14], [quadratic])

Students often confuse the *degree* of a polynomial with the number of distinct roots:
- the fundamental theorem of algebra counts roots with multiplicity;
- a real polynomial of odd degree has at least one real root;
- complex roots of real polynomials come in conjugate pairs.

Some more prose follows, so that the section has a realistic paragraph length. A careful reader
will check each step of the argument against a small example such as $x^2 - 2$, whose roots
$plus.minus 1.414$ lie well inside the bound.
`;

/**
 * About five A4 pages of what worksheets are made of: headings, prose, inline
 * and display math, a table, a list. Every token-sized prefix of it heals to a
 * source that compiles without errors (checked in server.test.ts), so a stream
 * of it must produce no error frames.
 */
export const FIVE_PAGES = `#set page(paper: "a4")\n#set heading(numbering: "1.")\n= A five page handout\n${Array.from(
  { length: 11 },
  (_, i) => section(i + 1),
).join("")}`;
