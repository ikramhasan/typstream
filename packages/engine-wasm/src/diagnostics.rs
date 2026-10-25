//! Typst diagnostics as plain JS objects (the `Diagnostic` type in the `.d.ts`).
//! Spans become a file path plus a UTF-16 range, so JS can slice its own
//! strings with them.

use typst::diag::{Severity, SourceDiagnostic};
use typst::syntax::DiagSpan;
use typst::WorldExt;
use wasm_bindgen::JsValue;

use crate::js::{set, string_array};
use crate::world::{file_path, MemWorld};

/// Typst emits this on every HTML compile (no span, three hints). It says
/// nothing about the document, so it is dropped.
const HTML_EXPERIMENTAL: &str = "html export is under active development";

fn is_noise(diag: &SourceDiagnostic) -> bool {
    diag.severity == Severity::Warning && diag.message.starts_with(HTML_EXPERIMENTAL)
}

/// Errors first, then warnings, without the noise.
pub fn to_js_array(
    world: &MemWorld,
    errors: &[SourceDiagnostic],
    warnings: &[SourceDiagnostic],
) -> js_sys::Array {
    let out = js_sys::Array::new();
    for diag in errors.iter().chain(warnings).filter(|d| !is_noise(d)) {
        out.push(&to_js(world, diag));
    }
    out
}

fn to_js(world: &MemWorld, diag: &SourceDiagnostic) -> JsValue {
    let obj = js_sys::Object::new();
    let severity = match diag.severity {
        Severity::Error => "error",
        Severity::Warning => "warning",
    };
    set(&obj, "severity", severity);
    set(&obj, "message", diag.message.as_str());
    // Hint spans (secondary code locations) are dropped; only the text is kept.
    set(
        &obj,
        "hints",
        string_array(diag.hints.iter().map(|h| h.v.as_str())),
    );
    locate(world, diag.span, &obj);
    let trace = js_sys::Array::new();
    for point in &diag.trace {
        let entry = js_sys::Object::new();
        set(&entry, "message", point.v.to_string());
        locate(world, point.span.into(), &entry);
        trace.push(&entry);
    }
    set(&obj, "trace", trace);
    obj.into()
}

/// Sets `file` and `span: { from, to }` (UTF-16) on `obj` where the span
/// allows: detached spans get neither, and a range that can't be converted
/// (e.g. inside a binary file) gets only `file`.
fn locate(world: &MemWorld, span: DiagSpan, obj: &js_sys::Object) {
    let Some(id) = span.id() else { return };
    set(obj, "file", file_path(id));
    let Some(range) = world.range(span) else {
        return;
    };
    let (Some(from), Some(to)) = (
        world.utf16_offset(id, range.start),
        world.utf16_offset(id, range.end),
    ) else {
        return;
    };
    let js_span = js_sys::Object::new();
    set(&js_span, "from", from as f64);
    set(&js_span, "to", to as f64);
    set(obj, "span", js_span);
}
