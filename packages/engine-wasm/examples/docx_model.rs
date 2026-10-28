//! A document's DOCX model, fonts and PDF, compiled natively the way the engine exports (#131):
//! `cargo run --release --example docx_model -- doc.typ --out DIR [--packages DIR] [--input k=v]`.
//! Writes DIR/model.json, DIR/font-N.ttf and DIR/typst.pdf.

mod common;

use std::fs;
use std::path::PathBuf;

use typstream_engine_wasm::docx;

fn main() {
    let mut args: Vec<String> = std::env::args().collect();
    let at = args.iter().position(|a| a == "--out").expect("--out DIR");
    let out = PathBuf::from(args.remove(at + 1));
    args.remove(at);
    let (main, fonts, packages, inputs) = common::options(&args);
    // The export compiles the document with the margin probe after it.
    let probed = std::env::temp_dir().join(format!("docx-model-{}.typ", std::process::id()));
    fs::write(
        &probed,
        fs::read_to_string(&main).unwrap() + docx::MARGIN_PROBE,
    )
    .unwrap();
    let o = common::Options {
        main: &probed,
        fonts: &fonts,
        packages: packages.as_deref(),
        inputs,
    };
    let (_, doc) = common::compile(&o);
    fs::remove_file(&probed).ok();
    let doc = match doc {
        Ok(doc) => doc,
        Err(e) => {
            eprintln!("compile failed: {e}");
            std::process::exit(1);
        }
    };
    fs::create_dir_all(&out).unwrap();
    let model = docx::model(&doc);
    fs::write(out.join("model.json"), &model.json).unwrap();
    for (i, data) in model.fonts.iter().enumerate() {
        fs::write(out.join(format!("font-{i}.ttf")), data).unwrap();
    }
    let pdf = typst_pdf::pdf(&doc, &typst_pdf::PdfOptions::default()).expect("pdf");
    fs::write(out.join("typst.pdf"), pdf).unwrap();
}
