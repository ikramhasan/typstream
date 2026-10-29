# DOCX checks (#131)

`check.mjs` exports every Latin corpus document (the edu, llm and islands sets; `--scripts` for the others) to PDF and
DOCX through `@typstream/node`, healed in final mode first as an engine exports it (lint fixes included, the layout
profile's among them), has a layout engine lay the DOCX out, and compares its lines and page starts with Typst's
PDF. Each document is compared as the plugin conformance suite compares an example (#135), with its modules
(tools/conformance: `compare.mjs`, `lines.mjs`, `pixels.mjs`, `ink.mjs`, `office.mjs`).

Documents with pictures (#133: images, CeTZ canvases, mind maps, edu's drawings, boxes with rounded corners) are
reported apart. Text drawn in a picture is outlines in the DOCX, so Typst's is left out of the lines (the model says
where each picture is: `@typstream/node`'s internal `renderDocxModel`). Each picture is compared with Typst's PDF
pixel by pixel (tools/conformance's `pixels.mjs`), as tools/browser-suites' PDF raster suite compares the canvas (#119): both rasterized
by poppler, the differing pixels that touch counted, at most 3 allowed. A picture is found where it is in the other
PDF first, on its page or the next (where the text above it came out taller, the lines already count that), to an
eighth of a point.

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
node tools/docx-check/check.mjs --scripts               # the documents in other scripts (#134)
node tools/docx-check/check.mjs --native --scripts --fonts DIR chinese   # with fonts the engine doesn't ship (CJK)
```

**Other scripts** (#134: Arabic, Bengali, Devanagari, Chinese): `--scripts` checks those documents instead. Their
PDFs' text can't be compared as written: Typst draws a mark (an Arabic dot, an Indic vowel sign) as an item of its
own, which its PDF gives the letter it sits on again, and ONLYOFFICE's PDF drops Indic vowel signs. So each line
(`scriptLinesOf`) is its words' text with words of no width left out and repeated syllables collapsed, and where its
ink starts and ends (poppler's raster, in the middle of the line, which only its own glyphs reach); a line is
reproduced when either is the same (a line broken elsewhere has neither). `--fonts DIR` gives the native example and
the layout engine other fonts: the engine ships no CJK face, so the Chinese document is tofu in both PDFs without
one.

**Rules, borders and shading** (tools/conformance's `ink.mjs`): on documents without equations laid out line for
line, what the pages draw besides text and pictures is compared with Typst's PDF, so a lost border or an underline
drawn off its line shows (the lines compare text only). It is reported, not a floor (`--ink` fails on any): of the 51
such corpus documents, 37 match. The rest are documents a model wrote: blanks of their own (`box(stroke: (bottom:
…))`, its line on the baseline, where Word can only underline at the font's underline position), and tables that go
on to another page.

Files and LibreOffice's PDFs go to `$TMPDIR/typstream-docx-check` (`results.json` holds each document's numbers).

**Google Docs** (`--google-docs`, local only): each DOCX is uploaded to Google Drive through the
[Composio CLI](https://composio.dev) (`composio` on PATH, logged in, `composio link googledrive`), converted to a
Google Doc and exported as PDF (`google-docs.mjs`). Google Docs has no exact line heights: it spaces every line as a
multiple of the font's, so its lines and page starts differ from Typst's where nothing is wrong, and it scales pictures
about 1% and draws their PNGs, so they can't be compared pixel by pixel. What it checks is **text over pictures**: a
word whose box is more than a quarter inside a picture's image in Google's PDF (a picture's own text is in its PNG),
unless Typst's PDF has the same word at about the same place on a picture of about the same size (code over a code
block's box is over it by design). That is how a drawing whose room didn't hold shows (#149: a CeTZ canvas over the
questions after it; #150: boxes, code blocks). It also counts Google's images against the model's pictures, since a
picture Google dropped has no text over it. A document with either fails the run; lines and pages are reported only.

```bash
node tools/docx-check/check.mjs --google-docs                 # the Latin corpus, about 380 Composio requests
node tools/docx-check/check.mjs --google-docs area-perimeter  # documents whose id contains a filter, ~3 requests each
node tools/docx-check/check.mjs --google-docs --google-docx   # also Google's own DOCX of each (a 4th request each)
```

Each run is a folder of its own, named by when it ran and the commit: `typstream-docx-check/<run>` in My Drive (the
uploaded DOCX and its Google Doc) and `$TMPDIR/typstream-docx-check/google-docs/<run>` here (each document's DOCX,
Typst's PDF and model, Google's PDF in `google/`, `results.json`). Nothing is deleted: remove the Drive folder
`typstream-docx-check` and the local `google-docs` folder to clean up every run. The run prints how many Composio
requests it made.

**Microsoft's validator** (`validator/`, the Open XML SDK's `OpenXmlValidator` for Microsoft 365): any error is one
Word would report as unreadable content.

```bash
dotnet publish tools/docx-check/validator -c Release -o tools/docx-check/validator/out
node tools/docx-check/check.mjs --validate tools/docx-check/validator/out/validator.dll --min-lines 0.99 --min-math-lines 0.95 \
  --min-picture-lines 0.92 --min-pictures 0.95
```

and `--scripts` with its own floors (`--min-lines 0.97 --min-math-lines 0.86 --min-picture-lines 0.94 --min-pictures
0.95`). CI's `DOCX (validator, LibreOffice)` job runs both: it fails on any validator error, on an equation that doesn't
come out whole, when fewer of Typst's lines come back than the floors (`--min-lines` on the documents without
equations or pictures, `--min-math-lines` on those with equations, `--min-picture-lines` on those with pictures), and
when fewer pictures than `--min-pictures` match the PDF's pixels (LibreOffice versions differ, so these are floors,
not per-document baselines). The nightly `DOCX (ONLYOFFICE)` job reports ONLYOFFICE's numbers.

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
Lines are compared with a leader's dots as one, since how many fit depends on their spacing. LibreOffice shades
consecutive paragraphs with the same shading as one block, the gaps between them too, so rules one after another
(answer lines) have a paragraph a hundredth of a point tall between them; the line comparison doesn't see colour.

Scripts (#134): in a right-to-left paragraph, LibreOffice and ONLYOFFICE read alignment and indents as the start and
end side (`jc="left"` is the right edge), but disagree on list labels: ONLYOFFICE (as presumably Word) aligns a
`lvlJc="left"` label at the start, the right, and LibreOffice puts it past the margin by its width. ONLYOFFICE ignores
character spacing among complex-script text (Arabic, Indic), so gaps there are no-break spaces, the last spaced by
what is left. LibreOffice sets a Chinese line's closing comma in the line where Typst moved its last character on
(even with `overflowPunct` off); ONLYOFFICE breaks as Typst does. Word has no numbering for Bengali or Eastern Arabic
digits.

Pictures (#133): LibreOffice (24.2 and 26.2) draws an SVG picture whose content stays inside its view box a pixel at
96 DPI smaller than its frame (0.75 pt narrower and shorter, 0.31 pt in from its top left), so every picture's SVG has
a stroke outside its view box, which nothing draws. ONLYOFFICE draws some a few tenths of a point shorter. All three
draw the SVG, not the PNG (that is for older Word and apps that don't read Word's SVG extension).
