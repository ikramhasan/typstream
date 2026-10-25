//! typstream Phase 0 spike: minimal wasm-bindgen wrapper around Typst 0.15.1.
//!
//! Exposes an `Engine` class with an in-memory `World` (virtual files + fonts as
//! bytes, fixed `today()`, no packages / network / filesystem).

use std::collections::HashMap;

use typst::diag::{FileError, FileResult, Severity, SourceDiagnostic, Warned};
use typst::foundations::{Bytes, Datetime, Dict, Str, Value};
use typst::syntax::{DiagSpan, FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Feature, Library, LibraryExt, World, WorldExt};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = performance, js_name = now)]
    fn perf_now() -> f64;
}

const MAIN_PATH: &str = "/main.typ";

#[wasm_bindgen(typescript_custom_section)]
const TS_TYPES: &'static str = r#"
/** `start`/`end` are UTF-8 byte offsets into /main.typ, present only when the span is in main.
 *  `file` is set instead when the span points into another virtual file (no offsets then). */
export type Diag = { severity: "error" | "warning"; message: string; hints: string[]; start?: number; end?: number; file?: string };
export type HtmlResult = { ok: boolean; html?: string; diagnostics: Diag[]; ms: number };
export type SvgResult = { ok: boolean; pages?: string[]; diagnostics: Diag[]; ms: number };
/** Only pages whose frame hash changed since the previous successful call. */
export type SvgChangedResult = { ok: boolean; pageCount?: number; changed?: { index: number; svg: string }[]; diagnostics: Diag[]; ms: number; compileMs: number; exportMs: number };
export type PdfResult = { ok: boolean; pdf?: Uint8Array; diagnostics: Diag[]; ms: number };
"#;

fn file_id(path: &str) -> Option<FileId> {
    let vpath = VirtualPath::new(path).ok()?;
    Some(RootedPath::new(VirtualRoot::Project, vpath).intern())
}

fn build_library(inputs: Dict) -> LazyHash<Library> {
    LazyHash::new(
        Library::builder()
            .with_inputs(inputs)
            .with_features([Feature::Html].into_iter().collect())
            .build(),
    )
}

/// In-memory world. Sources are kept across compiles and updated with
/// `Source::replace` so comemo / the reparser can reuse work.
struct MemWorld {
    library: LazyHash<Library>,
    book: LazyHash<FontBook>,
    fonts: Vec<Font>,
    main: FileId,
    sources: HashMap<FileId, Source>,
    files: HashMap<FileId, Bytes>,
}

impl World for MemWorld {
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }
    fn book(&self) -> &LazyHash<FontBook> {
        &self.book
    }
    fn main(&self) -> FileId {
        self.main
    }
    fn source(&self, id: FileId) -> FileResult<Source> {
        match self.sources.get(&id) {
            Some(s) => Ok(s.clone()),
            None => Err(not_found(id)),
        }
    }
    fn file(&self, id: FileId) -> FileResult<Bytes> {
        if let Some(b) = self.files.get(&id) {
            return Ok(b.clone());
        }
        if let Some(s) = self.sources.get(&id) {
            return Ok(Bytes::from_string(s.text().to_string()));
        }
        Err(not_found(id))
    }
    fn font(&self, index: usize) -> Option<Font> {
        self.fonts.get(index).cloned()
    }
    fn today(&self, _offset: Option<typst::foundations::Duration>) -> Option<Datetime> {
        Datetime::from_ymd(2026, 1, 1)
    }
}

fn not_found(id: FileId) -> FileError {
    FileError::NotFound(id.get().vpath().get_with_slash().into())
}

#[wasm_bindgen]
pub struct Engine {
    world: MemWorld,
    /// Frame hashes of the pages sent by the last `compile_svg_changed`.
    page_hashes: Vec<u128>,
}

fn set(obj: &js_sys::Object, key: &str, val: impl Into<JsValue>) {
    let _ = js_sys::Reflect::set(obj, &JsValue::from_str(key), &val.into());
}

impl Engine {
    fn diag_to_js(&self, d: &SourceDiagnostic) -> JsValue {
        let o = js_sys::Object::new();
        set(
            &o,
            "severity",
            match d.severity {
                Severity::Error => "error",
                Severity::Warning => "warning",
            },
        );
        set(&o, "message", d.message.as_str());
        let hints = js_sys::Array::new();
        for h in d.hints.iter() {
            hints.push(&JsValue::from_str(h.v.as_str()));
        }
        set(&o, "hints", hints);
        if let Some((s, e)) = self.main_range(d.span) {
            set(&o, "start", s as f64);
            set(&o, "end", e as f64);
        } else if let Some(id) = d.span.id() {
            set(&o, "file", id.get().vpath().get_with_slash());
        }
        o.into()
    }

