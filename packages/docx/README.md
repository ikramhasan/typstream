# @typstream/docx

The DOCX writer behind typstream's Word export. It turns a laid-out Typst document into an editable `.docx` that
Word-like editors lay out as Typst did: the same lines, the same page breaks.

You don't call it yourself. Export through `exportDocx()` on an `EngineDocument` (`@typstream/engine`), on
`mountTypstream`'s handle (`@typstream/dom`), on `<Typstream>`'s ref or `useTypstream()` (`@typstream/react`), or with
`render(source, "docx")` (`@typstream/node`). The engine's worker loads this package the first time a document is
exported, so apps that never export don't download it. Its exports (`writeDocx` and the document model's types) are
internal, for other typstream packages; DOCX export as a whole is beta.

```ts
const bytes = await doc.exportDocx(); // Uint8Array of a .docx file
```

## What it writes

`@typstream/engine-wasm` reads the laid-out pages into a document model; this package writes it as OOXML and zips it
(with fflate, its only dependency).

- **Text** as paragraphs and runs (font, size, colour), headings, lists with Word numbering, page headers and footers
  with page-number fields, page breaks, and every gap Typst made, with exact line spacing, no hyphenation and Word 2013+
  layout, the settings of the layout profile every typstream compile follows.
- **Tables and grids** with Typst's column widths and repeated header rows; framed blocks, ruled lines, columns (as
  Word sections), and placed text as frames at its page position.
- **Equations** as Word math (OMML): fractions, scripts and limits, roots, delimiters, matrices, big operators,
  functions, accents and aligned lines.
- **Pictures** of what Word can't express otherwise (images, CeTZ canvases, mind maps, rounded boxes): Typst's own
  drawing, as an SVG with a 300 DPI PNG, as Word writes an SVG.
- **Fonts** the runs use, embedded and obfuscated as ECMA-376 asks.
- **Scripts.** Runs in logical order with their language; right-to-left text as Word's right-to-left runs and
  paragraphs.

Exports are checked against Typst's PDF in LibreOffice (lines, page starts, pictures pixel by pixel, rules and colours)
and with Microsoft's Open XML validator.

Docs: [Exports](https://typstream.vercel.app/docs/guides/exports#docx),
[reference](https://typstream.vercel.app/docs/reference/docx).

## License

MIT
