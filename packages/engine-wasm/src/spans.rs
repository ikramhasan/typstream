//! Where an HTML compile's text came from in `/main.typ`, for an editor over
//! the HTML target (`@typstream/plate`): typing into the HTML must become an
//! edit of the Typst that made it.
//!
//! typst-html keeps a span on every text node (`HtmlNode::Text`) and element.
//! Before encoding, each text node whose span is in `/main.typ` is wrapped in
//! `<typstream-text data-src="from to">`, the UTF-16 range of the source it
//! shows, and each element from `/main.typ` (a `<strong>` from `*…*`, an `<h2>`
//! from `=`) gets `data-typstream-span="from to"`, its node's range.
//! `@typstream/dom` takes the wrappers and attributes off again when it parses
//! the HTML, so the document lays out as it does without them.
//!
//! Text in markup is a `Text` node, which typst-html cuts at whitespace into
//! pieces with the node's span (convert.rs, `handle_text`): a piece's range is
//! where it is in its node, found from where the last piece ended. Anything
//! else (a space, a smart quote, a shorthand, a string in code) has its whole
//! node's range; the editor tells which ranges show their text exactly.

use std::collections::HashMap;

use typst::syntax::{FileId, Source, Span, SyntaxKind};
use typst::World;
use typst_html::{HtmlAttr, HtmlElement, HtmlNode, HtmlTag};

use crate::world::MemWorld;

/// Elements whose text is raw (CSS, scripts) or not shown: their text stays as it is.
const RAW: [&str; 5] = ["style", "script", "textarea", "title", "head"];

struct Marker<'a> {
    world: &'a MemWorld,
    main: FileId,
    source: Source,
    /// For a `Text` node cut into pieces: how far into it (bytes) the last piece ended.
    cursors: HashMap<Span, usize>,
    text: HtmlTag,
    src: HtmlAttr,
    span: HtmlAttr,
    anchor: HtmlTag,
}

impl Marker<'_> {
    fn utf16(&self, byte: usize) -> Option<usize> {
        self.world.utf16_offset(self.main, byte)
    }

    /// `"from to"` in UTF-16, from a byte range of `/main.typ`.
    fn range(&self, from: usize, to: usize) -> Option<String> {
        Some(format!("{} {}", self.utf16(from)?, self.utf16(to)?))
    }

    /// The range a text node shows: its piece of a `Text` node, or its whole node.
    fn text_range(&mut self, text: &str, span: Span) -> Option<String> {
        if span.id() != Some(self.main) {
            return None;
        }
        let node = self.source.find(span)?;
        let range = node.range();
        if node.kind() == SyntaxKind::Text {
            let cursor = self.cursors.entry(span).or_insert(0);
            if let Some(at) = node
                .get()
                .leaf_text()
                .get(*cursor..)
                .and_then(|rest| rest.find(text))
            {
                let from = range.start + *cursor + at;
                *cursor += at + text.len();
                return self.range(from, from + text.len());
            }
        }
        self.range(range.start, range.end)
    }

    fn element(&mut self, element: &mut HtmlElement) {
        if RAW.iter().any(|tag| element.tag == HtmlTag::constant(tag)) {
            return;
        }
        if element.span.id() == Some(self.main) && element.tag != self.anchor {
            if let Some(range) = self
                .source
                .find(element.span)
                .map(|n| n.range())
                .and_then(|r| self.range(r.start, r.end))
            {
                element.attrs.push(self.span, range);
            }
        }
        // A span typst-html made to keep whitespace (`pre_span`) escapes its spaces, which a wrapper's text wouldn't:
        // its text, whitespace, stays as it is.
        if element.children.is_empty() || element.pre_span {
            return;
        }
        for child in element.children.make_mut() {
            match child {
                HtmlNode::Element(inner) => self.element(inner),
                HtmlNode::Text(text, span) => {
                    let Some(range) = self.text_range(text, *span) else {
                        continue;
                    };
                    let mut wrapper = HtmlElement::new(self.text);
                    wrapper.attrs.push(self.src, range);
                    wrapper.children.push(HtmlNode::Text(text.clone(), *span));
                    *child = HtmlNode::Element(wrapper);
                }
                _ => {}
            }
        }
    }
}

/// Marks where `root`'s text and elements came from in `/main.typ` (see the module docs).
pub fn mark(world: &MemWorld, root: &mut HtmlElement) {
    let main = world.main();
    let Ok(source) = world.source(main) else {
        return;
    };
    let (Ok(text), Ok(src), Ok(span), Ok(anchor)) = (
        HtmlTag::intern("typstream-text"),
        HtmlAttr::intern("data-src"),
        HtmlAttr::intern("data-typstream-span"),
        HtmlTag::intern("typstream-anchor"),
    ) else {
        return;
    };
    let mut marker = Marker {
        world,
        main,
        source,
        cursors: HashMap::new(),
        text,
        src,
        span,
        anchor,
    };
    marker.element(root);
}
