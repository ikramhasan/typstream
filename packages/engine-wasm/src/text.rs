//! The text drawn on a page, for the renderer's selectable text layer (#14).
//!
//! typst-svg draws glyphs as `<use>`s of outline paths, so an SVG page has no
//! text a browser can select, search or read aloud. This walks the page frame
//! the way typst-svg does (`render_frame`, `render_group`) and returns each
//! `TextItem` with where it sits on the page, so the renderer can lay invisible
//! text over the glyphs.

use typst::layout::{Abs, Frame, FrameItem, Point, Transform};
use typst_layout::Page;
use wasm_bindgen::prelude::*;

use crate::js::set;

/// Rounds to 1/100 pt: invisible text doesn't need more, and it keeps the
/// numbers short when they cross the worker boundary as JSON.
fn round(v: Abs) -> f64 {
    (v.to_pt() * 100.0).round() / 100.0
}

fn ratio(v: f64) -> f64 {
    (v * 10_000.0).round() / 10_000.0
}

/// The text runs of a page, in document order: `TextRun[]` (see `TS_TYPES`).
pub fn text_runs(page: &Page) -> js_sys::Array {
    let runs = js_sys::Array::new();
    walk(&runs, &page.frame, Transform::identity());
    runs
}

fn walk(runs: &js_sys::Array, frame: &Frame, ts: Transform) {
    for (pos, item) in frame.items() {
        let ts = ts.pre_concat(Transform::translate(pos.x, pos.y));
        match item {
            FrameItem::Group(group) => walk(runs, &group.frame, ts.pre_concat(group.transform)),
            FrameItem::Text(text) => {
                // Shaping can produce runs of only spaces or default ignorables.
                if text.text.trim().is_empty() {
                    continue;
                }
                let origin = Point::zero().transform(ts);
                let run = js_sys::Object::new();
                set(&run, "text", text.text.as_str());
                set(&run, "x", round(origin.x));
                set(&run, "y", round(origin.y));
                set(&run, "size", round(text.size));
                set(&run, "width", round(text.width()));
                // Only rotated, skewed or scaled text needs the linear part.
                if !ts.is_only_translate() {
                    let matrix: js_sys::Array =
                        [ts.sx.get(), ts.ky.get(), ts.kx.get(), ts.sy.get()]
                            .into_iter()
                            .map(|v| JsValue::from_f64(ratio(v)))
                            .collect();
                    set(&run, "matrix", matrix);
                }
                runs.push(&run);
            }
            FrameItem::Shape(..)
            | FrameItem::Image(..)
            | FrameItem::Link(..)
            | FrameItem::Tag(_) => {}
        }
    }
}
