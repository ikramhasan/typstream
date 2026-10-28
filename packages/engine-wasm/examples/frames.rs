//! Dumps a document's laid-out frames: items, positions, tags. A native tool for
//! working on the DOCX model (#131): `cargo run --release --example frames -- doc.typ [--packages DIR] [--input k=v]`.

mod common;

use typst::introspection::Tag;
use typst::layout::{Frame, FrameItem, Point, Transform};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (main, fonts, packages, inputs) = common::options(&args);
    let o = common::Options {
        main: &main,
        fonts: &fonts,
        packages: packages.as_deref(),
        inputs,
    };
    let doc = common::compile(&o).1.expect("compile");
    for (i, page) in doc.pages().iter().enumerate() {
        println!("== page {} {:?}", i + 1, page.frame.size());
        dump(&page.frame, Transform::identity(), 1);
    }
}

fn dump(frame: &Frame, ts: Transform, depth: usize) {
    let pad = "  ".repeat(depth);
    for (pos, item) in frame.items() {
        let ts = ts.pre_concat(Transform::translate(pos.x, pos.y));
        let at = Point::zero().transform(ts);
        let xy = format!("({:.2},{:.2})", at.x.to_pt(), at.y.to_pt());
        match item {
            FrameItem::Group(g) => {
                println!(
                    "{pad}group {xy} size {:.2}x{:.2}{}",
                    g.frame.width().to_pt(),
                    g.frame.height().to_pt(),
                    if g.clip.is_some() { " clip" } else { "" }
                );
                dump(&g.frame, ts.pre_concat(g.transform), depth + 1);
            }
            FrameItem::Text(t) => println!(
                "{pad}text {xy} {:?} {} {:.2}pt w{:.2} fill {:?}",
                t.text.as_str(),
                t.font.info().family,
                t.size.to_pt(),
                t.width().to_pt(),
                t.fill
            ),
            FrameItem::Shape(s, _) => println!(
                "{pad}shape {xy} {:?} fill {:?} stroke {:?}",
                s.geometry,
                s.fill,
                s.stroke
                    .as_ref()
                    .map(|s| (s.thickness.to_pt(), s.paint.clone()))
            ),
            FrameItem::Image(_, size, _) => println!(
                "{pad}image {xy} {:.2}x{:.2}",
                size.x.to_pt(),
                size.y.to_pt()
            ),
            FrameItem::Link(dest, size) => println!(
                "{pad}link {xy} {:?} {:.2}x{:.2}",
                dest,
                size.x.to_pt(),
                size.y.to_pt()
            ),
            FrameItem::Tag(Tag::Start(elem, _)) => println!("{pad}<{} {xy}", elem.func().name()),
            FrameItem::Tag(Tag::End(loc, ..)) => println!("{pad}</ {:?}", loc),
        }
    }
}
