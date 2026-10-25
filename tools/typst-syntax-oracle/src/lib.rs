//! Typst 0.15.1's real parser as a test oracle for `@typstream/heal`.
//!
//! `check(text)` returns JSON `{ "errors": [{ "message", "start", "end" }], "warnings": n }`
//! with UTF-16 offsets (JavaScript string indices). `tree(text)` returns the
//! debug-printed syntax tree for failure messages.

use typst_syntax::{parse, LinkedNode, SyntaxKind};
use wasm_bindgen::prelude::*;

/// Maps UTF-8 byte offsets to UTF-16 code unit offsets.
fn utf16_index(text: &str) -> Vec<usize> {
    let mut map = vec![0; text.len() + 1];
    let mut u16 = 0;
    for (byte, ch) in text.char_indices() {
        for i in 0..ch.len_utf8() {
            map[byte + i] = u16;
        }
        u16 += ch.len_utf16();
    }
    map[text.len()] = u16;
    map
}

fn collect(node: &LinkedNode, map: &[usize], out: &mut Vec<serde_json::Value>) {
    if node.kind() == SyntaxKind::Error {
        let (errors, _) = node.get().errors_and_warnings();
        let message = errors.first().map(|e| e.message.to_string()).unwrap_or_default();
        out.push(serde_json::json!({
            "message": message,
            "start": map[node.offset()],
            "end": map[node.offset() + node.len()],
        }));
        return;
    }
    for child in node.children() {
        collect(&child, map, out);
    }
}

#[wasm_bindgen]
pub fn check(text: &str) -> String {
    let root = parse(text);
    let map = utf16_index(text);
    let mut errors = Vec::new();
    collect(&LinkedNode::new(&root), &map, &mut errors);
    let (_, warnings) = root.errors_and_warnings();
    serde_json::json!({ "errors": errors, "warnings": warnings.len() }).to_string()
}

#[wasm_bindgen]
pub fn tree(text: &str) -> String {
    format!("{:#?}", parse(text))
}
