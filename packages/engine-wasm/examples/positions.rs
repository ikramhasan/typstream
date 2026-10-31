//! Dumps where a document's source was laid out (src/positions.rs): glyph clusters with their UTF-16 ranges in the
//! document, and the elements it made. A native tool for the editor (#36):
//! `cargo run --release --example positions -- doc.typ [--packages DIR] [--input k=v]`.

mod common;

use typstream_engine_wasm::positions::{page_positions, GLYPH_STRIDE};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (main, fonts, packages, inputs) = common::options(&args);
    let o = common::Options { main: &main, fonts: &fonts, packages: packages.as_deref(), inputs, docx: false };
    let text = std::fs::read_to_string(&main).unwrap();
    let units: Vec<u16> = text.encode_utf16().collect();
    let (world, doc) = common::compile(&o);
    let doc = doc.expect("compile");
    for (i, page) in doc.pages().iter().enumerate() {
        println!("== page {}", i + 1);
        let p = page_positions(&world, page);
        for g in p.glyphs.chunks(GLYPH_STRIDE) {
            let (from, to) = (g[5] as i64, g[6] as i64);
            let src = if from >= 0 { String::from_utf16_lossy(&units[from as usize..to as usize]) } else { String::new() };
            println!(
                "glyph x {:.1} y {:.1} w {:.1} a {:.1} d {:.1} [{from},{to}) {:?} flags {}",
                g[0], g[1], g[2], g[3], g[4], src, g[7]
            );
        }
        for e in &p.elements {
            let (from, to) = e.covers.unwrap();
            let src = String::from_utf16_lossy(&units[from as usize..(to as usize).min(units.len())]);
            let src: String = src.chars().take(40).collect();
            let bbox = e.bbox.map(|b| (b.min.x.to_pt(), b.min.y.to_pt(), b.max.x.to_pt(), b.max.y.to_pt()));
            println!(
                "{}{} [{from},{to}) node {:?} {:?} box {:.1?} cell {:?}",
                "  ".repeat(e.depth), e.kind, e.node, src, bbox, e.cell
            );
        }
    }
}
