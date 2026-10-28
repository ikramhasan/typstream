# @typstream/browser-suites

Browser suites over the corpus (PLAN.md §11.4, [#19](https://github.com/ikramhasan/typstream/issues/19)), in
Chromium, Firefox and WebKit. Documents are mounted the way an app mounts them: `mountTypstream` from
`@typstream/dom` on the real engine worker, with html-compat and the engine's math font (what the `typstream`
package's `<Typstream>` adds). Private; nothing here ships.

```bash
pnpm --filter @typstream/browser-suites test:browser   # equivalence, flicker, accessibility, preview vs PDF (any machine)
pnpm --filter @typstream/browser-suites test:pdf       # preview vs PDF only (~25 s per browser)
pnpm --filter @typstream/browser-suites test:visual    # screenshots against the baselines (needs Docker)
pnpm --filter @typstream/browser-suites visual:update  # accept visual changes: rewrites the baselines that differ
BROWSERS=chromium pnpm ...                             # one browser; extra arguments go to vitest (-t, a file)
```

They need engine-wasm's `dist/` (`pnpm --filter @typstream/engine-wasm build`) and Playwright's browsers
(`pnpm --filter @typstream/browser-suites exec playwright install chromium firefox webkit`; `test:visual` brings its
own).

## The suites

**Final-render equivalence** (`equivalence.test.ts`). Every corpus document (edu and adversarial: runaways, memory
bombs, 479 pages), in both targets, is streamed into a mount (the growing text with `isStreaming`, paced so it
compiles along the way) and finished, then compared with a mount given the whole source at once: the same status
and failure, the same artifact (the HTML string; every page's size, SVG and text runs, but not page hashes, which
include source spans), and the same DOM. The adversarial set runs in Chromium only: it tests the engine and its
watchdog, the same wasm in every browser, and takes most of the time (a final compile that runs out of time starts
#21's hang search, up to 16 more compiles under the 10 s budget). The two hostile runaways are left to the security
suite, which runs them under short budgets. The edu set, where browsers differ in rendering, runs in all three. When the watchdog acted on one side only (a timeout, or blocks the hang search skipped), the
machine was busy: the document is compared once more.

**Flicker** (`flicker.test.ts`). Every edu document is replayed in up to 60 steps, each waiting until the document
caught up, while MutationObservers record what the renderers remove and add.

- Paged: pages are never removed while the document grows; a page is redrawn only when its SVG changed, and an SVG
  is never taken out without the next going in (no blank page); no page returns to an SVG it showed before, the last
  page included: when heal or the fixers cut what rendered from the text being typed, the engine keeps its last
  render (#65). The exception is a page that isn't the last and lost what moved to a page added since (a heading moves
  to the next page with what follows it).
- HTML: a block whose markup didn't change is never re-created (a node added and removed between two steps was an
  artifact in between, not a re-creation). Blocks carry the source offset of the anchor before them; the blocks
  sharing one are a group, settled once the next group starts before heal's stable offset. A settled group never
  disappears and changes only where later text may change it: ids Typst writes once a reference targets an element,
  references and citations (a `pending-ref` placeholder until its target arrives), and outlines.
- Both report, per document, the steps whose render shows less than the step before (HTML: less text, whitespace
  aside; paged: a page back to an earlier SVG). Passing tests' logs show with `--reporter=verbose`.

**Accessibility** (`a11y.test.ts`). Every edu document, finished: axe-core with WCAG 2.2 A/AA and best practices
(page-level rules off: a document is part of a page), HTML in the light and the dark theme, plus:

- HTML: the root has the document's `lang` and `dir`, equations are MathML, every `table.header` is a row of `<th>`;
- paged: page SVGs are `aria-hidden`, and the text layers hold the document's text (the letters and digits of the
  HTML target's text, 98% at least: what a screen reader gets from either target), have the document's `lang` and
  `dir` on every page, and have the HTML target's headings, levels and text (#63). In Chromium the headings are also
  read from the browser's accessibility tree (CDP `Accessibility.getFullAXTree`), which is what heading navigation
  uses: content skipped by `content-visibility: auto` isn't in it. `HEADINGS_HTML_LOSES` lists documents whose
  headings a show rule takes out of typst-html's output.

Violations that come from Typst's own HTML or from axe's limits are listed in `KNOWN`, each with where it may occur
and why; so is a known bug, with its issue.

**Preview vs PDF** (`pdf-raster.test.ts`, [#118](https://github.com/ikramhasan/typstream/issues/118)). Every edu
document is shown in the document panel (paged, `fit-width` layout: its own pages scaled to the panel) and each page's pixels
are compared with the same page of the mount's `exportPdf()`, rasterized by pdf.js at the same size in the same
browser: the same page count and sizes, and no cluster of more than 3 touching pixels that differ. A pixel differs
when no pixel of the other image within one device pixel is close to it in colour, so edges antialiased a pixel apart
don't count. Pages are painted at a device pixel ratio of 2 (at 1, pdf.js widens a 0.4 pt rule to a whole device pixel
and the canvas doesn't); SVG pages (gradients) are rasterized by the browser. Chromium and Firefox match exactly;
WebKit differs by a few scattered pixels. A control checks that a missing full stop (7–8 pixels) is caught. It needs
no baselines, so it runs on any machine, and on PRs in CI's Engine (chromium) job (`test:pdf`). The `reflow`
layout lays pages out again at the panel's width, so it can't equal the PDF and isn't compared.

**Security** (`security.test.ts`, #29, `apps/website/content/docs/guides/security.mdx`). Every `hostile-*` document of the adversarial set,
streamed and finished in both targets, in all three browsers:

- nothing forbidden is left on the page, shadow roots included: no script, style, frame, object, form or SVG
  animation element, no `on*`, `data-*` (but the renderers' own) or other acting attribute, no link to a scheme
  other than `http(s)`, `mailto` or `#`, no image from anywhere but `data:` or `blob:`, no CSS that loads, nothing
  `position: fixed`;
- nothing ran (the documents' scripts and handlers would set `window.typstreamPwned`), nothing was fetched from the
  hosts they name, and their safe text is still there;
- the two runaways (a wasm plugin that loops, content nested too deep for the stack) are stopped by the watchdog
  or end the worker, under short budgets, and the same mount then renders the next document;
- the engine's limits hold: input past `maxLength` stops (`too-large`) and shorter input renders again; a streaming
  compile past `livePages` stops live preview, and the finished document has all its pages.

**Visual regression** (`visual.test.ts`), against the baselines in `__tests__/__screenshots__/<browser>/`.

## Baselines

Pixels depend on fonts, the rasterizer and the browser build, so baselines made on one OS fail on another. The
visual project therefore only exists inside **Playwright's Docker image** for the installed `playwright` version
(`mcr.microsoft.com/playwright:v<version>-noble`): `scripts/visual.mjs` runs vitest there, locally and in CI, with
the repository mounted at the same path and as the current user. Upgrading `playwright` changes the image, so
expect a `visual:update` with it. The HTML target is set in the engine's own text fonts (Libertinus Serif, DejaVu
Sans Mono), as an app styles its panel; scripts those don't cover fall back to the image's fonts (the paged target
uses the engine's own script fonts, #11).

Every suite first loads those script fonts into its engine (`warmFonts`): a finished document that lacked one is
compiled again when it arrives, and its artifact changes after `done`. Suites also wait for an artifact to stop
changing (`steady`) before they use it.

New and updated baselines are stored as 256-colour palette PNGs, about a third of the size. That is lossy, but the
colours it changes are antialiasing at glyph edges, which pixelmatch detects and ignores. Comparisons allow a colour
difference of 0.1 (pixelmatch's YIQ threshold) and at most 0.2% of pixels differing: text going from #1c1c1e to
#4a4a4e fails them, quantizing doesn't. Baselines already stored that way are left alone, so
one that still matches never changes in git.

What is shot, and why not the whole matrix (every document × both targets × light/dark × three widths × three
stream points × three browsers, about 1,600 screenshots and 100 MB):

| Shots | Browsers | Documents |
|---|---|---|
| Finished, paged and HTML (light), 600 px: the whole document | Chromium | the edu corpus |
| The same, first screen (600 × 800) | Firefox, WebKit | the edu corpus |
| HTML in the dark theme; mid-stream frames at 50% in both targets | all three | the feature set |
| Mid-stream frames at 25% and 75%; widths 360 and 960 px, both targets | Chromium | the feature set |

The engine's output doesn't depend on the browser, so whole documents in one browser catch layout changes
anywhere; the other browsers differ in how they render the same markup (CSS, MathML, SVG), which their first
screens show. The feature set (`FEATURES`) covers math, tables, shapes, fills, scripts, code and a recorded
stream. A mid-stream frame is the 800 px panel scrolled to its end, with the caret, after the stream's text up to
that point (or the next prefix that compiles).

When a visual test fails, vitest writes the actual screenshot and a diff under `.vitest-attachments/`; CI uploads
them as an artifact. If the change is intended, run `pnpm visual:update` and commit the baselines.
