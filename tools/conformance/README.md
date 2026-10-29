# Plugin conformance (#135)

A document looks the same in the paged view, in Typst's PDF and in the DOCX export, whatever plugin it is written with
(#118). Plugins prove it with this suite, run on their own examples: edu's catalogue entries, template specs and
prompt examples (answers hidden and shown), mindmap's examples, and a few documents using Universe's packages. The
plugin guide (`apps/website/content/docs/guides/writing-a-plugin.mdx`, "Matching the PDF and Word") says what that
asks of a plugin's Typst and how to add a suite.

```bash
pnpm --filter @typstream/edu test:paged        # pages against the PDF, in Chromium (BROWSERS=firefox, webkit)
pnpm --filter @typstream/edu test:docx         # DOCX against the PDF, in LibreOffice (soffice and poppler on PATH)
TYPSTREAM_DOCX_ENGINE=onlyoffice pnpm ...      # in ONLYOFFICE instead (Docker, onlyoffice/documentserver)
```

`test:docx` needs `@typstream/node` built (`pnpm turbo run build --filter=@typstream/node`) and uses Microsoft's
validator where it is built (`dotnet publish tools/docx-check/validator -c Release -o tools/docx-check/validator/out`;
under `CI` a missing one fails). Its files go to `$TMPDIR/typstream-conformance/<suite>/`.

## What a suite checks

A suite (`src/suite.ts`) is a name, the plugins documents are written with, and the examples (`withInputs` makes one
per set of `sys.inputs`).

- **Paged view = PDF** (`src/paged.ts`, vitest browser mode): each example mounted in the document panel
  (`mountTypstream`, paged, `fit-width`, painted at a device pixel ratio of 2), each page against pdf.js's raster of
  the mount's `exportPdf()`: the same pages, as big, and no more than 3 differing pixels touching. A pixel differs when
  no pixel of the other image within one device pixel is close to it in colour. tools/browser-suites' PDF raster suite
  (#119) runs the same comparison on the edu corpus.
- **DOCX = PDF** (`src/docx.mjs`, vitest in Node): each example healed in final mode and exported by
  `@typstream/node` to PDF and DOCX (the plugins' preambles, files and packages, as an engine mounts them), the DOCX
  laid out by LibreOffice, then (`src/compare.mjs`):
  - Microsoft's validator reports no errors (`src/office.mjs`);
  - every line and page start is Typst's (`src/lines.mjs`: by text; by the text around equations, which each engine
    sets its own way (#132); in other scripts, by text or ink extent, #134), and the suite keeps 95% of the lines of
    its examples with equations (`mathLines`);
  - every picture matches the PDF's pixels (`src/pixels.mjs`, #133) and every equation's letters and digits come out;
  - on examples without equations laid out line for line, what the pages draw besides text and pictures (rules,
    borders, shading, a blank's line) is where Typst draws it: no more than 6 differing pixels touching at 2 pixels per
    point, ink within a point counting as the same (`src/ink.mjs`). The lines alone would pass a lost border or an
    underline 2 pt off.

`src/vitest.mjs` has the two vitest projects a plugin adds (`paged`, `docx`), resolving the suite and packages from
source. Plugins don't depend on this package (it imports the engine, whose tests import Universe's plugin): they
import it by path, and TypeScript through `tsconfig.base.json`'s paths.

tools/docx-check (#131) reports the whole corpus through the same modules: `compareExport`, the lines, pixels and ink
comparisons, LibreOffice, ONLYOFFICE and the validator.

## Known differences

- LibreOffice sets an inline fraction at display size (#132), so a line with one can push a word on: Universe's suite
  allows 80% of its lines with equations (2 of its 11 lines).
- LibreOffice won't lower a drawing in a line (it ignores a negative `w:position` there): a picture Typst lowered below
  the baseline, a checkbox with `baseline: 20%`, is anchored to its line, which only an exact line (no equation in it)
  places where Typst does.
- ONLYOFFICE (nightly, informational): ruled answer lines are taller, an underline sits about a point higher than
  LibreOffice's, and its PDF's Arabic text can't be compared as written (#134).
