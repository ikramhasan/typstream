//! A document's DOCX model, fonts and PDF, compiled natively the way the engine exports (#131):
//! `cargo run --release --example docx_model -- doc.typ --out DIR [--packages DIR] [--input k=v]`.
//! Writes DIR/model.json, DIR/font-N.ttf and DIR/typst.pdf (from a compile without the DOCX rule for equations, as
//! the engine's PDF; `--docx-pdf` also writes the DOCX compile's as DIR/typst-docx.pdf, which should look the same).

mod common;

use std::fs;
use std::path::PathBuf;

use typstream_engine_wasm::docx;

fn main() {
    let mut args: Vec<String> = std::env::args().collect();
    let at = args.iter().position(|a| a == "--out").expect("--out DIR");
    let out = PathBuf::from(args.remove(at + 1));
    args.remove(at);
    let docx_pdf = args.iter().any(|a| a == "--docx-pdf");
    args.retain(|a| a != "--docx-pdf");
    let (main, fonts, packages, inputs) = common::options(&args);
    // The export compiles the document with the margin probe after it (beside it, so its assets are found).
    let probed = main.with_extension(format!("probed-{}.typ", std::process::id()));
    fs::write(
        &probed,
        fs::read_to_string(&main).unwrap() + docx::MARGIN_PROBE,
    )
    .unwrap();
    let mut o = common::Options {
        main: &probed,
        fonts: &fonts,
        packages: packages.as_deref(),
        inputs,
        docx: true,
    };
    let (_, doc) = common::compile(&o);
    o.docx = false;
    let (_, plain) = common::compile(&o);
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
    if docx_pdf {
        let pdf = typst_pdf::pdf(&doc, &typst_pdf::PdfOptions::default()).expect("pdf");
        fs::write(out.join("typst-docx.pdf"), pdf).unwrap();
    }
    let plain = plain.expect("compile");
    let pdf = typst_pdf::pdf(&plain, &typst_pdf::PdfOptions::default()).expect("pdf");
    fs::write(out.join("typst.pdf"), pdf).unwrap();
}
