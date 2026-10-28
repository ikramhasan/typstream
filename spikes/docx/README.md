# DOCX spike (#118)

Throwaway research for [#118](https://github.com/ikramhasan/typstream/issues/118): does a DOCX laid out by a
Word-like engine break lines and pages where Typst does, and under which settings? Findings are on the issue and in
PLAN.md's decision log; port what's kept into a package, don't import from here.

- `model.py`: a corpus document reduced to headings, paragraphs (bold, italic), list items and (with `--tables`)
  plain tables, read from Typst's HTML export. Math, figures and edu's drawings are left out and counted.
- `writers.py`: the same model as Typst and as DOCX under one profile, the "Word-compatible settings": exact line
  pitch (Typst: `leading: 0`, text edges set so a line box is the pitch; Word: exact line spacing), one gap before
  each block (Typst: weak `#v`; Word: space before), greedy ragged-right lines, no hyphenation, list numbers in an
  18 pt box, table columns at Typst-`auto`-like widths with cell padding equal to Typst's inset, rows that don't
  split. Fonts embedded on request (ECMA-376 obfuscation).
- `run.py`: renders each document with native `typst`, LibreOffice (headless) and ONLYOFFICE (`x2t` in the
  `onlyoffice/documentserver` image), reads every line back (`pdftotext -bbox`) and reports how many of Typst's lines
  each renderer has, in order, and whether its pages start on the same lines. Variants switch one setting at a time.
- `otf2ttf.py`: Libertinus (CFF outlines) converted to TrueType outlines, which is what Word embeds.
- `math_sample.py`: a paragraph with inline math and a display equation as Word equations (OMML), rendered by the
  three engines.

```bash
python3 -m venv /tmp/docx-venv && /tmp/docx-venv/bin/pip install fonttools pillow
docker pull onlyoffice/documentserver           # ~3 GB
/tmp/docx-venv/bin/python run.py                # every edu and llm document, every variant (~1.5 h)
/tmp/docx-venv/bin/python run.py --tables --variants base --no-oo
/tmp/docx-venv/bin/python run.py --only edu/report-climate-change --variants base,justify
/tmp/docx-venv/bin/python math_sample.py --at-least
```

Needs native `typst` 0.15.1, LibreOffice, poppler (`pdftotext`, `pdftoppm`), Docker and engine-wasm's `dist/fonts`
(read through a copy in `--out`).

Microsoft's validator (`validator/`, the Open XML SDK's `OpenXmlValidator` for Microsoft 365), built in Microsoft's
SDK image and run on the .NET 9 runtime:

```bash
docker run --rm -v "$PWD/validator:/src" -w /src mcr.microsoft.com/dotnet/sdk:9.0 dotnet publish -c Release -o out
dotnet validator/out/validator.dll /tmp/docx-spike/*.docx
```
