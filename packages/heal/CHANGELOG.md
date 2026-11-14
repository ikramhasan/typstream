# @typstream/heal

## 0.1.1

### Patch Changes

- 3e5b205: Published with npm provenance, through trusted publishing: each version on npm now carries a signed statement of the GitHub Actions run and commit that built it (0.1.0 has none). No code changes.
- Updated dependencies [3e5b205]
  - @typstream/core@0.1.1

## 0.1.0

### Minor Changes

- 865949a: Pages follow typstream's layout profile (#129), so a DOCX export can break lines and pages where Typst does: a
  constant line pitch (1.3em, close to Typst's default), ragged right without hyphenation, table rows that don't split,
  and inline math at least a line tall. The engine puts it (`LAYOUT_PROFILE`, from `@typstream/engine/server`) in front
  of every document and its preamble when it compiles pages or exports a PDF; `@typstream/node` does too. Its show-set
  rules win over a document's set rules; heal's new `layout-profile` lint rule takes out the arguments that would win
  (`par(justify: true)[…]`, `show par: set par(…)`, `show text: set text(hyphenate: …)`). Every page looks a little
  different: default gaps between paragraphs and headings are smaller to keep Typst's distances between baselines, and
  some documents that set their own table insets or spacing gain a page. edu's spacing, answer lines, circled answers and
  blanks are adjusted to keep their look under the profile. `fromMain` takes where the preamble starts, after the
  profile. html-compat's placed text uses the profile's text edges.
- fdb250d: Prompt kit measured on real models (#24). `@typstream/edu`: `buildSystemPrompt(plugins)` writes the system prompt from the plugins' rules, catalogue and examples, and `typstPromptRules` adds the Typst habits models get wrong (scripts without a base, multi-letter math names, bare math as arguments, `*/` and `/ ` in markup, imports for packages); `mcq`'s example shows math options. `@typstream/heal`: new `math-lone-script` lint fix (`m/s$^2$` → `m/s$""^2$`), and `currency-dollar` no longer warns on math such as `$0.4 times 0.3 =$` or `$30 degree$`. `@typstream/universe`: CeTZ's prompt line shows its own shapes.
- 0d1c1c3: Streaming into a range of a finished document: an edit such as a model rewriting one question, where only that part heals as text being typed and the rest shows as it did. `EngineDocument.setStreamingRange(range)`, and `streamingRange` on `mountTypstream` and `<Typstream>` (with `isStreaming`; a finished document given a range streams again without starting over). Heal: `setStreamingRange` works on a finished healer (streaming mode until `finish()`); the text after a range is linted as a text of its own, so its fixes stay; `HealResult.suffixOffset` and `Healer.streamingRange`; `blockStarts` (`@beta`, moved from the engine's server) gives the top-level blocks a range should cover. The worker keeps to the range: `CompileParams.settledFrom` and `FixContext.settledFrom`, so `tail-cut` no longer drops the rest of the document with the text being typed. Layer 4's level 1 compares only what the range wrote, and the new `FallbackParams.restart` (sent after `setStreamingRange` and `reset()`) shows text that starts over even when it is shorter than what it replaces: a regenerated answer no longer keeps the old one on screen until it has caught up. `@typstream/node`'s server accepts the new fields.

### Patch Changes

- ea04dbd: Fixes found by the corpus-wide browser suites (#19). heal closes a cut display equation with a space (`$ a + b` heals to `$ a + b $`, not the inline `$ a + b$`), so a streamed equation no longer flips between display and inline. The HTML renderer sets `lang` and `dir` on its root from the document's language (Typst writes `lang` on `<html>` and no direction), so right-to-left documents render right to left; keeps the light theme's colours inside what the document filled (boxes, table cells, code blocks), which the dark theme made light on light; and no longer takes a document that so far is one `<div>` for a template wrapper, which rebuilt the page twice. The paged renderer doesn't redraw a page whose SVG is unchanged under a new hash (Typst's frame hashes include source spans). html-compat hides drawings without text from assistive technology instead of exposing them as images without a name.
- 28374ec: DOCX exports keep what the page shows where they lost it while their lines still matched (#118). An answer line under
  a callout in a question is no longer dropped (LibreOffice drops an empty paragraph after a table at a cell's end); an
  equation starting or ending in an operator (`$1/5 + 2/5 =$`, an aligned equation's `&= 22`) or with absolute-value
  bars no longer shows LibreOffice's red "¿", and an equation that is only an operator (`$->$`) is set without spacing;
  a blank that is a list item's whole body (`1. #box(stroke: (bottom: …))` in a table cell), a term's or a line's first
  stays on its line, underlined; a list item's number Typst kept at the left of a centred cell stays there; a line a `\`
  broke where Typst would have broken anyway keeps its break, an empty line between such lines its room, and a line
  after one starting with `h()` its room; a code block's lines and right-aligned or centred lines no longer wrap in
  Word, and centred and right-aligned lines are centred and right-aligned paragraphs; list numbers keep their labels'
  face, size and colour (not a bold first word's); a list starting at "v." is numbered in Roman numerals. Highlights and
  filled boxes around words are Word's shading (in their colour as it shows on paper: `highlight`'s yellow is
  translucent), strikethrough is Word's, dashed and dotted frames have Word's dashed and dotted borders, a dashed line
  is a picture, and a gradient is a picture whose SVG LibreOffice draws (typst-svg's referencing gradients are
  flattened).
  
  The layout profile turns hanging punctuation off (`overhang: false`), as Word has none. Heal's `layout-profile` lint
  rule takes a small fixed `radius` (a text box's, up to 12 pt) out of `block`, `rect` and `box` calls that hold content
  and out of their set rules: a box with rounded corners around text was a picture in a DOCX export, its text not
  editable; a square one is a table cell. A ratio or a larger radius draws a shape, which stays as it is.
- 85ab88f: Content no longer vanishes and returns at the stream's position (#65). A streaming compile that succeeds but shows less of the unsettled tail than the last artifact did (heal or the tail-cut fixer cut what had rendered, such as `..xs.map(x => (a, b` before its `.flatten()`, or the stable prefix would show it as source again) publishes nothing and answers `error`, so the client keeps its last render until the tail shows as much again or that text is settled. heal closes a math group left open inside a math call's arguments (`$sqrt(1/n sum (x_i` heals to `$sqrt(1/n sum (x_i))$`, new frame kind `math-delimited`); before, the group took the call's `)` and the whole construct was dropped.
- b880330: heal reads an enum marker as Typst does: any number that parses as a u64 followed by `.`, so a 20-digit number up to 18446744073709551615 and numbers with leading zeros (`0001.`) are enum markers. `blockStarts` follows, so a 20-digit item right after another is in the same list.
- ba55345: Streamed and incrementally edited text lints an indented Markdown heading (` # Title`) as a heading, as healing it in one go does; it had escaped the `#` instead (`\# Title`). Found by the nightly property campaign.
- aef5d68: The `layout-profile` lint also takes `leading`, `justify` and `linebreaks` out of `set par(…)` rules, and out of any
  show-set rule that sets `par`. Typst sets text with no blocks around it (a tight list's items, a table cell's, a box's)
  without a `par` element, which the layout profile's show rule doesn't reach, so a document's `#set par(leading: 0.75em)`
  still spaced those lines apart in pages, PDFs and DOCX exports (#131).
- b880330: The incremental healer reports a syntax error at a block's start once, as stateless healing does. An error the block before reported there (a term item's missing colon, after an unclosed `_`) came twice when an edit's re-recognition stopped at that block, and went missing when it resumed there.
- Edits in the middle of a document re-parse only the edited block: the incremental healer resyncs with its previous state at the first matching checkpoint past the edit and reuses the rest (#5). `push` and `applyEdit` no longer diff the whole text. Also fixes a case where an edit right after a checkpoint (`#\n*` + `/*`) left the incremental result different from stateless healing.
- 3a11cdc: Every `@public` and `@beta` export and member has TSDoc (#33): the protocol and plugin types in core, heal's results, options and recognizer types, and `@typstream/node`'s options and results, so editors show what each one means. `HealHandler.priority`'s comment said the built-in lint rules run at 50; they run before every handler, and a handler's default priority is 100. heal's `Mode` and `ModeSpan` are now `@internal`: they were reachable only through the internal `Recognition.modes` (handlers see core's `SyntaxMode`).
- Updated dependencies [3e66075]
- Updated dependencies [12ea537]
- Updated dependencies [ba56f2e]
- Updated dependencies [ec38329]
- Updated dependencies [69f1477]
- Updated dependencies [b4d7bed]
- Updated dependencies [813029f]
- Updated dependencies [cbb44d9]
- Updated dependencies [ba77608]
- Updated dependencies [41ae15f]
- Updated dependencies [4ad0ae1]
- Updated dependencies [8184b0f]
- Updated dependencies [466147c]
- Updated dependencies [893bbb1]
- Updated dependencies [d54927d]
- Updated dependencies [60c1567]
- Updated dependencies [8d2f1c5]
- Updated dependencies [e6c5a7b]
- Updated dependencies [3a11cdc]
- Updated dependencies [5275321]
- Updated dependencies [c620668]
- Updated dependencies [0d1c1c3]
  - @typstream/core@0.1.0
