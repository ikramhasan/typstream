// typstream's layout profile (#129): the settings under which Word-like layout engines break lines and pages where
// Typst does (#118's spike: LibreOffice equal on 122 Latin documents, ONLYOFFICE 99%), so the paged view, the PDF and
// the DOCX export lay a document out alike. The worker puts it before every document's preamble when it compiles
// pages or exports a PDF. Not for the HTML target, whose browser layout matches no DOCX: html-compat would carry its
// spacing defaults into CSS.
//
// - Lines: a constant pitch of 1.3em, close to Typst's default (14.39pt at 11pt), and a whole number of twips at
//   Word's half-point text sizes. `leading` is 0 and the text's edges make a line box exactly the pitch, the
//   baseline 0.246em above its bottom (Libertinus Serif's descender), as Word's exact line spacing places it.
// - Greedy, ragged-right lines without hyphenation: justification and hyphenation each cost 5–10% of lines in
//   Word, whose breaking differs from Typst's.
// - Table rows don't split (Word: `w:cantSplit`). Not grids': a row that can't split and is taller than a page
//   runs off it, and layout grids hold whole pages.
//
// They're show-set rules, which win over every set rule, a document's or a plugin's, and over `text(..)[..]`
// arguments (styling too). Two things win over them: an element's own arguments (`par(justify: true)[..]`) and a
// later show-set rule on the same element. Plugins use those on purpose (edu's ruled answer lines set their own
// pitch); heal's `layout-profile` lint rule takes them out of documents.
//
// Spacing between blocks isn't fixed: Word expresses any gap (space before), and Typst's weak spacing collapses to
// the larger of two gaps, which the exporter writes as one.

/**
 * The layout profile the worker puts before every document (and its preamble) for pages and PDFs: constant line
 * pitch, ragged right without hyphenation, table rows that don't split (#129). Typst source.
 * @public
 */
export const LAYOUT_PROFILE: string = `// typstream's layout profile: what a DOCX export can reproduce line for line.
#show text: set text(hyphenate: false, top-edge: 1.054em, bottom-edge: -0.246em)
#show par: set par(leading: 0pt, justify: false, linebreaks: "simple")
#show table: set table.cell(breakable: false)
// A line holding only an equation is as tall as the equation, while Word gives every line of a paragraph with math
// at least the pitch: a zero-width strut of one line box makes Typst's line that tall too.
#show math.equation.where(block: false): it => box(height: 1.3em, baseline: 0.246em) + it
// The rows of a display equation with line breaks are par.leading apart: Typst's default, which 0 would make touch.
// (Not inline ones: a paragraph setting inside a line ends the paragraph there.)
#show math.equation.where(block: true): set par(leading: 0.65em)
// Defaults only: Typst's distances between baselines, now that line boxes hold the room above capitals and below
// the baseline (0.64em more than Typst's default edges). Tight lists space their items by par.leading.
#set par(leading: 0pt, spacing: 0.56em)
#show heading: set block(above: 0.71em, below: 0.3em)
#set table(inset: (x: 5pt, y: 1.5pt))
`;
