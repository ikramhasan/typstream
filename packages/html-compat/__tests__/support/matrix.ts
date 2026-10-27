// The coverage matrix (issue #15, PLAN.md §6.5): one entry per element and common parameter.
// Every entry must compile to HTML with the prelude without "ignored during HTML export"
// warnings, and its HTML must hold every letter and digit of its paged output, except the
// `missing` ones, which are documented gaps.

export interface MatrixEntry {
  name: string;
  source: string;
  /** What the HTML must contain: proof the mapping is the intended one. */
  html?: RegExp;
  /** Characters of the paged text HTML is allowed to lack, and why. */
  missing?: { chars: string; why: string };
  /** Without the prelude, HTML export drops this: warns that it ignored something, or loses text. */
  nativeDrops?: boolean;
}

const BIB = `bytes("@book{knuth, title={The Art of Computer Programming}, author={Knuth, Donald}, year={1968}}")`;

// A drawing built the way CeTZ builds its canvas: an unbreakable block of `place`d curves and labels
// (cetz 0.4.2 src/canvas.typ). The real packages have entries below (#25); this one keeps the shape
// covered without them.
const CANVAS = `#block(breakable: false, width: 4cm, height: 2cm, {
  place(top + left, dx: 0pt, dy: 0pt, curve(curve.move((0pt, 0pt)), curve.line((3cm, 1.5cm))))
  place(top + left, dx: 1cm, dy: 1cm)[Label A]
  place(top + left, dx: 2.5cm, dy: 0.2cm, circle(radius: 4pt))
})`;