    /// Byte range into the main source, if the span points there.
    fn main_range(&self, span: DiagSpan) -> Option<(usize, usize)> {
        if span.id()? != self.world.main {
            return None;
        }
        let r = self.world.range(span)?;
        Some((r.start, r.end))
    }

    fn result(
        &self,
        ok: bool,
        errors: &[SourceDiagnostic],
        warnings: &[SourceDiagnostic],
        t0: f64,
    ) -> js_sys::Object {
        let o = js_sys::Object::new();
        set(&o, "ok", ok);
        let diags = js_sys::Array::new();
        for d in errors.iter().chain(warnings.iter()) {
            diags.push(&self.diag_to_js(d));
        }
        set(&o, "diagnostics", diags);
        set(&o, "ms", perf_now() - t0);
        o
    }

    #[cfg(any(feature = "svg", feature = "pdf"))]
    fn compile_paged(&self) -> Warned<typst::diag::SourceResult<typst_layout::PagedDocument>> {
        typst::compile::<typst_layout::PagedDocument>(&self.world)
    }
}

#[allow(dead_code)]
fn not_built(feature: &str) -> JsValue {
    let o = js_sys::Object::new();
    set(&o, "ok", false);
    let diags = js_sys::Array::new();
    let d = js_sys::Object::new();
    set(&d, "severity", "error");
    set(&d, "message", format!("feature not built: {feature}"));
    set(&d, "hints", js_sys::Array::new());
    diags.push(&d);
    set(&o, "diagnostics", diags);
    set(&o, "ms", 0.0);
    o.into()
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Engine {
        let main = file_id(MAIN_PATH).unwrap();
        let mut sources = HashMap::new();
        sources.insert(main, Source::new(main, String::new()));
        Engine {
            world: MemWorld {
                library: build_library(Dict::new()),
                book: LazyHash::new(FontBook::new()),
                fonts: Vec::new(),
                main,
                sources,
                files: HashMap::new(),
            },
            page_hashes: Vec::new(),
        }
    }

    /// Add a font file (TTF/OTF/TTC). Returns the number of faces added.
    pub fn add_font(&mut self, bytes: &[u8]) -> u32 {
        let data = Bytes::new(bytes.to_vec());
        let mut n = 0;
        let mut book = FontBook::from_fonts(self.world.fonts.iter());
        for font in Font::iter(data) {
            book.push(font.info().clone());
            self.world.fonts.push(font);
            n += 1;
        }
        self.world.book = LazyHash::new(book);
        n
    }

    /// Set a virtual source file. `/main.typ` is the entry point. Existing
    /// sources are updated in place via `Source::replace` (incremental).
    pub fn set_source(&mut self, path: &str, text: &str) -> Result<(), JsError> {
        let id = file_id(path).ok_or_else(|| JsError::new("invalid path"))?;
        match self.world.sources.get_mut(&id) {
            Some(src) => {
                src.replace(text);
            }
            None => {
                self.world.sources.insert(id, Source::new(id, text.to_string()));
            }
        }
        Ok(())
    }

    /// Set a binary virtual file (images, data files, ...).
    pub fn set_file(&mut self, path: &str, bytes: &[u8]) -> Result<(), JsError> {
        let id = file_id(path).ok_or_else(|| JsError::new("invalid path"))?;
        self.world.files.insert(id, Bytes::new(bytes.to_vec()));
        Ok(())
    }

    /// Remove a virtual file (source or binary).
    pub fn remove_file(&mut self, path: &str) {
        if let Some(id) = file_id(path) {
            if id != self.world.main {
                self.world.sources.remove(&id);
            }
            self.world.files.remove(&id);
        }
    }

    /// `sys.inputs` as a JSON object. Non-string values are stringified.
    pub fn set_inputs(&mut self, json: &str) -> Result<(), JsError> {
        let map: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(json).map_err(|e| JsError::new(&e.to_string()))?;
        let dict: Dict = map
            .into_iter()
            .map(|(k, v)| {
                let s = match v {
                    serde_json::Value::String(s) => s,
                    other => other.to_string(),
                };
                (Str::from(k.as_str()), Value::Str(Str::from(s.as_str())))
            })
            .collect();
        self.world.library = build_library(dict);
        Ok(())
    }

    /// Compile with the HTML target. `{ ok, html?, diagnostics, ms }`.
    #[wasm_bindgen(unchecked_return_type = "HtmlResult")]
    pub fn compile_html(&self) -> JsValue {
        let t0 = perf_now();
        let Warned { output, warnings } =
            typst::compile::<typst_html::HtmlDocument>(&self.world);
        match output.and_then(|doc| {
            typst_html::html(&doc, &typst_html::HtmlOptions::default())
        }) {
            Ok(html) => {
                let o = self.result(true, &[], &warnings, t0);
                set(&o, "html", html);
                o.into()
            }
            Err(errors) => self.result(false, &errors, &warnings, t0).into(),
        }
    }

    /// Compile paged and render every page to SVG. `{ ok, pages?, diagnostics, ms }`.
    #[cfg(feature = "svg")]
    #[wasm_bindgen(unchecked_return_type = "SvgResult")]
    pub fn compile_svg(&self) -> JsValue {
        let t0 = perf_now();
        let Warned { output, warnings } = self.compile_paged();
        match output {
            Ok(doc) => {
                let opts = typst_svg::SvgOptions::default();
                let pages = js_sys::Array::new();
                for page in doc.pages() {
                    pages.push(&JsValue::from_str(&typst_svg::svg(page, &opts)));
                }
                let o = self.result(true, &[], &warnings, t0);
                set(&o, "pages", pages);
                o.into()
            }
            Err(errors) => self.result(false, &errors, &warnings, t0).into(),
        }
    }

    #[cfg(not(feature = "svg"))]
    #[wasm_bindgen(unchecked_return_type = "SvgResult")]
    pub fn compile_svg(&self) -> JsValue {
        not_built("svg")
    }

    /// Compile paged and export SVG only for pages whose content changed since
    /// the last successful call. Pages are compared by `hash128` of the page
    /// (frames cache their hashes, so this is cheap). A failed compile keeps
    /// the previous hashes, so the next success diffs against what's on screen.
    #[cfg(feature = "svg")]
    #[wasm_bindgen(unchecked_return_type = "SvgChangedResult")]
    pub fn compile_svg_changed(&mut self) -> JsValue {
        let t0 = perf_now();
        let Warned { output, warnings } = self.compile_paged();
        let compile_ms = perf_now() - t0;
        match output {
            Ok(doc) => {
                let t1 = perf_now();
                let opts = typst_svg::SvgOptions::default();
                let changed = js_sys::Array::new();
                let mut hashes = Vec::with_capacity(doc.pages().len());
                for (i, page) in doc.pages().iter().enumerate() {
                    let h = typst::utils::hash128(page);
                    if self.page_hashes.get(i) != Some(&h) {
                        let entry = js_sys::Object::new();
                        set(&entry, "index", i as f64);
                        set(&entry, "svg", typst_svg::svg(page, &opts));
                        changed.push(&entry);
                    }
                    hashes.push(h);
                }
                self.page_hashes = hashes;
                let export_ms = perf_now() - t1;
                let o = self.result(true, &[], &warnings, t0);
                set(&o, "pageCount", doc.pages().len() as f64);
                set(&o, "changed", changed);
                set(&o, "compileMs", compile_ms);
                set(&o, "exportMs", export_ms);
                o.into()
            }
            Err(errors) => {
                let o = self.result(false, &errors, &warnings, t0);
                set(&o, "compileMs", compile_ms);
                set(&o, "exportMs", 0.0);
                o.into()
            }
        }
    }

    #[cfg(not(feature = "svg"))]
    #[wasm_bindgen(unchecked_return_type = "SvgChangedResult")]
    pub fn compile_svg_changed(&mut self) -> JsValue {
        not_built("svg")
    }

    /// Forget the page hashes so the next `compile_svg_changed` sends every page
    /// (new document, or the renderer lost its DOM).
    pub fn reset_pages(&mut self) {
        self.page_hashes.clear();
    }

    /// Compile paged and export PDF. `{ ok, pdf?: Uint8Array, diagnostics, ms }`.
    #[cfg(feature = "pdf")]
    #[wasm_bindgen(unchecked_return_type = "PdfResult")]
    pub fn compile_pdf(&self) -> JsValue {
        let t0 = perf_now();
        let Warned { output, warnings } = self.compile_paged();
        match output.and_then(|doc| typst_pdf::pdf(&doc, &typst_pdf::PdfOptions::default())) {
            Ok(bytes) => {
                let o = self.result(true, &[], &warnings, t0);
                set(&o, "pdf", js_sys::Uint8Array::from(bytes.as_slice()));
                o.into()
            }
            Err(errors) => self.result(false, &errors, &warnings, t0).into(),
        }
    }

    #[cfg(not(feature = "pdf"))]
    #[wasm_bindgen(unchecked_return_type = "PdfResult")]
    pub fn compile_pdf(&self) -> JsValue {
        not_built("pdf")
    }

    /// Evict memoization cache entries older than `max_age` compilations.
    pub fn evict(&self, max_age: u32) {
        comemo::evict(max_age as usize);
    }

    /// Current wasm linear memory size in bytes.
    pub fn memory_bytes(&self) -> f64 {
        #[cfg(target_arch = "wasm32")]
        {
            (core::arch::wasm32::memory_size(0) * 65536) as f64
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            0.0
        }
    }

    /// Which optional features this build contains.
    pub fn features() -> Vec<String> {
        let mut v = vec!["html".to_string()];
        if cfg!(feature = "svg") {
            v.push("svg".into());
        }
        if cfg!(feature = "pdf") {
            v.push("pdf".into());
        }
        v
    }
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}
