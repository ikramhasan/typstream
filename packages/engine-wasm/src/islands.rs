//! Island markers in a laid-out document (PLAN.md §8.4, #28): every
//! `metadata` labelled `<typstream-island>`, with the page and point Typst put
//! it at. The paged view positions interactive components over the drawings
//! they mark from these; positions come from layout, so they hold however the
//! page is drawn.
//!
//! The marker's value is a dictionary (`name`, `data`, `width`, `height`, and
//! `source`); everything but `source` goes to JS as JSON. `source` is content
//! the document wrote (the island function's argument): the metadata itself is
//! made in the package's code, so its span is there, while `source`'s spans are
//! in `/main.typ`, which locates the island in the document.

use std::ops::ControlFlow;

use typst::foundations::{Content, Label, Selector, Value};
use typst::introspection::{Introspector, MetadataElem};
use typst::syntax::Span;
use typst::utils::PicoStr;
use typst::{World, WorldExt};
use typst_layout::PagedDocument;

use crate::js::set;
use crate::world::MemWorld;

/// The label of island markers: `ISLAND_MARKER` in `@typstream/core`.
const LABEL: &str = "typstream-island";

/// The first span in `/main.typ` among `content` and what it holds, as a
/// UTF-16 offset.
fn offset_in_main(world: &MemWorld, content: &Content) -> Option<f64> {
    let main = world.main();
    let found = content.traverse(&mut |c: Content| -> ControlFlow<Span> {
        let span = c.span();
        if span.id() == Some(main) {
            ControlFlow::Break(span)
        } else {
            ControlFlow::Continue(())
        }
    });
    let ControlFlow::Break(span) = found else { return None };
    let range = world.range(span)?;
    world.utf16_offset(main, range.start).map(|o| o as f64)
}

/// `{ page, x, y, value, from }` per marker, in document order: `page` from
/// 0, `x` and `y` in points from the page's top left, `value` the marker's
/// value without `source` as JSON, `from` the UTF-16 offset of `source` in
/// `/main.typ` or `null`.
pub fn islands(world: &MemWorld, doc: &PagedDocument) -> js_sys::Array {
    let out = js_sys::Array::new();
    let Some(label) = Label::new(PicoStr::intern(LABEL)) else {
        return out;
    };
    let introspector = doc.introspector();
    for elem in introspector.query(&Selector::Label(label)).iter() {
        let Some(meta) = elem.to_packed::<MetadataElem>() else {
            continue;
        };
        let (Some(location), Value::Dict(dict)) = (elem.location(), &meta.value) else {
            continue;
        };
        let Some(position) = introspector.position(location) else {
            continue;
        };
        let mut value = dict.clone();
        let from = match value.take("source") {
            Ok(Value::Content(source)) => offset_in_main(world, &source),
            _ => None,
        };
        let Ok(json) = serde_json::to_string(&Value::Dict(value)) else {
            continue;
        };
        let entry = js_sys::Object::new();
        set(&entry, "page", (position.page.get() - 1) as f64);
        set(&entry, "x", position.point.x.to_pt());
        set(&entry, "y", position.point.y.to_pt());
        set(&entry, "value", json);
        match from {
            Some(from) => set(&entry, "from", from),
            None => set(&entry, "from", wasm_bindgen::JsValue::NULL),
        }
        out.push(&entry);
    }
    out
}