export const MATRIX: MatrixEntry[] = [
  // Grid
  {
    name: "grid",
    source: "#grid(columns: 2, gutter: 1em, [Alpha], [Beta], [Gamma], [Delta])",
    html: /ts-grid/,
    nativeDrops: true,
  },
  {
    name: "grid: fr, auto and fixed columns",
    source: "#grid(columns: (1fr, 2fr, auto, 2cm), [Aa], [Bb], [Cc], [Dd])",
    html: /minmax\(0, 2fr\)/,
    nativeDrops: true,
  },
  {
    name: "grid: colspan, rowspan, explicit x/y",
    source:
      "#grid(columns: 3, grid.cell(colspan: 2)[Wide], [Cc], grid.cell(rowspan: 2)[Tall], [Ee], [Ff], grid.cell(x: 2, y: 3)[Last])",
    html: /grid-area: 4 \/ 3/,
    nativeDrops: true,
  },
  {
    name: "grid: header and footer",
    source: "#grid(columns: 2, grid.header([Head1], [Head2]), [Body1], [Body2], grid.footer([Foot1], [Foot2]))",
    nativeDrops: true,
  },
  {
    name: "grid: hline and vline",
    source: "#grid(columns: 2, [Aa], grid.vline(), [Bb], grid.hline(), [Cc], [Dd])",
    html: /border-top/,
    nativeDrops: true,
  },
  {
    name: "grid: stroke, fill, align, inset as functions",
    source:
      "#grid(columns: 2, stroke: 0.5pt, fill: (x, y) => if y == 0 { luma(230) }, align: (x, y) => (left, right).at(x), inset: 4pt, [Aa], [Bb], [Cc], [Dd])",
    html: /text-align: right/,
    nativeDrops: true,
  },
  {
    name: "grid: vertical alignment",
    source: "#grid(columns: 2, align: horizon, [Tall \\ cell], [Mid])",
    html: /ts-valign/,
    nativeDrops: true,
  },

  // Tables (native HTML tables; the prelude adds cell styling)
  { name: "table", source: "#table(columns: 3, [*A*], [*B*], [*C*], [1], [2], [3])", html: /<table>/ },
  {
    name: "table: header and footer",
    source: "#table(columns: 2, table.header([H1], [H2]), [b1], [b2], table.footer([F1], [F2]))",
    html: /<thead>/,
  },
  {
    name: "table: colspan and rowspan",
    source:
      "#table(columns: 3, table.cell(colspan: 2)[Wide], [Cc], table.cell(rowspan: 2)[Tall], [Dd], [Ee], [Ff], [Gg])",
    html: /colspan="2"/,
  },
  {
    name: "table: fill, align, stroke none",
    source:
      "#table(columns: 2, stroke: none, fill: (x, y) => if y == 0 { gray }, align: (left, right), [Aa], [Bb], [Cc], [Dd])",
    html: /ts-no-stroke.*text-align: right/,
  },
  {
    name: "table: hline and vline",
    source: "#table(columns: 2, [Aa], table.vline(stroke: red), [Bb], table.hline(), [Cc], [Dd])",
  },

  // Alignment and containers
  { name: "align", source: "#align(center)[Centered text]", html: /text-align: center/, nativeDrops: true },
  { name: "align: inside a paragraph", source: "Before #align(right)[Right] after", nativeDrops: true },
  {
    name: "block",
    source: "#block(fill: luma(230), inset: 8pt, radius: 4pt, stroke: (bottom: 1pt + blue))[Block body]",
    html: /ts-block.*border-bottom/,
  },
  { name: "block: width", source: "#block(width: 50%, breakable: false, stroke: 1pt)[Block body]", html: /width: 50%/ },
  { name: "box", source: "Text #box(fill: yellow, inset: 2pt, baseline: 20%)[Boxed] text", html: /ts-box/ },
  {
    name: "box: answer blank",
    source: "Name: #box(width: 3cm, stroke: (bottom: 0.5pt))",
    html: /width: 85\.039pt; |border-bottom/,
  },
  {
    name: "blocks inside a box stay inside its paragraph",
    source: "Text #box(width: 4cm, height: 2cm)[#place(center)[#rect[In rect]] #align(right)[Right]] after",
    // A <div> inside the box's <span> would make the browser close the <p> early.
    html: /<p>Text <span class="ts-box"[^>]*><span class="ts-place ts-b"[^>]*><span class="ts-shape ts-rect ts-b"/,
  },
  {
    name: "stack",
    source: "#stack(dir: ltr, spacing: 1em, [Left], 1fr, [Right])",
    html: /flex-direction: row/,
    nativeDrops: true,
  },
  { name: "stack: ttb", source: "#stack([Top], [Bottom])", html: /flex-direction: column/, nativeDrops: true },
  {
    name: "columns and colbreak",
    source: "#columns(2)[First column text #colbreak() Second column text]",
    html: /column-count: 2/,
    nativeDrops: true,
  },
  { name: "pad", source: "#pad(x: 1em)[Padded text]", html: /ts-pad/, nativeDrops: true },

  // Placement
  {
    name: "place",
    source: "#place(top + right)[Placed text] Body text",
    html: /ts-place.*right: 0/,
    nativeDrops: true,
  },
  {
    name: "place: dx, dy",
    source: "#block(height: 2cm)[#place(bottom + center, dy: -4pt)[Caption] Body]",
    html: /translate/,
    nativeDrops: true,
  },
  {
    name: "place: float",
    source: "#place(bottom, float: true)[Floating text] Body text",
    html: /ts-float/,
    nativeDrops: true,
  },

  // Shapes
  { name: "rect", source: "#rect(width: 4cm, fill: aqua)[Rect body]", html: /ts-rect/, nativeDrops: true },
  { name: "rect: empty", source: "#rect(width: 2cm, height: 1cm)", html: /ts-rect/, nativeDrops: true },
  {
    name: "square, circle, ellipse",
    source: "#square[Sq] #circle(radius: 1cm)[Ci] #ellipse[El]",
    html: /border-radius: 50%/,
    nativeDrops: true,
  },
  {
    name: "line",
    source: 'Above\n#line(length: 100%, stroke: (dash: "dashed"))\nBelow',
    html: /ts-line.*dashed/,
    nativeDrops: true,
  },
  {
    name: "line: angled (drawn)",
    source: "#line(start: (0pt, 0pt), end: (2cm, 1cm))",
    html: /ts-frame/,
    nativeDrops: true,
  },
  {
    name: "polygon and curve (drawn)",
    source: "#polygon((0pt, 0pt), (10pt, 0pt), (5pt, 10pt)) #curve(curve.move((0pt, 0pt)), curve.line((10pt, 10pt)))",
    html: /ts-frame/,
    nativeDrops: true,
  },
  { name: "canvas of placed drawings (CeTZ-style)", source: CANVAS, html: /ts-frame" role="img" aria-label="Label A"/ },
  // Packages typstream vendors (@typstream/universe, #25). fletcher 0.5.8 is a known gap: its
  // cetz 0.3.4 canvas calls `layout` inside `context`, within the package, so it stays empty.
  {
    name: "CeTZ canvas (@preview/cetz:0.5.3)",
    source: `#import "@preview/cetz:0.5.3"
#cetz.canvas({
  import cetz.draw: *
  grid((-2, -2), (2, 2), step: 1, stroke: gray + 0.3pt)
  circle((0, 0), radius: 1)
  line((-2, 0), (2, 0), mark: (end: ">"))
  content((1.4, 1.4), [Unit circle])
})`,
    html: /ts-frame" role="img" aria-label="Unit circle"/,
    nativeDrops: true,
  },
  {
    name: "function graph (@preview/cetz-plot:0.1.4)",
    source: `#import "@preview/cetz:0.5.3"
#import "@preview/cetz-plot:0.1.4": plot
#cetz.canvas(plot.plot(size: (5, 3), x-label: [time], y-label: [height], {
  plot.add(domain: (-2, 2), x => x * x - 1)
}))`,
    html: /ts-frame" role="img" aria-label="[^"]*time[^"]*height/,
    nativeDrops: true,
  },
  {
    name: "structural formula (@preview/alchemist:0.2.0)",
    source: `#import "@preview/alchemist:0.2.0": *
#skeletize({
  fragment("H_3C")
  single()
  fragment("CH_2")
  single()
  fragment("OH")
})`,
    html: /ts-frame" role="img"/,
    nativeDrops: true,
  },
  {
    name: "box of placed pieces (hand-made diagram)",
    source:
      "#box(width: 8cm, height: 3cm)[\n#place(center + horizon, rect[$m = 1200$ kg])\n#place(left + horizon)[friction]\n#place(bottom, line(length: 100%))\n]",
    html: /ts-frame" role="img" aria-label="m = 1200 kg friction"/,
    nativeDrops: true,
  },
  {
    name: "rect with placed labels",
    source:
      "#rect(width: 3.5cm, height: 2cm)[#place(bottom + center, dy: 1.2em)[7 cm] #place(right + horizon, dx: 3.4em)[4 cm]]",
    // Both point away from their edge: outside the rect, so the theme keeps the page's colors (#64).
    html: /class="ts-place ts-place-out"[^>]*>7 cm.*class="ts-place ts-place-out"[^>]*>4 cm/s,
    nativeDrops: true,
  },
  {
    name: "place: offsets inside the container",
    source:
      "#rect(width: 4cm, height: 3cm, fill: white)[#place(bottom + right)[Corner] #place(top + left, dx: 4pt, dy: 4pt)[Inset] #place(left + horizon, dx: -1cm)[Margin]]",
    // Only the label pushed past the left edge is outside (#64).
    html: /class="ts-place"[^>]*>Corner.*class="ts-place"[^>]*>Inset.*class="ts-place ts-place-out"[^>]*>Margin/s,
    nativeDrops: true,
  },

  // Spacing and breaks
  { name: "v", source: "Para one\n#v(2em)\nPara two", html: /height: 2em/, nativeDrops: true },
  { name: "h", source: "Word #h(1em) word #h(1fr) end", html: /ts-hfill/, nativeDrops: true },
  { name: "pagebreak", source: "Page one #pagebreak() Page two", html: /ts-pagebreak/, nativeDrops: true },

  // Transforms and visibility
  {
    name: "move, rotate, scale, skew",
    source: "#move(dx: 5pt)[Moved] #rotate(45deg)[Rotated] #scale(x: 150%)[Scaled] #skew(ax: 10deg)[Skewed]",
    html: /skew\(-10deg/,
    nativeDrops: true,
  },
  { name: "hide", source: "Visible #hide[Hidden] visible", html: /ts-hide/, nativeDrops: true },
  {
    name: "repeat (leader dots)",
    source: "Name #box(width: 1fr, repeat[.]) Page",
    html: /ts-repeat/,
    nativeDrops: true,
  },
  { name: "layout", source: "#layout(size => [Width is #size.width])", nativeDrops: true },

  // Semantic elements HTML export handles natively
  { name: "headings, numbered", source: '#set heading(numbering: "1.1")\n= Intro\n== Sub', html: /<h2>1 Intro/ },
  { name: "lists and terms", source: "- one\n- two\n+ first\n+ second\n/ Term: Definition", html: /<dl>/ },
  {
    name: "enum: explicit numbers, start, reversed",
    source: "4. four\n5. five\n\n#enum(start: 7, [seven])\n\n#enum(reversed: true, [b], [a])",
  },
  { name: "enum: numbering pattern", source: '#set enum(numbering: "a)")\n+ alpha\n+ beta', html: /ts-marker">a\)/ },
  {
    name: "quote",
    source: "#quote(block: true, attribution: [Someone])[Quoted words] and #quote[inline]",
    html: /<blockquote>/,
  },
  { name: "raw", source: "`inline` and\n```py\nprint(1)\n```", html: /<pre>/ },
  {
    name: "link",
    source: '#link("https://typst.app")[Typst] and https://example.com',
    html: /href="https:\/\/typst.app"/,
  },
  {
    name: "text styles",
    source:
      "#underline[Under] #overline[Over] #strike[Struck] #highlight[Hi] #smallcaps[Small] H#sub[2]O x#super[2] #upper[up]",
  },
  {
    name: "figure: table",
    source: "#figure(table(columns: 2, [Aa], [Bb]), caption: [Tab caption]) <t>\nSee @t.",
    html: /<figcaption>Table\s1/,
  },
  {
    name: "figure: image",
    source:
      "#figure(image(bytes(\"<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'/>\")), caption: [Img caption])",
    html: /Figure\s1/,
  },
  { name: "figure: raw", source: "#figure(```py\nx = 1\n```, caption: [Code caption])", html: /Listing\s1/ },
  {
    name: "figure: custom kind",
    source: '#figure([Content], kind: "exercise", supplement: [Exercise], caption: [Ex caption]) <e>\nSee @e.',
    html: /Exercise\s1/,
  },
  {
    name: "figure: grid body",
    source: "#figure(grid(columns: 2, [Left], [Right]), caption: [Side by side])",
    html: /<figure>.*ts-grid/,
  },
  {
    name: "outline",
    source: '#outline()\n#set heading(numbering: "1.")\n= First\n== Second',
    html: /doc-toc/,
    missing: { chars: "11", why: "outline page numbers: HTML has no pages" },
  },
  {
    name: "outline of figures",
    source: "#outline(target: figure.where(kind: table))\n#figure(table([Aa]), caption: [Tcap])",
    missing: { chars: "1", why: "outline page numbers: HTML has no pages" },
  },
  { name: "footnote", source: "Text#footnote[Note body] more.", html: /doc-endnotes/ },
  {
    name: "bibliography and cite",
    source: `See @knuth and #cite(<knuth>, form: "prose").\n#bibliography(${BIB})`,
    html: /doc-bibliography/,
  },
  { name: "title", source: "#set document(title: [Doc Title])\n#title()", html: /<h1>/ },

  // Math
  {
    name: "math: inline and block",
    source: "Inline $a^2 + b^2 = c^2$ and\n$ sum_(k=0)^n k = (n(n+1))/2 $",
    html: /<math display="block">/,
  },
  {
    name: "math: equation numbering",
    source: '#set math.equation(numbering: "(1)")\n$ x = 1 $ <eq>\n$ y = 2 $\nSee @eq.',
    html: /ts-equation-number">\(2\)/,
    nativeDrops: true,
  },
  {
    name: "math: matrix, vec, cases",
    source: '$ mat(1, 2; 3, 4) quad vec(x, y) quad f(x) = cases(1 "if" x > 0, 0 "else") $',
    html: /<mspace width="1em"\/>/,
  },
  { name: "math: alignment", source: "$ a &= b + c \\\\ &= d $", html: /aligned/ },
  { name: "math: overline (as accent)", source: "$ overline(a b) $", html: /<mover accent="true">/ },
  { name: "math: cancel (drawn)", source: "$ cancel(x) + y $", html: /ts-frame/ },
  { name: "math: box inside an equation", source: "$ x + #box(stroke: 1pt)[y] $" },
];
