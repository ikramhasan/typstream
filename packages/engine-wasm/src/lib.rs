//! @typstream/engine-wasm: Typst 0.15.1 compiled to wasm (PLAN.md §6.1).
//!
//! An `Engine` holds an in-memory World (virtual files as bytes, `sys.inputs`)
//! and compiles it to HTML, or to SVG for the pages that changed since the last
//! call. Fonts are shared by every engine in the instance, and can be
//! registered before their bytes are loaded (§6.4, fonts.rs). Every compile
//! ends with `comemo::evict(2)` (§6.3).

mod diagnostics;
#[doc(hidden)]
pub mod docx;
pub mod math;
pub mod picture;
mod raster;
mod draw;
// Public for native tools (`examples/`), not part of the wasm API.
#[doc(hidden)]
pub mod fonts;
mod islands;
mod js;
#[doc(hidden)]
pub mod positions;
pub(crate) mod text;
#[doc(hidden)]
pub mod world;

use typst::diag::{SourceDiagnostic, Warned};
use typst::foundations::{Dict, Str, Value};
use typst::layout::Dir;
use typst::model::Document;
use wasm_bindgen::prelude::*;

use crate::js::{perf_now, set};
use crate::world::{file_id, MemWorld};

#[wasm_bindgen(typescript_custom_section)]
const TS_TYPES: &'static str = r#"
/** A range `[from, to)` in UTF-16 code units (JS string indices) of a file's text. */
export type Range = { from: number; to: number };
/** One step of the call chain that led to a diagnostic. `span` is in /main.typ, or `null` if the step isn't. */
export type TraceItem = { message: string; span: Range | null };
/**
 * A Typst error or warning, or one of the engine's own (`source: "typstream"`), in the
 * shape of `@typstream/core`'s `Diagnostic` with /main.typ as the document. `span` is in /main.typ: the problem itself, or for a
 * problem in another file the nearest call site in /main.typ (else `null`); `file`
 * then holds the original location. `trace` is innermost first.
 */
export type Diagnostic = {
  severity: "error" | "warning";
  span: Range | null;
  message: string;
  hints: string[];
  trace: TraceItem[];
  file?: { path: string; span: Range | null };
  /** Typst's, or the engine's own: a DOCX export's `docx/fallback` warnings (`code`). */
  source: "typst" | "typstream";
  code?: string;
};
/**
 * What every compile returns. `ms` is the time spent in the call: compile,
 * export and cache eviction. `missingFonts` lists the lazily registered font
 * files (`Engine.register_font` ids) the compile wanted but had no bytes for:
 * it fell back to other fonts or tofu. Load them and compile again.
 */
export type CompileResult = { ok: boolean; diagnostics: Diagnostic[]; ms: number; missingFonts: number[] };
/** An HTML compile (`compile_html`): `html` is the document when `ok`. */
export type HtmlResult = CompileResult & { html?: string };
/**
 * A run of text on a page, for a selectable text layer: the glyphs are paths in
 * the SVG. Points, from the page's top left. `(x, y)` is the start of the
 * baseline; `width` is the run's advance and `size` its font size. `matrix`
 * (`[a, b, c, d]` of an SVG matrix, translation in `x`/`y`) is set only when
 * the text is rotated, skewed or scaled. `lang` and `dir` are set only when
 * they differ from the page's; `dir` is the direction the run was shaped in,
 * unset for a run of one character without a strong direction.
 */
export type TextRun = {
  text: string;
  x: number;
  y: number;
  size: number;
  width: number;
  matrix?: [number, number, number, number];
  lang?: string;
  dir?: "ltr" | "rtl";
};
/**
 * A structure element around text runs: `[from, to)` indexes the page's runs
 * (empty for an empty cell). `role` is an ARIA role; headings have their
 * `aria-level` (Typst's level + 1, as typst-html's `<h2>` for `=`; the
 * document's title is 1). Rows group a table's cells by row.
 */
export type TextNode = {
  role: "heading" | "list" | "listitem" | "table" | "row" | "cell" | "columnheader";
  level?: number;
  from: number;
  to: number;
  children?: TextNode[];
};
/** A link to a URL on a drawn page: the box around its area, in points from the page's top left. */
export type PageLink = { url: string; x: number; y: number; width: number; height: number };
/**
 * A page as drawing operations for a canvas (src/draw.rs describes the format):
 * `ops` holds little-endian 32-bit floats, `strings` what they name (colours,
 * path data, image URLs), `glyphs` the outlines they draw as `[key, path]` in
 * font units (one key, one outline, on every page).
 */
