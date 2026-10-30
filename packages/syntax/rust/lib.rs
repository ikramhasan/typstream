//! Typst 0.15.1's parser for `@typstream/syntax` (PLAN §4.1, #36).
//!
//! `parse(text)` returns the lossless syntax tree as a flat array of `u32`s, three per node in
//! pre-order: the kind (`SyntaxKind as u8`), the node's length in UTF-16 code units (JavaScript
//! string indices) and its number of children. The JS side rebuilds offsets from the lengths, so
//! nothing here converts positions. `kind_names()` names the kinds by index, as `SyntaxKind`'s
//! variants are written.

use typst_syntax::{SyntaxKind, SyntaxNode, parse as parse_markup};
use wasm_bindgen::prelude::*;

/// Every kind in declaration order, so `KINDS[k as usize] == k` (checked by `kinds_in_order`).
const KINDS: [SyntaxKind; 137] = {
    use SyntaxKind::*;
    [
        End, Error, Shebang, LineComment, BlockComment, Markup, Text, Space, Linebreak, Parbreak, Escape,
        Shorthand, SmartQuote, Strong, Emph, Raw, RawLang, RawDelim, RawTrimmed, Link, Label, Ref, RefMarker,
        Heading, HeadingMarker, ListItem, ListMarker, EnumItem, EnumMarker, TermItem, TermMarker, Equation,
        Math, MathText, MathIdent, MathFieldAccess, MathShorthand, MathAlignPoint, MathCall, MathArgs,
        MathDelimited, MathAttach, MathPrimes, MathFrac, MathRoot, Hash, LeftBrace, RightBrace, LeftBracket,
        RightBracket, LeftParen, RightParen, Comma, Semicolon, Colon, Star, Underscore, Dollar, Plus, Minus,
        Slash, Hat, Dot, Eq, EqEq, ExclEq, Lt, LtEq, Gt, GtEq, PlusEq, HyphEq, StarEq, SlashEq, Dots, Arrow,
        Root, Bang, Not, And, Or, None, Auto, Let, Set, Show, Context, If, Else, For, In, While, Break,
        Continue, Return, Import, Include, As, Code, Ident, Bool, Int, Float, Numeric, Str, CodeBlock,
        ContentBlock, Parenthesized, Array, Dict, Named, Keyed, Unary, Binary, FieldAccess, FuncCall, Args,
        Spread, Closure, Params, LetBinding, SetRule, ShowRule, Contextual, Conditional, WhileLoop, ForLoop,
        ModuleImport, ImportItems, ImportItemPath, RenamedImportItem, ModuleInclude, LoopBreak, LoopContinue,
        FuncReturn, Destructuring, DestructAssignment,
    ]
};

/// Writes `node` and its descendants; returns its UTF-16 length.
fn flatten(node: &SyntaxNode, out: &mut Vec<u32>) -> u32 {
    let at = out.len();
    out.extend_from_slice(&[node.kind() as u32, 0, node.children().len() as u32]);
    let len = if node.children().len() == 0 {
        node.leaf_text().encode_utf16().count() as u32
    } else {
        node.children().map(|child| flatten(child, out)).sum()
    };
    out[at + 1] = len;
    len
}

/// The syntax tree of a Typst document (markup mode), flattened as the module's doc says.
#[wasm_bindgen]
pub fn parse(text: &str) -> Vec<u32> {
    let root = parse_markup(text);
    let mut out = Vec::with_capacity(text.len());
    flatten(&root, &mut out);
    out
}

/// The kinds' names by index (`Markup`, `Text`, `FuncCall`, …).
#[wasm_bindgen]
pub fn kind_names() -> Vec<String> {
    KINDS.iter().map(|kind| format!("{kind:?}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_in_order() {
        for (i, kind) in KINDS.iter().enumerate() {
            assert_eq!(*kind as usize, i);
        }
        assert_eq!(KINDS.len(), SyntaxKind::DestructAssignment as usize + 1);
    }
}
