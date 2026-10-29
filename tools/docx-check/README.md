# DOCX checks (#131)

`check.mjs` exports every Latin corpus document (the edu and llm sets, without non-Latin scripts) to PDF and DOCX
through `@typstream/node`, healed in final mode first as an engine exports it (lint fixes included, the layout
profile's among them), has a layout engine lay the DOCX out, and compares its lines and page starts with Typst's
PDF (`lines.mjs`). Documents with images or drawings hold placeholders until #133, and are reported apart.

Documents with equations (#132) are reported apart too: each engine sets math itself (LibreOffice in formula objects
of its own spacing), so their lines are compared by the text around the equations (`textLinesOf`: `pdftohtml`'s
pieces without those in a math face, or in a face Typst's PDF doesn't use, which is how ONLYOFFICE draws operators),
and every equation must come out whole: its letters and digits, in order, as in Typst's PDF
(`mathOf`).

```bash
pnpm turbo run build --filter=@typstream/docx-check^...
node tools/docx-check/check.mjs                         # LibreOffice (soffice on PATH, and poppler's pdftotext)
node tools/docx-check/check.mjs edu/worksheet           # documents whose id contains a filter
node tools/docx-check/check.mjs --onlyoffice            # ONLYOFFICE's x2t (Docker, onlyoffice/documentserver)
node tools/docx-check/check.mjs --native                # engine-wasm's native example for the model, no wasm build:
                                                        #   cargo run --release --example docx_model (in engine-wasm)
```

Files and LibreOffice's PDFs go to `$TMPDIR/typstream-docx-check` (`results.json` holds each document's numbers).

**Microsoft's validator** (`validator/`, the Open XML SDK's `OpenXmlValidator` for Microsoft 365): any error is one
Word would report as unreadable content.

```bash
dotnet publish tools/docx-check/validator -c Release -o tools/docx-check/validator/out
node tools/docx-check/check.mjs --validate tools/docx-check/validator/out/validator.dll --min-lines 0.99 --min-math-lines 0.95
```

CI's `DOCX (validator, LibreOffice)` job runs that: it fails on any validator error, on an equation that doesn't
come out whole, and when fewer of Typst's lines come back than the floors (`--min-lines` on the documents without
equations or placeholders, `--min-math-lines` on those with equations; LibreOffice versions differ, so they're
floors, not per-document baselines). The nightly `DOCX (ONLYOFFICE)` job reports ONLYOFFICE's numbers.

Working on the model: `examples/frames.rs` in engine-wasm dumps a document's laid-out frames (items, positions,
tags), and `examples/docx_model.rs` writes its model, fonts and Typst's PDF; with `--native`, the check gets Universe's
packages and each set's `assets/` the same way. A full native run takes about half a minute.

Known differences: a word longer than its table column runs past the cell in Typst, where Word-like engines break it
inside the cell; ONLYOFFICE gives a paragraph as short as a rule (an exact line height under about a point) more
height than LibreOffice does, so its pages drift on documents with many ruled lines.

Equations (#132): each engine sets math a little wider or taller than Typst, so lines move where a paragraph has
several equations and pages overflow where a page has many (an inline fraction in a list item is a few points taller
than Typst's line). LibreOffice sets inline fractions at display size, spaces formulas wider, draws stretchy
brackets in Typst's math font as bars (so brackets around one line of math are plain characters, as Typst sets them),
draws no `cancel` stroke but a horizontal one, and reads `lim` with its limit beside it only as text (written so).
Before 26.2 (CI's Ubuntu has 24.2), it drops a whole equation whose script is a lone operator (an ion's charge,
`Ag^+`), so those scripts are written as text.
ONLYOFFICE draws operators in another face than the document's math font (presumably Cambria Math, which it doesn't
have here, so whatever face has them). Exact line spacing would keep an equation Typst's height but clips it
(LibreOffice, and #118's spike), so lines with math are "at least".
Lines are compared with a leader's dots as one, since how many fit depends on their spacing.

Not math, but in documents with equations, which #131 didn't count: roman page numbers and a numbering restart come
out as the first page's literal footer (the climate report), and a centred table with strokes gets a wide first column
and its strokes as rules (the statistics worksheets).
