//! Throwaway (#22): engine-wasm's World behind napi-rs, so the same Typst
//! compiles can be timed natively and in wasm from one Node script. Diagnostics
//! are reduced to messages; the timings are what matter here.

mod world;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::time::Instant;
use typst::diag::{SourceDiagnostic, Warned};
use world::{file_id, MemWorld};

#[napi(object)]
pub struct Output {
    pub ok: bool,
    pub errors: Vec<String>,
    pub html: Option<String>,
    pub page_count: Option<u32>,
    pub svg_bytes: Option<u32>,
    pub pdf: Option<Buffer>,
    pub ms: f64,
}

fn output(ok: bool, errors: &[SourceDiagnostic], t0: Instant) -> Output {
    comemo::evict(2);
    Output {
        ok,
        errors: errors.iter().map(|d| d.message.to_string()).collect(),
        html: None,
        page_count: None,
        svg_bytes: None,
        pdf: None,
        ms: t0.elapsed().as_secs_f64() * 1000.0,
    }
}

#[napi]
pub struct NativeEngine {
    world: MemWorld,
}

#[napi]
impl NativeEngine {
    #[napi(constructor)]
    pub fn new() -> Self {
        NativeEngine { world: MemWorld::new() }
    }

    #[napi]
    pub fn add_font(&mut self, bytes: Buffer) -> u32 {
        self.world.add_font(&bytes)
    }

    #[napi]
    pub fn set_source(&mut self, path: String, text: String) -> Result<()> {
        let id = file_id(&path).ok_or_else(|| Error::from_reason("bad path"))?;
        self.world.set_source(id, &text);
        Ok(())
    }

    #[napi]
    pub fn compile_html(&self) -> Output {
        let t0 = Instant::now();
        let Warned { output: doc, .. } = typst::compile::<typst_html::HtmlDocument>(&self.world);
        match doc.and_then(|d| typst_html::html(&d, &typst_html::HtmlOptions::default())) {
            Ok(html) => Output { html: Some(html), ..output(true, &[], t0) },
            Err(e) => output(false, &e, t0),
        }
    }

    /// Every page as SVG (a server render, not the changed-page stream).
    #[napi]
    pub fn compile_svg(&self) -> Output {
        let t0 = Instant::now();
        let Warned { output: doc, .. } = typst::compile::<typst_layout::PagedDocument>(&self.world);
        match doc {
            Ok(d) => {
                let options = typst_svg::SvgOptions::default();
                let bytes: usize = d.pages().iter().map(|p| typst_svg::svg(p, &options).len()).sum();
                Output {
                    page_count: Some(d.pages().len() as u32),
                    svg_bytes: Some(bytes as u32),
                    ..output(true, &[], t0)
                }
            }
            Err(e) => output(false, &e, t0),
        }
    }

    #[napi]
    pub fn compile_pdf(&self) -> Output {
        let t0 = Instant::now();
        let Warned { output: doc, .. } = typst::compile::<typst_layout::PagedDocument>(&self.world);
        match doc.and_then(|d| typst_pdf::pdf(&d, &typst_pdf::PdfOptions::default())) {
            Ok(bytes) => Output { pdf: Some(bytes.into()), ..output(true, &[], t0) },
            Err(e) => output(false, &e, t0),
        }
    }
}
