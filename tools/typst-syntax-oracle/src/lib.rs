//! Typst 0.15.1's real parser as a test oracle for `@typstream/heal`.
//!
//! `check(text)` returns JSON `{ "errors": [{ "message", "start", "end" }], "warnings": n }`
//! with UTF-16 offsets (JavaScript string indices). `tree(text)` returns the
//! debug-printed syntax tree for failure messages. `lex(text, mode)` runs
//! Typst's lexer alone in one mode and returns its tokens as JSON
//! `[{ "kind", "start", "end", "error"? }]` (UTF-16 offsets). `modes(text)`
//! returns the lexer mode of every non-trivia token of the parsed text as
//! `[{ "start", "mode" }]`, mode one of markup, math, code and raw.

use typst_syntax::{parse, LinkedNode, SyntaxKind, SyntaxMode, SyntaxNode};
use wasm_bindgen::prelude::*;

// Typst's lexer is private to typst-syntax; build.rs copies its source here.
// It refers to `crate::{SyntaxKind, SyntaxMode, SyntaxNode}`, imported above.
#[allow(dead_code, clippy::all)]
mod lexer {
    include!(concat!(env!("OUT_DIR"), "/lexer.rs"));
}

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

#[wasm_bindgen]
pub fn lex(text: &str, mode: &str) -> String {
    let mode = match mode {
        "markup" => SyntaxMode::Markup,
        "math" => SyntaxMode::Math,
        "code" => SyntaxMode::Code,
        _ => panic!("unknown mode {mode}"),
    };
    let map = utf16_index(text);
    let mut lexer = lexer::Lexer::new(text, mode);
    let mut tokens = Vec::new();
    loop {
        let start = lexer.cursor();
        let (kind, node): (SyntaxKind, SyntaxNode) = lexer.next();
        if kind == SyntaxKind::End {
            break;
        }
        let mut token = serde_json::json!({
            "kind": format!("{kind:?}"),
            "start": map[start],
            "end": map[lexer.cursor()],
        });
        if kind == SyntaxKind::Error {
            let (errors, _) = node.errors_and_warnings();
            token["error"] = errors.first().map(|e| e.message.to_string()).unwrap_or_default().into();
        }
        tokens.push(token);
    }
    serde_json::Value::Array(tokens).to_string()
}

fn is_trivia(kind: SyntaxKind) -> bool {
    matches!(
        kind,
        SyntaxKind::Space | SyntaxKind::Parbreak | SyntaxKind::LineComment | SyntaxKind::BlockComment | SyntaxKind::Shebang
    )
}

/// The mode each token was lexed in, read off the tree: the nearest Markup, Math
/// or Code node decides, and an expression right after `#` is code. Two
/// delimiters are lexed in the mode they close: a content block's `]` (markup)
/// and an equation's closing `$` (math). So is the `;` that may end an embedded
/// expression (code), even after a space. Raw text and math field access are one
/// token each.
fn collect_modes(node: &LinkedNode, mode: &'static str, map: &[usize], out: &mut Vec<serde_json::Value>) {
    let mut push = |offset: usize, mode: &str| out.push(serde_json::json!({ "start": map[offset], "mode": mode }));
    match node.kind() {
        SyntaxKind::Raw => return push(node.offset(), "raw"),
        SyntaxKind::MathFieldAccess => return push(node.offset(), mode),
        kind if node.children().len() == 0 => {
            // Empty inner nodes (`[]`'s Markup, `$$`'s Math) are no tokens.
            if !is_trivia(kind) && node.len() > 0 {
                push(node.offset(), mode);
            }
            return;
        }
        _ => {}
    }
    let inner = match node.kind() {
        SyntaxKind::Markup => "markup",
        SyntaxKind::Math => "math",
        SyntaxKind::Code => "code",
        _ => mode,
    };
    let mut after_hash = false;
    let mut after_embedded = false;
    let count = node.children().len();
    for (i, child) in node.children().enumerate() {
        let last = i + 1 == count;
        let child_mode = match (node.kind(), child.kind()) {
            (SyntaxKind::ContentBlock, SyntaxKind::RightBracket) if last => "markup",
            (SyntaxKind::Equation, SyntaxKind::Dollar) if last && i > 0 => "math",
            _ if after_hash => "code",
            (_, SyntaxKind::Semicolon) if after_embedded => "code",
            _ => inner,
        };
        collect_modes(&child, child_mode, map, out);
        // A statement's `;` may follow trivia (`#import "m": a ;`); a bare `#` may not.
        if !is_trivia(child.kind()) {
            after_embedded = after_hash;
        }
        after_hash = child.kind() == SyntaxKind::Hash;
    }
}

#[wasm_bindgen]
pub fn modes(text: &str) -> String {
    let root = parse(text);
    let map = utf16_index(text);
    let mut out = Vec::new();
    collect_modes(&LinkedNode::new(&root), "markup", &map, &mut out);
    serde_json::Value::Array(out).to_string()
}
