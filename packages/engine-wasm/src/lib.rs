//! @typstream/engine-wasm: Typst 0.15.1 compiled to wasm (PLAN.md §6.1).
//!
//! An `Engine` holds an in-memory World (fonts and virtual files as bytes,
//! `sys.inputs`) and compiles it to HTML, or to SVG for the pages that changed
//! since the last call. Every compile ends with `comemo::evict(2)` (§6.3).

mod diagnostics;
mod js;
mod world;

use typst::diag::{SourceDiagnostic, Warned};
use typst::foundations::{Dict, Str, Value};
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
 * A Typst error or warning, in the shape of `@typstream/core`'s `Diagnostic` with
 * /main.typ as the document. `span` is in /main.typ: the problem itself, or for a
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
  source: "typst";
};
/** `ms` is the time spent in the call: compile, export and cache eviction. */
export type HtmlResult = { ok: boolean; html?: string; diagnostics: Diagnostic[]; ms: number };
/**
 * `changed` holds only the pages whose content changed since the last successful
 * call (all of them after `reset_pages`); indices refer to the new document.
 * Pages at or past `pageCount` are gone.
 */
export type SvgChangedResult = {
  ok: boolean;
  pageCount?: number;
  changed?: { index: number; svg: string }[];
  diagnostics: Diagnostic[];
  ms: number;
  compileMs: number;
  exportMs: number;
};
/** A paged compile without export (`check_paged`). */
export type CheckResult = { ok: boolean; pageCount?: number; diagnostics: Diagnostic[]; ms: number };
"#;

#[cfg(feature = "pdf")]
#[wasm_bindgen(typescript_custom_section)]
const TS_PDF_TYPES: &'static str = r#"
export type PdfResult = { ok: boolean; pdf?: Uint8Array; pageCount?: number; diagnostics: Diagnostic[]; ms: number };
"#;

/// How many evict calls an unused memoized result survives. Eviction counts
/// calls, not time, and the cache is global to the wasm instance. Phase 0:
/// with `evict(2)` after every compile memory stays flat (27-34 MiB over 200
/// compiles of a growing document) and compiles get faster; without it, it
/// grows ~4 MiB per compile.
const EVICT_MAX_AGE: usize = 2;

/// A Typst project in memory: fonts, source and binary files, `sys.inputs`.
/// Compile it with `compile_html` or `compile_svg_changed`. Engines in one
/// wasm instance share Typst's memoization cache and the wasm memory.
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

    /// Adds a font file (TTF, OTF or TTC). Returns the number of faces added.
    pub fn add_font(&mut self, bytes: &[u8]) -> u32 {
        self.world.add_font(bytes)
    }

    /// Sets a source file. `/main.typ` is the entry point. Throws on an
    /// invalid path.
    pub fn set_source(&mut self, path: &str, text: &str) -> Result<(), JsError> {
        self.world.set_source(path_id(path)?, text);
        Ok(())
    }

    /// Sets a binary file (images, data). Throws on an invalid path.
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
    pub fn compile_html(&self) -> JsValue {
        let t0 = perf_now();
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
    #[wasm_bindgen(unchecked_return_type = "SvgChangedResult")]
    pub fn compile_svg_changed(&mut self) -> JsValue {
        let t0 = perf_now();
        let Warned { output, warnings } =
            typst::compile::<typst_layout::PagedDocument>(&self.world);
        let compile_ms = perf_now() - t0;
        let obj = match output {
            Ok(doc) => {
                let t1 = perf_now();
                let options = typst_svg::SvgOptions::default();
                let changed = js_sys::Array::new();
                let mut hashes = Vec::with_capacity(doc.pages().len());
                for (index, page) in doc.pages().iter().enumerate() {
                    let hash = typst::utils::hash128(page);
                    if self.page_hashes.get(index) != Some(&hash) {
                        let entry = js_sys::Object::new();
                        set(&entry, "index", index as f64);
                        set(&entry, "svg", typst_svg::svg(page, &options));
                        changed.push(&entry);
                    }
                    hashes.push(hash);
                }
                self.page_hashes = hashes;
                let obj = self.result(true, &[], &warnings);
                set(&obj, "pageCount", doc.pages().len() as f64);
                set(&obj, "changed", changed);
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
    pub fn check_paged(&self) -> JsValue {
        let t0 = perf_now();
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

    /// Compiles paged and exports PDF. Only in builds with the `pdf` feature.
    #[cfg(feature = "pdf")]
    #[wasm_bindgen(unchecked_return_type = "PdfResult")]
    pub fn compile_pdf(&self) -> JsValue {
        let t0 = perf_now();
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

    /// The optional features in this build: always "html" and "svg", plus "pdf"
    /// when built with it.
    pub fn features() -> Vec<String> {
        let mut features = vec!["html".to_string(), "svg".to_string()];
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
