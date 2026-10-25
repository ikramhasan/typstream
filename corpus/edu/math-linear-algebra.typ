#set page(margin: 2cm, numbering: "1")
#set text(size: 11pt)
#set math.mat(delim: "[")
#set math.vec(delim: "[")

#let ans(body) = text(fill: rgb("#6a1b9a"))[#body]

#align(center, text(16pt)[*Linear Algebra — Problem Set 4: Matrices and Determinants*])

*Due:* Friday #h(1fr) *Topics:* matrix multiplication, inverses, determinants, eigenvalues

== 1. Matrix arithmetic

Let
$
  A = mat(1, 2; 3, 4), quad
  B = mat(0, -1; 1, 0), quad
  C = mat(2, 0, 1; -1, 3, 2), quad
  bold(v) = vec(1, -2).
$

Compute, if defined: (a) $A + B$ #h(1em) (b) $A B$ #h(1em) (c) $B A$ #h(1em) (d) $A C$ #h(1em) (e) $C A$ #h(1em) (f) $A bold(v)$.

#ans[
  $ A B = mat(2, -1; 4, -3), quad B A = mat(-3, -4; 1, 2), quad A C = mat(0, 6, 5; 2, 12, 11) $
  $C A$ is undefined ($2 times 3$ times $2 times 2$).
]

== 2. Determinants

Find the determinant of each matrix.

$
  P = mat(4, 7; 2, 6), quad
  Q = mat(1, 0, 2; -1, 3, 1; 2, 1, 0), quad
  R = mat(
    2, 0, 0, 0;
    1, 3, 0, 0;
    5, -2, 1, 0;
    0, 4, 7, -1
  )
$

For $Q$, expand along the first row:

$
  det Q = 1 dot mat(delim: "|", 3, 1; 1, 0) - 0 dot mat(delim: "|", -1, 1; 2, 0) + 2 dot mat(delim: "|", -1, 3; 2, 1)
  = 1(-1) - 0 + 2(-7) = -15
$

== 3. Inverses

Show that $P^(-1) = 1/10 mat(6, -7; -2, 4)$ and verify $P P^(-1) = I_2$.

== 4. Systems of equations

Write the system as $A bold(x) = bold(b)$ and solve by row reduction:

$
  cases(
    x + 2y - z = 3,
    2x - y + 3z = 8,
    -x + y + 2z = 3,
  )
$

$
  mat(augment: #3, 1, 2, -1, 3; 2, -1, 3, 8; -1, 1, 2, 3)
  ~
  mat(augment: #3, 1, 2, -1, 3; 0, -5, 5, 2; 0, 3, 1, 6)
$

== 5. Eigenvalues

Find the eigenvalues and eigenvectors of $M = mat(2, 1; 1, 2)$.

$ det(M - lambda I) = (2 - lambda)^2 - 1 = (lambda - 1)(lambda - 3) = 0 $

#ans[
  $lambda_1 = 1$ with $bold(v)_1 = vec(1, -1)$; #h(0.5em) $lambda_2 = 3$ with $bold(v)_2 = vec(1, 1)$.
]

== 6. Proof

Prove that for any invertible $n times n$ matrices $A$ and $B$, $(A B)^(-1) = B^(-1) A^(-1)$.
