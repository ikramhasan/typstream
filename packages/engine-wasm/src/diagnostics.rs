//! Typst diagnostics as plain JS objects, in the shape of `@typstream/core`'s
//! `Diagnostic` (PLAN.md §6.1) with `/main.typ` as the document. Spans are
//! UTF-16 ranges, so JS can slice its own strings with them.

use typst::diag::{Severity, SourceDiagnostic};
use typst::syntax::{DiagSpan, FileId};
use typst::{World, WorldExt};
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

/// `{ severity, span, message, hints, trace, file?, source: "typst" }`:
/// - `span` is in the main source: the diagnostic's own range there, or for a
///   problem in another file the nearest call site in main (from the trace),
///   else `null`;
/// - `file: { path, span }` is the original location when it isn't main;
/// - trace items carry a span only where they are in main.
fn to_js(world: &MemWorld, diag: &SourceDiagnostic) -> JsValue {
    let main = world.main();
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

    // Innermost first, as Typst records them.
    let trace: Vec<(String, Option<JsValue>)> = diag
        .trace
        .iter()
        .map(|point| {
            let span = match locate(world, point.span.into()) {
                Some((id, range)) if id == main => range,
                _ => None,
            };
            (point.v.to_string(), span)
        })
        .collect();

    let span = match locate(world, diag.span) {
        Some((id, range)) if id == main => range,
        Some((id, range)) => {
            let file = js_sys::Object::new();
            set(&file, "path", file_path(id));
            set(&file, "span", range.unwrap_or(JsValue::NULL));
            set(&obj, "file", file);
            trace.iter().find_map(|(_, span)| span.clone())
        }
        None => None,
    };
    set(&obj, "span", span.unwrap_or(JsValue::NULL));

    let js_trace = js_sys::Array::new();
    for (message, span) in trace {
        let item = js_sys::Object::new();
        set(&item, "message", message);
        set(&item, "span", span.unwrap_or(JsValue::NULL));
        js_trace.push(&item);
    }
    set(&obj, "trace", js_trace);
    set(&obj, "source", "typst");
    obj.into()
}

/// The file a span points into, and its `{ from, to }` range in UTF-16 units
/// when that can be mapped (not inside a binary file, say). `None` for
/// detached spans.
fn locate(world: &MemWorld, span: DiagSpan) -> Option<(FileId, Option<JsValue>)> {
    let id = span.id()?;
    let range = world.range(span).and_then(|range| {
        let from = world.utf16_offset(id, range.start)?;
        let to = world.utf16_offset(id, range.end)?;
        let obj = js_sys::Object::new();
        set(&obj, "from", from as f64);
        set(&obj, "to", to as f64);
        Some(JsValue::from(obj))
    });
    Some((id, range))
}