export type PageDrawing = {
  ops: Uint8Array;
  strings: string[];
  glyphs: [string, string][];
  links: PageLink[];
};
/**
 * One exported page. `hash` (32 hex digits) identifies the page's content: equal
 * hashes mean identical pages. `width` and `height` are in Typst points. `svg`
 * is the page as typst-svg writes it, or empty when the page comes as a
 * `drawing` instead. `text` lists the page's text runs as Typst laid them out,
 * `structure` the elements around them. `lang` is the document's language as
 * typst-html writes it (`ar`, `zh-CN`) and `dir` its direction.
 */
export type ChangedPage = {
  index: number;
  hash: string;
  width: number;
  height: number;
  svg: string;
  drawing?: PageDrawing;
  text: TextRun[];
  structure: TextNode[];
  lang: string;
  dir: "ltr" | "rtl";
};
/**
 * An island marker (PLAN §8.4): a `metadata` labelled `<typstream-island>`, at
 * `page` (from 0), `(x, y)` in points from the page's top left. `value` is its
 * value without `source`, as JSON; `from` is the UTF-16 offset in /main.typ of
 * `source`, content the document wrote, or `null`.
 */
export type IslandMarker = { page: number; x: number; y: number; value: string; from: number | null };
/**
 * `changed` holds only the pages whose content changed since the last successful
 * call (all of them after `reset_pages`); indices refer to the new document.
 * Pages at or past `pageCount` are gone. `islands` lists every island marker,
 * whichever pages changed.
 */
export type SvgChangedResult = CompileResult & {
  pageCount?: number;
  changed?: ChangedPage[];
  islands?: IslandMarker[];
  /** With `positions`: every page's, changed or not. */
  positions?: PagePositions[];
  compileMs: number;
  exportMs: number;
};
/**
 * Where a page's source was laid out (src/positions.rs), for an editor on the pages: `glyphs` holds a glyph cluster
 * per 8 little-endian 32-bit floats (x, baseline y, advance, ascent, descent, from, to, flags), `from`/`to` its
 * UTF-16 range in /main.typ or -1, `flags` 1 = exactly its characters (text or math in markup), 2 = math, 4 = shaped
 * right to left. `elements` are the elements laid out on the page that show some of /main.typ: `from`/`to` what they
 * cover of it, `node` their own source if /main.typ made them, `depth` how many elements they are in, (`x`, `y`)
 * where they start and (`endX`, `endY`) end, `box` around what is drawn inside them (x, y, width, height). `kind` is
 * the element function's name, `cell` for a table or grid cell (`cell` its column and row), `item-body` and
 * `item-label` for a list item's parts.
 */
export type PagePositions = {
  glyphs: Uint8Array;
  elements: {
    kind: string;
    from: number;
    to: number;
    node?: [number, number];
    depth: number;
    x: number;
    y: number;
    endX?: number;
    endY?: number;
    box?: [number, number, number, number];
    cell?: [number, number];
  }[];
};
/** A paged compile without export (`check_paged`). */
export type CheckResult = CompileResult & { pageCount?: number };
/**
 * A paged compile read into a DOCX document model (`compile_docx_model`): `model` is `@typstream/docx`'s
 * `DocxModel` as JSON, `fonts` the data of the faces it names and `pictures` the pictures it refers to, in its
 * order. Free-form content a picture holds (a box with rounded corners) is a `docx/fallback` warning.
 */
export type DocxModelResult = CompileResult & {
  model?: string;
  fonts?: Uint8Array[];
  pictures?: DocxPictureData[];
  pageCount?: number;
};
/** A picture of a DOCX model (#133): what Word draws, and the PNG older Word and other apps draw instead. */
export interface DocxPictureData {
  /** The picture as SVG, as typst-svg writes a page. */
  svg: string;
  /** The picture as PNG, at 300 DPI (less for one bigger than a page). */
  png: Uint8Array;
}
"#;

#[cfg(feature = "pdf")]
#[wasm_bindgen(typescript_custom_section)]
const TS_PDF_TYPES: &'static str = r#"
/** A paged compile exported to PDF (`compile_pdf`). */
export type PdfResult = CompileResult & { pdf?: Uint8Array; pageCount?: number };
"#;

/// How many evict calls an unused memoized result survives. Eviction counts
/// calls, not time, and the cache is global to the wasm instance. Phase 0:
/// with `evict(2)` after every compile memory stays flat (27-34 MiB over 200
/// compiles of a growing document) and compiles get faster; without it, it
/// grows ~4 MiB per compile.
const EVICT_MAX_AGE: usize = 2;

