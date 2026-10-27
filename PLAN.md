# Typstream — Design & Implementation Plan

> Streaming renderer for LLM-generated **Typst** documents, built for an AI tool that writes
> academic and educational material (worksheets, quizzes, exams, lesson plans, handouts).
> Inspired by [streamdown](reference/streamdown), but Typst is a *compiled language*, not a
> markup format, so most of the hard problems are different.

Status: draft v2 · 2026-10-26 · Target Typst version: **0.15.1** (pinned, see §15)

## Status & decisions

**Where we are:** Phase 0 (engine spikes) and Phase 1 (`@typstream/heal`) are done. Phase 2 (engine) is next. Remaining work is tracked as GitHub issues; [#38](https://github.com/ikramhasan/typstream/issues/38) (pinned, label `roadmap`) lists them in order. `CLAUDE.md` explains how to work in this repo.

**Decision log** (newest first). Record new decisions here in the same PR that acts on them.

| Date | Decision | Why / where |
|---|---|---|
| 2026-10-27 | **Layer 3 cuts errors with no position in the document** (#72). Code that evaluates the document's content inside a `context` or layout callback (CeTZ's canvas, unify, edu's `coordinate-plane`) reports errors on half-typed values with no span and no trace in the text, so `tail-cut` had nowhere to cut. Now such an error cuts what is open at the end of the text, as heal sees it once healing's closers are off: a value or content block at its opener (`(6` of `line((0, 0), (6`), an argument list as the whole call. A second round cuts the call if it fails without the value. Not cutting back to the checkpoint: that is the stable prefix, and it drops the whole canvas. Measured over every stream prefix of the oracle's documents: 49 paged prefixes (0.10%, 10 recorded documents, 45 CeTZ) and 5 HTML ones (HTML doesn't lay out a canvas without html-compat), none fixed before. All are fixed now, 33 of 49 in one round, keeping 93.5% of the unsettled tail (whole-call cut 90.7%, checkpoint 0%). The compile oracle classes `unlocated` by position before message and no longer allows it. | §5.5 "As built (#20)" |
| 2026-10-27 | **Website and docs** (#32, #33, started before the first release at the maintainer's request): `apps/website`, Next.js 16 + Fumadocs 16. **Agent-readable by default**: `/llms.txt` indexes every page's Markdown, `/llms-full.txt` has them all, and each page is Markdown at `/docs/<page>.md` or under `Accept: text/markdown` (Fumadocs' processed Markdown; interactive demos are filtered out, live previews keep their code). **Reference that can't drift**: TypeScript types are tables generated from TSDoc at build time (fumadocs-typescript's `auto-type-table`, Markdown tables in the `.md` version too), not api-extractor → MDX as §10.5 sketched; the edu vocabulary page is generated from `eduCatalogue`. **Dogfooding**: docs examples render through `typstream` in the reader's browser (`<TypstPreview>`), and the landing page replays recorded Claude streams from `corpus/llm` into `<Typstream>` at their recorded timing. `docs/security.md` and `docs/writing-a-plugin.md` moved into the site (`content/docs/guides/`). The build runs in CI's test job with `check-docs.mjs` (frontmatter, navigation, every internal link and anchor). Not yet: deploy previews, a CI check that every `@public` export is documented, versioned docs. | §10.5 "As built", `apps/website` |
| 2026-10-27 | **A PR's CI finishes in about 5 minutes; what can't, runs nightly.** The corpus-wide browser suites (#19: Chromium ~17 min, WebKit ~45) moved to `nightly.yml`, which a branch can run on demand (`gh workflow run nightly.yml --ref <branch> -f only=browser-suites`). The rest is split, not cut: the engine's browser tests run one job per browser, inside Playwright's Docker image like the visual suite (`tools/repo/playwright-docker.mjs`: `playwright install --with-deps` stalled 10 min on the Ubuntu mirror, cold or warm), the engine checks in two jobs on the cached engine-wasm `dist/`, and heal's every-prefix corpus suite (144 s in one file after #24's LLM corpus) across four test files that vitest runs in parallel. The nightly property campaign had found incremental and streamed lint missing indented Markdown headings (they resume at a line's first token, past its indentation): fixed in the same PR. | §11.8 |
| 2026-10-27 | **Plugin system** (#27): one resolution, in `@typstream/core` (`resolvePlugins`): a key loads once (its last definition, at the place of its first, so a component's plugin overrides a provider's), every plugin after its dependencies, otherwise in the given order; a missing dependency or a cycle throws; unknown facets are ignored. **Facets go where their scope is.** Worker-wide ones (fonts, packages, fixer modules) come from `createEngine({ plugins })` and go out with `initialize`. A document's plugins (`engine.open({ plugins })`, which `mountTypstream` and `<Typstream>` call) bring files, packages, preambles, heal handlers and lint settings, **and fixer modules, loaded per document** (`document/open`'s new `fixerModules`; the worker imports each URL once, a module that fails to load is logged and skipped rather than failing the open, which the client would only see as a missing document), so a `<Typstream plugins>` on the page's shared engine gets its fixers. **Fonts stay engine-only**: they belong to the wasm instance shared by every document (#11), so a document's plugin can't scope them; the engine logs a warning for plugin fonts it lacks. **New `stylesheets` facet**: html-compat and edu carry their CSS in it, so `plugins: [htmlCompat]` is all an app passes (the renderer, `standaloneHtml` and `mountTypstream` apply plugins' stylesheets before the app's) and `typstream` no longer special-cases `htmlCompatCss`. Islands stay with #28 (the facet is reserved, nothing renders it). **Security:** importing a fixer module runs its code, and `@typstream/node`'s protocol server imported untrusted clients' `initialize.fixerModules` (a `data:` URL ran code in the server); the server's new `clientFixers: false`, which node sets, ignores clients' module lists at `initialize` and `document/open`. How-to: `docs/writing-a-plugin.md` (the website, #32, publishes it). **Size:** resolving and merging plugins on the main thread costs `@typstream/engine` 0.7 KB gzipped (the resolver 0.2 KB, the font warning 0.1 KB, the rest the facet merging that `mountTypstream` did before), so its main-thread budget goes from 8 to 8.5 KB; `@typstream/react` gets smaller, since `mountTypstream` renders with the engine's resolved list instead of resolving and merging itself. Also raised here: `@typstream/heal`'s budget, 15 → 15.5 KB, which main had passed (15.1 KB) with #24's and #65's heal fixes, and the HTML renderer's, 9 → 9.5 KB (plugins' stylesheets cost 24 bytes; #29 and #63 had left 7). | §8.0 "As built (#27)" |
| 2026-10-27 | **The tail never shows less than it did** (#65). A streaming compile that succeeds but shows less of the unsettled tail than the last artifact (heal or tail cut took what rendered, or the stable prefix would put it back to source) keeps the last artifact until the tail shows as much again or that text settles: fallback level 1 in the server (§5.6 "As built"). Heal: a math group open inside a math call's arguments gets its own closer (`$sqrt(1/n sum (x_i` → `…(x_i))$`); it took the call's `)` and the whole construct was dropped (a `#table` in one document). The flicker suite asserts that no page returns to an earlier SVG, the last page included (8 of 35 edu documents did), except a page that lost what moved to a new page. | Measured first: Node replay of the edu corpus through the real server. Released after `staleMs` instead, the hold brought the flicker back in the browser, where steps are slower. |
| 2026-10-27 | **Prompt kit measured on real models** (#24, `tools/llm-corpus`): 29 teachers' requests streamed from claude-haiku-5-5 and claude-sonnet-5-5 (463 documents, $5.36), compiled as final mode compiles them. #23's kit alone didn't lower errors (12.1% vs 10.3% for the nextjs example's naive prompt): models take up the vocabulary (57/58 template lines, no hand numbering) but every failure was a generic Typst slip. **The kit's rules now target the measured error classes** (`typstPromptRules`: scripts need a base in their equation, multi-letter math names, content arguments in brackets, escapes incl. `\/`; packages must be imported; CeTZ's shapes in a canvas). **kit-v4: Sonnet 0/29 in final mode (0.9% over 115 kit-v2–v4 documents), Haiku 3.4% (4/116).** The Phase 5 target (< 2%) holds for Sonnet, the examples' default, not for Haiku: its residue is one-offs for the fix loop. `buildSystemPrompt(plugins)` assembles the prompt in edu (`@beta`; the app reads the `prompt` facet, #27). **To revisit: the toolkit is model-agnostic, and prompting may move out of the packages into a skill ([#75](https://github.com/ikramhasan/typstream/issues/75)).** **Heal: new `math-lone-script` fix** (`m/s$^2$` → `m/s$""^2$`), the top error class in both models that four prompt versions didn't stop in Haiku; **`currency-dollar` no longer fires on math** (`$0.4 times 0.3 =$`, `$30 degree$`: it flagged 10 of the 116 baseline documents, all math, which `fixLoop({ strict })` would have "fixed"). **`corpus/llm`**: recorded streams with the API's own chunk boundaries, an opt-in set (`ALL_SETS`) because documents name their plugins (`meta.plugins`); broken output stays as `expect: "error"`. The real streams found one Layer 3 gap: a package panic with no position in the document (CeTZ on a half-typed coordinate) can't be cut ([#72](https://github.com/ikramhasan/typstream/issues/72); the oracle allows the class `unlocated` until then). | §8.3, §11.2 "As built (#24)", §5.3, [#24 comment](https://github.com/ikramhasan/typstream/issues/24#issuecomment-6435594096) |
| 2026-10-27 | **Security hardening** (#29): 19 hostile documents in `corpus/adversarial/` (`hostile-*`) run through the engine (Node: the sandbox in both targets) and through `mountTypstream` in Chromium, Firefox and WebKit (nothing forbidden reaches the page, nothing runs or loads, runaways stop and the mount recovers). Guide: `docs/security.md` (threat model, CSP). The suite found, and this PR fixes: **content nested too deep overflows the host's stack inside wasm**, which throws `RangeError` (V8, JavaScriptCore) or `InternalError` (SpiderMonkey), not a wasm trap; the server answered `internal` and kept using an instance whose shadow stack pointer was left behind; it now ends the worker like a trap. And **a strict CSP broke the HTML target's layout** in Chromium and Firefox: they refuse `style` attributes parsed from markup, even in an inert template, and report each one; the renderer now renames them before parsing and the sanitizer applies them through the CSSOM (`style.cssText`), which no policy restricts (also making its CSS checks see CSSOM-normalized values). `examples/strict-csp` shows that `script-src 'self' 'wasm-unsafe-eval'`, `worker-src`/`connect-src`/`font-src`/`style-src 'self'` and `img-src 'self' data: blob:` are enough, in all three browsers, in CI. **Limits** (§9) in the engine client: `maxLength` (1 MiB of UTF-16; longer input isn't healed or compiled, `too-large`) and `livePages` (100; a streaming compile with more stops live preview). The corpus validator compiles with `--features html` so documents may use `html.elem`. Gaps filed: #69 (a document can draw outside its element: viewport-sized absolute boxes, the host's utility classes) and #70 (Trusted Types). The CSSOM styles cost 0.15 KB gzipped: `@typstream/dom`'s HTML renderer stays under 9 KB, `@typstream/react`'s budget goes from 16 to 16.5 KB (it was 11 bytes under after #63). | §9 "As built (#29)", `docs/security.md` |
| 2026-10-27 | **Paged text layer: structure, language, direction** (#63). Structure comes from the **introspection tags** Typst puts in every frame, the ones typst-pdf builds tagged PDF from: headings (`aria-level` n + 1, `#title` 1, as typst-html's `<h{n+1}>`), lists (items from typst-layout's `PdfMarkerTag` label/body markers: the items' own tags stay where realization found them, around the list), tables (cells by `y` into rows, header rows from the resolved grid). Elements open across a page boundary are replayed at the next page's top from a walk over earlier pages' tags. The layer wraps runs in **unstyled inline spans with ARIA roles**, not `<h2>`/`<table>`: block elements add line breaks to copied text and pick up app CSS. The page carries the document's `lang`/`dir` (`DocumentInfo.locale`, as typst-html's `<html lang>`), runs their own where they differ (direction from glyph cluster order). Found on the way: **Arabic text layers read backwards with repeated letters**: `ShapedText::build` makes a `TextItem` per stretch of one font and vertical offset, so Noto Naskh's offset dot marks (each repeating its base letter's cluster) and Libertinus spaces cut words into visual-order pieces; marks are now dropped and touching pieces joined (right to left for RTL), and line items are already in logical order. Also: **`content-visibility: auto` took offscreen pages out of the accessibility tree** (Chromium kept 2 of a report's 16 headings), so it moved from the page to its SVG; the text layer gets `contain: strict` (streaming 19 pages in Chromium: no measurable change). Paged headings equal typst-html's on the whole edu corpus except where a show rule replaces the heading (typst-html then writes none; the paged tag keeps it). `@typstream/react`'s budget goes to 16 KB (+0.5 KB). | §6.5 "As built (#14)", §11.4, [#63 comment](https://github.com/ikramhasan/typstream/issues/63#issuecomment-6435638506) |
| 2026-10-27 | **Events and telemetry hooks** (#30): the event shapes live in `@typstream/core` (`telemetry.ts`), plain serializable data. The engine client emits them per document (`EngineDocument.onEvent`) and forwards them through `Engine.onEvent` as `{ type: "document", event }`, so one listener sees every document; the bindings take `onRendered`, `onFallback`, `onWatchdog` (and the existing `onDiagnostics`), on `TypstreamProvider` too, where provider and instance hooks are both called rather than the instance's winning. The worker now says what only it knows: `CompileResult.fixes` (fixer name and error message) and `CompileFallback.level`. **Fallback level 1** (the last good render stays) is a compile that published nothing; levels 2–4 are §5.6's rungs as built. `healMs` is main-thread healing summed since the previous compile, since many pushes heal into one compile. `onRendered` replaces the `@beta` `RenderedInfo` with the compile's report plus render cost. Fallback events carry the input and healed source (a corpus case); the example sends only their lengths, since collecting documents needs consent. | §8.6 As built, §12 |
| 2026-10-26 | **Browser suites** (#19, `tools/browser-suites`): final-render equivalence, flicker and accessibility over the corpus through `mountTypstream` on the real worker, in Chromium, Firefox and WebKit (vitest browser mode, as #10), and visual regression. **Visual baselines are only rendered inside Playwright's Docker image** (the tag of the installed `playwright`), locally (`pnpm test:visual`, `visual:update`) and in CI alike, so they don't depend on the machine's fonts or rasterizer; they're stored as 256-colour palette PNGs (a third of the size; the colours quantizing changes are antialiasing, which pixelmatch ignores). Not §11.4's full matrix (~1,600 shots, ~100 MB): whole documents of the edu corpus in both targets at 600 px in Chromium, first screens in Firefox and WebKit, and dark theme, widths 360/960 and mid-stream frames (25/50/75%) on a 12-document feature set: 414 baselines, 11 MB. **Equivalence holds for 100% of the corpus** (53 documents, both targets: artifacts and DOM). The suites found, and this PR fixes: heal closed a cut display equation as inline (`$ a + b` → `$ a + b$`), so equations flipped between inline and display while streaming; the paged view redrew pages whose SVG hadn't changed (their frame hash had: spans), 424 times over the edu corpus, about a quarter of all redraws; a document that so far is one `<div>` (a title in `#align`) was taken for a template wrapper, rebuilding the page twice; the HTML renderer dropped the document's `lang` and never set `dir` (Arabic rendered left to right); the dark theme left text in the document's fills light on light (14 of 35 documents); html-compat drawings without text were images without a name. Those fixes cost 0.3 KB gzipped, so `@typstream/react`'s budget goes from 15 to 15.5 KB (it was at 14.9). | §11.4 "As built (#19)", `tools/browser-suites/README.md` |
| 2026-10-26 | **Primary surface: a document panel** (#1, question 1). That favours the **paged** target: it gets the deepest test coverage and polish first; HTML stays covered. This changes the earlier ranking of HTML first ("HTML is the default streaming target; paged is for print preview", below; §0 #2; §6.5's headings). Not changed yet, for the maintainer to decide: the bindings' default `target` is still `html` (`mountTypstream`, `<Typstream>`, §7), and paged's default `layout` is `fixed`, where a panel wants `fit-width`. | #1, §0, §6.5, §7 |
| 2026-10-26 | **Lazy fonts** (#11): fonts belong to the wasm instance (shared by every document's `Engine`), and script fonts sit in the font book as precomputed `FontInfo` without their bytes. Typst's own selection is the script detector: a compile that picks a missing face (by family or for fallback) records it, falls back or draws tofu, and lists it in `missingFonts`; comemo replays font lookups when validating cached layout, so cached compiles report it too. The worker fetches it (Cache Storage first) and the adapter returns `pending`; the server then **recompiles the document on its own** (same revision, queued like a request, skipped if the document changed or compiled again), and exports wait up to 3 s. Rejected: sync XHR in `World::font` (network time inside the watchdog budget, a blocked worker, no Node) and heal-side script detection (a second, inexact table; it sees text only at compile time anyway, so it would start a fetch one compile earlier at best). Measured: registering 6 files 1.2 ms, 3.4 KB of metadata; a warm recompile once fonts arrive 22 ms; output byte-identical to native typst with the same files. Script fonts: **Noto Naskh Arabic, Noto Serif Bengali, Noto Serif Devanagari**, regular and bold (book styles, to match Libertinus Serif; 47–79 KB brotli each, 411 KB for all six, fetched per face). **CJK is not in the default set** (Noto Serif SC is 11.6 MB per weight); apps add fonts with `FontSource.info`. `@typstream/node` loads the script fonts up front. HTML: the browser draws text, so engine fonts only matter in frames; Typst's HTML doesn't mark RTL paragraphs, so the theme sets `unicode-bidi: plaintext` (each paragraph's direction from its text). | §6.4 "As built (#11)", [#11 comment](https://github.com/ikramhasan/typstream/issues/11#issuecomment-6411893007) |
| 2026-10-26 | **Launch scripts** (#1 Q2, maintainer): "support languages with quirks first", e.g. English to test the standard, **Arabic** to test bidi, **Bengali** to test Indic scripts. English, Arabic and Bengali are required; Devanagari is supported too (cheap, and its shaping is Bengali's); CJK waits until it's a target. The primary surface (#1 Q1) is a document panel, so the paged target comes first. | #1, #11 |
| 2026-10-26 | **`@typstream/edu` v1** (#23), built from a proposal on the issue that waits for the maintainer's review: assumptions A1–A9 and ten open questions are on [#23](https://github.com/ikramhasan/typstream/issues/23#issuecomment-6411668598). The vocabulary comes from what the 35 `corpus/edu` documents each re-invent (answer lines, blanks, points, show-answers toggles, MCQ option grids, callouts, `ce`, name/date/class lines). Five templates applied by the document (`#show: quiz.with(…)`, so exported source names its own); `rubric` is a function. **Answers produce no output unless `sys.inputs.showAnswers` is `"true"`**, in either target; `answer-key()` likewise. Labels, option letters and the points word follow `text.lang` (English, Arabic, Bengali); question numbers and drawings stay Western and left to right. **No `@preview` imports**: drawings (number line, graph paper, coordinate plane) use native shapes and `ce()` is edu's own mhchem subset, so edu works offline and before #25; CeTZ and chemistry packages stay separate allowlist entries. Every function has its own HTML branch (semantic elements with `edu-*` classes, `dir="rtl"` in RTL, drawings as `html.frame`), so it doesn't need html-compat; `eduCss` styles it. **Streaming:** every parameter has a default, and arrays and lengths cut mid-stream (`(2` → `2`, `5em` arrives as `5`) are accepted. The compile oracle found both; with them, 100% of the prompt examples' prefixes compile at every code point with Layer 3 (heal alone 88–96%). A **local package**: the plugin mounts its files under `@typstream/edu:0.1.0/…`, which the engine roots at that package (#25), and the preamble is `#import "@typstream/edu:0.1.0": *`; nothing is fetched and it needs no allowlist entry. 16 KB gzipped (budget 30 KB, §11.6). | §8.3 "As built (#23)", `packages/edu/README.md` |
| 2026-10-26 | **Day-one Typst packages** (#1 Q3 "diagrams, chemistry, math"; #25): **CeTZ 0.5.3** and **fletcher 0.5.8** (diagrams), **cetz-plot 0.1.4**, **physica 0.9.8**, **unify 0.8.1** (math), **chemformula 0.1.3** and **alchemist 0.2.0** (chemistry). Their dependencies come too, pinned as the packages pin them: cetz 0.5.2 and 0.3.4, oxifmt 1.0.0 and 0.2.1. Rejected: typsium and whalogen (both get hydrates and subscripts wrong; whalogen's arrows are empty in MathML), lilaq (six dependencies, two with wasm plugins; later), equate (needs a 3.6 MB wasm plugin), mitex, zero. **wasmi stays:** CeTZ ≥ 0.4 calls its `cetz-core` wasm plugin, so #26 can't cut plugins. In engine-wasm the first compile of a CeTZ canvas takes 100–260 ms (cetz-plot up to 680 ms), then 2–4 ms per streamed token. | §6.4 "As built (#25)", [#25 comment](https://github.com/ikramhasan/typstream/issues/25#issuecomment-6411908163) |
| 2026-10-26 | **Package loading** (#25):<br>• **Vendoring.** New `@typstream/universe` (layer 2) vendors the unmodified Typst Universe `.tar.gz` files (~740 KB, each fetched only when imported) as bundler assets, with an allowlist plugin and prompt rules; `typstream` adds it by default. Integrity is the SHA-256 of the *uncompressed* tar, because servers send `.gz` with `Content-Encoding: gzip` (Vite's dev server does) and the browser hands over the tar.<br>• **Pre-pass.** The engine server scans the preamble and document for package specs before each compile and fetches only allowlisted ones. It verifies them, untars them (DecompressionStream plus a ustar reader) and mounts them under `@ns/name:x.y.z/…` keys, which engine-wasm roots at the package; mounted packages' own imports are followed.<br>• **Waiting and caching.** A compile waits within the fix budget; a later arrival recompiles the revision (server-initiated output). Tarballs are kept in Cache Storage.<br>• **Allowlists.** `initialize.packages` plus `document/open`'s new `packages` (plugins' `engine.packages`); `ServerOptions.packages` with `trustClient: false` (set by `@typstream/node`) ignores client lists. An empty allowlist means no network.<br>• **Versions.** A version that isn't allowed resolves to the nearest allowed one (same major.minor, else the newest) with a warning, because models write old versions.<br>• **Missing packages** are reported as not allowed / still loading / failed to load, and the new `package-stub` fixer binds their imported names to placeholders.<br>• **Local packages** (`@typstream/edu:0.1.0`) are files at those keys. | §6.4 "As built (#25)", §5.5, `packages/engine/README.md` |
| 2026-10-26 | **Layer 4 fallback ladder** (#21) is **opt-in per compile** (`CompileParams.fallback`), so the protocol's "a failed compile publishes no artifact" holds for other clients and the conformance suite; the engine client asks with every compile (`DocumentOptions.fallback`, default true). **Block isolation runs in the protocol server** (browser worker and `@typstream/node`): blocks are the source-anchor points over heal's root checkpoints; the first failing block is found by bisecting prefixes with *check* compiles (no export; new optional `AdapterDocument.check`, engine-wasm's `check_paged`), ⌈log₂ n⌉ checks + 1 compile per failing block, none for syntax errors; it becomes `#typstream.error-block(source, message)`. Checks ignore missing-label errors (references flow backwards). Isolated blocks are remembered per document for the next revision. While streaming, settled blocks are always isolated, but the **stable prefix** (settled text, tail as plain text) only once the last good render is 1.5 s stale (`schedule.staleMs`). **Hangs and crashes are the client's** (only it can stop a compile): a final compile that times out or crashes starts a bisection of prefixes with the rest skipped (`fallback.skip`), each under `watchdog.probeMs` (5 s); streaming keeps strikes and `too-complex`. Final-mode last resort: the whole document as one error block. Measured: **every corpus stream prefix renders** with Layer 4 (the 11 Layer 3 leaves, by the stable prefix), **every corpus document renders in final mode** (Node; 6 with error blocks, ≤ ⌈log₂ n⌉ checks each), and every adversarial one, runaway loops and memory bombs included, in Chromium, Firefox and WebKit. A streamed document with lasting errors (markdown-habits) renders 95.0% of its prefixes, 38.5% with Layer 3. | §5.6 "As built (#21)", §6.3 |
| 2026-10-26 | **Layer 3 fixers** (#20) run in the protocol server (`@typstream/engine/server`), so the browser worker and `@typstream/node` both apply them. Two generic built-ins, as #13's data said: `pending-ref` (`@key` with no `<key>` → `#typstream.pending-ref("key");`, both modes, still reported as an error in final mode) and `tail-cut` (streaming: cut the text still being typed at the error, or at its call site there, and re-heal; a cut that leaves a call or group empty also drops the call). The client sends heal's `stableOffset` as `CompileParams.settled`; without it nothing is cut. Placeholders come from a runtime library at `/@typstream/runtime.typ`, imported only by fixed compiles. At most 2 rounds per revision, each starting only within a third of the watchdog budget; only a round ending without errors counts. **Prefix compile rate 99.93%** (HTML and paged, every stream prefix; heal alone 88.0%), 100% for generated documents; longest stale run 21.1 s → 0.6 s. Heal's syntactic drops (#13) are left for later: they'd only save compiles now. | §5.5 "As built (#20)", §8.2 |
| 2026-10-26 | **PDF ships in the default engine build** (#18), not as a lazily loaded second engine. A PDF-only module can't be small or share the preview's work: typst-pdf needs a laid-out document, so the module is all of Typst, in separate memory. Measured: the pdf build is 6.20 MB brotli vs 5.85 MB (+0.34 MB once per release, ~0.14 s at 20 Mbps, hidden by preloading), with unchanged HTML/SVG speed and memory. A second engine on first export would download 6.20 MB (~2.5 s) and spend 0.25–0.8 s compiling the wasm, adding fonts and compiling the document cold, while an export from the preview's engine is warm (8–50 ms for 3–19 pages). One build: `dist/pdf` and `@typstream/engine-wasm/pdf` are gone (supersedes the 2026-10-26 "second build" rows), and `--no-default-features` builds without PDF (#26). Wasm budget 6.0 → 6.3 MB until #26 trims data. Server-side export (`@typstream/node`) works through the same client API. **Exports** are `EngineDocument.exportPdf()` / `exportHtml()` / `exportSource()`: the healed source, compiled by the preview's engine in final mode, ahead of waiting compiles, under the final watchdog budget; failures reject with `ExportError`. `@typstream/dom`'s `standaloneHtml` makes the HTML export a file: theme and plugin CSS inline, optional embedded math font, and a **CSP `<meta>` instead of sanitizing** (no scripts, no network, no forms; Typst writes `html.elem("script")` verbatim, and re-serializing sanitized nodes would invite mXSS). | §6.4 "As built (#18)", §6.5 "As built: exports", [#18 comment](https://github.com/ikramhasan/typstream/issues/18#issuecomment-6410254097) |
| 2026-10-26 | **React bindings** (#17): `@typstream/react` is a thin layer over a new framework-free **`mountTypstream(el, options)`** in `@typstream/dom` (open a document, feed `source` or `stream`, render each artifact with its target's renderer, `update()` applying only what changed). `<Typstream>` mounts it in an effect and passes every render's props to `update()`, so it is StrictMode-safe (the second mount opens a fresh document; the first is disposed). Instances without an `engine` share **one engine worker per page**, ref-counted and terminated 1 s after the last user unmounts (StrictMode and instances replacing each other keep it warm); `TypstreamProvider` holds a reference while mounted. **Only visible or streaming documents compile**: a document opens when its element nears the viewport (IntersectionObserver, 50% margin) or as soon as it streams. `useTypstream()` returns a callback ref (`<Typstream ref={t.ref}>`) instead of reading the app's ref, which React never announces. Deps: react imports `core`, `dom` and `engine` (it creates the default engine and re-exports engine types); `typstream` adds `html-compat` and `engine-wasm` (the math font's URL) to make html-compat and MathML work out of the box. Deferred props: `fallback` (beyond the engine's last good render), `islands` (#28), engine `adapter`/`fonts`/`packages` (#11, #25; pass an `Engine` instead). `exportPdf` waits for #18: `useTypstream()` exposes the `EngineDocument` it will go through. 14.0 KB gz with dom. | §7 "As built", `packages/react/README.md` |
| 2026-10-26 | **Playground default render mode is `<Typstream>`** (#31): fed the step's *raw* input as an app would, on its own document; the raw engine and DOM views keep sharing a document fed the healed source. The inspector's engine sections read whichever document is shown; with `<Typstream>` the re-heal row checks that the component's own (incremental) healing equals the healed pane. `render=engine` / `render=dom` in the hash select the other views. | `apps/playground`, `CLAUDE.md` |
| 2026-10-26 | **Playground raw engine view** (#31 follow-up): the render pane's "Raw engine" mode shows the engine's artifacts exactly as the worker sends them, with no renderer between (HTML in a sandboxed iframe, page SVGs as `<img>`s, or their markup), for watching streams render while scrubbing and for telling renderer bugs from engine output. It is permanent: when `<Typstream>` (#17) lands it becomes the default mode and the raw view stays as a toggle. One `engineWorker()` per page; each step `set()`s the healed source into one document (re-healing it is a no-op; the inspector flags it if not) and the engine's scheduler paces compiles. html-compat is opt-out per view (`compat=0`). A **DOM renderer** mode (`render=dom`) feeds the same document to `@typstream/dom`'s renderers, so the two views compare one artifact; HTML artifacts now carry the server's source anchors, which the raw view shows as they are. | `apps/playground`, `CLAUDE.md` |
| 2026-10-26 | **HTML renderer** (#16, `@typstream/dom`, `src/html/`). Blocks are split from the HTML *string*, not the DOM: typst-html's serializer is regular enough for an exact depth scan, and each update resumes from the last split (unchanged leading blocks verified with `startsWith`, as streamdown does on its input), so only changed blocks are parsed and sanitized. A block's HTML string is its key; unchanged blocks are never re-created (asserted while streaming corpus documents in three browsers). 20 pages: p50 1.0–1.2 ms, p90 3–5 ms per update. **Sanitizer: hand-rolled allowlist, not DOMPurify** (11.8 KB gz): blocks are parsed in an inert `<template>`, cleaned, and the same nodes moved into the page, so nothing is re-serialized (no mXSS). Ids are prefixed per renderer (documents on one page share `loc-1`; labels could clobber globals). Word fade-in ports streamdown's timeline; a re-created block continues its words' animations. 8.5 KB gz with its CSS: dom has no row in §11.6, and @typstream/react's 15 KB will need revisiting once the paged renderer lands. | §6.5 "As built: HTML renderer", §9, [#16 comment](https://github.com/ikramhasan/typstream/issues/16#issuecomment-6406893456) |
| 2026-10-26 | **Source anchors** (#16): the engine server inserts `#std.html.elem("typstream-anchor", attrs: ("data-src": "N"));` on its own line before each top-level block, in HTML compiles only (paged compiles and exports have none). A custom element isn't phrasing content, so typst-html emits it as a block-level sibling that adds no paragraph or space. Anchors go only at block starts (start of the text, after a blank line, a heading), never before an item continuing a wide list (it would split the list and restart numbering) or before a line starting with `<` (a label would attach to the anchor). Checked over the corpus and streamed prefixes: HTML with anchors stripped is byte-identical, and diagnostics map back to the same spans. | §10.2 "As built", `packages/engine/src/server/anchors.ts` |
| 2026-10-26 | **Paged renderer** (#14, `@typstream/dom`): one element per page, **each page's SVG in its own shadow root**, `content-visibility: auto`; changed visible pages are drawn at the next frame, offscreen ones and all text layers in idle time. typst-svg repeats glyph `<symbol>`s under content-hash ids on every page; inline in one document, Chromium re-resolves every `<use>` when one page changes (~300 ms per streamed update at 19 pages vs ~20 ms with ids scoped per page). **Glyph defs are not shared**: they are 29% of the bytes, but the time is style and layout of one `<use>` per glyph, which sharing doesn't remove (and trimming the markup 37% doesn't help either). | §6.5 "As built (#14)", [#14 comment](https://github.com/ikramhasan/typstream/issues/14#issuecomment-6407171030) |
| 2026-10-26 | **Text layer = invisible HTML spans** over each page (pdf.js-style), from Typst's text items: engine-wasm returns each changed page's runs (`ChangedPage.text`, core's optional `PageUpdate.text`). SVG `<text>` was rejected: copying gives a newline after every run in Chromium/WebKit and none between lines in Firefox. Spans with `<br>` at line ends copy alike in all three; find-in-page works. Links: only `http(s)`/`mailto` keep their href (typst-svg passes `javascript:` through); links within the document stay inert (a standalone page SVG has no target for them, and their targets would go stale under changed-page diffing). | §6.5 "As built (#14)" |
| 2026-10-26 | **Fit-width only sets the default page.** A document's own `#set page(paper: …)` overrides the preamble, and Typst has no rule after the document. Height defaults to A4's proportions at the container's width, not `auto`: one ever-growing page would be redrawn whole on every update. `"auto"` is opt-in for short documents. | §6.5 "As built (#14)" |
| 2026-10-26 | **Inline SVG pages can't reach the 10 ms budget for dense pages.** A full A4 page of math and prose (~1,700 `<use>`s) costs 9–16 ms to parse plus 24 ms (Chromium) to 80–160 ms (Firefox, WebKit) of style and layout, measured on a loaded 6-core machine. Phase 0's 5–9 ms timed `innerHTML` only. A **canvas page renderer** (§8.5 `canvas-pages`, glyph `Path2D`s, possibly an `OffscreenCanvas` in the worker) is the follow-up if previews of dense documents must stay jank-free. | §6.5 "As built (#14)", §8.5 |
| 2026-10-26 | **Mutation testing for heal** (#6): Stryker over `packages/heal/src`, nightly, failing below 80%. Score **80.59%** (full run; 3,464 killed, 340 timeouts, 800 survived, 116 uncovered of 4,721). Mutation runs leave out the corpus tests and use 10 seeded property runs: instrumented code is ~10× slower and every survivor runs every test that covers it. Most kills come from differential tests against Typst: its lexer run alone, token modes, first error positions. Survivors are triaged on #6. | §11.1 "As built (mutation testing)" |
| 2026-10-26 | The syntax oracle also runs **Typst's own lexer** (`lex(text, mode)`; build.rs copies `lexer.rs` from the pinned typst-syntax crate, where it's private) and reports each token's lexer mode in the parse tree (`modes(text)`). | `tools/typst-syntax-oracle`, #6 |
| 2026-10-26 | **The server runs engine-wasm on Node worker threads, not a native addon** (#22). Measured on the edu corpus: a napi-rs addon over the same World is ~2.5× faster warm (PDF p50 7 vs 19 ms) and ~8× on a process's first compile. But a runaway native compile can't be stopped (`worker.terminate()` never returns, the process can't exit), and a memory bomb aborts the whole process. Wasm terminates in 10–140 ms and traps at wasm32's 2 GiB limit inside its worker. An `-O3` wasm build gains 10–25% on HTML/SVG, nothing on PDF, and costs +45% RSS plus a second full Rust build: not worth it. | §6.1 "As built (#22)", [#22 comment](https://github.com/ikramhasan/typstream/issues/22#issuecomment-6405646790) |
| 2026-10-26 | `@typstream/node` imports engine-wasm directly (its deps: core, heal, engine, engine-wasm); `@typstream/engine` is the browser runtime. engine-wasm ships a second build with PDF export (`@typstream/engine-wasm/pdf`, also a candidate for #18's lazy PDF module) and `check_paged()`. The server's default fonts are Typst's bundled set, as in `typst compile --ignore-system-fonts`. | §4.1, §6.1, §6.4 |
| 2026-10-26 | **Server adapter = the worker protocol over WebSocket, served by #10's protocol server.** `@typstream/node` runs `@typstream/engine/server`'s `createServer` with an `EngineAdapter` that compiles on its worker pool, so one implementation of the protocol serves the browser worker and Node. A gate in front checks untrusted messages and enforces limits. JSON with bytes as `{ "$bytes": base64 }` (`serializeMessage` / `deserializeMessage` in core, so browser clients can decode). Documents live on the server's main thread and pool workers only compile, so the watchdog can kill one without losing a document; changed pages are diffed by SVG content across workers. The adapter now receives each compile's `mode` (exports are `final`), and unknown methods answer `method-not-found`. #10's conformance suite passes in-process and over a real WebSocket. | §6.1 "As built (#22)" |
| 2026-10-26 | **Engine worker** (#10): `@typstream/engine/server` runs the protocol over an `EngineAdapter` (per-document compiler state: files, inputs, HTML, changed-page SVG); the engine-wasm adapter gives each document its own wasm `Engine` in one shared instance. `engineWorker()` spawns the default worker with `new Worker(new URL("./worker.js", import.meta.url))`, which Vite 8 and Next.js 16 (Turbopack and webpack) bundle with the wasm and fonts and no config. The base fonts ship in engine-wasm's `dist/fonts/` until #11. The preamble is prepended to `/main.typ` and diagnostics are moved past it. A wasm trap kills the worker unanswered, so the client counts a crash strike. `engine` now depends on `engine-wasm` (same layer). Worker code is tested with vitest browser mode (Playwright) in Chromium, Firefox and WebKit; the protocol conformance suite (`packages/engine/__tests__/conformance.ts`) runs there and in Node in-process. | §6.1 "As built (#10)", §11.3 |
| 2026-10-26 | **html-compat** (#15): a prelude of show rules gated on `target() == "html"` (`@typstream/html-compat`, mounted at `/@typstream/html-compat.typ`, applied by a two-line preamble). Layout maps to **semantic HTML + CSS** (grid → CSS grid with Typst's cell placement, align, block/box/shapes, stack, columns, place → absolute, pad, transforms, v/h); only drawings become **`html.frame` SVG** (curves, polygons, angled lines, boxes made only of `place`d pieces, CeTZ canvases, equations with `cancel`), with their text in `aria-label`. Tables stay native `<table>`, styled per cell from `table.cell`'s resolved fields. Page furniture (header, footer, page numbers) is a known gap. Paged output is byte-identical with the prelude (tested). | §6.5 "As built", `packages/html-compat/README.md` |
| 2026-10-26 | **MathML needs a math web font**: browsers can't stretch delimiters or pick math italics without one. The renderer registers New Computer Modern Math (already in the engine's font set) for `math`. Remaining browser defects are listed in §6.5 and go to the renderer (#17). | §6.5 "As built" |
| 2026-10-26 | A package's tests may import extra packages listed as `testDeps` in `tools/repo/layers.mjs` (html-compat's tests compile with engine-wasm); its `src` may not. html-compat runs in the `Engine (wasm)` CI job. | §4.1, `.dependency-cruiser.mjs` |
| 2026-10-26 | **Dev playground** (#31, `apps/playground`): Vite + React, heal-only until the engine worker (#10) lands; the render pane is a slot. Workspace packages resolve to source (no build step, heal hot-reloads). State lives in the URL hash (corpus entries by id, pasted text deflate-raw + base64url). Stepping forward pushes chunks into one incremental healer; scrubbing back or far is a `set`. Served cross-origin isolated so `performance.now()` resolves µs. `@typstream/corpus/stream` is a browser-safe subpath (the main entry reads the disk). Layering: packages never import apps (`no-apps` rule); dependency-cruiser now also cruises `apps/`. | §10.5, `CLAUDE.md` |
| 2026-10-26 | **Compile oracle (#13):** healed prefixes go through the real compiler in `tools/compile-oracle` (outside `packages/`: heal may not import the engine), in CI's engine job. **88% of corpus stream prefixes compile** after healing (HTML and paged alike), 96% of generated ones. The test allows an explicit list of error classes, each tied to the issue that removes it, and fails below a rate floor (87%) that rises as classes go. | §5.5 "Measured", §11.1 "As built" |
| 2026-10-26 | **Layer 3 is two generic fixers, not the §5.5 table:** *tail cut* (an error in the unsettled tail, or a call site there in its trace, cuts the healed source at that point and re-heals) and *pending reference* (`@x` with no `<x>` becomes a placeholder). Simulated with the PLAN's 2-round limit they reach **99.4%** on the corpus. Heal takes the syntactic cases (a value being typed at the cut, a reference at the cut, incomplete `#let`) so fewer rounds are needed. | §5.5 "Measured", #20 |
| 2026-10-26 | **Engine client** (#9, `packages/engine`): `createEngine({ spawn })` → `engine.open()` → `EngineDocument` (`push` / `set` / `applyEdit` / `finish`, state snapshots via `subscribe`). The worker sits behind a `SpawnEngine` factory, so the client has no DOM dependency. **One compile at a time per engine**, across documents, so a watchdog budget only ever measures that document's own compile. Edits go to the worker only right before a compile, as one diff of the healed source; a change that leaves the healed source unchanged doesn't compile. Boundary bias means "compile after `minInterval` once `stableOffset` advanced". Crashes count as watchdog strikes. Recycling swaps workers between compiles, and documents reopen on their next compile. The client merges changed pages, so `state.artifact` is always complete. 4.7 KB gz. | §6.2–6.3 "As built" |
| 2026-10-26 | **Corpus format:** `corpus/<set>/<name>.typ`, optional `.stream.jsonl` (`{"t", "text"}` per line), and one `meta.json` per set whose `expect` (`ok` / `error` / `limit`) says what native `typst compile` 0.15.1 must do, checked by `pnpm corpus:validate` with embedded fonts only. Streams without a recording are synthesized from the source (token-sized, seeded). | §11.2 "As built", `corpus/README.md` |
| 2026-10-26 | Heal runs the corpus: every prefix of documents up to 20 KB through the incremental healer, sampled prefixes of larger ones. Bugs the corpus finds but nobody has fixed yet are listed as known, each with a repro that must keep failing. | `packages/heal/__tests__/corpus*.test.ts` |
| 2026-10-26 | **Edits resync** (#5): re-parsing after an edit resumes one checkpoint earlier than before, so it never starts at a checkpoint whose own token the edit can change, and stops at the second matching root checkpoint past the edit. The healer passes known edits (`push`, `applyEdit`) through instead of diffing the whole text. Measured side by side on one (loaded) machine: mid-document 1-char edit at 100 KB ~7–10 ms → ~0.5 ms; per streamed token at 50 KB p50 ~0.25 ms → ~0.03 ms. | §5.2 "As built (resync)" |
| 2026-10-26 | `@typstream/engine-wasm` API as built: changed-page SVG only (no full `compile_svg`), eviction inside every compile, diagnostics in core's `Diagnostic` shape with UTF-16 spans (`/main.typ` = the document), real `today()`, PDF behind a non-default cargo feature. Its own CI job; the other jobs skip it. | §6.1 "As built", #8 |
| 2026-10-26 | **Layering is an allowlist:** a package may import only the packages in its §4.1 "Deps" column. That's stricter than "lower layers only": same-layer deps (node → engine, react → dom) are allowed only where listed, and so are lower-layer ones. One table (`tools/repo/layers.mjs`) drives the dependency-cruiser rules, the package.json check and the changesets fixed group. | §4.1, #3 |
| 2026-10-26 | API reports live in `packages/*/api/`. Untagged exports are `@public`; `@beta` and `@internal` are explicit. Packages are ESM-only for now: attw runs with the `esm-only` profile, so add CJS (and drop the profile) only for a package that needs it (§10.4). | §10.4, #3 |
| 2026-10-26 | The changesets `fixed` group lists only packages that exist, because changesets rejects unknown names. `check:layers` fails when a package marked `fixed` in the table is missing from it. | §10.4, #3 |
| 2026-10-26 | **Worker protocol v1 is in `@typstream/core`** (`protocol.ts`). Compile output arrives only as `document/diagnostics` + `document/artifact` notifications sent before the `compile` response, so client- and server-initiated compiles share one render path. Paged artifacts name the `base` revision their changed pages diff against. Added `document/setFiles`, `shutdown`, `$/cancel`, `$/log`; `resolve/*` is paged-only. | §6.1 "As built" |
| 2026-10-26 | `Diagnostic.span` is nullable and diagnostics from other files carry `file`; `HealHandler` moved from heal to core (the plugin contract needs it); plugins override lint rules by id instead of adding `LintRule` objects (custom rules are `settled` handlers). | §6.1, §8.0 "As built" |
| 2026-10-26 | **CI runs on GitHub Actions** (`.github/workflows/`): lint, types, test (with the oracle), size on every PR and `main`; the 20,000-run property campaign nightly. Perf is **report-only** on PRs: shared runners can't hold the strict budgets, so CI fails only above 3× (`PERF_TOLERANCE=3`). The §11.5 plan of failing on a > 10% regression waits for a dedicated runner or CodSpeed. | #2, §11.5, §11.8 |
| 2026-10-26 | **Low-end devices are out of scope for now.** No Chromebook or Android measurements before launch; budgets are set on a mid-range laptop. | Product call. Revisit after launch. |
| 2026-10-26 | Work is tracked in GitHub issues, each self-contained; open questions are research tasks inside issues, not guesses in this plan. | — |
| 2026-10-26 | `@typstream/heal` is a faithful port of typst-syntax's parser used as a recognizer, tested against Typst's real parser. | §5.2 "As built" |
| 2026-10-26 | Stable offset = last root checkpoint whose first character is followed by another (monotone under appends). | §5.2 |
| 2026-10-26 | **One engine: our own wasm build of Typst 0.15.1** (`@typstream/engine-wasm`) for both HTML and paged output. typst.ts and typst-wasm are dropped as defaults. | §6.1, `spikes/phase0/RESULTS.md` |
| 2026-10-26 | Paged output uses changed-page SVG export (only pages whose frame hash changed). | §6.1, §6.5 |
| 2026-10-26 | The engine calls `comemo::evict(2)` after every compile. | §6.3 |
| 2026-10-26 | HTML is the default streaming target; paged is for print preview. *(Ranking changed: the primary surface is a document panel, so paged comes first; see the #1 row above.)* | §0, §6.5 |
| 2026-10-26 | Built as a published toolkit, editor-ready from day one (edits, not appends; LSP-shaped worker protocol; one plugin contract). | §10 |

**Open product questions** (block parts of Phases 2–5, tracked in [#1](https://github.com/ikramhasan/typstream/issues/1)): licensing, npm scope. Day-one Typst packages are answered (diagrams, chemistry, math; #25), and so are launch scripts (Arabic, Bengali; #11) and the primary surface (a document panel).

---

## 0. TL;DR — the key decisions

| # | Decision | Why |
|---|----------|-----|
| 1 | **Use the real Typst compiler (wasm, in a dedicated Web Worker)**, not a hand-written Typst→React parser — **our own wasm build of the Typst crates** is the default adapter (Phase 0 winner: smallest, fastest HTML, flat memory), behind an `EngineAdapter` (§6.1). | Typst documents are programs (`#let`, `#set`, `#show`, loops, packages). A subset parser would silently render the wrong thing. Fidelity is the whole point of moving off Markdown. |
| 2 | **Two render targets from one compile:** `html` (semantic HTML + MathML, default for chat/streaming) and `paged` (SVG pages, print-faithful, default for "document preview"). The primary surface is a document panel (#1), so `paged` gets polish first (decision log). | Typst 0.15's HTML export produces real `<h2>/<p>/<table>/<math>` and resolves refs (verified locally). It reflows, is accessible, selectable, themeable and animatable. Paged output is what teachers print. |
| 3 | **A four-layer error-correction pipeline**: normalize → incremental *mode-aware* scanner + tail repair → diagnostic-driven semantic fixers → fallback ladder (last-good render / block isolation). | A single unclosed `[` makes the *whole* document fail to compile. Unlike Markdown, there is no graceful degradation for free — we must guarantee a compilable source at every tick or fall back. |
| 4 | **`@typstream/heal` is a pure, zero-dependency TS package** (the `remend` analogue), resumable and O(Δ) per token. | Runs on every token on the main thread; must be testable in isolation with property tests against the real Typst parser as oracle. |
| 5 | **Latest-wins compile scheduler with adaptive throttle + watchdog.** | Compiles take 5–100 ms; tokens arrive every ~20 ms. Never queue stale work; never let an AI-written `while` loop freeze the tab. |
| 6 | **Extensibility through Typst itself first** (a preamble/package layer: `@typstream/edu`, `html-compat`), then TS hooks (repair handlers, diagnostic fixers, render islands, engine adapters). | Teachers' document types are best expressed as Typst functions (`#question`, `#mcq`, `#answer-key`), which the LLM can call and which render identically in every target. |
| 7 | **Prevention beats cure:** ship a prompt kit + lint rules for LLM "Markdown-isms" and a server-side validator/fix loop. | Most real errors we saw are Markdown habits (`# Heading`, `**bold**`, `me@x.com`, `$5 and $10`). |
| 8 | **Built as a published toolkit, editor-ready from day one** (§10): a dependency-free `@typstream/core` (document model, `TextEdit`, spans, source maps, plugin contract) under everything; the source text is the single source of truth and *streaming is just a special kind of edit*; the worker is an LSP-shaped "language service", not a one-off compiler wrapper. | A future Plate-style editor, a CodeMirror source mode, AI "rewrite this section" streams and collaboration all need the same primitives. Getting the contracts right now costs little; retrofitting them later means a rewrite. |

---

## 1. Goals, non-goals, success metrics

### Goals
- Render a Typst document **while it streams**, with no error flashes, no layout thrash, and a final render identical to a one-shot compile of the complete source.
- Work for real teacher content: math (inline/display, aligned, matrices, chemistry), tables, figures with captions & cross-references, numbered questions, answer keys, multi-column worksheets, headers/footers, footnotes, bibliographies, diagrams (CeTZ), multilingual text (incl. RTL and Bengali/CJK).
- One source → chat view, document view, PDF download, `.typ` download.
- Framework-agnostic core; first-class React binding.
- Safe to run untrusted (LLM-authored) Typst in the user's browser.
- Ship as an **open, published family of packages** with a landing page, docs and playground in this repo, usable outside our own product.
- Architecture that a future **visual editor** (Plate-like), a **source editor** (CodeMirror) and **AI-assisted editing** can be built on without rewriting the core.

### Non-goals (v1)
- Building the editor itself. v1 renders; it doesn't edit. But every core contract is designed for editing (§10.3) and has tests that exercise non-append edits.
- Supporting every Typst package. We ship an allowlist.
- Server-only rendering (supported as an adapter, but browser rendering is the main path).

### Success metrics (SLOs, enforced by tests in §11)
| Metric | Target |
|--------|--------|
| Prefix-compile rate (share of stream prefixes whose healed source compiles with zero errors, over corpus) | ≥ 99% (layers 1–3), 100% visible render incl. fallback. Measured: 88.0% with heal alone (#13); **99.93% with Layer 3** (#20) |
| Final-render equivalence (streamed final frame vs. one-shot compile) | 100% byte-identical HTML / pixel-identical pages |
| Main-thread time per token (heal + scheduling) | p95 < 0.5 ms for 50 KB docs (heal measured: p95 0.2 ms at 40–50 KB) |
| Main-thread long tasks during stream (> 50 ms) | 0 |
| Compile→paint latency for a 5-page doc, warm | p50 < 60 ms, p95 < 150 ms |
| Time to first render (cached wasm) | < 800 ms on mid-range laptop |
| Time to first render (first visit, wasm not cached) | hidden behind LLM generation via preload; otherwise server-first hybrid (§6.4) |
| Core JS (heal + react binding), gzipped | < 20 KB |
| Memory growth over 50 streamed docs in one session | < 10% after GC |

---

## 2. What we borrow from streamdown (and what doesn't transfer)

Studied: `packages/remend` (healing), `packages/streamdown/lib/parse-blocks.tsx`, `index.tsx`, `animate.ts`, plugin types, tests/benchmarks, `scripts/bundle-size.js`, CI.

**Borrow directly**
- **Healing as a separate, zero-dep package** (`remend` → `@typstream/heal`) with per-construct handlers, priorities, per-option toggles, and custom handler API.
- **Single-pass region scan memoized per input** (`remend/src/scan.ts`): every handler asks "is this position code or prose?" in O(1). We extend this into a full Typst *mode stack* and make it **resumable** (streamdown re-scans per string; we can checkpoint because streams are append-only).
- **Stable-prefix reuse** (`parse-blocks.tsx`, `countStableBlocks`): blocks before the last safe boundary never change — reused, not re-lexed. Also its `copyString` trick to avoid V8 substring retention of every intermediate document.
- **Property tests over every prefix** (`remend/__tests__/streaming-properties.test.ts`): build documents from *complete* atoms, cut at every offset, use a real parser as oracle; assert subsequence preservation with bounded tail loss and idempotence. This is the single most valuable testing idea to copy.
- **`mode: "static" | "streaming"`, `isAnimating`, `onAnimationStart/End`, caret, `BlockIncompleteContext`** (lets custom components know they're rendering a still-streaming block).
- **Animation timeline with backlog budget** (`animate.ts`: `MAX_ANIMATION_BACKLOG_MS`, stagger compression) for word fade-in in the HTML target.
- **Plugin packages kept out of core** (`@streamdown/code|math|mermaid`) + bundle-size script with externals; vitest bench files per package; changesets; turbo monorepo.
- **Security posture**: sentinel placeholders for incomplete links (`streamdown:incomplete-link`), link/image hardening.

**Doesn't transfer**
- Markdown degrades gracefully (an unclosed `**` is just text). Typst **fails the whole compile** on one unclosed delimiter. So we need a correctness *guarantee*, a semantic layer and a fallback ladder, not just heuristics.
- Markdown blocks are independent; Typst has **global state** (`#set`/`#show` rules, counters, `#let` bindings, outline, references). We can't render blocks independently — we rely on the compiler's incremental compilation (comemo) instead of block memoization, and do diffing on the *output* (HTML nodes / SVG pages).
- No remark/rehype pipeline; the "components map" idea becomes Typst show rules + render islands (§8.4).

---

## 3. Why streaming Typst is hard — empirical findings

Verified with `typst 0.15.1` on truncated inputs (scratch experiments):

| Truncated input | Result | Implication |
|---|---|---|
| `Hello *bold` | `error: unclosed delimiter` | Must close strong/emph. |
| `*a⏎⏎b*` | 2× unclosed delimiter | Strong/emph are **paragraph-scoped**: an unmatched `*` in a *finished* paragraph is a hard error even in the final doc → escape it. |
| `#table(columns: 2, [a], [b` | 2× unclosed delimiter | Nested frame stack; close `]` then `)`. |
| `#let x = ` / `#show heading: it =>` / `#let f(x) = x +` | `expected expression` | Can't just close — must **drop** the incomplete statement. |
| `#tabl` | `unknown variable: tabl` | Partial identifier after `#` — drop it. |
| `text #` / `cost # 5` | `expected expression` | Dangling/bare `#` → drop or escape. |
| `$x^` / `$ frac(a, $` | unclosed + expected expression | In math, drop trailing operator; close function parens; but **plain parens in math are lenient** (`$ [0, 1) $` is fine — don't "fix" them). |
| ```` ```py⏎print(1) ```` / `` `code `` | `unclosed raw text` | Close with the *same* backtick run. |
| `/* unclosed` | compiles (comment swallows rest) | Block comments nest; no repair needed, but scanner must track depth. |
| `Hi <lab` | `unclosed label` | Drop partial label. |
| `See @fig1` (label later in stream) | `label <fig1> does not exist` | **Forward references are normal while streaming** → semantic fixer. |
| `email me@x.com` | `label <x.com> does not exist` | Markdown-ism / email → escape `@` (lint, also in final). |
| `# Heading` | `expected expression` | Markdown heading → convert to `= Heading` (lint). |
| `this is **bold**` | compiles silently as empty strong | Silent misrender → lint convert to `*bold*`. |
| `costs $5 and $10` | compiles silently as math | Silent misrender → currency lint (`\$`). |
| `text ] more` | `unexpected closing bracket` | Stray closers need escaping too. |
| `#while n >= 0 { n += 1 }` | `loop seems to be infinite` (fast) | Typst has an iteration limit… |
| `#let f(x) = f(x + 1)` | `maximum function call depth exceeded` | …and a recursion limit… |
| `range(100000000).map(x => x)` | **ran > 25 s** (killed) | …but no time/memory limit → **watchdog + worker termination is mandatory**. |
| `/* a /* b */ c */` | compiles | Nested block comments confirmed. |

HTML export (0.15, `--features html`) findings:
- Produces semantic HTML + **MathML** (`<math display="block">…`), `<figure>/<figcaption>`, resolved `<a href="#t">Table 1</a>`, `<nav role="doc-toc">`, endnote footnotes.
- **Drops content** of unsupported layout elements with a warning (`grid`, `rect`, `align`, `place`, `line`, `v`, `pagebreak`, `page` set rules). The *text inside* `#grid[...]` disappears. A CeTZ canvas becomes an empty `<div>` with **no warning** (#15).
- **Much cheaper to compile**: a 6.4 KB / 40-section document with math and tables takes ~150 ms for a cold native CLI PDF compile vs ~32 ms for HTML (no layout).
- `html.frame(it)` renders any content as inline SVG; show rules gated on `context target() == "html"` work (verified). → we ship an **`html-compat` prelude** that maps unsupported elements to `html.elem` (where semantic) or `html.frame` (where visual). This is the bridge that makes the HTML target usable.

Wasm measurements (desk research: typst.ts `typst-ts-web-compiler@0.8.0-rc3`, Typst 0.15.0-rc.1, Node 25 on an M1 Pro; real-browser numbers in [spikes/phase0/RESULTS.md](spikes/phase0/RESULTS.md) and §6.1):
- **Streaming a ~6-page document (2.1 k chars), compiling a prefix every 25 chars: 70% of raw prefixes fail with syntax errors.** Without healing, the preview would be broken most of the time. This is the strongest argument for §5.
- Failing compiles fail fast (median 0.2 ms); successful warm compiles: **median 10 ms, p90 15 ms, max 69 ms**. First compile ≈ 145 ms (font parsing + layout). Wasm compile + instantiate ≈ 40 ms once downloaded.
- Compilation is all-or-nothing: `typst-eval` refuses to evaluate if *any* syntax error exists, and runtime errors (unknown variable, missing label) abort too. There is no partial document to show.
- The parser itself is lossless: every unclosed construct becomes an `Error` node and parsing continues (max nesting depth 256). That makes `typst-syntax` a perfect **oracle** for our healer's tests.
- `while` loops are capped at 10,000 iterations; recursion is depth-limited; but allocation/layout bombs are not limited at all.
- An unclosed `/* …` is **not** an error: it silently swallows the rest of the file. The healer must handle this deliberately (§5.3, §5.4).
- No existing streaming/partial Typst renderer exists (npm, GitHub, web) — typstream would be the first.

---

## 4. Architecture

```
 LLM token stream
       │  (string chunks; may split UTF-16 surrogates, may wrap in ```typst fences)
       ▼
┌────────────────────────────── main thread ──────────────────────────────┐
│ StreamBuffer ── Layer 0: normalize (fences, BOM, CRLF, surrogates)     │
│      │                                                                  │
│      ▼                                                                  │
│ @typstream/heal                                                         │
│   IncrementalScanner (mode stack, checkpoints)  ── O(Δ) per append     │
│   Layer 1: lint fixes on *settled* text (markdown-isms, stray delims)   │
│   Layer 2: tail repair (trim incomplete atom, close open frames)        │
│      │ healed source + SourceMap(healed→original) + stable boundary     │
│      ▼                                                                  │
│ CompileScheduler (latest-wins, adaptive throttle, cancellation)         │
└──────┼──────────────────────────────────────────────────────────────────┘
       │ postMessage {rev, files delta, target}
┌──────▼──────────────────────── Web Worker ──────────────────────────────┐
│ Engine (adapter: @typstream/engine-wasm — our Typst build — by default)│
│   VirtualFS: main.typ, preamble, @typstream/edu, html-compat, images   │
│   Fonts: base set + lazy script-specific fonts                         │
│   Packages: allowlisted, pre-bundled or fetched from mirror            │
│   compile(target) → diagnostics + artifact (HTML string | vector doc)  │
│   Layer 3: semantic fixers (diagnostic → source patch → recompile ≤2)  │
│   Layer 4: fallback (last-good, block isolation)                       │
└──────┼──────────────────────────────────────────────────────────────────┘
       │ {rev, artifact | delta, diagnostics, status}
┌──────▼──────────────── main thread: renderer ───────────────────────────┐
│ html target: sanitize → hast → keyed block diff → React; word fade-in   │
│ paged target: per-page vector diff → SVG/canvas; unchanged pages kept   │
│ Overlays: islands, caret, "updating" indicator, diagnostics panel      │
└─────────────────────────────────────────────────────────────────────────┘
       Watchdog (main thread): compile > budget → terminate + respawn worker
```

### 4.1 Packages (pnpm + turbo monorepo, mirrors streamdown's layout)

Packages are layered; a package may only depend on layers below it (enforced by a dependency-cruiser rule in CI). **v1** marks what we build now; the rest are reserved names whose contracts v1 must already satisfy (§10).

| Layer | Package | Contents | Deps | When |
|---|---|---|---|---|
| 0 · contracts | `@typstream/core` | Types & tiny utilities only: `TextEdit`, `Span`/`Range`, `SourceMap`, `Diagnostic`, `Revision`, `TypstreamPlugin` contract, worker protocol message types, error classes. | none | v1 |
| 1 · language | `@typstream/heal` | Normalizer, incremental scanner, lint rules, tail/region repair. Pure TS. | core | v1 |
| 1 · language | `@typstream/syntax` | Small custom wasm over `typst-syntax` returning a structured (JSON/flat-array) CST, incremental reparse, node↔span queries. Test oracle in v1, editor foundation later. (`@typstyle/typstyle-wasm-bundler`, 247 KB gzip, is the real parser but only returns a text dump — fine as a stopgap oracle.) | core | v1 (oracle), public later |
| 2 · runtime | `@typstream/engine` | Worker "language service": compile, diagnostics, scheduler, watchdog, VFS, fonts, packages, semantic fixers, fallback ladder, `EngineAdapter` + adapters (engine-wasm default; typst.ts, typst-wasm, server optional). Later: completion, hover, jump, format. | core, heal, engine-wasm | v1 |
| 2 · runtime | `@typstream/engine-wasm` | Our wasm build of the Typst crates (Rust, wasm-bindgen): in-memory World, HTML/SVG/PDF, changed-page detection, `comemo::evict`, structured diagnostics. Pinned Typst version. | (Rust) | v1 |
| 2 · runtime | `@typstream/universe` | The Typst Universe packages allowed by default (CeTZ, fletcher, cetz-plot, physica, unify, chemformula, alchemist), vendored tarballs with integrity hashes, as an allowlist plugin with prompt rules (#25). Layer 2 so the engine's tests can load them. | core | v1 |
| 2 · runtime | `@typstream/node` | Server-side validate / render (PDF, HTML, SVG), LLM fix-loop helper, diagnostics formatter, the protocol served over WebSocket. Runs engine-wasm on worker threads. | core, heal, engine, engine-wasm | v1 |
| 3 · content | `@typstream/edu` | Typst package for educational primitives + templates + prompt kit, *packaged as a `TypstreamPlugin`* (as built, #23: `packages/edu`). | core | v1 |
| 3 · content | `@typstream/html-compat` | Typst prelude mapping layout elements for the HTML target. | core | v1 |
| 4 · bindings | `@typstream/dom` | Framework-free renderers (`html`, `svg-pages`), sanitizer, `mountTypstream(el, opts)`. | core, engine | v1 |
| 4 · bindings | `@typstream/react` | `<Typstream>`, `useTypstream()`, islands, caret, diagnostics UI — thin layer over `dom`. | core, dom, engine, react (peer) | v1 |
| 4 · bindings | `typstream` | Convenience meta-package (`import { Typstream } from "typstream"`), like `streamdown`. | react, engine, engine-wasm, heal, html-compat, universe | v1 |
| 5 · integrations | `@typstream/ai` | Glue for AI SDKs (`useChat` parts → `stream`), prompt kit loader, structured "edit region" streaming, server fix-loop route helpers. | core, heal | v1.x |
| 5 · editors | `@typstream/codemirror` | Source-mode editor: highlighting (build on / contribute to `codemirror-lang-typst`, an existing Lezer grammar for Typst 0.15), diagnostics, completion/hover via engine. | syntax, engine | future |
| 5 · editors | `@typstream/editor-core` / `@typstream/editor-react` | Plate-style visual editor: structured view over the CST, edits as minimal text patches. | syntax, engine, dom | future |
| — | `apps/website` | Landing page + docs + embedded playground (§10.5). | | v1 (MVP docs) |
| — | `apps/playground` | Dev playground: replay streams, inspect healed source & diagnostics, record corpus cases. | | v1 |
| — | `examples/*` | `nextjs-ai-sdk`, `vite-react`, `vanilla`, `node-validate` — smoke-tested in CI. | | v1 |
| — | `corpus/` | Test corpus (§11.2). | | v1 |

---

## 5. Error correction & auto-closing (the core)

The guarantee we want: **for every prefix P of a stream, render(heal(P)) is either a clean compile or the last-good render — never an error screen.** And for the complete document D: `heal(D) == D` whenever D is valid (healing never changes a correct document).

### 5.1 Layer 0 — Normalization (StreamBuffer)

Applied to the raw stream before anything else; all transforms are tracked in the source map.

- **Fence unwrapping**: LLMs often emit ```` ```typst … ``` ```` or prefix chatter ("Here is your worksheet:"). Configurable: `unwrap: "auto" | "never"`. Auto = if the stream begins (after whitespace) with a ```` ```typ(st)? ```` fence, strip it and its closer.
- **Surrogate safety**: a chunk can end on a lone high surrogate → hold it back until the next chunk (never feed it to the compiler).
- BOM removal, `\r\n` → `\n` (Typst handles both, but our offsets must be stable), NUL/control-char stripping.
- **Edit detection** when the caller passes whole strings (`source` prop): if the new text extends the previous one, it's an append; otherwise diff the common prefix/suffix into a single `TextEdit` and apply it (§5.2) instead of resetting — callers that already have edits (editors, CRDTs) pass them directly.

### 5.2 The incremental mode-aware scanner

> **As built (Phase 1):** instead of a heuristic frame stack, `@typstream/heal` contains a **faithful TypeScript port of typst-syntax 0.15.1's lexer and parser, used as a recognizer**: same grammar, lookahead, newline modes and mode switches, no tree. When a construct meets the *real* end of input, it records a requirement: either `close` (append `]`, `)`, `*`, `$`, `"`, backticks, `:`) or `cut` (drop an incomplete construct back to its start, e.g. `#let x =`, `$x^`). *Soft* cuts handle words that may still grow (`#tabl`, `$alph`). Typst's real parser, compiled to wasm (`tools/typst-syntax-oracle`), is the oracle in every test. The sketch below was the original design; the port supersedes it.

A hand-written lexer (no regex backtracking — see streamdown's comment on exponential list-marker regexes) that maintains a **frame stack**:

```ts
type Frame =
  | { kind: "markup" }                                  // root or inside [ ... ]
  | { kind: "content"; open: number }                   // [ ... ]
  | { kind: "code-block"; open: number }                // { ... }
  | { kind: "parens"; open: number; role: "args" | "group" | "array" | "dict" | "params" }
  | { kind: "math"; open: number; display: boolean }    // $ ... $
  | { kind: "math-call"; open: number }                 // frac( ... ) inside math — strict
  | { kind: "string"; open: number }                    // "..." (escapes, \u{...})
  | { kind: "raw"; open: number; ticks: number; block: boolean; lang?: string }
  | { kind: "block-comment"; open: number; depth: number }
  | { kind: "strong"; open: number } | { kind: "emph"; open: number }
  | { kind: "embedded-expr"; open: number; stage: ExprStage } // after `#` in markup/math
  | { kind: "statement"; open: number; keyword: "let" | "set" | "show" | "import" | "include" | "if" | "for" | "while" | "return" | ... };
```

Typst rules the scanner must encode (each gets a test file):
- Markup: `*` strong / `_` emph (word-boundary rules, paragraph-scoped), `` ` `` raw (1 tick inline; ≥3 ticks block with lang; 2 = empty raw), `$` math (display iff whitespace after open & before close), `#` → embedded expression, `[`/`]` content (stray `]` is an error), `<label>`, `@ref` (with `[supplement]`), `\` escapes incl. `\u{…}`, `//` and nested `/* */` comments (**but not** inside URLs: `https://a//b` — Typst autolinks), `=` headings at line start, `-`/`+`/`/ Term:` lists, `~`, `---`, smart quotes.
- Code: `{}` `[]` `()` with role detection (needed to know what a trailing `name:` means), strings, keywords, closures `=>`, statement termination by newline or `;` (unless inside brackets).
- **Embedded-expression end in markup**: `#ident` then any chain of `.field`, `(args)`, `[content]` with *no whitespace*; ends at first other char. Keywords (`#let`, `#set`, `#show`, `#if`, `#for`, `#import`) parse to end of statement/line. This determines whether the tail is "inside code".
- Math: `#` embeds code, `"..."` text, `\` escapes, function calls `f(…)` strict, bare parens/brackets lenient, `&` and `\` line breaks.

**Incrementality — edits, not just appends.** The scanner records **checkpoints**: offsets where the stack is `[markup]` at the start of a line following a blank line (no open frames, not in a statement), each storing the scanner state. The public entry point is `applyEdit({ from, to, insert })` from `@typstream/core`; an append is just `from = to = length`.
- On any edit, invalidate checkpoints after the last checkpoint ≤ `from`, rescan from there, and **stop early** as soon as the new state at a checkpoint position equals the old state at the (shifted) same position — the rest of the document is unaffected (the same resynchronization trick CodeMirror/Lezer and tree-sitter use).
- For appends this degenerates to "resume from the last checkpoint": O(chunk + distance to last checkpoint) per token. Constructs that are look-ahead-sensitive are flagged and tested.
- v1 only *needs* appends (and full resets for regenerate), but the edit path is implemented and covered by the "random edit ≡ full rescan" property test (§11.1) so the editor never needs a new scanner.

> **As built (resync, #5):** checkpoints are root-markup line starts storing `{ offset, nesting }` (open text brackets). After an edit, `updateState` resumes at the last checkpoint whose *following* checkpoint is still at or before `edit.from`, not at the last one before it. Whether a position is a checkpoint depends on the token there, and the lexer may read to the end of its line to find where that token ends (`#\n*` + `/*` turns the `*` into a `*/` that the `#` consumes, so 2 stops being a checkpoint). Recognition stops at the first new checkpoint whose shifted offset and nesting match an old one. That checkpoint must be the *second* one past the edit, because the lexer looks back from a token (`column()` to the line start, keywords two characters). The old checkpoints, errors, lint events, mode spans, requirements and `lastTokenStart` after that point are reused, shifted by the edit's length change. Cached lint findings past it are reused too, except when `settled` handlers are registered (they may read anything). Edits that change the rest of the document (an unclosed `/*`, a deleted `"`, a new `[`) never match and re-parse to the end. `resync.test.ts` checks the spliced state against a fresh recognition and asserts bounded re-parsing; `scripts/perf.mjs` budgets a one-character edit in the middle of 100 KB.

Checkpoints double as **stable boundaries** for the renderer and for fallback (§5.6).

**Streaming regions, not only streaming tails.** Healing is defined over a *streaming range* `[start, end)` rather than "the end of the document": the text before `start` is settled, the text after `end` is settled, and the region in between is being written by the model. Whole-document generation is the case `end = length`. The general case is **AI editing** ("rewrite question 3", "add an answer key below") streaming *into the middle* of an existing document: the scanner state at `start` is known from checkpoints, the region is healed as if it were a tail (trim the partial atom, close the frames opened *inside* the region), and the suffix is reattached unchanged. This one generalization covers chat generation today and editor AI commands later.

Outputs per scan: frame stack, `regions` (Uint8Array like remend's) for O(1) "what mode is offset i in", list of open-frame offsets, list of *settled* lint findings, checkpoint list, `lastStableOffset`.

### 5.3 Layer 1 — Lint fixes (settled text, also apply in final mode)

Rules run only on text before `lastStableOffset` *or* on the complete document; each rule is pure `(scan, text) → Patch[]`, individually toggleable, with a severity (`fix` | `warn`). They exist because these errors are permanent, not streaming artifacts.

| Rule | Detects | Fix |
|---|---|---|
| `markdown-heading` | `^#{1,6} ` in markup at line start (not a valid `#expr`) | `= `×n |
| `markdown-bold` | `**text**` in markup | `*text*` |
| `markdown-link` | `[text](url)` in markup | `#link("url")[text]` |
| `markdown-inline-code` | Leave alone (valid raw in Typst) | — |
| `email-at` | `\w@\w+\.\w` in markup (not a ref to an existing label) | `\@` |
| `currency-dollar` | `$` followed by digit and paired math containing prose words | `\$` (heuristic, warn by default) |
| `unmatched-strong-emph` | Unclosed `*`/`_` in a *finished* paragraph | escape `\*` / `\_` |
| `stray-closer` | `]` / `)` / `}` with no open frame in markup | escape |
| `bare-hash` | `#` followed by whitespace/digit in markup | `\#` |
| `unclosed-block-comment` | `/*` never closed in the complete document | warn (content after it is invisible) |
| `unknown-font` (advisory) | `#set text(font: "X")` with font not in registry | warn; engine falls back |
| `math-lone-script` (#24) | An equation starting with `^` or `_`: units and formulas as prose with a math script, `m/s$^2$`, `H$_2$O` (a parse error) | empty base: `m/s$""^2$` |

### 5.4 Layer 2 — Tail repair (auto-closing)

Runs on the **tail only** (text after `lastStableOffset`). Two phases:

**Phase A — trim the incomplete atom at the very end.** Determined by the top frame and the last token:

| Situation at end of input | Action |
|---|---|
| Partial identifier after `#` (`#tabl`, `#ta`) or bare `#` | drop from `#` |
| Partial keyword statement: `#let x =`, `#let f(x) = x +`, `#set text(size:`, `#show heading: it =>`, `#import "@preview/` | drop the **whole statement** (global rules must never apply half-written — they'd restyle the entire doc and flicker) |
| Dangling binary operator / `.` / `=>` / `:` key without value in code | drop back to last complete element (`(a: 1, b:` → `(a: 1`) |
| Trailing operator in math (`^ _ / + - = &`, `\` linebreak) | drop operator |
| Partial escape `\`, `\u{1F6` | drop |
| Partial label `<lab`, bare `@`, `@fig:` | drop (or keep `@fig:` with config `refs: "drop" \| "placeholder"`) |
| Partial raw run at line start (` `` ` while a ```` ``` ```` block is open) | drop the partial closer |
| Partial line-start marker (`=` alone, `- ` empty item, `/ Term:` with no body) | keep (valid) — but optionally hide empty list items |
| Mid-word | keep (it's just text) |

**Phase B — close open frames, innermost first.**

| Frame | Closer |
|---|---|
| `strong` / `emph` | `*` / `_` (if the frame opened in the current paragraph) |
| `string` | `"` (after dropping a partial escape) |
| `raw` inline | same tick run; `raw` block → `\n` + same tick run (≥ opener) |
| `math` | `$` (or ` $` for display: keep display-ness) |
| `math-call` / `parens` | `)` |
| `content` | `]` |
| `code-block` | `}` |
| `block-comment` | `*/` × depth. Not needed for compilation (an unclosed comment compiles), but closing it keeps the source map and stable boundaries sane while streaming. In **final** mode an unclosed block comment is reported by the `unclosed-block-comment` lint (it silently hides everything after it). |
| `embedded-expr` | nothing (closing its children completes it) |
| `statement` (`#if cond [` …) | close children; `#if cond` with no body yet → drop statement |

Then **empty-construct pruning** (configurable): e.g. `#figure(` with nothing inside → drop rather than produce an empty figure; `#table(columns: 3, [a]` → fine (Typst pads missing cells).

**Additions found while building it** (each one came from a failing property test):
- An open *text* bracket (`[` in markup) needs a `]` only if an enclosing content block will append its own `]`. Otherwise (in a heading, or at root) closing it is wrong.
- **Stable offset** = the last root checkpoint whose first character is followed by at least one more character. Earlier definitions moved backwards when tokens merged (`https:` → a link) or a line-start `/` became `//`. This one is monotone under appends and independent of how the stream is chunked.
- **Streaming regions** pick a separator between the healed region and the untouched suffix: `""`, then a zero-width space, a space, or a newline. Without it, `p` + `*bold*` would make the suffix's `*` word-internal.
- Repair is verified: each candidate is re-recognized before it's accepted. After a few failed rounds the whole outermost open construct is cut, so pathological input stays linear (20,000 nested `#box[` in 73 ms).

**Invariants** (all property-tested, §11.1):
1. **Validity**: `typst-syntax` parse of `heal(P)` has zero syntax errors for every prefix P of a syntactically valid document D.
2. **Preservation**: all of P except a bounded tail (one atom / one incomplete statement) is a subsequence of `heal(P)`.
3. **Idempotence**: `heal(heal(P)) == heal(P)`.
4. **Identity on valid docs**: `heal(D) == D` when D compiles cleanly (Layer 1 off) — no "fixing" of correct documents.
5. **Monotonic stability**: `lastStableOffset` never decreases during an append-only stream.
6. **Linear time**: heal on a 1 MB input under N ms; no input causes super-linear behavior (fuzzed with pathological inputs: 100k nested `[`, 10k backtick runs).

**Source map.** Every patch records `{healedRange, originalRange, reason}` so diagnostics, caret position and "click to source" map back to the user's/LLM's text.

**API (mirrors remend):**
```ts
heal(source: string, options?: HealOptions): HealResult        // stateless, whole-tail
createHealer(options?: HealOptions): {                          // incremental
  push(chunk: string): HealResult;                              // append (chat streaming)
  applyEdit(edit: TextEdit): HealResult;                        // arbitrary edit (editor, regenerate)
  setStreamingRange(range: Range | null): HealResult;           // AI writing into the middle
  reset(text?: string): void;
  state(): ScanState;
}

interface HealResult {
  source: string;               // compilable (best effort)
  stableOffset: number;         // in healed coordinates
  patches: Patch[];             // for source map / debugging
  openFrames: Frame[];          // e.g. UI can show "writing table…"
  findings: LintFinding[];
}
interface HealOptions {
  lint?: Partial<Record<LintRuleId, boolean | "warn">>;
  tail?: { dropIncompleteStatements?: boolean; refs?: "drop" | "placeholder"; pruneEmpty?: boolean };
  unwrapFences?: "auto" | "never";
  handlers?: HealHandler[];     // custom, see §8.1
}
```

### 5.5 Layer 3 — Semantic fixers (diagnostic-driven, in the worker)

Some errors only appear after evaluation. The worker compiles the healed source; if there are **errors**, it maps each diagnostic to registered fixers, applies patches, and recompiles — **at most 2 extra rounds**, each budgeted. Fixers are pure `(diagnostic, source, ctx) → Patch[] | null`, ordered by priority.

| Diagnostic (pattern) | Fixer | Streaming | Final |
|---|---|---|---|
| `label <x> does not exist` (from `@x`) | Rewrite `@x` → `#typstream.pending-ref("x")` (styled grey placeholder text) | ✓ | ✓ (+ report) |
| `unknown variable: foo` at tail | Drop (scanner miss) | ✓ | report |
| `file not found` for `image("x.png")` | Replace with `#typstream.image-placeholder(alt)` box | ✓ | ✓ (+ report) |
| `unknown font family` | warning only; ensure fallback | ✓ | ✓ |
| `package not found` / not allowlisted | Async: fetch if allowlisted, else replace import with stub + report. *As built (#25): fetching is a pre-pass before the compile (§6.4); `package-stub` binds the import's names to placeholders.* | ✓ | ✓ |
| `expected X, found Y` in an *argument value* still in the tail | Drop that argument | ✓ | ✗ |
| `loop seems to be infinite` / `maximum function call depth` | Isolate block (§5.6) | ✓ | ✓ |
| `unclosed delimiter` (scanner bug safety net) | Re-run heal in strict mode; log telemetry | ✓ | — |

Fixers that need IO (fonts, packages) are **async**: the engine renders with a placeholder now and schedules a recompile when the resource arrives.

**Measured (#13).** The table above was a hypothesis. `tools/compile-oracle` healed and compiled every stream prefix of the 39 corpus documents that compile complete (16,618 prefixes) and of 150 generated documents (6,315). **88.0% of corpus prefixes compile** (87.9% paged; 87.7% when cutting at every code point); 96.3% of generated ones. 36 of 39 documents fail somewhere. Error classes, as a share of all corpus prefixes:

| Class | Share | Where | Cause |
|---|---:|---|---|
| missing argument | 4.5% | tail, at the cut | A call closed before its required arguments arrived: `#text(` → `text()`, `#align(center` (body comes after `)`), user functions. Needs signatures, so only the compiler knows. |
| type mismatch | 3.3% | tail, 98% at the cut | A value still being typed: `#v(1` (integer, not length), `0.`, `stroke: (` (array), `..xs.zip(` |
| citation before bibliography | 2.9% | settled | `@key` cites a bibliography entry; `#bibliography(..)` is the last line. One document: **70% of its stream (21 s) never compiles.** |
| invalid value | 0.6% | tail, at the cut | A string or array still being typed: `rgb("#e`, `link("")`, `lang: ""`, `(0cm, 2.5cm), (1` |
| unknown variable | 0.3% | tail | Closure parameters before `=>` arrives (`.map(((l, t)` is an array of unknowns) |
| invalid operation | 0.3% | 69% settled | A settled function called with a half-typed argument fails in its body (`#mcq(q, ([Arg`); the call site is in the tail, in the diagnostic's trace |
| partial reference | 0.1% | tail, at the cut | `@fig-` of `@fig-cell` |
| file not found | 0.02% | tail, at the cut | A path still being typed: `bibliography("assets/clim` |
| syntax | 0.01% | tail | Only heal's two known bugs |

Forward references (`@x` before `<x>`) never occurred: the corpus defines labels before using them. No `unknown font`, `package`, infinite-loop or call-depth errors occurred in prefixes. HTML and paged output fail on the same prefixes, except that 64-deep nesting exceeds Typst's maximum HTML depth even when complete.

What handles each class:
- **Heal, syntactically** (no compile round): drop a code value still being typed at the cut inside an argument list, array or dictionary (a number literal, a string heal had to close, an open group), generalizing `(a: 1, b:` → `(a: 1`; drop a reference that touches the end of the input; drop an incomplete `#let` like an incomplete set/show rule (generated documents' `#let (a, b) = (1,`). Content blocks keep streaming. This covers type mismatch, invalid value, file not found and partial references: about 4% of prefixes.
- **Layer 3, two generic fixers** (#20): *tail cut*: an error in the unsettled tail, or whose trace has a call site there, cuts the healed source at that point and re-heals (missing argument, unknown variable, invalid operation, and anything heal leaves); *pending reference*: `label <x> does not exist` rewrites the `@x` to a placeholder while streaming and is reported in final mode. A simulation of the two (since replaced by the real fixers, #20) fixed 80% of failing prefixes in one round and 95% in two: **99.4% of corpus prefixes compile with the 2-round limit**, 99.95% with 3. The longest remaining stale run is 0.6 s.
- **Last-good render** (§5.6 level 1) for the rest. The stable-prefix compile (level 2) would rescue only 75% of failures and drops the whole unsettled tail (often a whole table), so tail cut comes first.
- The other rows of the table (`file not found` for images, fonts, packages, loops) didn't occur here; they stay as hypotheses until a corpus has them (images, #25 packages).

> **As built (#20, `packages/engine/src/server/fixers.ts`):**
> - **Where.** The fix loop is in the protocol server, so the browser worker and `@typstream/node`'s WebSocket server both run it. Each error of a failed compile is offered to the fixers in priority order; the first that returns `TextEdit`s fixes it. A round is applied only when every error has a fix (one left over fails the recompile anyway). At most 2 rounds per revision, each starting only while the compile has taken under 1 s (streaming) or 3 s (final), a third of the watchdog's default budgets. Only a round that ends without errors counts: otherwise the client gets the first compile's diagnostics and keeps its last good render.
> - **Settled text.** The engine client sends heal's `stableOffset` as `CompileParams.settled` with streaming compiles, and tail cut only changes text after it. Without it all of the text counts as settled, so other clients (and the conformance suite) see plain compiles.
> - **`pending-ref`** (priority 10, both modes): `@key` or `@key[supplement]` → `#typstream.pending-ref("key");` (the `;` ends the embedded expression, so following text can't continue it); `ref(<key>)` in code → `typstream.pending-ref("key")`. A reference built elsewhere (a function's body) isn't in the text as written and is left alone.
> - **`tail-cut`** (priority 100, streaming only): cuts at the error's span, or the innermost call site in its trace, when that is in the unsettled tail, and re-heals the prefix (lint off; it ran on the client). A cut that leaves an argument list or a group empty also cuts the opener and the call's name (`rgb("#e` loses the whole `rgb(…)`, `.map(((i, s` the whole `.map(…)`; a method called on a value keeps the value: `zip(ys).map(` → `zip(ys)`). Measured, that raised one-round fixes from 80% to 88% of failing prefixes and cut the unfixed ones from 103 to 11.
> - **Errors with no position in the document** (#72): code that evaluates the document's content in a `context` or layout callback reports errors with no span and no trace span in the text. That includes CeTZ resolving a canvas's elements (`Failed to resolve coordinate system: 6`, `stroke: 1.2` before its `pt`), unify, and edu's `coordinate-plane`. `tail-cut` blames what is open at the end of the text: it strips the closers and whitespace healing appends, re-heals, and cuts heal's innermost open frame there. A value or content block is cut at its opener; an argument list loses the whole call. The cascade above then drops what that empties. If the call fails without the value (`line((0, 0), )`, which has a span), the second round cuts it. With nothing open there, nothing is cut. Measured (every stream prefix of the oracle's corpus, edu and `corpus/llm` documents): 49 paged prefixes of 47,983 and 5 HTML ones of 47,795 had such an error, none fixed before. All are fixed now, 33 of 49 in one round, keeping 93.5% of the unsettled tail (cutting the whole innermost call: 90.7%; back to the checkpoint: 0%, the whole canvas).
> - **Runtime library** at `/@typstream/runtime.typ`, mounted at `document/open` (a document's own file at that path replaces it, e.g. to restyle placeholders). Fixed compiles import it as `typstream` after the preamble; other compiles don't, so valid documents compile exactly as before. `pending-ref(key)` shows the key muted: `<span class="typstream-pending-ref" style="opacity: 0.55">` in HTML, grey text in paged output. #21 added `pending-text` and `error-block` (§5.6).
> - **Coordinates.** A fixed text maps back to the client's through the fixes' edits (core's `SourceMap`): diagnostics are reported in document coordinates, and HTML source anchors in a fixed text name the client's offsets.
> - **Reporting.** After a successful fix the diagnostics also list the errors that were fixed, at their place in the document: as `info` with the fixer's name as `source` while streaming, as the errors they are in final mode (a finished document with a missing label shows the placeholder and reports the error). `CompileTimings.fixMs` is the time in fixers and their recompiles; `compileMs` sums every round. Exports (`export/*`) don't run fixers.
> - **Measured** (compile oracle through the real server, every stream prefix): **99.93% of corpus prefixes compile**, HTML and paged (16,607 of 16,618; heal alone 88.0%), and 100% of generated ones; cutting at every code point (HTML), 99.95% (77,813 of 77,849; heal alone 87.65%). 87.7% of failing prefixes are fixed in one round, 99.45% within two. The rounds add compiles for 13.5% of prefixes; fixing took p50 3.5 ms, p95 13 ms in Node for HTML (paged 11.6 / 41 ms, SVG export included). The longest stale run is 0.6 s, down from 21.1 s (the citation document). The 11 prefixes left need three cuts (`#place(center, dx: 3` inside content inside a call, a gradient's second stop, a closure in a spread); the last good render covers them.
> - **Not done.** Heal's syntactic drops above would make many cuts free of compile rounds, but with tail cut in place they'd only save compiles, so they wait. Async fixers are awaited inside the compile; restarting a compile when a font arrives belongs to #11 (packages do it since #25). *(#11 added it: an adapter compile's `pending` promise, §6.4.)* Image placeholders, fonts and loop isolation stay hypotheses until the corpus has them.
> - **`package-stub`** (#25, priority 20, both modes): an import of a package the document can't have (Typst's "package not found", which the server rewrites to `package … is not allowed` / `is still loading` / `failed to load (…)`) becomes `let (a, c) = (typstream.missing-package("@preview/x:1.0.0"),) * 2` for `: a, b as c`, or binds the module's name for a bare or `as m` import. The placeholder is a function showing `[@preview/x:1.0.0]` muted. Wildcard imports and modules whose fields are used (`cetz.draw`) can't be stood in for: the error stays, and the fallback ladder (§5.6) isolates the block.

### 5.6 Layer 4 — Fallback ladder

If errors remain after Layer 3:

1. **Last-good render** (streaming): keep showing the previous successful artifact; show a subtle "updating…" state. The stream keeps going; the next token usually fixes it. Telemetry counts consecutive failures.
2. **Stable-prefix compile**: compile `heal(source[0..lastStableOffset])` (always cached from earlier) + render the remainder as plain styled text below (`raw`-ish preview). Used when last-good is too stale (> N tokens or > 1.5 s).
3. **Block isolation** (final mode, or persistent streaming errors): split at top-level checkpoints, bisect to find failing blocks (O(log n) compiles, since state flows forward we test prefixes), replace each failing block with `#typstream.error-block(raw: "...", message: "...")` and compile the rest. Teachers see the full document with an inline, friendly "this part couldn't be displayed" box — never a blank screen.
4. **Raw source view** as last resort (and toggle for power users).

> **As built (#21, `packages/engine/src/server/fallback.ts`, `src/hang.ts`):**
> - **Opt-in per compile.** `CompileParams.fallback: { isolate?, stablePrefix?, skip? }`. Without it a failed compile publishes no artifact, as before (the conformance suite, other clients). The engine client sends `{ isolate: true }` with every compile, `stablePrefix` once stale, `skip` in final mode after a hang; `DocumentOptions.fallback: false` turns it off. `CompileResult.fallback: { isolated, plainFrom }` says what the artifact shows instead of the text, `timings.fallbackMs` what it cost.
> - **Order.** The text as it is, then Layer 3's fixers, then Layer 4. Every compile Layer 4 makes for an artifact runs the fixers too, so a tail cut still applies around isolated blocks.
> - **Blocks** are the lines source anchors go before (§10.2): heal's root checkpoints at the start of the text, after a blank line, or at a heading, never splitting a wide list or detaching a label. A block's parse doesn't depend on other blocks; its evaluation does (`#let`, `#set`, `#show` flow forward).
> - **Isolation (level 3).** The first failing block is found by bisecting prefixes: prefix `k` compiles, `k + 1` doesn't. Prefixes are *checked*: compiled for diagnostics only (`AdapterDocument.check`: HTML compile, or engine-wasm's `check_paged`, which keeps the changed-page baseline; an adapter without it compiles and the next paged artifact sends every page). That block becomes `#typstream.error-block(source, message)` (source clipped at 2,000 characters) and the search continues after it, so a block that uses an isolated block's definitions is isolated too, and a function that fails is blamed where it is called, not defined. ⌈log₂ n⌉ checks and one compile per failing block. Blocks where heal's recognizer (Typst's parser, ported) finds a syntax error, and Typst reports one, are isolated without any check. Checks ignore `label … does not exist` (a prefix may cite a label that comes later); the whole text's compile runs `pending-ref` for those. Only errors placed in the text (or a compile `@typstream/node`'s pool stopped) start a search: a broken preamble fails every prefix alike.
> - **Streaming.** Only settled blocks are isolated (before the block holding heal's `stableOffset`); the block being written is the tail, left to the fixers. First check: the settled text alone (the stable-prefix compile). If it compiles, the tail is at fault: with `stablePrefix` the artifact is the settled text plus `#typstream.pending-text(tail)` (muted, line breaks kept; level 2), else the client keeps its last good render. Each document remembers the prefix that compiled and its isolated blocks; the next revision of a growing text starts the search after it, so a lasting error costs one extra compile per revision.
> - **Stale** is the client's call: `schedule.staleMs` (1.5 s) after the first failed streaming compile since a good render, it asks for `stablePrefix`. A render that used the stable prefix doesn't end staleness.
> - **Level 1 in the server (#65): never show less of the tail.** Heal and tail cut keep a prefix compiling by cutting what is still being typed, and a cut can take what already rendered with it: `..xs.map(x => (a, b` is an array of arrays until its `.flatten()` arrives, so tail cut drops the whole spread and a table loses the rows it showed; heal drops a whole spread argument at `..(…).map`. So a streaming compile with `fallback` that succeeds but shows less of the tail than the last artifact did publishes nothing and answers `error`, as a failed compile does, and the client keeps its last render (`stale`). "Less" is textual (`showsLess`): past where the compiled text and the last artifact's part, the old one has more than closers, and they part at or after `settled` (an edit before it, or a settled reference resolving, shows). It lasts until the tail shows as much again or that text is settled, not `staleMs`: a cut drops everything after it, so the cut render never shows more meanwhile, and releasing it after 1.5 s brought the flicker back in the browser. The stable prefix (level 2) is held the same way (its plain text would replace a tail that rendered, from `plainFrom`); it shows only a tail block that never rendered. The next paged artifact after a held one sends every page (the adapter's baseline moved). Telemetry (#30) reports a held compile as fallback level 1, like any compile that keeps the last render. Measured over the edu corpus (flicker suite's 60 steps, real server, Node): a page returning to an SVG it showed before, in 8 of 35 documents before, 2 after, both a heading moving to a new page with what follows it (layout, not a cut).
> - **Hangs and crashes (per-block budgets, §6.3).** The server can't stop a compile, so the client searches: when a *final* compile runs past the watchdog or crashes the worker, it bisects prefixes of the source with the rest `skip`ped, each compile under `watchdog.probeMs` (5 s; the whole text keeps `finalMs`). A skipped range is an error block that is never compiled ("Compiling this part took too long." / "…crashed the engine.", reported with code `timeout` / `engine-crashed`). Probe compiles' output isn't shown. What was found stays skipped while the source is the same; at most 16 compiles per search. `@typstream/node` needs none of this: its pool stops a runaway compile and answers with a `timeout` diagnostic, so the server's own bisection finds the block. While streaming, timeouts stay strikes (`too-complex` after 3).
> - **Last resort (level 4)**, final mode: when nothing else compiles in time (a reference built at runtime, budgets), the whole document as one error block, i.e. its source. Fallback compiles start only while the request has taken under 1.5 s (streaming) or 5 s (final), half the watchdog's budgets.
> - **Reporting.** Isolated blocks' errors stay errors, at their place (a stopped compile's on its block); the tail's errors under the stable prefix become `info` with `source: "stable-prefix"`. The status is `idle` / `done`, since there is an artifact.
> - **Runtime library.** `error-block(source, message)`: in HTML a `div.typstream-error-block` (`role="note"`, dashed border in `currentColor`) with "This part couldn't be displayed.", the message, and the source in a `<details>`; in paged output a dashed box with the source as raw text. `pending-text(source)`: `div.typstream-pending-text` / grey text.
> - **Measured** (compile oracle, `tools/compile-oracle`): with the stable prefix asked for, **every stream prefix renders** (corpus and generated, HTML and paged; Layer 3 leaves 11 of 16,618 corpus prefixes, all taken by the stable prefix). In final mode **all 48 corpus documents that don't run away render** (`__tests__/fallback.test.ts`; 6 with error blocks: deep-nesting-10k, deep-nesting-64 (too deep for HTML), markdown-habits, runaway-recursion, runaway-while, truncated-output), with at most ⌈log₂ n⌉ checks per isolated block (markdown-habits: 3 blocks of 25 in 10 checks, 139 ms). The engine's browser tests render all 17 adversarial documents in final mode (not large-1mb, for time), runaway loops and memory bombs included, in Chromium, Firefox and WebKit. Streamed with lasting errors, markdown-habits renders 95.0% of its prefixes (Layer 3: 38.5%) and runaway-while 100% (89.7%).
> - **Not done.** Streaming hangs still end live compiling after 3 strikes; isolating them would need the same search on a text that keeps changing. Exports don't fall back: they publish what compiles or reject. The renderer's raw-source toggle for power users is a UI concern (#17's component).

### 5.7 Final mode & the LLM fix loop

When the stream ends (`isStreaming=false`), the pipeline switches to **strict**: no tail repair (a truncated stream is reported, not hidden), lint fixes per config, semantic fixers still on, block isolation for the rest. Then:
- `onDiagnostics(diags)` fires with source-mapped, deduplicated, human-readable diagnostics.
- `formatDiagnosticsForLLM(source, diags)` (in `@typstream/node` and engine) produces a compact repair prompt (line excerpts + messages + hints) so the app can run an **automatic AI fix pass** (server-side preferred: `@typstream/node.validate()` before persisting a document).
- The edu prompt kit (§8.3) is the first line of defense; telemetry from fixers feeds the prompt kit's "don'ts".

> **As built (#22, `packages/node`):**
> - `validate(source, { target = "paged", preamble, files, inputs, lint })` compiles without exporting (engine-wasm's `check_paged`). It adds heal's final-mode lint findings as `warning`s (`source: "heal"`, `code: <rule>`, a "replace X with Y" hint), because Markdown habits like `**bold**` and `$5 and $10` compile but render wrongly. `ok` means no errors.
> - `formatDiagnosticsForLLM` writes the Typst CLI's layout: `error: message`, ` --> line:col`, numbered context lines, `^^^` under the span, `= note:` for the call chain, `= hint:` lines. Errors come first. It's capped at 10 diagnostics with long lines clipped around the span, and ends with "reply with the complete corrected document".
> - `fixLoop({ source, generate, maxRounds = 3, strict })` returns the attempt with the fewest errors (then warnings, then the latest), so a worse reply never replaces a better one. Replies are normalized (a `typst` fence is stripped). Typst stops evaluating at the first runtime error, so a document with several mistakes usually takes several rounds.
> - The watchdog (default 10 s) and a crashed engine (a wasm trap) come back as error diagnostics with `source: "typstream"` and `code: "timeout"` / `"engine-crashed"`, never as exceptions.

---

## 6. Compile engine

### 6.1 Engine adapter

```ts
interface EngineAdapter {
  init(opts: { wasmUrl?: string; fonts: FontSource[]; packages: PackageResolver }): Promise<void>;
  setFiles(delta: Record<string, string | Uint8Array | null>): void;   // incremental VFS update
  compile(req: { entry: string; target: "html" | "paged"; inputs?: Record<string, string> }):
    Promise<{ diagnostics: Diagnostic[]; artifact?: HtmlArtifact | PagedArtifact; timings: Timings }>;
  exportPdf(): Promise<Uint8Array>;
  dispose(): void;
}
```
**State of the options (Oct 2026)** — none covers everything yet, which is exactly why the adapter boundary matters:

| Option | Typst | Paged (vector/SVG, incremental) | HTML target in wasm | Notes |
|---|---|---|---|---|
| **typst.ts** web compiler + renderer (`@myriaddreamin/*`) | 0.14.2 (`latest` 0.7.0), 0.15.0-rc.1 (`rc` 0.8.0-rc3); main tracks 0.15.1, unreleased | ✓ `IncrementalServer` → delta artifacts merged by the renderer (`manipulateData`) | ✗ — open PR #894 adds `CompileFormatEnum.html` | Mature renderer. **Memory leak: comemo cache never evicted in the web build (issue/PR #895, ~100 compiles → crash)**. Packages/lazy fonts use sync XHR → dedicated worker only. Node compiler already has `.html()`/`.hast()`. |
| **typst-wasm** (npm 1.0.0, MIT) | 0.15.0 | SVG/PNG/PDF (full pages each compile) | ✓ | 6.22 MB brotli. Worker backend needs COOP/COEP; JSPI backend works without isolation in Chromium 156 / Firefox 157 / WebKit 27.2 but runs on the calling thread (host it in our worker). ~1.5× slower HTML streaming than the custom build; no eviction API. |
| **Custom build** (`typst` + `typst-html` + `typst-svg` via wasm-bindgen; spike in `spikes/phase0/custom-engine`, ~350 lines of Rust) | 0.15.1, we pin | SVG for changed pages only (`compile_svg_changed`, measured) | ✓ | **5.86 MB brotli** (HTML+SVG), +0.34 MB with PDF. Fastest HTML streaming (20 pages: p50 17–22 ms, warm 2 ms). With `comemo::evict(2)` after each compile, **memory stays flat at ~21 MB** over 200 compiles (typst.ts: 280 MB). No COOP/COEP, no JSPI. Costs a small Rust crate + CI wasm build. |
| **Server adapter** (`@typstream/node`: engine-wasm on Node worker threads, #22) | 0.15.1 (same build) | ✓ | ✓ | No download for the client; latency + cost on our side. |

**Decision (Phase 0, measured in Chromium, Firefox and WebKit — see [spikes/phase0/RESULTS.md](spikes/phase0/RESULTS.md))**:
- **Default adapter: our own build** (`@typstream/engine-wasm`, Rust crate in the monorepo), HTML target first.
- **Paged target: our build with changed-page export** (`compile_svg_changed`). It hashes each page frame and exports SVG only for pages that changed: median 1 page per streamed step. At 20 pages, main-thread render is 5–9 ms p50 (typst.ts 3–8 ms; sending all pages 58–146 ms). First paint of a full document is faster than typst.ts (45–88 vs 80–146 ms). **typst.ts is dropped**, so there's one engine and one wasm download. Remaining worst case: occasional multi-page reflows (40–70 ms when 7 pages change). Handle it with visible-pages-first DOM updates and offscreen pages in idle time (§6.5).
- typst.ts and typst-wasm remain possible adapters behind the conformance suite, but we don't ship them.
- A **server adapter** is a first-class option, not an afterthought, given the download size (§6.4).

**As built** ([#8](https://github.com/ikramhasan/typstream/issues/8), `packages/engine-wasm`): the Phase 0 crate, cleaned up. `Engine` has `add_font`, `set_source` / `set_file` / `remove_file` (virtual absolute paths), `set_inputs({ key: "value" })`, `compile_html()`, `compile_svg_changed()` + `reset_pages()`, and static `features()` / `memory_bytes()`. Differences from the spike and the sketch above:
- There is no full-document `compile_svg()`: `reset_pages()` then `compile_svg_changed()` sends every page.
- `comemo::evict(2)` runs inside every compile; `evict` is not exported.
- Diagnostics already have `@typstream/core`'s `Diagnostic` shape (#7), with `/main.typ` as the document: `{ severity, span, message, hints, trace, file?, source: "typst" }`. All spans are `{ from, to }` in **UTF-16**. For a problem in another file (a source, or a UTF-8 data file such as JSON), `span` is the nearest call site in `/main.typ` from the trace and `file: { path, span }` is the original location. Trace items have a span only where they are in `/main.typ`. Hint spans are dropped. The "html export is under active development" warning is filtered. engine-wasm can't import core (its layer row has no deps), so the shape is mirrored, not shared; the worker (#10) only remaps offsets (preamble, fixers) with `mapDiagnostic`.
- `datetime.today()` is the real local date (the spike fixed it to 2026-01-01), as in the CLI.
- PDF export (`compile_pdf()` → `{ pdf, pageCount }`) is the `pdf` cargo feature. Since [#18](https://github.com/ikramhasan/typstream/issues/18) it is a default feature and there is one build, which browsers and `@typstream/node` both run (§6.4). `--no-default-features` leaves it out.
- `check_paged()` (#22): a paged compile without export, giving diagnostics and the page count, for validation. It leaves the changed-page baseline alone.
- Each changed page also carries its text runs (`text`, #14) for the paged renderer's text layer, with their structure, the document's language and direction (`structure`, `lang`, `dir`, #63); the SVG stays byte-identical to native typst.
- Tests compare HTML and every SVG page byte for byte with native `typst compile` 0.15.1 using the same fonts (Typst's bundled set, read from the `typst-assets` crate).
- CI: an `Engine (wasm)` job builds it (Rust, wasm-bindgen, binaryen, native typst) and runs its types, tests, size, API report and package lint. The other jobs leave it out with `--filter=!@typstream/engine-wasm`.

> **As built (#22): the server adapter.** `@typstream/node`'s `createProtocolServer({ engine })` serves this protocol; `handleWebSocket(ws, server)` attaches it to a `ws`-style socket. The protocol is `@typstream/engine/server`'s `createServer` (#10, the code in the browser worker) over a node `EngineAdapter` that compiles on the pool. A gate checks message shapes from untrusted clients first, and on disconnect cancels queued requests and shuts the session down.
> - **Wire format:** JSON, with `Uint8Array` as `{ "$bytes": "<base64>" }` (core's `serializeMessage` / `deserializeMessage`).
> - **Sessions:** each connection is a session with its own documents. Requests run in arrival order, so `$/cancel` can drop queued ones.
> - **Capabilities:** `targets: ["html", "paged"]`, `exports: ["pdf", "html"]`, `pagedDiff`. No `resolve/*`. HTML compiles carry source anchors (§10.2) unless `anchors: false`. The adapter gets each compile's `mode` (`AdapterCompileOptions`; exports are `final`); here it picks the watchdog budget (3 s streaming, 10 s final). Layer 3 fixers (#20) run in the protocol server, so socket clients get them too. `initialize`'s fonts and packages are ignored: the server configures its own.
> - **Limits:** `maxDocuments` per connection (32) and `maxTextLength` of `/main.typ` (1,000,000 UTF-16 units) answer `invalid-params`; message size is the socket server's (`ws`'s `maxPayload`).
> - **Engine:** a lazily grown pool of `worker_threads` (default `min(4, cores − 1)`). Each worker runs one engine-wasm `Engine`. The 20 MB module is compiled once and posted to workers.
> - **Where state lives:** documents (text, preamble, files, revisions, page hashes) stay on the main thread. Each compile sends the full source, plus only the file versions that worker lacks. A timed-out or trapped worker is terminated and replaced; its document only sees one failed compile.
> - **Warm caches:** compiles of a document prefer the worker that compiled it last.
> - **Changed pages:** a worker diffs against its own last paged compile only when that was this document at the version the adapter holds (a token). Otherwise it exports every page and the adapter keeps those whose SVG content differs, so the client still gets a `base` diff. `PageUpdate` (frame hash, size) is engine-wasm's.
> - **Preamble:** as in #10's server (`preamble + "\n" + text`, `fromMain`); `validate` / `render` use the same `fromMain`, so preamble problems carry `file: { path: "<preamble>" }` everywhere.
> - **Conformance:** #10's suite (`packages/engine/__tests__/conformance.ts`) runs against `@typstream/node` in-process and over a real WebSocket; node's own tests add the watchdog, budgets per mode, malformed input, limits and disconnects.

typst.ts compiler API notes that shape the adapter: `addSource`/`mapShadow` for the VFS, `compile({ format: vector | pdf, diagnostics: "full", inputs })`, `query({ selector, field })` (used for islands), `setFonts(resolver)` shared across compiler instances. Diagnostics come back as `{ severity, range: "sl:sc-el:ec" (zero-based in practice), message }` with **hints concatenated into `message`** — the adapter normalizes this into `@typstream/core`'s `Diagnostic` (`{ severity, span, message, hints[], trace[] }`) so fixers never parse adapter-specific strings.

**The worker is a language service, not a compile function.** The main thread talks to it through a versioned, LSP-shaped protocol defined in `@typstream/core` (`{ id, method, params }` requests, `{ id, result | error }` responses, notifications for diagnostics/artifacts):

| Method | v1 | Later (editor) |
|---|---|---|
| `document/open`, `document/edit` (TextEdit[] + revision), `document/close` | ✓ | — |
| `compile` → artifact + diagnostics, `export/pdf`, `export/html` | ✓ | — |
| `resolve/span` (artifact position → source span), `resolve/location` (span → page/element) | basic (paged) | full |
| `completion`, `hover`, `definition`, `signatureHelp`, `format` (typstyle), `foldingRanges` | — | ✓ (typst-ide / tinymist-style services) |

Multiple documents per worker (chat history, editor tabs) share fonts, packages and the comemo cache. A protocol version number and capability negotiation (`initialize` → capabilities) let newer editors talk to older engines gracefully.

> **As built (#7):** the protocol is `packages/core/src/protocol.ts`; its TSDoc is the reference. Differences from the table above:
> - **Revisions.** Every document-scoped message (params, results, notifications) carries `{ uri, rev }`; revisions are client-chosen, increasing integers. Protocol-level messages (`initialize`, `shutdown`, `$/cancel`, `$/log`) carry none. `document/edit` with a non-increasing `rev` fails with `stale-revision`; compiling, exporting or resolving a revision that is no longer current fails with `content-modified`.
> - **Compile output is pushed, not returned.** For each compile the worker sends `document/diagnostics` (always), then `document/artifact` (on success), then the `compile` response, which carries only status, timings and `memoryBytes` (for recycling, §6.3). Server-initiated recompiles (a lazy font or package arrived) publish the same notifications for the same revision, and the later one replaces the earlier. A failed compile publishes no artifact; the client keeps last-good (§5.6).
> - **Changed pages are explicit.** A `PagedArtifact` lists only changed pages plus `pageCount`, and names the `base` revision it diffs against (`null` = all pages). A client whose pages aren't from `base` recompiles with `fullPages`. Clients opt in with the `pagedDiff` capability.
> - **Added:** `document/setFiles` (per-document images and data; a new revision), `shutdown`, `$/cancel` (drops a queued request; a running Typst compile can't be interrupted, so the watchdog stays the hard stop), `$/log`. `initialize` takes shared `fonts` and `packages`; `document/open` takes a `preamble` and `files`. `compile` takes `mode: "streaming" | "final"` and `anchors` (HTML, §10.2).
> - **`resolve/span` / `resolve/location`** are typed for paged output only, since HTML resolves blocks through renderer anchors. They are `@beta`, behind `resolveSpan` / `resolveLocation` capabilities. Editor services (completion, hover, …) will arrive as new capability flags, not a version bump.
> - **`Diagnostic`** is `{ severity: "error" | "warning" | "info", span: Range | null, message, hints[], trace[], file?, source?, code? }`. `span` is `null` when Typst gives no position in the document (e.g. a missing font). For errors inside the preamble or a package, `span` is the nearest call site in the document and `file` holds the original location. Helpers: `mapDiagnostic` (through heal's source map or an edit), `normalizeDiagnostics` (sort + dedupe), `formatDiagnostic`, `lineColumn`.

> **As built (#10, `packages/engine`, worker half):**
> - **Entry points.** `@typstream/engine` exports `engineWorker()`, a `SpawnEngine` for the default worker (`dist/worker.js` = `serve(engineWasm({ fonts: baseFonts }))`). It is written as `new Worker(new URL("./worker.js", import.meta.url), { type: "module" })`, and the worker imports engine-wasm's glue and `@typstream/engine-wasm/fonts`, whose URLs are `new URL(…, import.meta.url)` as well. So bundlers emit the worker, the wasm and the fonts as assets with no configuration: checked with packed tarballs in Vite 8 (dev and build) and Next.js 16 (Turbopack dev and build, webpack build), in Chromium, Firefox and WebKit. `@typstream/engine/server` (`serve`, `createServer`, `inProcess`, `engineWasm`, `EngineAdapter`) is for custom workers, e.g. to load the wasm or fonts from a CDN: `serve(engineWasm({ wasm: url, fonts: [...] }))`.
> - **Adapter.** The server owns the protocol: documents, revisions, edits, preambles, file paths, inputs and which revision changed pages diff against. An `EngineAdapter` only creates per-document compiler state (`setFiles` at absolute virtual paths, `setInputs`, `compileHtml`, `compilePaged({ fullPages })`, optional `exportPdf`). The engine-wasm adapter gives each document its own wasm `Engine` (its own files and page hashes); they share the wasm instance and Typst's cache. Fonts are fetched once but copied into every document's engine; sharing them is #11. *(As built, #11: fonts belong to the wasm instance; see §6.4.)*
> - **Preamble.** `/main.typ` is `preamble + "\n" + text`, so the preamble's definitions are in scope. Diagnostics are moved back by the preamble's length; one inside the preamble gets `file: { path: "<preamble>", span }` and the nearest call site in the document as `span`, like a problem in another file.
> - **Paged.** Changed pages are sent against the last paged artifact sent for the document. After an HTML artifact, or when the client lacks `pagedDiff`, the server sends every page. engine-wasm now returns each page's `hash`, `width` and `height` with its SVG. Typst's frame hashes include source spans, so the same text parsed afresh and reparsed incrementally can hash differently: equal hashes mean equal pages, not the reverse.
> - **Failures.** A request that throws is answered `internal`. A wasm trap (a Typst panic, or running out of memory as `range(100000000).map(x => x)` does in some browsers) may leave the instance corrupt, so the worker rethrows it without answering, and the client counts a crash strike and replaces the worker. `fromWorker` cancels the worker's `error` event so the page doesn't also report it as uncaught.
> - Not yet: `resolve/*` (answered `unsupported`). Packages arrived with #25 and lazy fonts with #11 (§6.4). PDF export arrived with #18: the engine-wasm adapter offers `exports: ["html", "pdf"]` when the loaded wasm has the `pdf` feature.

### 6.2 Scheduling

- **Latest-wins**: at most one compile in flight + one pending (the newest). Intermediate sources are discarded, never queued.
- **Adaptive throttle**: `interval = clamp(minInterval, 1.25 × EMA(compileMs), maxInterval)`; defaults `minInterval=33ms` (≈30 fps), `maxInterval=500ms`. Big docs naturally update less often; small docs feel live.
- **Boundary bias**: prefer compiling when the healer reports a new stable checkpoint (a finished paragraph/block) over mid-word ticks — fewer visual reflows, better cache hits.
- **Revision numbers** on every message; renderer ignores stale results.
- **Incremental compilation**: VFS updates only `main.typ`; preamble/packages/fonts stay resident; Typst's comemo memoization reuses layout of unchanged content.

### 6.3 Watchdog & resource limits

- Each compile has a wall-clock budget (default 3 s streaming, 10 s final). On timeout the main thread **terminates the worker** and spawns a fresh one (pre-warmed spare worker to make this ~instant), marks the offending revision, and falls back (§5.6) — block isolation runs in the fresh worker with per-block budgets.
- **Cache eviction**: the default adapter calls `comemo::evict(2)` after **every** compile. Eviction ages entries per evict call, and the cache is global per wasm instance. Measured: wasm memory flat at ~21 MB over 200 compiles, and compiles ~30% faster than without eviction (less memory pressure); without it, memory grew ~1.9 MB per compile.
- **Compiler recycling** (for adapters without eviction, i.e. typst.ts #895 — measured +1.3 MB per compile, 280 MB after 200 — and as a general safety net): the worker pool tracks wasm memory per worker; past a threshold (default 256 MB) it spins up a fresh worker in the background, warms it with the current document, then swaps — invisible to the user.
- Optional `maxMemoryMB` via a wasm memory cap where the adapter supports it.
- After 3 timeouts on the same document → stop live compiling, show "document too complex to preview live", compile once at the end.

> **As built (#29):** `limits.maxLength` and `limits.livePages` (§9 "As built (#29)"). A wasm stack overflow (the host's `RangeError`/`InternalError`) ends the worker like a trap.

> **As built (#21):** a final compile that times out or crashes the worker doesn't fail the document: the client looks for the blocks that do it by compiling prefixes with the rest skipped, each under its own budget (`watchdog.probeMs`, 5 s), and skips them from then on (§5.6 "As built (#21)"). Streaming timeouts are strikes as before.

> **As built (#9, `packages/engine`, main-thread client):**
> - **Scheduling.**
>   - The engine runs **one compile at a time across all its documents**. The worker is single-threaded anyway, and this way a watchdog timer never counts another document's compile. Each document has at most one pending compile, which is a flag: the healed source is read when its turn comes.
>   - Edits are sent only right before a compile, as `diffEdit(sent, healed)`. A change that heals to the same source doesn't compile (e.g. typing inside a cut `#let x =`).
>   - The EMA is over the worker's `timings.totalMs` (α = 0.3).
>   - Boundary bias: when heal's `stableOffset` has advanced since the last compile, the next compile is due `minInterval` after the last one started, not after the adaptive interval.
>   - A due compile still waits for a 0 ms timer, so chunks pushed in one task share a compile.
> - **Watchdog.**
>   - The budget clock starts once the worker has answered `initialize`, so cold start isn't counted.
>   - A worker crash (an `error` event) during a compile is a strike, like a timeout.
>   - A worker that dies before it is initialized isn't respawned. The engine fails, and every document reports `error`, rather than respawning in a loop.
>   - The spare is spawned once the active worker is up, so they don't compete for the first compile.
>   - After a replacement, documents open themselves in the new worker (`document/open` with the current healed text) at their next compile. Idle documents don't recompile.
> - **Recycling.** `memoryBytes` from a compile result over the threshold swaps in the spare right after that compile. There is no warm-up compile: the next one runs without the old worker's caches.
> - **Status.**
>   - While streaming, `stale` wins over `compiling`: it lasts until a compile succeeds.
>   - In final mode a failure is `error`.
>   - After the third strike, `live` is false. `finish()` still compiles once, with the final budget.
> - **Paged output.** The client applies changed-page artifacts, so `state.artifact` always holds every page. A `base` it doesn't have triggers a `fullPages` recompile.

### 6.4 Assets: wasm, fonts, packages

- **Wasm**: the compiler is **heavy**. Brotli-11 sizes: our build 5.86 MB (HTML+SVG; PDF +0.34 MB), typst-wasm 6.22 MB, typst.ts 7.74 MB + 0.37 MB renderer. The Typst core itself (eval, layout, shaping, bundled data) is ~5.8 MB; exporters are small. About 3 s at 20 Mbps (measured with network emulation). That is the biggest product risk for school devices on slow networks. Mitigations, in order:
  1. Load lazily, `WebAssembly.compileStreaming`, serve immutable with content hash from our own origin; persist in Cache Storage so the cost is paid once per release.
  2. **Preload hint** API (`preloadTypstream()`) so apps start the download when the user opens the "Generate" dialog — generation itself takes seconds, which hides most of the download.
  3. **Server adapter for the first document** while the wasm downloads in the background (hybrid mode: server artifacts until the local engine is warm, then switch). Built in #22 (`@typstream/node`, §6.1); the client-side switch is still to do.
  4. ~~Ship PDF export as a lazily loaded second module or do it server-side (+0.36 MB otherwise).~~ *As built (#18): PDF is in the one build (+0.34 MB). A lazy module would be a whole second engine; numbers below.*
  5. **Trim bundled data.** Typst has no feature gates, but patching two dependencies (hyphenation limited to the languages we support; a curated or empty syntax-highlight set) brought the engine to **4.29 MB brotli (−27%)**, verified in all three browsers at unchanged speed. `#[cfg]` patches to typst-library for bibliography, plugins and PDF-as-image are estimated to reach ~2.4–2.7 MB. *(#25: plugins can't go: CeTZ ≥ 0.4 needs its `cetz-core` wasm plugin.)* That's a maintenance trade-off to decide once we know whether teachers need bibliographies and code highlighting.

> **As built (#18): PDF in the default build.** Measured with `packages/engine/__tests__/browser/research-pdf.test.ts` (Playwright's Chromium, Firefox, WebKit; 6-core machine at load ~5):
> - **Size:** 6.20 MB brotli with PDF vs 5.85 MB without (+0.34 MB, +5.9%). A PDF-only module would still be all of Typst (~5.8 MB): typst-pdf exports a laid-out `PagedDocument`, and a second wasm instance can't use the first one's (separate memory, frames aren't serializable).
> - **Option (b), a second engine on first export:** 6.20 MB to download (~2.5 s at 20 Mbps, cached after); `WebAssembly.compile` 32 / 154 / 111 ms (Chromium / Firefox / WebKit), instantiate and fonts ~10–20 ms; first `compile_pdf` 67–248 ms for 3–5 pages, 437–595 ms for 19 pages; plus a second instance's memory (~58 MB here) while it lives.
> - **Option (a), PDF in the build:** warm HTML and SVG compiles and memory are unchanged within noise; an export recompiles what the preview already compiled, so it is warm: `compile_pdf` 8–23 ms for 3–5 pages, 38–50 ms for 19 pages.
> - (b) wins only if fewer than ~1 session in 18 exports, and teachers print. Server export (option c) needs nothing extra: the client's `exportPdf()` works over a `@typstream/node` connection too.

- **Fonts** (as built, #10: engine-wasm's build copies the minimal set below from the `typst-assets` crate into `dist/fonts/` with its license NOTICE, and `@typstream/engine-wasm/fonts` exports their URLs; the default worker loads them at `initialize`. Lazy and script fonts are #11): the minimal default set (Libertinus Serif regular/bold/italic, New Computer Modern Math, DejaVu Sans Mono) is **≈ 2.6 MB raw / 1.45 MB brotli** (measured); the full typst-assets set is 9.9 MB. Ship the minimal set; register everything else **lazily**: put precomputed `FontInfo` in the `FontBook` at build time, and have the World's `font(index)` load bytes on first use (the worker prefetches them asynchronously when the healer detects a script; sync XHR in the worker is the fallback). `text.fallback` only sees fonts in the book, so lazy registration is required for fallback to work. **Script detection**: the healer reports Unicode scripts present (Bengali, Arabic, Devanagari, CJK, …); the engine fetches the matching Noto font *before* compiling text that needs it (or compiles with fallback and recompiles when loaded). Font registry is configurable; fonts cached in Cache Storage.

> **As built (#11): lazy fonts.** Findings and measurements: [#11 comment](https://github.com/ikramhasan/typstream/issues/11#issuecomment-6411893007).
> - **Where fonts live.** engine-wasm keeps one font set per wasm instance (`src/fonts.rs`), shared by every `Engine`: `Engine.add_font(bytes)` (static; a file added twice is added once), `Engine.register_font(info)` → id, `Engine.load_font(id, bytes)` (rejects bytes whose `FontInfo` differs from the registered one). Each compile snapshots the font book, so fonts added between compiles show up in the next one.
> - **How a missing font is found.** Typst selects faces from the book alone, by family (`book.select`) or for text the families don't cover (`book.select_fallback`, by coverage and similarity to the current font), and only then asks `World::font(index)` for bytes. A registered face without bytes returns `None`: Typst tries the next family or shapes tofu (typst-layout `get_font_and_covers`), and the World records the face's file. Every compile result lists them in `missingFonts`. Cached layout reports them too: comemo replays `font()` calls when it validates a cached result. This replaces the script detection sketched above: it is exact (explicit `font:` choices, fallback, nothing fetched for scripts a base font covers, or for comments and strings), and the client only sends text right before a compile, so detection there would start a fetch one compile earlier at best.
> - **Registry.** `build.sh` downloads the script fonts (notofonts.github.io at a pinned commit, unhinted static TTFs, SHA-256 checked) into `dist/fonts/` with `LICENSE-Noto.txt` (OFL), and `scripts/fonts.mjs` runs the just-built wasm to write `scriptFonts` (`{ url, file, family, scripts, info }`, `info` = `Engine.font_info`) into `@typstream/engine-wasm/fonts`. `node scripts/fonts.mjs --info font.ttf` makes entries for other fonts. No subsetting: Typst needs whole files, these are per script already, and weights are separate files fetched only when used.
> - **Worker.** The engine-wasm adapter registers `lazyFonts` (the default worker: `scriptFonts`) and URL `FontSource`s with `info` from `initialize` at start. After a compile with `missingFonts` it fetches them through Cache Storage (`fontCache`, default `"typstream-fonts"`; base fonts too; a cached copy that doesn't match its info is fetched again) and returns `pending`, which resolves once they're loaded. The server keeps the document's last `pending` with that compile's params; when it resolves, it queues a recompile like a request (so it never overlaps one), skipped if the document changed, closed or compiled again meanwhile, and publishes diagnostics and artifact for the same revision with no response, which the client already shows. A font that fails to download is logged (`$/log` warn) and asked for again after 30 s. Exports wait up to 3 s for `pending` and compile again. Nothing waits on the network inside a compile, and nothing runs on the main thread.
> - **Scripts** (#1 Q2). Base set: Latin, plus Greek, Cyrillic and Hebrew, which Libertinus Serif covers. Lazily, regular and bold: Noto Naskh Arabic (63 KB brotli per weight), Noto Serif Bengali (69–78 KB), Noto Serif Devanagari (67–70 KB). A Bengali worksheet with headings fetches ~150 KB; all six files would be 411 KB, every session, if loaded eagerly. CJK is left to apps (`FontSource.info`): Noto Serif SC Regular alone is 11.6 MB. Unicode-range slices, as Google Fonts serves CJK, would work with this mechanism if CJK becomes a target.
> - **Targets.** Paged: the recompile's SVG is byte-identical to native `typst compile --font-path` with the same files; in Chromium, Firefox and WebKit the first render has tofu and the recompile replaces it. HTML: the browser draws the text with its own fonts, so engine fonts matter only in `html.frame`s, and HTML compiles report no missing fonts for plain text. Typst's HTML export doesn't mark right-to-left paragraphs (not even under `text(lang: "ar")`), so the renderer's theme sets `unicode-bidi: plaintext` on paragraphs, list items, headings and cells: each takes its direction from its first strong letter, as `dir="auto"` would.
> - **Server.** `@typstream/node` loads the script fonts up front from engine-wasm's `dist/fonts/` (`scriptFonts: false` leaves them out).
- **Packages**: allowlist (`@preview/cetz`, `@preview/fletcher`?, chemistry, …) pinned to versions; pre-bundled tarballs or fetched from our own mirror, untarred into the VFS **before** compiling (the World's `file()` is synchronous, so imports are resolved by a pre-pass that scans `#import "@preview/…"` and fetches asynchronously). No direct calls to third-party registries from users' browsers unless configured; tarballs persisted in Cache Storage. `@typstream/edu` and `html-compat` are mounted in the VFS as `@typstream/*` local packages. *(html-compat as built is a single file, `/@typstream/html-compat.typ`, imported by path.)*

> **As built (#25):** findings and measurements in the [#25 comment](https://github.com/ikramhasan/typstream/issues/25#issuecomment-6411908163).
> - **Allowlist.** `initialize.packages` (engine-wide) plus `document/open`'s `packages` (per document; `mountTypstream` fills it from plugins' `engine.packages`). A server's own list is `ServerOptions.packages.allowlist`, and `trustClient: false` ignores the client's lists: `@typstream/node` sets it, since a WebSocket client could otherwise make the server fetch any URL. An empty allowlist means no network. Specs without a `url` resolve against `ServerOptions.packages.registry` (packages.typst.org's layout), and there is none by default.
> - **Pre-pass** (`packages/engine/src/server/packages.ts`). Before each compile and export, the server scans the preamble and the document for complete specs in string literals (`"@preview/cetz:0.5.3"`; a half-typed one doesn't match). It requests each one, and mounted packages' `.typ` files are scanned the same way, so dependencies follow. A compile waits for loads within the fix budget (1 s streaming, 3 s final). Loads that finish later trigger a server-initiated recompile of the same revision, if no newer one came.
> - **Mounting.** engine-wasm takes package files at `@ns/name:x.y.z/path` keys, `FileId`s rooted at the package, so Typst reads `typst.toml` and the entry point as it does natively. A package with nothing mounted reports Typst's own "package not found (searched for …)", which the server rewrites to say whether it is not allowed (hint: the allowed ones), still loading, or failed to load. The same keys in a document's or plugin's `files` mount a **local package** (`@typstream/edu:0.1.0`) with no allowlist or download. Project paths (`/@typstream/html-compat.typ`) are unchanged.
> - **Versions.** A requested version that isn't allowed gets the allowed one with the same major.minor (newest patch), else the newest allowed version of that name. It is mounted under the requested spec with `typst.toml`'s version rewritten, and a warning on the import says which version was used. Exact pins inside packages still get exactly what they pin, which is why cetz 0.3.4 is vendored for fletcher.
> - **Format and cache.**
>   - Tarballs are the unmodified Universe `.tar.gz` files, gunzipped with `DecompressionStream` and read by a small ustar reader (`tar.ts`).
>   - Integrity (SRI, any of sha256/384/512) is checked against the bytes as fetched or the tar inside them. `@typstream/universe` lists the tar's hash, because a server that sends `Content-Encoding: gzip` (Vite's dev server does) makes the browser hand over the tar.
>   - Loaded packages are shared by every document of the worker, and tarballs are kept in Cache Storage (`typstream-packages`), so allowed packages work offline after the first load (tested in all three browsers). A failed download is retried after 10 s.
>   - Each document's engine gets its own copy of the files it mounts (fonts are shared since #11).
> - **Day one: `@typstream/universe`.** CeTZ 0.5.3, fletcher 0.5.8, cetz-plot 0.1.4, physica 0.9.8, unify 0.8.1, chemformula 0.1.3 and alchemist 0.2.0, plus cetz 0.5.2 and 0.3.4 and oxifmt 1.0.0 and 0.2.1 as dependencies: 11 tarballs, ~740 KB. Bundlers emit them as assets, and `typstream` adds the plugin by default.
> - **HTML target.** CeTZ 0.5 canvases (cetz, cetz-plot, alchemist) become `.ts-frame` SVG with html-compat and are in its matrix. fletcher stays empty in HTML: its cetz 0.3.4 canvas calls `layout` inside `context`, within the package (an html-compat gap). Chemistry and math packages are plain MathML.
> - **wasm plugins.** CeTZ needs wasmi (its `cetz-core` plugin), so plugins stay in the engine (§6.4 point 5).

### 6.5 Render targets

**`html` (default for chat/streaming)**
- Compile with HTML target; inject `html-compat` prelude (maps `grid/align/rect/place/columns/v/line/pagebreak` to `html.elem` or `html.frame`).
- Sanitize the HTML (allowlist tags/attrs; `href` protocol allowlist; SVG from `html.frame` sanitized), parse to hast, split into **top-level blocks** keyed by content hash → React reconciles only changed blocks (streamdown's memoized `Block` idea applied to *output*).
- Word fade-in via the animate timeline (diff text of the last block); caret appended to last text node.
- Styling via our CSS (themeable with CSS variables, dark mode free), MathML styled with a math font.
- Caveat: HTML export is experimental upstream → pin version, keep compat prelude under test (§11.4), and keep `paged` as the fidelity reference.

> **As built: html-compat ([#15](https://github.com/ikramhasan/typstream/issues/15), `packages/html-compat`).** Coverage matrix, Typst 0.15.1, with the full list and tests in `packages/html-compat/__tests__/support/matrix.ts`:
>
> | Native HTML (kept as is) | Dropped natively → mapped to HTML + CSS | Dropped natively → drawn (`html.frame`) | Lossy, kept |
> |---|---|---|---|
> | headings (numbered), par, lists, terms, enum (`start`, explicit numbers, `reversed`), quote, raw (highlighted), link, ref, figure (table, image, raw, custom kinds, caption position), outline, footnote (endnotes), bibliography + cite, title, strong/emph/underline/overline/strike/highlight/sub/super/smallcaps, image, table (thead/tfoot, spans), math (MathML), `measure` | grid (all cell features), align, block/box styling, rect/square/circle/ellipse, stack, columns + colbreak, place (absolute; `float` in flow), pad, v, h, pagebreak, move/rotate/scale/skew, hide, repeat, `layout` (fixed size), line (horizontal), enum numbering patterns, block equation numbers, math `overline` (→ accent) | curve, polygon, angled lines, boxes/blocks holding them or made only of `place`d pieces (CeTZ canvases: an empty `<div>` natively, *without* a warning), equations with `cancel` | **page set rules** (header, footer, page numbers: "page set rule was ignored"), text size/weight/fill/font, fractional spacing, vertical alignment in align/box/block, table strokes other than default/none and table lines, outline page numbers, `enum(full: true)` patterns, matrix `augment` lines |
>
> - Every rule returns the element untouched unless `target()` is `"html"`. Inside `html.frame` the target is `"paged"`, so drawings lay out normally. Weak `h`/`v` are left alone: Typst inserts some itself (an inline quote has one), and wrapping weak spacing in `context` changes paged layout. `paged.test.ts` checks every corpus document and matrix entry is byte-identical with and without the prelude.
> - Rules that must know where they are (no `h` spans inside MathML; no `<div>` inside a box's `<span>`, which makes browsers close the paragraph) read a marker that the enclosing rule sets on `text.costs`, a property only paged line breaking uses.
> - Tests run through engine-wasm and compare against native `typst` paged text (PDF → pdf.js) as multisets of letters and digits: all 67 matrix entries lose nothing (32 of them lose text or warn without the prelude); the 35 edu corpus documents lose only page furniture (and pdf.js artifacts of stretched braces and Devanagari conjuncts), listed per document.
> - Cost: a one-line edit recompile of the whole edu corpus went from 78 to 103 ms of HTML compile in total (35 documents, warm; median of 7 on a loaded machine), about +0.7 ms per document. Paged was unchanged within noise.
> - **MathML in browsers** (Chromium 156, Firefox 157, WebKit 27.2; screenshots against Typst's paged output). Without a math font all three are poor: no stretchy delimiters, matrices without brackets, wrong italics. With New Computer Modern Math as a web font, **Firefox is close to paged output**. Remaining defects, for the renderer (#17): Chromium adds space inside every stretchy `(`…`)` (`f ( x )`; `stretchy="false"` fixes it, so set it on parentheses around flat content); primes in `msup` render too high in Chromium and WebKit (`f′`); WebKit misplaces `tilde`/`dot` accents and overlaps `f(`. Not fixable in CSS: `cancel` (no `menclose` in MathML Core; the prelude draws the equation instead) and Typst's dropped `augment` lines.
> - The prelude ships as a `TypstreamPlugin` (`htmlCompat`): files, preamble, and the tags/attributes the sanitizer (#16) must allow (`div`/`span` with `class`, `style`, `role`, `aria-label`; inline `svg`). The CSS is scoped to `.typstream` with zero specificity. `KNOWN_HTML_WARNINGS` lists the page-rule warning the worker (#10) may drop in HTML mode, like the "under active development" one.

> **As built: HTML renderer ([#16](https://github.com/ikramhasan/typstream/issues/16), `packages/dom/src/html/`).** `createHtmlRenderer(root, options)` → `update(html, { animate, caret })`.
> - **Splitting.** The artifact is split into top-level blocks as a string (`split.ts`). typst-html's serializer (encode.rs) is regular, so a depth scan is exact: attribute values are always double-quoted, `<` in text is always escaped, there's a fixed void list, raw text appears only in `script`/`style` (never containing its closing tag) and `textarea`/`title`, and `/>` appears only on `mspace`/`mprescripts` and in frame SVG. Markup that doesn't scan becomes one block. A lone `div`/`section`/`article`/`main` around everything (a template) is descended into, unless the anchor before it is the only one: a template's wrapper holds the anchors of its later blocks, while a document that so far is one `div` (a title in `#align`) has none inside, and descending into it rebuilt the page twice (#19). `<head>` is ignored, since a document can write its own with `html.html`. Typst's MathML rules, which it writes into `<head>` only when there's math, are vendored into the renderer's CSS, scoped (a test compares them with the engine's).
> - **Diffing.** A block's HTML string is its identity. Each split resumes from the previous one: its leading blocks are verified with `startsWith` and kept, and only the rest is scanned. The renderer keeps unchanged blocks at both ends, matches the middle by key, and parses, sanitizes and inserts only new blocks. A block is the node list its string parses to; there are no wrapper elements, so CSS sibling selectors and margins are unaffected. Kept strings are copies (streamdown's `copyString`), so they don't pin old artifacts. An edit above a block changes only its `data-typstream-src`.
> - **Checked in Chromium, Firefox and WebKit** (`packages/dom/__tests__/browser/`):
>   - Rendering block by block equals a sanitized parse of the whole document, for every edu corpus document.
>   - While corpus documents stream through the real worker, no block whose HTML is unchanged is ever re-created, and the final DOM equals a fresh render.
>   - 20 pages (309 blocks), streamed at 600 tokens/s: p50 1.0–1.2 ms, p90 3–5 ms, max 8–23 ms per update (the max is updates that add many blocks at once). Budget: p50 ≤ 4 ms.
> - **Sanitizer** (`sanitize.ts`, §9): an allowlist walk over an inert tree, not DOMPurify. It allows the HTML elements Typst and html-compat write, MathML Core (no `annotation-xml`, no `href`), and frame SVG (no `foreignObject`, scripting or animation elements). Script-like elements and forms are removed with their content; other unknown elements are unwrapped. No `on*`, `data-*` or `name` attributes. Links may be `http(s)`, `mailto` or `#fragment`; external ones get `rel="noopener noreferrer"` and `target="_blank"` (configurable). Images may be `data:image/*` or `blob:`. CSS that loads anything (`url(`, `image-set(`, …) or uses `position: fixed` is dropped, after the CSSOM resolves escapes. Elements with an `is` value are rebuilt without it, since a page's customized built-ins would upgrade them. Ids and the references to them (`#` links, `url(#…)`, `headers`, `aria-*` id lists) get a per-renderer prefix. Plugins' `sanitize` facets add tags and attributes, but never handlers, scripts or URL attributes. It also handles SVG, so the paged renderer can use it.
> - **Animation** (`animate.ts`): streamdown's timeline (backlog budget 320 ms, 4 ms minimum step). Only new text in created blocks is wrapped; a created block is paired with the block it replaced, and their common visible text isn't animated. Words of a re-created block that were still fading in continue (negative delay) instead of popping in. Math, SVG, images and rules fade in whole; `pre` doesn't animate; list markers fade in through `::marker` color; `prefers-reduced-motion` turns it off. Delays are set through the CSSOM.
> - **Language:** the root takes `lang` from Typst's `<html lang>` and `dir` from the language, by Typst's own table (`Lang::dir`); Typst's HTML has no `dir` at all (#19).
- **Caret:** an `aria-hidden` span in the deepest last element holding text: the last cell of a table, after math or a drawing, never in the footnotes.
> - **Theme:** root class `typstream`; colors are CSS variables written with `light-dark()`. What the document filled (inline `background`: boxes, table cells, code blocks) keeps the light colors inside, as on paper (#19), except `place`d pieces that point outward from their anchoring edge (`bottom` with a positive `dy`, `right` with a positive `dx`, …), which html-compat marks `ts-place-out`: a shape's dimension labels sit outside its fill, on the page, and keep the page's theme (#64). `theme: "auto"` follows the page's `color-scheme`, while `light`/`dark` force one. Styles are injected once per document or shadow root as constructable stylesheets, plus any `stylesheets` given (html-compat's CSS). `registerMathFont(url)` registers New Computer Modern Math with the FontFace API.
> - **Size:** 8.8 KB gz including its CSS (`pnpm size`, budget 9 KB).

**`paged` (print preview, worksheets, exams)**

> **Priority (#1):** the product's primary surface is a document panel, so this target gets the deepest testing and polish first; the HTML target stays covered (decision log).
- Compile with `compile_svg_changed()`. The worker sends only pages whose frame hash changed (usually the last one or two). The renderer keeps one element per page, swaps changed pages, and updates visible pages first; offscreen pages are deferred to idle time; **page-level diff**: keep DOM for pages whose hash didn't change; lazy-render offscreen pages (IntersectionObserver, like streamdown's `useDeferredRender`).
- Layout modes: `fixed` (A4/Letter as authored) and `fit-width` (`#set page(width: <container>pt, height: auto)` via `sys.inputs`, recompiled on debounced resize) — a "continuous paper" view good for side panels.
- Text layer for selection/copy & search; links clickable (sanitized).
- New content highlight: a short fade on newly appeared glyph groups (opt-in; diff by element ids).

> **As built ([#14](https://github.com/ikramhasan/typstream/issues/14), `packages/dom/src/paged/`).** `mountPaged(container, doc, options)` follows an `EngineDocument` (switching it to `paged`); `createPagedView(container)` is the renderer alone, `view.render(artifact)` with a complete or changed-pages artifact. Findings with numbers: the [#14 comment](https://github.com/ikramhasan/typstream/issues/14#issuecomment-6407171030); `VITE_RESEARCH=1 pnpm test:browser research` in `packages/dom` reruns them.
> - **Pages.** One `.typstream-page` per page, sized from the page (`aspect-ratio`); its SVG host has `content-visibility: auto`, its text layer doesn't (#63: skipped content leaves the accessibility tree). A page is redrawn only when its hash differs from the one drawn and its SVG does too: frame hashes include source spans, so unchanged pages come back under new hashes (a quarter of all redraws over the edu corpus, #19). The SVG goes into a shadow root on a child of the page: glyph ids stay scoped to the page (see the decision log), and the app's CSS can't reach the SVG. The SVG is `aria-hidden`; the text layer is what assistive technology reads.
> - **Visible first.** An IntersectionObserver (`rootMargin` 50%) tracks visible pages. Changed visible pages are drawn in the next `requestAnimationFrame`; the rest, then every text layer (visible pages first), in `requestIdleCallback` (timeout 500 ms; WebKit: a timer with an 8 ms budget). A page that scrolls into view jumps the queue. A new page counts as visible when the page before it is known to be, so streamed pages appear without a blank frame. `flush()` draws everything (printing, tests).
> - **Measured** (19 dense A4 pages streamed at 4,000 chars/s; Playwright's Chromium, Firefox, WebKit on a 6-core machine at load ~10 from other work): one page redrawn per update (median); visible-page draw p50 15–20 ms in Chromium and Firefox, 19–27 ms in WebKit (max 40–171 ms); in Chromium 58 of 60 long tasks were visible-page frames (the draw plus the style, layout and paint after it), none were idle work. That misses the issue's 10 ms target and Phase 0's 2 long tasks (an idle M1 Pro, `innerHTML` time only); the floor is the per-glyph DOM (decision log).
> - **Text layer.** engine-wasm walks each exported page's frame (`src/text.rs`, as typst-svg's `render_frame`) and returns its text items: `{ text, x, y, size, width, matrix? }` in points, baseline origin, rounded to 0.01 pt. The renderer lays out spans in `cqw` of the page (it follows the page's size without script), stretches each to its run's width (`scaleX` from a canvas `measureText`, cached), adds a space across gaps on a line (a heading's number and text, table cells) and a `<br>` where the next run starts back to the left on another baseline (sub- and superscripts continue the line). Styles go through the CSSOM and one constructed stylesheet, so strict CSPs work.
> - **Structure, language, direction** (#63). Pages carry `structure` (`TextNode` trees over run indices: `heading` with `level`, `list`/`listitem`, `table`/`row`/`cell`/`columnheader`), `lang` and `dir`; runs carry `lang`/`dir` where they differ from the page. Runs are in reading order (engine-wasm joins the pieces Typst cuts a shaped run into, see the decision log). The layer has the page's `lang`/`dir` and wraps runs in unstyled inline `<span role>`s (`aria-level` on headings), which change neither copying nor positions. Spaces and line breaks follow the direction: in RTL text the next run is to the left and a new line starts back at the right; runs with other runs between them on screen (an embedding in the other direction) get no space. A page whose SVG is unchanged but whose layer differs is redrawn.
> - **Links.** `sanitizeLinks`: `http(s)` and `mailto` keep their href and open in `linkTarget` (default `_blank`, `rel="noopener noreferrer"`); every other href is removed, after stripping whitespace and control characters as URL parsers do (`java\tscript:`). `<image>`s keep only `data:` URLs (typst-svg never writes others). Links within the document (`Destination::Location`) get no href in a standalone page SVG and stay inert; making them work needs per-page anchors from the engine.
> - **Layouts.** `fixed`: authored size (pt × 4/3 px), `max-width: 100%`. `fit-width`: the document is opened with `FIT_WIDTH_PREAMBLE`, a `set page(…) if` reading `typstream-page-width` / `typstream-page-height` from `sys.inputs`; `mountPaged` sets them from the container's width (px × 0.75, to 0.5 pt) and again 150 ms after resizing stops; old pages scale meanwhile. Limits in the decision log.
> - Size: 3.7 KB gzipped (budget 4 KB, `pnpm size`; 3.2 KB before #63). Browser tests run in CI's browsers job after the engine's.

**Exports** (both): `exportPdf()`, `exportHtml()`, `exportSource()` — from the *same* final compiled source, so what the teacher previewed is what they print.

> **As built: exports ([#18](https://github.com/ikramhasan/typstream/issues/18)).**
> - **Engine client.** `EngineDocument.exportPdf(options?)` → `Uint8Array`, `exportHtml(options?)` → Typst's complete HTML document (no source anchors, unsanitized), and `exportSource()` → the healed source both compile (lint fixes, plus tail repair until `finish()`; without preamble or files). Exports compile that source with the document's preamble and files in the preview's worker (`export/pdf`, `export/html`, final mode), so a finished document exports warm.
> - **Scheduling.** Exports wait in the engine's one-at-a-time queue but go before waiting compiles, since someone is waiting for the file. The worker's copy is brought up to date first, as before a compile, and the preview then compiles that source too. They run under the final watchdog budget (10 s); a timeout replaces the worker like a compile's, but isn't a strike against live compiling.
> - **Inputs.** `options.inputs` defaults to the document's `sys.inputs`. Pass the inputs without fit-width's page size (`mountPaged`'s `options.inputs`) to print at the document's own size.
> - **Errors.** Failures reject with `ExportError`: `reason` is `diagnostics` (with the diagnostics in input coordinates), `unsupported` (see `capabilities.exports` in `engine.ready`), `timeout`, `crash` or `engine` (disposed, or the engine can't run).
> - **Standalone HTML** (`@typstream/dom`, `standaloneHtml(html, { stylesheets, theme, mathFont, title })`): a string transform, so it runs anywhere. It adds a CSP `<meta>` first in `<head>` (`default-src 'none'`, inline styles, `data:` images and fonts, `base-uri`/`form-action 'none'`) and strips `<meta http-equiv="refresh">`. Then the theme CSS, the given stylesheets (html-compat's) and an embedded or linked New Computer Modern Math, with `typstream` and the theme on `<body>`. The document's own `<title>` wins. It doesn't sanitize: Typst writes `html.elem("script")` and `on*` attributes verbatim, and the CSP stops them in all three browsers (tested), while re-serializing sanitized nodes for a file would invite mXSS.
> - **Tested.** The exported PDF has the paged preview's page count (real worker, three browsers); the standalone file opens from a blob URL with its styles and math font, and a hostile document's script, `onerror`, `javascript:` link and refresh do nothing. Size: 1.3 KB gz (budget 2 KB).
> - **`mountTypstream`** (what the bindings wrap) has `exportPdf()`, `exportHtml(options?)` (the standalone file, with the mount's `stylesheets` and `theme`) and `exportSource()`. They export with the template's inputs and `inputs` but not fit-width's page size: the document's own inputs include it, so `document.exportPdf()` from a fit-width preview would print at the element's width (tested: 225 pt instead of A4). An export opens a lazy document that hasn't opened yet. They add 0.9 KB to `@typstream/react`'s bundle (14.9 of 15 KB).
> - **React (#17)**: `useTypstream()` still has to forward the mount's exports through `TypstreamHandle`. Saving the file (a `Blob` and an object URL) is up to the app.

---

## 7. Public API & configuration (React)

```tsx
<Typstream
  source={text}                       // full text so far (streamdown-style), or:
  stream={asyncIterable}              // alternative: we consume chunks
  isStreaming={status === "streaming"}
  target="html"                       // "html" | "paged"
  layout="fit-width"                  // paged only: "fixed" | "fit-width"
  preamble={eduPreamble}              // Typst injected before user source (theme, edu functions)
  template="worksheet"                // named template from registry (sets page, fonts, header)
  inputs={{ showAnswers: "false" }}   // sys.inputs — e.g. answer-key toggle without regenerating
  heal={{ lint: { "currency-dollar": "warn" } }}
  engine={{ adapter: typstTsAdapter({ wasmUrl }), fonts, packages: allowlist, timeoutMs: 3000 }}
  schedule={{ minInterval: 33, maxInterval: 500 }}
  fallback={{ staleAfterMs: 1500, isolateBlocks: true }}
  animated caret="block"
  islands={{ "mcq": McqIsland }}      // render islands, §8.4
  theme="auto"                        // light | dark | auto — mapped to Typst colors via inputs
  onDiagnostics={(d) => …}
  onStatusChange={(s) => …}           // "idle" | "compiling" | "stale" | "error" | "done"
  onRendered={(info) => …}            // timings, pages, repair stats (telemetry hook)
  className=…
/>

const { status, diagnostics, exportPdf, healedSource, openFrames } = useTypstream(ref);
```

Configuration layering: library defaults → `TypstreamProvider` (app-wide: engine, fonts, packages, templates, theme) → per-instance props. Everything serializable (except adapters/components) so it can be stored per-organization or per-teacher in the product.

> **As built (#17):** `packages/react` over `mountTypstream` in `packages/dom/src/mount.ts`; props and behaviour in `packages/react/README.md`. Differences from the sketch above:
> - `useTypstream()` takes no ref; it returns one: `const t = useTypstream(); <Typstream ref={t.ref} />`. It returns `status`, `diagnostics`, `healedSource`, `openFrames`, the whole `state`, and the `document` (exports go through it once #18 lands; `exportPdf` isn't there yet).
> - `engine` takes an `Engine` (from `createEngine`); adapter, fonts and packages options wait for #11 and #25. Default: one shared worker per page.
> - Not yet: `fallback` (the engine keeps the last good render; block isolation is §5.6's later step), `islands` (#28).
> - Added: `plugins` and `stylesheets` (plugins' preambles, files, heal handlers, templates and sanitizer allowances), `files`, `mathFont`, `lazy` (default on: only documents near the viewport or streaming open and compile), `pageHeight`, `linkTarget`, `textLayer`.
> - `template` names a template from the plugins' `templates`; there is no registry beyond plugins.
> - Provider merging: lists (`plugins`, `stylesheets`) add up (plugins once per key), records (`inputs`, `files`) merge, other props override.
> - The `typstream` package's `<Typstream>` adds html-compat (opt out with `htmlCompat={false}`) and the engine's math font.

---

## 8. Extensibility

### 8.0 One plugin contract for the whole toolkit
Like Plate, a plugin is a single object with **optional facets**; each package reads only the facets it understands, so a plugin written today keeps working when the editor arrives, and the editor can add facets without breaking existing plugins.

```ts
// @typstream/core
interface TypstreamPlugin {
  key: string;                                  // unique, namespaced: "edu", "acme/chemistry"
  version?: string;
  dependencies?: string[];                      // other plugin keys
  // language (heal)
  heal?: { handlers?: HealHandler[]; lint?: LintRule[] };
  // runtime (engine, worker side — referenced by module URL, see 8.2)
  engine?: { fixerModules?: string[]; files?: Record<string, string | Uint8Array>;
             packages?: PackageSpec[]; fonts?: FontSource[]; preamble?: string };
  // content
  templates?: TemplateSpec[];
  prompt?: { catalogue?: FunctionDoc[]; rules?: string[]; examples?: PromptExample[] };
  // rendering
  islands?: Record<string, IslandSpec>;         // framework-neutral spec; bindings map to components
  sanitize?: { allowTags?: string[]; allowAttrs?: Record<string, string[]> };
  // editor (future — reserved, typed as unknown-extensible now)
  editor?: { nodes?: EditorNodeSpec[]; commands?: CommandSpec[]; toolbar?: ToolbarSpec[];
             shortcuts?: ShortcutSpec[]; slashItems?: SlashItemSpec[] };
}
```
> **As built (#7):** `packages/core/src/plugin.ts`. The `heal` facet is `{ handlers?: HealHandler[]; lint?: Record<ruleId, "fix" | "warn" | "off" | boolean> }`. Custom lint rules are `settled`-phase `HealHandler`s, so there is no separate `LintRule` type. `HealHandler` itself moved from heal into core, and heal re-exports it. `FontSource`, `PackageSpec`, `IslandSpec` and the `editor` facet are `@beta` and typed loosely until their issues (#11, #25, #28, #36) settle them. `definePlugin()` type-checks a plugin literal. The `engine` facet must stay structured-clonable (it is posted to the worker), and a type test enforces that.

> **As built (#27):** `resolvePlugins(plugins)` in core orders them: each key once (last definition wins, at its first place), dependencies first, otherwise as given; missing dependencies and cycles throw. Where each facet is read: `heal.*` by the engine client's healer; `engine.files`, `packages`, `preamble` and `fixerModules` per document (`EngineDocument` options → `document/open`); `engine.fonts`, `packages` and `fixerModules` engine-wide (`createEngine({ plugins })` → `initialize`; fonts only there); `templates` by `mountTypstream`, which renders with the engine's resolved list (`EngineDocument.plugins`, so resolution runs once, in the engine client); `sanitize` and the new `stylesheets` facet by the HTML renderer and `standaloneHtml`; `prompt` by the app (#24); `islands` and `editor` by nothing yet. Writing one: `apps/website/content/docs/guides/writing-a-plugin.mdx`. Contract tests: `packages/core/__tests__/plugin.test.ts` (resolution), `packages/engine/__tests__/plugins.test.ts` (every facet through the engine, unknown facets), `packages/dom/__tests__/browser/mount.test.ts` (dom facets; edu, html-compat and universe together).

`@typstream/edu` is itself just a plugin (Typst package files + templates + prompt catalogue + islands). Customers/third parties ship their own the same way (a school's branded templates, a chemistry pack, a music-notation pack).

### 8.1 Heal handlers (TS)
Like `RemendHandler`, but **scanner-aware** (no regex-on-raw-text guessing):
```ts
interface HealHandler {
  name: string;
  priority?: number;                       // built-ins 0–100
  phase: "lint" | "tail-trim" | "tail-close";
  run(ctx: { text: string; scan: ScanState; mode(i: number): Mode; frames: Frame[] }): Patch[];
}
```
Use cases: custom shorthand the LLM emits, product-specific syntax (`[[blank]]` → `#blank()`), stricter policies.

### 8.2 Diagnostic fixers (TS, worker)
```ts
interface DiagnosticFixer { name: string; match: RegExp | ((d: Diagnostic) => boolean);
  fix(d, source, ctx): Patch[] | null | Promise<Patch[] | null>; phases: ("streaming" | "final")[] }
```
Shipped in the worker bundle or registered by URL (workers can't receive functions) — fixers are loaded as ES modules inside the worker via `engine.fixerModules: string[]`.

> **As built (#20):** `DiagnosticFixer` and `FixContext` are in `@typstream/core` (`plugin.ts`): `{ name, priority?, modes?, match?, fix(d, ctx) }`, where `modes` is the sketch's `phases`, `match` (a message `RegExp` or a predicate) defaults to every error, and `priority` defaults to 50: after the built-in `pending-ref` (10), before the catch-all `tail-cut` (100). `fix` returns `TextEdit[]` against `ctx.text` (the compiled document text, without preamble), sync or async; `ctx` also has `settled`, `mode`, `round` and every error of the compile. Plugins' `engine.fixerModules` reach the worker as `initialize`'s `options.fixerModules` (`EngineOptions.initialize`, or `EngineOptions.plugins`), or per document as `document/open`'s `fixerModules` (a document's plugins, #27). Each module's default export is a fixer or an array of them; one that fails to load or exports something else fails `initialize` with `invalid-params`, and a fixer that throws is skipped. Custom workers set the list with `serve(adapter, scope, { fixers })` (`inProcess` takes the same option); `DEFAULT_FIXERS`, `pendingRef` and `tailCut` are exported from `@typstream/engine/server`.

### 8.3 Typst-level extension: preamble, templates, `@typstream/edu`
- **`@typstream/edu`** Typst package — the vocabulary we teach the LLM:
  `#question(points: 2)[…]`, `#mcq(options: (...), answer: 1)`, `#blank(width: 3cm, answer: […])`, `#answer[…]` (hidden unless `sys.inputs.showAnswers`), `#rubric(...)`, `#learning-objectives[...]`, `#worksheet-header(name: true, date: true, class: true)`, `#callout(kind: "tip"|"warning"|"definition"|"example")`, `#exercise-counter`, `#two-column[…]`, `#chem[...]`, `#graph-paper(...)`, `#number-line(...)`.
  Every function has an HTML-target branch (`context target()`), so both targets look right.
- **Templates**: named bundles (page setup, fonts, header/footer, numbering) — `worksheet`, `quiz`, `exam`, `lesson-plan`, `handout`, `rubric`. Registry is extensible by the app (org branding: school logo, colors).
- **Prompt kit**: generated *from* the package source (doc comments → function catalogue), so the system prompt never drifts from the real API. Includes Typst "dialect rules" (no Markdown syntax, escape `$`/`@`/`#`, allowed packages, no unbounded loops) and few-shot examples. Versioned with the package.
- **Answer keys without regeneration**: `inputs={{ showAnswers: "true" }}` → recompile, not re-prompt.

> **As built (#23, `packages/edu`).** The vocabulary and the reasons for it are in the [proposal on #23](https://github.com/ikramhasan/typstream/issues/23#issuecomment-6411668598); assumptions A1–A9 there are what review should settle.
> - **Functions:** templates `worksheet`, `quiz`, `exam`, `lesson-plan`, `handout`; `question(points:)`, `mcq(..options, answer:)` (1-based), `true-false`, `matching(..pairs)` (correct pairs in; edu shuffles by a text hash, rotated to leave as few pairs beside their match as possible, and derives the key); `blank`, `answer-lines`, `answer-space`, `answer`, `answer-key`; `callout(kind:)`, `instructions`, `learning-objectives`, `rubric`, `student-info`; `number-line`, `graph-paper`, `coordinate-plane`; `ce`. The sketch's `#two-column` is native `columns`/`grid` (html-compat maps both), `#exercise-counter` is `question`'s own counter, `#worksheet-header` is `student-info`, `#chem` is `ce`.
> - **Templates** are show rules the document applies, so `exportSource()` keeps the template call. `eduTemplates` (`TemplateSpec`s whose preamble is `#show: <name>`) are for apps that generate a body only; the two must not be combined. The template's `lang:` sets the language for the title block too (a `#set text(lang:)` after the template line can't reach it).
> - **Prompt kit:** `scripts/embed.mjs` builds the `FunctionDoc` catalogue from the `///` comments above each name `lib.typ` imports (description, parameters, an `example` block) and embeds `examples/*.typ` as few-shot examples; `eduPromptRules` are the starting rules for #24.
> - **Mounting:** a local package, `@typstream/edu:0.1.0` (`EDU_ROOT`): its files and `typst.toml` are plugin `engine.files` at `@typstream/edu:0.1.0/<file>` keys (#25), so the server's pre-pass finds nothing to fetch. With native `typst` it works from a `--package-path` directory (`typstream/edu/0.1.0/`). Edu doesn't import the vendored `@preview` packages (#25's chemformula and alchemist are there for documents); whether `ce()` should give way to chemformula is question 7 on #23.
> - **HTML:** each function writes semantic elements (`div.edu-question`, `ol.edu-mcq`, `aside.edu-callout`, `table.edu-rubric`, `header.edu-header`) that the default sanitizer already allows, plus `eduCss` (scoped, zero specificity, theme variables, logical properties). Templates write no page rules in HTML, so they add no warning.
> - **Tests** (engine-wasm and native `typst`, CI's engine job): every catalogue example, template and prompt example in both targets × answers hidden/shown × with/without html-compat has no errors or warnings; empty and half-streamed calls render; no answer text in a student's PDF or HTML; matching keys are right; the three languages' words and `dir`; `ce`'s MathML; native page counts match. The compile oracle streams the prompt examples.

> **As built (#24): the prompt kit, measured.** `buildSystemPrompt(plugins, { examples, typstRules })` in `@typstream/edu` (`@beta`) joins `typstPromptRules` (Typst habits, whatever the vocabulary), each plugin's rules and catalogue, then the example documents in `<example>` tags; deterministic, so it caches (~8.4K tokens for edu + universe). The app passes it as the system prompt; the `prompt` facet is read by nothing else (#27). `tools/llm-corpus` records real streams (`record`), compiles them as final mode does with edu and the vendored packages mounted and nothing fetched (`measure`), and copies them into `corpus/llm` (`promote`); each run keeps its exact prompt, so labels stay comparable. Findings ([#24](https://github.com/ikramhasan/typstream/issues/24)):
> - The vocabulary is taken up almost completely; errors are generic Typst. Classes, most common first: a script with no base (`m/s$^2$`, `H$_2$O`), a package used without its import (models assume the listed ones are preloaded, like edu), a multi-letter name in math (`leq`, `dy/dx`, `M(Cl)`), bare math as an argument (`#mcq($x = 2$, …)`), `*/` and `/ ` in markup (rubric cells: `[*/16*]`, `[/ 10]`), CeTZ's `polygon`/`ellipse` called with Typst's signatures, bold inside a word (`walk*ed*`).
> - Each rule in `typstPromptRules` and `eduPromptRules` answers one of these; `prompt.test.ts` checks that the rules only call edu functions with parameters they have. Rules change by re-measuring, not by guessing.
> - Rates per prompt version and model are in `tools/llm-corpus/README.md`. With 29 requests a document is 3.4 points, so versions were compared on repeated runs (Haiku, which costs 1/20 of Sonnet, four times).

### 8.4 Render islands (interactive components inside Typst output)
Typst emits a marker; the renderer swaps in a React component:
- **html target**: `html.elem("typstream-island", attrs: (name: "mcq", props: json.encode(...)))` → React renders `islands.mcq` with props (e.g., interactive multiple choice in a student view, copy buttons, embedded video). Fallback content is the Typst rendering itself (so PDF/print still works).
- **paged target**: `#metadata((island: "mcq", ...)) <typstream-island>` + an engine `query` method (introspector positions of the labelled elements) → absolutely-positioned overlay over the SVG page.
- `BlockIncompleteContext` equivalent: islands get `isIncomplete` while their block is still streaming.

### 8.5 Engine adapters & renderer adapters
- `EngineAdapter` (§6.1): engine-wasm (default, our Typst build), server; typst.ts / typst-wasm possible via the conformance suite.
- `RendererAdapter`: `html-react` (default), `svg-pages`, `canvas-pages` (very long docs), `pdfjs` (server-produced PDF). Framework bindings beyond React (`@typstream/vue`, vanilla `mountTypstream(el, opts)`) only need the engine + a renderer.

### 8.6 Events & telemetry hooks
`onRendered({ rev, compileMs, healMs, patches, fixersApplied, fallbackLevel, pages })`, `onFallback`, `onWatchdog`. No telemetry is sent by the library itself; the app wires it. These events feed the corpus (§11.2) — every production fallback is a candidate test case (with consent/anonymization).

> **As built (#30):** shapes in `packages/core/src/telemetry.ts`, documented field by field there and in `packages/engine/README.md` ("Events").
> - **Per document, per compile:** `diagnostics`, then `compiled` (`status`, `timings`, `compileMs`, `healMs`, `patches` and `patchReasons`, `fixersApplied`, `fallbackLevel`, `errors`, `warnings`, `pages`, `sourceLength`), then `fallback` when the output isn't the text as it is (`level`, `isolated`, `plainFrom`, `consecutive`, `diagnostics`, `input`, `source`). A compile the watchdog stops reports `watchdog` (`reason`, `budgetMs`, `strikes`, `live`, `searching`) instead. Probe compiles of a hang search aren't reported as compiles. Events fire before the state the compile leads to is published.
> - **Levels:** 0 the text (healed, maybe fixed), 1 the last good render stays (also with the fallback off), 2 stable prefix, 3 error blocks (failing, hanging or crashing blocks), 4 the whole document as source.
> - **Hooks:** `onRendered` (a `RenderedEvent`: the artifact's `compiled` report plus `renderMs` and `blocks` or `pages`), `onFallback`, `onWatchdog`, `onDiagnostics`, on `mountTypstream`, `<Typstream>` and `TypstreamProvider`. App-wide sinks: provider hooks or `Engine.onEvent`.
> - **Example:** `examples/nextjs-ai-sdk/app/telemetry.tsx` logs to the console and batches to `/api/telemetry` with `sendBeacon`; its smoke test checks a final render's event arrives.

---

## 9. Security model

LLM output is **untrusted code**. Defense in depth:
- **Sandbox**: Typst has no network, no shell, no env; file access only through our VFS (only `main.typ`, preamble, mounted packages, app-provided images). `#read("/etc/passwd")` → "file not found". **Never use typst.ts's `FetchAccessModel`** for untrusted documents — it turns `#read`/`#image`/`#json` paths into same-origin fetches, letting LLM-written paths probe our static files; use a memory access model populated only by us. Package wasm plugins run inside Typst's sandboxed interpreter without host imports (re-verify for each Typst upgrade).
- **Compute**: watchdog + worker termination (§6.3); typst's own loop/recursion limits; per-compile budgets; max source size (default 1 MB); max pages for live preview (default 100).
- **Packages**: allowlist + pinned versions + integrity hashes; mirror-hosted. *As built (#25): vendored tarballs from the app's own origin (`@typstream/universe`), nothing fetched outside the allowlist, and servers facing untrusted clients ignore client-sent lists (`trustClient: false`).*
- **Output sanitization**: HTML target → strict allowlist sanitizer (no `<script>`, no event handlers, no `style` with `url()` except data fonts; links limited to `http(s)`, `mailto`, in-doc `#anchors`); SVG target → same for `<a>`, no `foreignObject`. Image sources only from VFS/blob URLs. *As built (#16): `packages/dom/src/html/sanitize.ts`, see §6.5.* Standalone HTML exports (#18) get a Content-Security-Policy `<meta>` instead (no scripts, network or forms), see §6.5 "As built: exports".
- **Worker code**: fixer modules (§8.2) are code; a server imports the ones a client names only if it trusts the client (`clientFixers`, off in `@typstream/node`, #27).
- **CSP-friendly**: worker + wasm from same origin; no `eval`; document `wasm-unsafe-eval` requirement.
- **Privacy**: no third-party font/package fetching by default.
- Security test suite in §11.7.

> **As built (#29):** threat model, defences and the CSP guide in the website's security guide (`apps/website/content/docs/guides/security.mdx`).
> - **Sandbox**, checked on the real engine in both targets (`packages/engine/__tests__/security.test.ts`): reads and images outside the virtual file system, path escapes, `file:` and `https:` paths, `@local` and unlisted packages, a wasm plugin importing a host function, XML external entities, entity expansion and SVG `use` bombs all fail inside Typst; diagnostics name only virtual paths; a document can't read another's files.
> - **Compute.** Typst gives wasm plugins no fuel, so a looping plugin is the watchdog's. Content nested 100,000 deep (built by a loop, past the parser's depth limit) overflows the stack: natively a SIGSEGV, in wasm the host's stack overflow error (`RangeError`/`InternalError`), which the server now treats as fatal like a trap. Limits in the client (`createEngine({ limits })`): `maxLength` 1 MiB (input past it isn't healed or compiled: `too-large`, last artifact kept, exports refused) and `livePages` 100 (a streaming compile with more pages stops live preview, `too-complex`; `finish()` compiles every page). No wasm memory cap: a memory bomb ends in the watchdog, or in a trap once wasm32's 4 GiB run out.
> - **Output**, checked in all three browsers on every hostile document in both targets (`tools/browser-suites/__tests__/security.test.ts`). The HTML renderer's inline styles go through the CSSOM (see the decision log), so `style-src 'self'` is enough. The paged view inserts typst-svg's output as is (links and images filtered after); the hostile corpus guards that on Typst upgrades.
> - **CSP**: `examples/strict-csp`, served with `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'; style-src 'self'`, renders both targets with packages, a lazy font and MathML in Chromium, Firefox and WebKit without a violation (CI, browsers job).
> - **Gaps** filed: #69 (UI redress: a document can draw outside its element in the HTML target) and #70 (Trusted Types: the renderers' `innerHTML` needs a policy).

---

## 10. Toolkit, editor-readiness & publishing

We won't build the editor or the wider tool family now, but v1 must not need a rewrite to get there. This section lists the constraints v1 code is held to, and how the published project (packages, landing page, docs) is organized.

### 10.1 The document model (shared by renderer, editor, AI and collaboration)
- **Source text is the single source of truth.** No parallel JSON document model that must round-trip; everything else (healed source, CST, artifact, editor view) is *derived* and carries a `revision`.
- **All changes are `TextEdit`s** (`{ from, to, insert }`, UTF-16 offsets, plus an optional origin tag: `"stream" | "user" | "ai" | "remote"`). Streaming, regenerate, editor keystrokes, AI rewrites and CRDT updates (Yjs `Y.Text` deltas map 1:1) all flow through the same `applyEdit` path in heal, syntax and engine.
- **Positions survive edits**: a `mapPosition(pos, edits)` utility in core (like ProseMirror's mapping) so selections, diagnostics, comments and island anchors can be carried across revisions.
- **Every derived artifact can be mapped back to source**: heal patches → `SourceMap`; compiled output → spans (§10.2). This is what makes click-to-edit, cursor sync and "explain this error" possible.

### 10.2 Render ↔ source mapping
- **Paged target**: frame items carry Typst spans. The engine exposes `resolve/span` (click position → source span, as `typst-ide`'s `jump_from_click` does) and `resolve/location` (span → page + position, as `jump_from_cursor` does).
- **HTML target**: Typst's HTML export carries no source spans today. v1 adds **block-level anchors**: in *preview* compiles only, the engine inserts an invisible `html.elem("typstream-anchor", attrs: (data-src: "<offset>"))` at each top-level checkpoint (§5.2); the renderer turns them into `data-typstream-src` attributes on the following block and strips them. Exports never contain anchors. Finer-grained mapping is a later upgrade (upstream span support or a wrapping show-rule strategy), behind the same `resolve/*` methods.
- Tested by a property: for every corpus doc and every top-level block, clicking the block resolves to a source range that contains the block's text.

> **As built (#16).** The engine server (`packages/engine/src/server/anchors.ts`) writes `#std.html.elem("typstream-anchor", attrs: ("data-src": "<offset>"));` and a newline at the start of each anchored line; `std.` survives a document that shadows `html`, and the `;` ends the expression so the next line can't continue it. typst-html groups only phrasing content into paragraphs, so the custom element comes out as a block-level sibling before the block it marks. Rules and findings:
> - **Where.** Heal's root checkpoints sit at every root line, so only block starts get an anchor: the start of the text, a line after a blank line, a heading. Not before a list/enum/term item whose previous block start was an item of the same kind (`+ a⏎⏎+ b` would become two lists, the second numbered from 1 again), nor before a line starting with `<` (a label there would attach to the anchor). Other block starts without a blank line before them (a list right after a paragraph line) share the previous anchor.
> - **When.** HTML compiles only, unless `compile.anchors` is `false`; paged compiles and `export/*` are anchor-free. The server keeps heal's checkpoints per document and re-recognizes from the checkpoint before the first edit, so a streamed append costs the tail. Diagnostics are mapped back through the insertions (a position inside an anchor maps to its line). Worker JS is 16.3 KB gz with heal's recognizer (budget 40 KB).
> - **Checked** (`packages/engine/__tests__/anchors.test.ts`, engine-wasm): for every edu corpus document and a dozen healed prefixes of each stream, HTML with the anchors stripped equals HTML without them, byte for byte, and diagnostics map to the same spans. In the browser, every text block's words appear in its source range (`packages/dom/__tests__/browser/html-render.test.ts`).
> - **Offsets** are in the compiled document: the healed source of the artifact's revision, without the preamble. Map them to the raw stream with heal's `map.toInput`, which stays valid for settled text across appends; that's the bindings' job.
> - **Renderer side:** anchors become `data-typstream-src` on the following blocks. A block's range runs to the next anchor (`null` for the last); blocks before the first anchor and the footnotes section have none. `sourceRange(node)` and `blockAt(offset)` (`@beta`) resolve without a worker round trip. A template that wraps the body (`#show: body => html.div(body)`) puts the anchors inside the wrapper; the renderer splits inside it.

### 10.3 What a future visual (Plate-style) editor needs — and the v1 contract that provides it
| Editor need | v1 provision |
|---|---|
| Structured view of the document | `@typstream/syntax` lossless CST with incremental reparse (oracle in v1, same package later). |
| Edits that preserve the author's formatting and comments | Edits are minimal text patches on the CST, never "serialize the whole model back to Typst". Typst code (functions, `#let`, show rules) stays as **opaque atomic nodes** rendered from compiled output, editable via a source popover — the markup subset (headings, paragraphs, emphasis, lists, math, tables) gets rich editing. |
| Live preview & validation while typing | Same engine, same scheduler, same fallback ladder — typing an unclosed `[` is the same problem as a streamed one. |
| AI commands ("simplify this paragraph", "add 5 questions") | Streaming *regions* (§5.2) + `@typstream/ai`. |
| Toolbars, slash menu, custom blocks | `editor` facet of `TypstreamPlugin` (§8.0), reserved now. `@typstream/edu` will contribute `question`, `mcq`, `answer` nodes. |
| Autocomplete, hover docs, go-to-definition | Language-service protocol methods (§6.1) reserved and capability-negotiated. |
| Collaboration | `TextEdit` ⇄ Yjs `Y.Text` adapter; positions mapped through edits. |
| Undo/redo | Owned by the editor over `TextEdit` history; engine is stateless per revision. |

Guardrails that keep v1 honest: (1) no module in `heal`/`engine`/`dom` may assume "append-only" — enforced by the random-edit property tests; (2) no React import below layer 4; (3) protocol and plugin types live only in `core` and are API-reviewed (§10.4).

### 10.4 Publishing & API stability
- **npm scope** `@typstream/*` plus the unscoped `typstream` convenience package. ESM-first with `exports` maps (subpath exports like `@typstream/engine/worker`), types bundled, `sideEffects: false`, CJS only where needed for Node consumers.
- **Versioning**: changesets; `core`/`heal`/`engine`/`dom`/`react`/`typstream` in a **fixed** version group (they evolve together, users never mix versions); content and integration packages version independently. Pre-1.0 we ship `0.x` with clear "experimental" labels on the HTML target and editor-facing APIs.
- **API review**: `api-extractor` reports checked into the repo; CI fails when the public surface changes without an updated report (the reviewer sees the diff). `@public` / `@beta` / `@internal` TSDoc tags drive both the reports and the docs.
- **Compatibility matrix**: each release declares its Typst version (engine-wasm build), supported browsers and React versions; documented on the website and asserted in CI.
- **Quality gates for publishing**: `publint`, `@arethetypeswrong/cli`, size budgets (§11.6), example apps build & smoke test, provenance (`npm publish --provenance`), signed commits (as streamdown does).
- **License**: decide before first publish (Apache-2.0 aligns with Typst and typst.ts; MIT is the streamdown/Plate norm). Track third-party licenses (fonts are OFL; bundle notices). If any part becomes commercial (e.g. a pro editor), keep the split at package boundaries, never inside a package.

### 10.5 Landing page, docs & playground (`apps/website`)
- **Stack**: Next.js + Fumadocs (MDX), same as streamdown's website; deployed with preview deployments per PR.
- **Dogfooding**: the landing page's hero is a live stream of a Typst worksheet rendered by typstream; every docs example is real Typst rendered by the library (so docs break when the library breaks — the docs build is a test).
- **Docs structure**: Getting started (React, Next.js + AI SDK, Vite, vanilla, Node) → Concepts (healing, streaming regions, render targets, fallback ladder, security) → Guides/recipes (answer keys, templates, custom islands, writing a plugin, server fix loop, self-hosting wasm/fonts/packages, CSP) → API reference (generated from TSDoc via api-extractor/typedoc → MDX) → `@typstream/edu` reference (generated from Typst doc comments — the same source as the prompt kit) → Playground → Changelog/compat matrix.
- **Playground**: paste or replay a stream, scrub through it token by token, see raw vs healed source with patches highlighted, diagnostics, fallback level and timings; shareable URLs (state in the hash). The internal dev playground and the public one are the same app with a flag.
- **Agent-readable docs**: `llms.txt` / markdown endpoints for every docs page (streamdown does this too), since our users build AI products.
- Docs are versioned per minor release once we hit 1.0.

> **As built (#32, #33):** `apps/website`. Information architecture: Introduction → Getting started (installation, React, Next.js + AI SDK, without a framework, Node) → Concepts (how it works, healing, streaming and final mode, render targets, the engine, fixers and fallback, plugins) → Guides (prompting, edu documents, Typst packages, fonts and languages, exports, theming, telemetry, writing a plugin, server fix loop, self-hosting, remote engine, security) → Packages (one page per package, with generated type tables; edu's vocabulary generated from its doc comments) → Resources (compatibility, troubleshooting). The playground stays `apps/playground` for now.

---

## 11. Testing strategy

Tooling: **vitest** (unit/property/bench), **fast-check** (property), **Playwright** (browser e2e, visual, perf, cross-browser: Chromium/Firefox/WebKit), **typst CLI pinned in CI** + `typst-syntax` compiled to wasm as **parse oracle**, `size-limit`/esbuild script for size, CodSpeed or a stored-baseline comparator for benchmarks.

### 11.1 `@typstream/heal` — unit + property tests
- **Per-construct test files** (streamdown style): `strong.test.ts`, `emph.test.ts`, `raw-inline.test.ts`, `raw-block.test.ts`, `math-inline.test.ts`, `math-display.test.ts`, `math-calls.test.ts`, `content-block.test.ts`, `code-block.test.ts`, `args.test.ts`, `dict-array.test.ts`, `strings.test.ts`, `unicode-escape.test.ts`, `comments-nested.test.ts`, `labels.test.ts`, `refs.test.ts`, `statements-let-set-show.test.ts`, `closures.test.ts`, `control-flow.test.ts`, `embedded-expr-end.test.ts`, `urls-not-comments.test.ts`, `headings-lists-terms.test.ts`, `escapes.test.ts`, `surrogates.test.ts`, `fence-unwrap.test.ts`, plus one file per lint rule.
- **Table-driven expectations**: `{ input, healed, stableOffset, openFrames }` for ~1000 hand cases, including every row of §3 and §5.4.
- **Property tests over every prefix** (copy remend's method): generate documents from *complete* atoms (markup, math, code, tables, figures, raw blocks, edu functions, nested combos), then for every cut point assert invariants 1–6 of §5.4. Oracle for (1) = `typst-syntax` error-free parse (via `@typstream/syntax`, or the typstyle wasm `parse()` dump as a stopgap — search it for `Error` nodes). Additionally a **compile oracle** (sampled, slower): healed prefix compiles with zero errors via the real compiler with the edu package mounted.
  **As built (#13):** `tools/compile-oracle` (heal may not import the engine, §4.1), run in CI's engine job. It compiles one in three stream prefixes of the corpus and of generated documents to HTML; failing prefixes then go through the engine server's Layer 3 fixers (#20), as in the worker. Errors the fixers leave must be in an allowed class tied to what handles it, a class that stops occurring must leave the list, and the corpus rate with Layer 3 must stay above a floor (99% since #20). `pnpm --filter @typstream/compile-oracle report` runs the full measurement (§5.5 "Measured"). The edu package isn't mounted yet (#23).
- **Chunking fuzz**: same docs fed through `createHealer().push()` with random chunk sizes (1 char … 200 chars, incl. splits inside surrogate pairs and inside `\r\n`) → result must equal stateless `heal()` of the same prefix (**incremental ≡ stateless**).
- **Random-edit equivalence** (the editor-readiness guarantee): apply random `TextEdit` sequences (insert/delete/replace anywhere, incl. inside raw blocks, strings, math, nested code) via `applyEdit` → scanner state, checkpoints and regions must equal a full rescan of the resulting text; early-resync must actually trigger (assert rescanned length is bounded for local edits).
- **Streaming-region tests**: take a complete doc, delete a block, then stream it back in at its original position in random chunks → every intermediate healed document is valid, the suffix is byte-identical, and the final result equals the original.
- **Differential vs. tree-sitter-typst / typst-syntax for mode classification**: for random docs, our `mode(i)` must match the oracle's node kind at every offset (catches scanner drift when Typst syntax changes).
- **Mutation testing** (Stryker) on `heal` to keep the test suite honest; coverage ≥ 95% lines/branches for `heal`.

> **As built (mutation testing, #6):** `pnpm mutate` in `packages/heal` (Stryker, vitest runner, per-test coverage) runs nightly and fails below 80%. Score 80.59% at the first full run (lexer 88.6%, recognizer 77.2%, heal 65.4%, chars 81.7%, lint 96.2%, normalize 97.5%). The tests that took it from 57.6% compare with real Typst: the lexer token by token in all three modes (ASCII and Unicode soup), token modes and first error positions on generated code, and a syntax table checked on every prefix. The mode-classification differential above is `modes.test.ts`. Equivalent survivors: operator precedence and associativity (the recognizer builds no tree), ASCII fast paths in front of Unicode regexes, repair and resync shortcuts that only change cost. The rest are on #6. Running these differentials found port divergences and heal bugs, each kept as a known bug whose repro must keep failing (`__tests__/support/known-bugs.ts`, `lexer.test.ts`, `errors.test.ts`, `results.test.ts`).

### 11.2 Corpus (shared by all layers)
`corpus/` holds real-world-shaped documents, each with metadata (`category`, `expectedPages`, `allowedWarnings`):
- **Hand-authored edu set** (~60): worksheets (math, science, language), MCQ quizzes, exams with answer keys, lesson plans, rubrics, reading comprehension, chemistry equations, physics with units, geometry with CeTZ, multilingual (Bengali, Arabic RTL, Chinese, Hindi), long reports with outline/bibliography.
- **LLM-generated set** (~300+, growing): generated with our prompt kit across several models and temperatures, recorded **with real chunk boundaries and timings** (`.stream.jsonl`), so tests replay exactly what production sees. Includes *broken* outputs (with the errors we expect to repair) — tagged by error class.
- **Adversarial set**: deep nesting (10k `[`), 1 MB document, 2000-row table, 500-page doc, pathological backtick runs, every Markdown-ism, infinite loops, memory bombs, huge images, zalgo text, RTL+LTR mixing.
- **Production regression set**: anonymized cases captured from fallback telemetry (§8.6).

**As built (#12):** `corpus/edu/` (35 hand-written documents, all compiling natively; geometry uses Typst's own shapes because packages wait on #25) and `corpus/adversarial/` (17 documents; the large ones are generated by `corpus/scripts/generate-adversarial.mjs`). `@typstream/corpus` loads entries, synthesizes token-sized streams and replays them through a callback (`corpus/README.md`). Findings from the first run:
- Heal bugs: a cut inside `else` / `else if` after an if-expression in a `#let`, and a `(_, y)` closure parameter list closed before `=>`. Both are listed as known bugs in heal's corpus test.
- The incremental healer is far over its per-token budget when nothing settles, even after the #5 resync: about 57 ms per token at the end of the 2,000-row table, 65 ms in the 200 KB single line, 11 ms in 10k-deep nesting. A large `#table(` is one unsettled construct.
- Native layout of the 200 KB single paragraph takes about 12 s; the 1 MB document (479 pages) about 18 s.
- Typst stops `while` loops ("loop seems to be infinite") and deep recursion by itself, and rejects `while true` statically. Memoization collapses `f(n - 1) + f(n - 1)`. Long finite loops, recursion with distinct arguments, and memory bombs are left to the engine's watchdog (§6.3).

**As built (#24):** `corpus/llm/`, 141 documents recorded from claude-haiku-5-5 and claude-sonnet-5-5 by `tools/llm-corpus`, with the API's own text deltas and arrival times: the naive prompt's output (plain Typst), the final kit's (in edu's vocabulary) and every kit output that fails to compile, kept as `expect: "error"` entries. Two metadata fields: `plugins` (`["edu"]`: compile with edu's files and preamble) and `prompt` (`{ kit, request }`). Because its documents need their plugins, the set is opt-in: `loadCorpus()` still loads `edu` and `adversarial`, and `ALL_SETS` adds `llm`. Heal's corpus tests (every prefix, real chunk replay) and the compile oracle (edu's preamble in the first chunk) load it; `corpus:validate` compiles it natively with edu and the vendored packages on `--package-path` and no network. Recorded streams changed one invariant's wording: a document that parses comes back unchanged *except for lint fixes* (`**one**` parses).

### 11.3 Engine tests (Node + browser)
- Scheduler unit tests with fake timers & fake adapter: latest-wins, stale-result dropping, adaptive interval math, boundary bias, cancellation on unmount.
- Watchdog tests: infinite-loop doc → worker terminated within budget + spare worker takes over + fallback shown; 3-strikes behavior.
- Semantic fixers: per-fixer tests driven by **real compiler diagnostics** (no mocks — pin compiler version so messages are stable; snapshot the diagnostic shape to detect upstream changes).
- **Fallback ladder**: injected failures at each level; block isolation finds the right block(s) with ≤ ⌈log₂ n⌉+1 compiles.
- **Final-render equivalence**: for every corpus doc, replay the stream through the full pipeline; the final artifact must equal a one-shot compile of the full source (HTML string equality; paged: vector hash equality).
- **Protocol contract tests**: a shared conformance suite every `EngineAdapter` (typst.ts, server, future custom wasm) must pass — same requests, same diagnostics shape, same artifacts; version/capability negotiation tested old-client↔new-server and vice versa.
- **Plugin contract tests**: a plugin using every facet loads in engine + dom + react; unknown facets (e.g. `editor`) are ignored without error; plugin ordering/dependencies resolved deterministically.
- **Source-mapping tests**: every top-level block's anchor resolves to a source range containing its text (HTML); `resolve/span` round-trips on paged output; `mapPosition` through random edits matches a naive recomputation.
- **Streaming quality metrics** (reported, with thresholds): prefix-compile rate, fallback-level histogram, max consecutive stale frames, mean visible lag (tokens received but not yet rendered).

**As built (#10):** worker code runs under vitest browser mode with the Playwright provider (`packages/engine`, `pnpm test:browser`, project `browser`), in Chromium, Firefox and WebKit. It was chosen over Node `worker_threads` with a shim (which wouldn't exercise the browser's worker loading, `fetch` or streaming wasm compilation) and over a custom Playwright harness like `spikes/phase0/harness` (which would need its own runner and assertions). Later browser suites add files under `__tests__/browser/` or a project like it. What runs:
- The **protocol conformance suite** (`__tests__/conformance.ts`): raw protocol requests through a `SpawnEngine`, so it runs against the in-process server in Node (`inProcess`), the real worker in each browser, and later the server adapter of #22.
- **Streaming**: token-sized streams at 400 tokens/s through client, worker and engine-wasm, in both targets. Documents whose every token-sized prefix compiles (a five-page handout, `edu/programming-python-loops`) must produce no error frames, and every stream must end equal to a one-shot compile (HTML string; paged SVG, page sizes and count). A document with error frames keeps its last good artifact throughout.
- **Watchdog**: `#let a = range(100000000).map(x => x)` times out or traps, the worker is replaced and the document recovers.
- First measurements: streaming the edu corpus at token granularity, 87% of healed prefixes compile (13,534 of 15,518). 29 of 35 documents have error frames; most are calls cut before a required argument (`#question(` healed to `#question()`: "missing argument: body") and half-typed values (`1` before `em`). Heal reports no syntax errors on any of them. This agrees with #13's compile oracle (88%), and the fixers that remove them are #20: since then the `worksheet-fractions` stream has no error frames in any browser. Latency through the real stack, warm worker, on a 6-core machine that other jobs kept at load 12–16: a one-page document (`edu/programming-python-loops`) compiles at p50 7–9 ms in all three browsers, both targets; the five-page handout at p50 30–50 ms (Node: 19–37 ms for the same work at the same time). The Phase 0 figure (5 pages, p50 ≲ 10 ms in Chromium) still needs an idle-machine run; the test only guards against gross regressions (p50 < 100 ms in Chromium).

### 11.4 Rendering & visual tests (Playwright)
- **Visual regression**: screenshot every corpus doc (final) in both targets × light/dark × 3 widths; plus **mid-stream frames** at fixed cut points (25/50/75%) — catches flicker artifacts like a half-applied show rule. Pixel-diff threshold; baselines updated via explicit command.
- **Flicker test**: record DOM mutations during replay; assert no element that was already settled (above `stableOffset`) is removed/re-created (layout stability), and no CLS beyond a threshold in the HTML target.
- **html-compat coverage**: for each Typst element in a matrix (grid, align, rect, box, block, place, columns, stack, table features, figure kinds, outline, footnote, bibliography, equation numbering, cetz), compile to HTML and assert (a) no "ignored during HTML export" warnings, (b) no text content lost vs. paged text extraction. *As built (#15):* Node tests in `packages/html-compat` (engine-wasm vs native typst + pdf.js), not Playwright, plus the edu corpus and a paged-unchanged check; see §6.5. CeTZ itself waits for packages (#27): the matrix has a canvas built the way CeTZ builds one. Browser screenshots of MathML were a one-off for the research; visual regression belongs here.
- **Accessibility**: axe-core on HTML target; heading order, MathML presence, table headers, `lang`/`dir`; paged target exposes a text layer & document outline.
- Cross-browser matrix incl. WebKit (Safari MathML/wasm memory quirks) and a mobile viewport profile.

> **As built (#19, `tools/browser-suites`; README there).** Vitest browser mode in Chromium, Firefox and WebKit, through `mountTypstream` with html-compat and the math font, on the real worker.
> - **Equivalence:** every corpus document (edu and adversarial) streamed and finished equals a one-shot render: status, artifact (HTML string; page sizes, SVGs and text runs, not hashes) and DOM. 100%, both targets. The adversarial set runs in Chromium only: it exercises the engine and watchdog (same wasm everywhere), and #21's hang search makes it most of the suite's time. (This also covers §11.3's final-render equivalence.)
> - **Flicker:** edu documents replayed in steps of up to 1/60. Paged: pages never removed; redrawn only when their SVG changes; never blank; no page returns to an SVG it showed (#65), unless it isn't the last and what it lost moved to a page added since. HTML: a block with unchanged markup is never re-created; a settled anchor group (the next group starts before heal's stable offset) never disappears and changes only in ids, references, citations (pending-ref placeholders) and outlines. Both targets report the steps whose render shows less than the step before (Chromium, after #65): in HTML 2 edu documents, neither a cut (a `.map(w => box(` whose boxes are empty until their bodies arrive; an array's `repr` that becomes the shorter string `.join` makes of it); in paged 3, each a page that lost what moved to a page added since. Not built: the CLS threshold (blocks are kept, so shifts come only from content above changing, which the settled-group check covers).
> - **Accessibility:** axe-core (WCAG 2.2 A/AA, best practices; page-level rules off) on every edu document, HTML in light and dark, paged; plus `lang`/`dir`, MathML, `<th>` for `table.header`, and text layers holding the HTML target's text. Violations from Typst's markup or axe's limits are listed with reasons. Since #63 the paged text layers also have the HTML target's headings (levels and text; in Chromium as its accessibility tree exposes them, through CDP) and the document's `lang`/`dir` on every page.
> - **Visual:** screenshots only in Playwright's Docker image, baselines as palette PNGs, a reduced matrix (decision log). Mobile: the 360 px width; no device emulation.

### 11.5 Performance tests
Bench suites (vitest `bench`, stored baselines, CI fails on > 10% regression on a dedicated runner or via CodSpeed):
- **heal micro**: per-construct ns/op; **scaling** at 1 KB / 10 KB / 100 KB / 1 MB (must be linear; fit slope); **per-token incremental cost** vs. full rescan over a 50 KB replay (incremental must be ≥ 20× cheaper at the tail of the stream).
- **engine (Node, wasm)**: cold init (instantiate + fonts), first compile, incremental recompile after appending 1 / 10 / 100 chars for 1 / 5 / 20 / 100-page docs, p50/p95/p99, both targets; semantic-fixer overhead; block isolation cost.
- **end-to-end (Playwright + CDP tracing)**: replay corpus streams at 30, 100 and 300 tokens/s; measure time-to-first-render (cold/cached), compile→paint latency, **long tasks on main thread (must be 0 > 50 ms)**, total main-thread busy %, FPS during auto-scroll, worker CPU; CPU-throttled 4× profile to simulate low-end school laptops/Chromebooks.
- **Memory/leak**: 200 compiles of a changing document per adapter (catches comemo-cache growth like typst.ts #895; asserts worker recycling keeps wasm memory under its threshold); stream 50 docs sequentially in one page, heap snapshots before/after (detached DOM nodes, worker memory, wasm memory growth); unmount/remount 100 times.
- **Concurrency**: 10 `<Typstream>` instances on one page (chat history) — shared worker pool (default pool size 1–2), only visible/streaming instances compile.

### 11.6 Size tests
Budgets checked in CI with a report comment on PRs (like streamdown's `scripts/bundle-size.js`, but enforced):
| Artifact | Budget (gz unless noted) |
|---|---|
| `@typstream/heal` | ≤ 15.5 KB (measured 15.1 KB; the faithful parser port is most of it; 15 KB until #24's `math-lone-script` rule and currency fix and #65's math-argument closers added 0.2 KB) |
| `@typstream/react` (excl. engine, peers external) | ≤ 16.5 KB (measured 16.1 KB; 15 KB until #19's renderer fixes added 0.3 KB, 15.5 KB until #63's paged text layer structure added 0.5 KB, 16 KB until #29's CSSOM styles added 0.15 KB) |
| `@typstream/engine` main-thread part | ≤ 8.5 KB (measured 8.2 KB; 8 KB until #27's plugin resolution and facet merging, moved here from `@typstream/dom`, added 0.7 KB) |
| `@typstream/dom` HTML renderer, with its CSS | ≤ 9.5 KB (measured 9.0 KB; counts toward `@typstream/react`'s 16.5 KB; 9 KB until #27's plugin stylesheets added 24 bytes to a renderer 7 bytes under) |
| `@typstream/dom` standalone HTML export | ≤ 2 KB (measured 1.3 KB) |
| Worker JS (excl. wasm) | ≤ 40 KB |
| Compiler wasm (brotli) | ≤ 6.3 MB for `engine-wasm` (HTML+SVG+PDF; measured 6.20 MB, 5.85 MB without PDF, #18); 4.29 MB + PDF with trimmed data (#26); alert on +3% |
| Renderer wasm (brotli) | ≤ 400 KB (typst.ts renderer 0.8.0-rc3 is 372 KB) |
| Syntax wasm (`@typstream/syntax`, gz) | ≤ 300 KB; never loaded by the renderer-only path |
| Base font payload | ≤ 1.5 MB (brotli), lazy script fonts tracked individually |
| `@typstream/edu` Typst package | ≤ 30 KB gzipped (measured 16 KB, #23; `package.test.ts`) |
Plus: tree-shaking test (importing `heal` alone pulls nothing else), "no wasm in main bundle" assertion, ESM/CJS export map tests, `publint`/`attw` checks.

### 11.7 Security tests
Corpus of hostile docs: file reads outside VFS, package imports not on allowlist, `javascript:` / `data:` links, SVG/HTML injection attempts via `html.elem("script")`, `html.elem` with `onclick` attrs, huge allocations, deep recursion, infinite layout (e.g. self-referential `context` loops / layout not converging) → assert sandbox holds, sanitizer strips, watchdog fires, UI recovers.

> **As built (#29):** 19 `hostile-*` documents in `corpus/adversarial/` (validated natively with `--features html`), the engine's `security.test.ts` (sandbox, both targets) and the browser suites' `security.test.ts` (both targets, three browsers, plus the limits); `examples/strict-csp` for CSP. Details in §9 "As built (#29)" and the security guide (`apps/website/content/docs/guides/security.mdx`).

### 11.8 CI pipeline
`lint (biome) → layering check (dependency-cruiser) → typecheck → unit+property (heal, engine, core) → build → api-extractor diff → publint/attw → size → node benches (compare) → Playwright (e2e, visual, a11y, perf smoke) → examples build + smoke → website build (docs examples render through the library) → corpus report artifact (prefix-compile rate, fallback histogram, perf table)`. Nightly: full perf suite, long property runs (10× examples), mutation testing, cross-browser full matrix (as built: the corpus-wide browser suites), LLM corpus refresh (regenerate N new docs with current prompt kit & models, run the pipeline, file new failures as test cases).

*As built:* a PR's CI should finish in about 5 minutes, so slow checks are split across parallel jobs (per browser, per engine shard, heal's corpus suite across test files) and what still can't fit runs nightly (see the 2026-10-27 decision).

---

## 12. Observability in production
The app (not the library) collects, via `onRendered`/`onFallback`/`onDiagnostics`: heal patch counts by rule, fixer hits by diagnostic, fallback levels, watchdog events, compile latency by doc size and device class, final-mode errors after the LLM fix loop. Weekly review → new lint rules / prompt kit "don'ts" / corpus cases. Target: final-mode error rate (after fix loop) < 0.5% of generated documents.

---

## 13. Repository layout & tooling

```
typstream/
  packages/
    core/          src/{edits,positions,sourcemap,diagnostics,protocol,plugin,errors}.ts   (no deps)
    heal/          src/{normalize,scanner,frames,checkpoints,lint/*,tail,region,index}.ts  __tests__/  __benchmarks__/
    syntax/        wasm wrapper over typst-syntax (oracle now, editor CST later)
    engine/        src/{client,scheduler,watchdog,pool}.ts  src/worker/{server,vfs,fonts,packages,fixers/*,fallback,anchors}.ts
                   src/adapters/{typst-ts,server}.ts
    node/          src/{validate,render,fix-loop,format-diagnostics}.ts
    html-compat/   typst/html-compat.typ  (+ coverage matrix tests)
    edu/           typst/{lib.typ,templates/*.typ}  prompt-kit/  plugin.ts  scripts/gen-catalogue.ts
    dom/           src/{mount,renderers/{html,svg-pages}/*,sanitize,animate,caret}.ts
    react/         src/{Typstream.tsx,provider.tsx,use-typstream.ts,islands.tsx}
    typstream/     re-exports (convenience package)
    ai/            (v1.x)    codemirror/, editor-core/, editor-react/   (future — directories created only when work starts)
  apps/
    website/       Next.js + Fumadocs: landing page, docs, public playground, llms.txt
    playground/    internal dev playground (same code as public playground behind a flag) + corpus recorder
  examples/        nextjs-ai-sdk/  vite-react/  vanilla/  node-validate/   (built & smoke-tested in CI)
  corpus/          edu/ llm/ adversarial/ regressions/   (*.typ, *.stream.jsonl, meta.json)
  bench/           e2e perf harness (Playwright + CDP)
  tools/           typst-syntax-wasm build, size report, benchmark baseline compare, api-extractor config
```
pnpm workspaces, turbo, tsup, vitest, biome (ultracite), changesets, Playwright, api-extractor, dependency-cruiser (layering rules from §4.1); Rust toolchain only for the `syntax` wasm and the optional custom compiler wasm. Shared `tsconfig`/build presets so a new package (e.g. `editor-core`) is a copy-and-rename.

---

## 14. Roadmap (phased, each with exit criteria)

> The phases below are the original plan. **The authoritative, up-to-date breakdown is the GitHub issues** (roadmap: #38). Issue numbers are noted per phase.

**Phase 0 — Spikes**
- ✅ **Engine bake-off done** (2026-10-26, [spikes/phase0/RESULTS.md](spikes/phase0/RESULTS.md)). typst.ts 0.8.0-rc3, typst-wasm 1.0.0 and our own Typst 0.15.1 build were measured in Chromium 156, Firefox 157 and WebKit 27.2 for size, cold start, streaming latency at 1/5/20 pages, main-thread render cost, and memory over 200 compiles. **Decision: own the engine build; HTML is the default streaming target** (§6.1).
- Remaining:
  - ✅ Changed-page SVG export prototyped. It meets the bar, so typst.ts is dropped (see RESULTS.md, "Changed-page SVG prototype").
  - Decide the data-trimming level: hyphenation languages, highlighting, bibliography and plugins (4.29 MB measured; ~2.5 MB estimated).
  - ~~Measure on real low-end hardware~~: deferred (see decision log).
  - html-compat prelude coverage and MathML rendering across browsers: moved to Phase 3.
  - ✅ `typst-syntax` wasm oracle built (`tools/typst-syntax-oracle`).
- *Exit*: data-trimming level decided (needs the launch-languages decision).

**Phase 1 — `@typstream/heal`** ✅ (2026-10-26; see `packages/heal/README.md`)
- Built:
  - `@typstream/core`: edits, positions, source maps.
  - `@typstream/heal`: normalizer, recognizer (typst-syntax port), incremental healer with checkpoints, tail repair, streaming regions, 9 lint rules, custom handlers.
  - `tools/typst-syntax-oracle`: Typst's real parser as a test oracle.
- Tests: 119 (heal) + 4 (core).
  - Properties: validity, preservation, idempotence, identity, chunking ≡ stateless, random edits ≡ stateless, streaming regions.
  - Recognizer ≡ typst-syntax on documents, prefixes and character soup.
  - All 21 property and edge-case tests passed a 10,000-run campaign (millions of healed prefixes checked by Typst's parser). An earlier 20,000-run campaign found no violations; one test only hit the old 120 s timeout, which is now raised for long runs.
  - Coverage: 97.6% lines, 92% branches.
  - Mutation score 80.59% (Stryker, nightly; #6).
- Perf: per token at 40–50 KB p50 0.16 ms / p95 0.2 ms; stateless healing is linear (~85 µs/KB up to 1 MB); pathological inputs under 75 ms.
- Not done yet:
  - ✅ Compile-oracle tests (healed prefixes compile with the engine): `tools/compile-oracle`, #13.
  - CI (the repo isn't under git yet).

**Phase 2 — Engine MVP (2–3 wks)** · issues #7–#14
- Worker + `@typstream/engine-wasm` (productionize the Phase 0 crate: CI wasm build, eviction after every compile, changed-page SVG, structured diagnostics), VFS, base fonts, scheduler, watchdog, last-good fallback, paged target with visible-pages-first updates.
- *Exit*: corpus replays with 0 error screens; perf SLOs for 5-page docs met in Chromium.

**Phase 3 — React + HTML target (2–3 wks)** · issues #15–#19
- `<Typstream>`, HTML renderer with block diffing, sanitizer, html-compat, animation/caret, exports.
- *Exit*: visual + a11y suites green; final-render equivalence 100%.

**Phase 4 — Semantic fixers, block isolation, final mode, `@typstream/node` fix loop (2 wks)** · issues #20–#22
- `@typstream/node` built (#22): validate / render, LLM prompt and fix loop, WebSocket protocol server, `examples/node-validate`. Its tests compile the whole corpus on the wasm engine, page counts matching native Typst.
- *Exit*: prefix-compile rate ≥ 99%; final-mode recovery shows full doc with isolated error blocks.

**Phase 5 — `@typstream/edu` + prompt kit + templates (2–3 wks, can start in parallel with 2)** · issues #23–#24
- *Exit*: LLM corpus generated with the kit has < 2% raw final-mode error rate before fix loop.
- *Status (#24)*: met for claude-sonnet-5-5 (0/29 with kit-v4; 0.9% over kit-v2–v4), not for claude-haiku-5-5 (3.4%, one-off errors left to the fix loop).

**Phase 6 — Hardening & extensibility** · issues #25–#30
- Islands, lazy script fonts, package allowlist & mirror, cross-browser. (Low-end perf deferred; see decision log.)

**Track W — Website & docs (runs alongside Phases 2–6)** · issues #31–#33
- Phase 2: `apps/website` scaffold (Fumadocs), landing page with live streamed demo, Getting started.
- Phase 3–4: Concepts + API reference generation, public playground.
- Phase 5: `@typstream/edu` reference generated from Typst doc comments; recipes; `llms.txt`.
- *Exit for first public release (0.1)*: docs cover every `@public` API, examples green, compat matrix published.

**Later — the wider toolkit (not scheduled; v1 contracts already support them)** · issues #34–#37
- `@typstream/ai`: AI SDK integration, streaming *regions* for "rewrite this section" commands.
- `@typstream/codemirror`: source editor with highlighting, diagnostics, completion/hover via the language service.
- `@typstream/editor-core` / `editor-react`: Plate-style visual editor over the CST (markup subset rich-editable, code as atomic nodes), edu nodes via the plugin `editor` facet.
- Collaboration adapter (Yjs), Vue/Svelte bindings over `@typstream/dom`.

---

## 15. Risks & open questions

| Risk | Mitigation |
|---|---|
| **Wasm + fonts payload** heavy for school devices / slow networks (≈ 5.9 MB engine + 1.45 MB fonts brotli; ~3 s at 20 Mbps) | Preload while the LLM is still generating, cache forever, hybrid server-first mode; PDF is +0.34 MB in the one build (#18). |
| **Memory growth from Typst's memoization cache** (typst.ts #895 confirmed in all browsers: +1.3 MB/compile) | Our build evicts after each compile (flat ~21 MB, measured); recycling for other adapters (§6.3); 200-compile memory test in CI (§11.5). |
| Owning a Rust/wasm build adds maintenance (Typst upgrades, wasm toolchain) | Small surface (~350 lines); pinned toolchain in CI; Typst-upgrade playbook; typst.ts/typst-wasm adapters remain drop-in fallbacks via the conformance suite. |
| Paged target jank on long documents (multi-page reflows: 40–70 ms when 7 pages change) | Changed-page export (measured: usually 1 page per step); visible-pages-first DOM updates, offscreen pages in idle time; typst.ts adapter possible as fallback. |
| **HTML export is experimental upstream**; output changes between versions | Pin Typst version per typstream release; html-compat + visual tests catch changes; `paged` remains reference. |
| **Typst syntax/diagnostic changes** break scanner & fixers | Oracle-differential tests against pinned `typst-syntax`; diagnostic snapshot tests; upgrade playbook per Typst release. |
| **LLM writes complex code** (loops, heavy CeTZ) → slow compiles | Watchdog, adaptive throttle, prompt kit constraints, "too complex for live preview" mode. |
| Global show/set rules arriving late cause **restyle flashes** | Tail repair drops incomplete global rules; prompt kit asks for all `#set`/`#show` at the top; templates set style up front. |
| Forward refs/outline cause numbers to shift during stream | Pending-ref placeholders; acceptable by design; final render exact. |
| Typst versions: typst.ts lags the latest Typst release (`latest` is still on 0.14.2; 0.15 only in `rc`) | Pin per adapter and declare it in the compat matrix; custom wasm adapter as escape hatch; heal/lint tests run against the *same* pinned `typst-syntax` as the engine. |
| **Over-engineering v1 for a future editor** slows the product launch | Only *contracts* are built now (edit-based APIs, protocol types, plugin facets, block anchors); editor packages are reserved names with no code. Each contract has a test that keeps it honest, and nothing editor-specific ships in the bundle. |
| HTML target lacks fine-grained source spans → weak click-to-edit in a future visual editor | Block-level anchors in v1; paged target has full spans; track upstream HTML span work; editor can fall back to paged preview. |
| Publishing a public API too early locks in mistakes | `0.x` with `@beta` tags, api-extractor review on every change, editor-facing APIs marked experimental until the editor exists. |

Open questions for the product team:
1. ~~Primary surface: chat bubbles (favor `html`) or document side-panel (favor `paged`)?~~ Answered (#1): a document panel; paged first (decision log).
2. Which languages/scripts must be supported at launch (drives font payload)?
3. Is server-side compile acceptable as a fallback for low-end devices (cost, latency)?
4. Which Typst packages do teachers need on day one (CeTZ for diagrams? chemistry? music notation?)
5. Do students interact with documents (islands for quizzes), or is it teacher-only output?
6. Licensing and open-source scope: fully open (Apache-2.0/MIT), or open core with a commercial editor later? This decides package boundaries before the first publish.
7. Product name and npm scope availability (`typstream`, `@typstream/*`) — reserve them early.
