# DOCX checks (#131)

`check.mjs` exports every Latin corpus document (the edu and llm sets, without non-Latin scripts) to PDF and DOCX
through `@typstream/node`, healed in final mode first as an engine exports it (lint fixes included, the layout
profile's among them), has a layout engine lay the DOCX out, and compares its lines and page starts with Typst's
PDF (`lines.mjs`). Documents with equations, images or drawings hold placeholders until #132 and #133, and are
reported apart.

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
node tools/docx-check/check.mjs --validate tools/docx-check/validator/out/validator.dll --min-lines 0.94
```

CI's `DOCX (validator, LibreOffice)` job runs that: it fails on any validator error, and when fewer of Typst's lines
come back than the floor on the documents without placeholders (LibreOffice versions differ, so it's a floor, not a
per-document baseline). The nightly `DOCX (ONLYOFFICE)` job reports ONLYOFFICE's numbers.

Working on the model: `examples/frames.rs` in engine-wasm dumps a document's laid-out frames (items, positions,
tags), and `examples/docx_model.rs` writes its model, fonts and Typst's PDF; with `--native`, the check gets Universe's
packages and each set's `assets/` the same way. A full native run takes about half a minute.

Known differences: a word longer than its table column runs past the cell in Typst, where Word-like engines break it
inside the cell; ONLYOFFICE gives a paragraph as short as a rule (an exact line height under about a point) more
height than LibreOffice does, so its pages drift on documents with many ruled lines.