/// A Typst project in memory: source and binary files, `sys.inputs`. Compile
/// it with `compile_html` or `compile_svg_changed`. Engines in one wasm
/// instance share their fonts, Typst's memoization cache and the wasm memory.
#[wasm_bindgen]
pub struct Engine {
    world: MemWorld,
    /// Hashes of the pages as of the last successful `compile_svg_changed`.
    page_hashes: Vec<u128>,
}

impl Engine {
    fn result(
        &self,
        ok: bool,
        errors: &[SourceDiagnostic],
        warnings: &[SourceDiagnostic],
    ) -> js_sys::Object {
        let obj = js_sys::Object::new();
        set(&obj, "ok", ok);
        set(
            &obj,
            "diagnostics",
            diagnostics::to_js_array(&self.world, errors, warnings),
        );
        let missing: js_sys::Array = self
            .world
            .missing_fonts()
            .into_iter()
            .map(JsValue::from)
            .collect();
        set(&obj, "missingFonts", missing);
        obj
    }
}

/// Ends a compile: evicts the memoization cache and records the elapsed time.
fn finish(obj: js_sys::Object, t0: f64) -> JsValue {
    comemo::evict(EVICT_MAX_AGE);
    set(&obj, "ms", perf_now() - t0);
    obj.into()
}

fn path_id(path: &str) -> Result<typst::syntax::FileId, JsError> {
    file_id(path).ok_or_else(|| JsError::new(&format!("invalid virtual path: {path}")))
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::new_without_default)]
    pub fn new() -> Engine {
        Engine {
            world: MemWorld::new(),
            page_hashes: Vec::new(),
        }
    }

    /// Adds a font file (TTF, OTF or TTC) for every engine in the instance.
    /// Returns its number of faces. Adding a file again does nothing.
    pub fn add_font(bytes: &[u8]) -> u32 {
        fonts::add(bytes)
    }

    /// The metadata Typst keeps about each face of a font file, as JSON, for
    /// `register_font`. Computed at build time for a font registry.
    pub fn font_info(bytes: &[u8]) -> String {
        fonts::info(bytes)
    }

    /// Registers a font file from its `font_info` without its bytes, for every
    /// engine in the instance. Typst can select its faces by family and for
    /// fallback; a compile that does lists the returned id in `missingFonts`
    /// until `load_font` gives it the bytes. Throws on invalid info.
    pub fn register_font(info: &str) -> Result<u32, JsError> {
        fonts::register(info).map_err(|e| JsError::new(&e))
    }

    /// Gives a registered font file its bytes. Throws unless they are the file
    /// its info came from. Loading a file again does nothing.
    pub fn load_font(id: u32, bytes: &[u8]) -> Result<(), JsError> {
        fonts::load(id, bytes).map_err(|e| JsError::new(&e))
    }

    /// Sets a source file. `/main.typ` is the entry point. A path such as
    /// `@preview/cetz:0.5.3/src/lib.typ` is a file of that package (its spec,
    /// then the path inside it). Throws on an invalid path.
    pub fn set_source(&mut self, path: &str, text: &str) -> Result<(), JsError> {
        self.world.set_source(path_id(path)?, text);
        Ok(())
    }

    /// Sets a binary file (images, data, a package's `typst.toml` or wasm
    /// plugins). Paths as in `set_source`. Throws on an invalid path.
    pub fn set_file(&mut self, path: &str, bytes: &[u8]) -> Result<(), JsError> {
        self.world.set_file(path_id(path)?, bytes);
        Ok(())
    }

    /// Removes a source or binary file. `/main.typ` can't be removed.
    pub fn remove_file(&mut self, path: &str) -> Result<(), JsError> {
        self.world.remove_file(path_id(path)?);
        Ok(())
    }

    /// Sets `sys.inputs`. Throws unless every value is a string, as with the
    /// CLI's `--input key=value`.
    pub fn set_inputs(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "Record<string, string>")] inputs: js_sys::Object,
    ) -> Result<(), JsError> {
        let mut dict = Dict::new();
        for entry in js_sys::Object::entries(&inputs).iter() {
            let entry: js_sys::Array = entry.unchecked_into();
            let key = entry.get(0).as_string().unwrap_or_default();
            let value = entry
                .get(1)
                .as_string()
                .ok_or_else(|| JsError::new(&format!("sys.inputs.{key} must be a string")))?;
            dict.insert(
                Str::from(key.as_str()),
                Value::Str(Str::from(value.as_str())),
            );
        }
        self.world.set_inputs(dict);
        Ok(())
    }

    /// Compiles with the HTML target.
    #[wasm_bindgen(unchecked_return_type = "HtmlResult")]
    pub fn compile_html(&mut self) -> JsValue {
        let t0 = perf_now();
        self.world.begin_compile();
        let Warned { output, warnings } = typst::compile::<typst_html::HtmlDocument>(&self.world);
        let obj = match output
            .and_then(|doc| typst_html::html(&doc, &typst_html::HtmlOptions::default()))
        {
            Ok(html) => {
                let obj = self.result(true, &[], &warnings);
                set(&obj, "html", html);
                obj
            }
            Err(errors) => self.result(false, &errors, &warnings),
        };
        finish(obj, t0)
    }

    /// Compiles paged and exports SVG for the pages whose content changed since
    /// the last successful call. Pages are compared by `hash128` (frames cache
    /// their hashes, so this is cheap). A failed compile keeps the old hashes,
    /// so the next success diffs against what is on screen.
    ///
    /// With `drawings`, a page comes as a `drawing` for a canvas instead (its
    /// `svg` empty), unless it has something the drawing can't express
    /// (gradients, tilings, colour glyphs): that page is still SVG.
    ///
    /// With `positions`, the result also says where the source was laid out on
    /// every page, changed or not (positions.rs): an edit moves the offsets of
    /// the text after it, on pages that look the same.
    #[wasm_bindgen(unchecked_return_type = "SvgChangedResult")]
    pub fn compile_svg_changed(&mut self, drawings: Option<bool>, positions: Option<bool>) -> JsValue {
        let t0 = perf_now();
        self.world.begin_compile();
        let Warned { output, warnings } =
            typst::compile::<typst_layout::PagedDocument>(&self.world);
        let compile_ms = perf_now() - t0;
        let obj = match output {
            Ok(doc) => {
                let t1 = perf_now();
                let options = typst_svg::SvgOptions::default();
                let locale = doc.info().locale.unwrap_or_default();
                let lang = locale.rfc_3066();
                let dir = locale.lang.dir();
                let mut open = text::OpenElements::new();
                let changed = js_sys::Array::new();
                let mut hashes = Vec::with_capacity(doc.pages().len());
                for (index, page) in doc.pages().iter().enumerate() {
                    let hash = typst::utils::hash128(page);
                    if self.page_hashes.get(index) != Some(&hash) {
                        let entry = js_sys::Object::new();
                        set(&entry, "index", index as f64);
                        set(&entry, "hash", format!("{hash:032x}"));
                        set(&entry, "width", page.frame.width().to_pt());
                        set(&entry, "height", page.frame.height().to_pt());
                        match drawings.unwrap_or(false).then(|| draw::page_drawing(page)).flatten() {
                            Some(drawing) => {
                                set(&entry, "svg", "");
                                set(&entry, "drawing", drawing);
                            }
                            None => set(&entry, "svg", typst_svg::svg(page, &options)),
                        }
                        let begun = open.at(doc.pages(), index);
                        let text = text::page_text(page, begun, &lang, dir);
                        set(&entry, "text", text.runs);
                        set(&entry, "structure", text.structure);
                        set(&entry, "lang", lang.as_str());
                        set(&entry, "dir", if dir == Dir::RTL { "rtl" } else { "ltr" });
                        changed.push(&entry);
                    }
                    hashes.push(hash);
                }
                self.page_hashes = hashes;
                let obj = self.result(true, &[], &warnings);
                set(&obj, "pageCount", doc.pages().len() as f64);
                set(&obj, "changed", changed);
                set(&obj, "islands", islands::islands(&self.world, &doc));
                if positions.unwrap_or(false) {
                    let all: js_sys::Array = doc
                        .pages()
                        .iter()
                        .map(|page| {
                            let p = positions::page_positions(&self.world, page);
                            let entry = js_sys::Object::new();
                            let bytes: Vec<u8> = p.glyphs.iter().flat_map(|v| v.to_le_bytes()).collect();
                            set(&entry, "glyphs", js_sys::Uint8Array::from(bytes.as_slice()));
                            let elements: js_sys::Array = p.elements.iter().map(|e| e.to_js()).collect();
                            set(&entry, "elements", elements);
                            JsValue::from(entry)
                        })
                        .collect();
                    set(&obj, "positions", all);
                }
                set(&obj, "exportMs", perf_now() - t1);
                obj
            }
            Err(errors) => {
                let obj = self.result(false, &errors, &warnings);
                set(&obj, "exportMs", 0.0);
                obj
            }
        };
        set(&obj, "compileMs", compile_ms);
        finish(obj, t0)
    }

    /// Compiles paged without exporting anything: diagnostics and the page
    /// count, for validating a document (`@typstream/node`'s `validate`). It
    /// leaves the `compile_svg_changed` baseline alone.
    #[wasm_bindgen(unchecked_return_type = "CheckResult")]
    pub fn check_paged(&mut self) -> JsValue {
        let t0 = perf_now();
        self.world.begin_compile();
        let Warned { output, warnings } =
            typst::compile::<typst_layout::PagedDocument>(&self.world);
        let obj = match output {
            Ok(doc) => {
                let obj = self.result(true, &[], &warnings);
                set(&obj, "pageCount", doc.pages().len() as f64);
                obj
            }
            Err(errors) => self.result(false, &errors, &warnings),
        };
        finish(obj, t0)
    }

    /// Forgets the page hashes, so the next `compile_svg_changed` sends every
    /// page (a new document, or the renderer lost its DOM).
    pub fn reset_pages(&mut self) {
        self.page_hashes.clear();
    }

    /// Compiles paged and exports PDF. Only in builds with the `pdf` feature (the default).
    #[cfg(feature = "pdf")]
    #[wasm_bindgen(unchecked_return_type = "PdfResult")]
    pub fn compile_pdf(&mut self) -> JsValue {
        let t0 = perf_now();
        self.world.begin_compile();
        let Warned { output, warnings } =
            typst::compile::<typst_layout::PagedDocument>(&self.world);
        let exported = output.and_then(|doc| {
            typst_pdf::pdf(&doc, &typst_pdf::PdfOptions::default())
                .map(|pdf| (pdf, doc.pages().len()))
        });
        let obj = match exported {
            Ok((bytes, pages)) => {
                let obj = self.result(true, &[], &warnings);
                set(&obj, "pdf", js_sys::Uint8Array::from(bytes.as_slice()));
                set(&obj, "pageCount", pages as f64);
                obj
            }
            Err(errors) => self.result(false, &errors, &warnings),
        };
        finish(obj, t0)
    }

    /// Compiles paged and reads the pages into the document model a DOCX export is written from (docx.rs, #131).
    /// The source should end with `docx_margin_probe()`, which records the page margins.
    #[wasm_bindgen(unchecked_return_type = "DocxModelResult")]
    pub fn compile_docx_model(&mut self) -> JsValue {
        let t0 = perf_now();
        self.world.begin_compile();
        self.world.set_docx(true);
        let Warned { output, warnings } =
            typst::compile::<typst_layout::PagedDocument>(&self.world);
        self.world.set_docx(false);
        let obj = match output {
            Ok(doc) => {
                let model = docx::model(&doc);
                let obj = self.result(true, &[], &warnings);
                set(&obj, "model", model.json);
                let fonts: js_sys::Array = model
                    .fonts
                    .iter()
                    .map(|data| JsValue::from(js_sys::Uint8Array::from(data.as_slice())))
                    .collect();
                set(&obj, "fonts", fonts);
                let pictures: js_sys::Array = model
                    .pictures
                    .iter()
                    .map(|p| {
                        let entry = js_sys::Object::new();
                        set(&entry, "svg", p.svg.as_str());
                        set(&entry, "png", js_sys::Uint8Array::from(p.png.as_slice()));
                        JsValue::from(entry)
                    })
                    .collect();
                set(&obj, "pictures", pictures);
                if let Ok(list) = js_sys::Reflect::get(&obj, &"diagnostics".into()) {
                    let list: js_sys::Array = list.into();
                    for (span, what) in &model.fallbacks {
                        list.push(&diagnostics::fallback(&self.world, *span, what));
                    }
                }
                set(&obj, "pageCount", doc.pages().len() as f64);
                obj
            }
            Err(errors) => self.result(false, &errors, &warnings),
        };
        finish(obj, t0)
    }

    /// Typst source a DOCX export appends to the document: it records the page margins, which laid-out pages
    /// don't keep, for `compile_docx_model`.
    pub fn docx_margin_probe() -> String {
        docx::MARGIN_PROBE.to_string()
    }

    /// The optional features in this build: always "html", "svg" and "docx" (its model), plus "pdf"
    /// when built with it.
    pub fn features() -> Vec<String> {
        let mut features = vec!["html".to_string(), "svg".to_string(), "docx".to_string()];
        if cfg!(feature = "pdf") {
            features.push("pdf".into());
        }
        features
    }

    /// Size of the wasm linear memory in bytes. Shared by all engines in the
    /// instance, and a high-water mark: wasm memory never shrinks.
    pub fn memory_bytes() -> f64 {
        #[cfg(target_arch = "wasm32")]
        {
            (core::arch::wasm32::memory_size(0) * 65536) as f64
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            0.0
        }
    }
}
