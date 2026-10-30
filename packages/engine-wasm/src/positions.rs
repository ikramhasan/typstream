//! Where the document's source was laid out on a page, for an editor that
//! edits on the pages themselves (#36): its caret, selection and clicks.
//!
//! Glyphs: every glyph cluster drawn, with the range of `/main.typ` it came
//! from. Typst keeps a source location on every glyph (`Glyph::span`: a span
//! and an offset into it). For text in markup (a `Text` node) the offset says
//! which characters the glyph shows, as typst-ide's `jump_from_click` reads it;
//! for anything else (a space, a smart quote, a shorthand, a string in code)
//! the glyph covers its whole node. Glyphs from other files (a package's
//! template, a numbering) have no range: the editor can't type into them.
//!
//! Elements: where elements made by `/main.typ` start and end (their tags, the
//! `FrameItem::Tag`s introspection uses), for what has no glyph to put a caret
//! at: an empty table cell, an empty list item's body. Table cells also give
//! their place in the grid.
//!
//! Glyphs are written as little-endian 32-bit floats, `GLYPH_STRIDE` a glyph,
//! as `draw.rs` writes drawings: thousands of objects would cost more to make
//! and to send than the numbers. Offsets are exact in a float up to 2^24.

use std::ops::Range;

use typst::foundations::{Content, StyleChain};
use typst::introspection::{Location, Tag};
use typst::layout::{Abs, Frame, FrameItem, Point, Transform};
use typst::model::TableCell;
use typst::pdf::{PdfMarkerTag, PdfMarkerTagKind};
use typst::syntax::{FileId, Source, Span, SyntaxKind};
use typst::text::TextItem;
use typst::World;
use typst_layout::Page;

use crate::js::set;
use crate::world::MemWorld;

/// Floats per glyph cluster: x, baseline y, advance, ascent, descent, from, to, flags.
pub const GLYPH_STRIDE: usize = 8;

/// `flags`: the range is exactly the characters drawn (text in markup or math), not a whole node.
const EXACT: u32 = 1;
/// `flags`: math (an equation's glyph).
const MATH: u32 = 2;
/// `flags`: shaped right to left.
const RTL: u32 = 4;

/// Where a page's source went (see the module docs).
pub struct PagePositions {
    pub glyphs: Vec<f32>,
    /// In the order they start.
    pub elements: Vec<Element>,
}

/// Looks up spans in `/main.typ`, remembering the last one: a run's glyphs share their span.
struct Spans<'a> {
    world: &'a MemWorld,
    main: FileId,
    source: Option<Source>,
    last: Option<(Span, Option<(Range<usize>, SyntaxKind)>)>,
}

impl<'a> Spans<'a> {
    fn new(world: &'a MemWorld) -> Self {
        let main = world.main();
        Spans { world, main, source: world.source(main).ok(), last: None }
    }

    /// The byte range and kind of the node `span` points to in `/main.typ`.
    fn node(&mut self, span: Span) -> Option<(Range<usize>, SyntaxKind)> {
        if let Some((last, found)) = &self.last {
            if *last == span {
                return found.clone();
            }
        }
        let found = if span.id() == Some(self.main) {
            let source = self.source.as_ref()?;
            source.find(span).map(|node| (node.range(), node.kind()))
        } else {
            None
        };
        self.last = Some((span, found.clone()));
        found
    }

    fn utf16(&self, byte: usize) -> f32 {
        self.world.utf16_offset(self.main, byte).map_or(-1.0, |o| o as f32)
    }
}

/// The glyphs and elements of `page` (see the module docs).
pub fn page_positions(world: &MemWorld, page: &Page) -> PagePositions {
    let mut walker = Walker {
        spans: Spans::new(world),
        glyphs: Vec::new(),
        elements: Vec::new(),
    };
    walker.walk(&page.frame, Transform::identity());
    PagePositions {
        glyphs: walker.glyphs,
        elements: walker.elements,
    }
}

/// An element `/main.typ` made, where it starts on the page and, if it ends on it, where it ends.
pub struct Element {
    /// The element function's name (`heading`, `table`), `cell` for a table cell, `item-body` for a list item's body.
    pub kind: &'static str,
    /// The UTF-16 range of its node in `/main.typ`.
    pub from: f32,
    pub to: f32,
    pub start: Point,
    pub end: Option<Point>,
    loc: Option<Location>,
    /// A table cell's column and row.
    pub cell: Option<(usize, usize)>,
}

impl Element {
    /// `{ kind, from, to, x, y, endX?, endY?, cell? }`.
    pub fn to_js(&self) -> wasm_bindgen::JsValue {
        let obj = js_sys::Object::new();
        set(&obj, "kind", self.kind);
        set(&obj, "from", self.from as f64);
        set(&obj, "to", self.to as f64);
        set(&obj, "x", round(self.start.x));
        set(&obj, "y", round(self.start.y));
        if let Some(end) = self.end {
            set(&obj, "endX", round(end.x));
            set(&obj, "endY", round(end.y));
        }
        if let Some((col, row)) = self.cell {
            let cell = js_sys::Array::new();
            cell.push(&(col as f64).into());
            cell.push(&(row as f64).into());
            set(&obj, "cell", cell);
        }
        obj.into()
    }
}

fn round(v: Abs) -> f64 {
    (v.to_pt() * 100.0).round() / 100.0
}

struct Walker<'a> {
    spans: Spans<'a>,
    glyphs: Vec<f32>,
    elements: Vec<Element>,
}

impl Walker<'_> {
    fn walk(&mut self, frame: &Frame, ts: Transform) {
        for (pos, item) in frame.items() {
            let ts = ts.pre_concat(Transform::translate(pos.x, pos.y));
            match item {
                FrameItem::Group(group) => self.walk(&group.frame, ts.pre_concat(group.transform)),
                FrameItem::Text(text) => self.text(text, ts),
                FrameItem::Tag(Tag::Start(elem, _)) => self.start(elem, Point::zero().transform(ts)),
                FrameItem::Tag(Tag::End(loc, ..)) => {
                    let at = Point::zero().transform(ts);
                    if let Some(e) = self.elements.iter_mut().rev().find(|e| e.loc.as_ref() == Some(loc)) {
                        e.end.get_or_insert(at);
                    }
                }
                FrameItem::Shape(..) | FrameItem::Image(..) | FrameItem::Link(..) => {}
            }
        }
    }

    fn start(&mut self, elem: &Content, at: Point) {
        let kind = if let Some(marker) = elem.to_packed::<PdfMarkerTag>() {
            match marker.kind {
                PdfMarkerTagKind::ListItemBody | PdfMarkerTagKind::TermsItemBody => "item-body",
                _ => return,
            }
        } else if elem.is::<TableCell>() {
            "cell"
        } else {
            // The others by their function's name: `heading`, `equation`, `table`, …
            elem.func().name()
        };
        let Some((range, _)) = self.spans.node(elem.span()) else { return };
        let cell = elem.to_packed::<TableCell>().map(|cell| {
            let styles = StyleChain::default();
            (cell.x.get(styles).custom().unwrap_or(0), cell.y.get(styles).custom().unwrap_or(0))
        });
        let (from, to) = (self.spans.utf16(range.start), self.spans.utf16(range.end));
        self.elements.push(Element { kind, from, to, start: at, end: None, loc: elem.location(), cell });
    }

    fn text(&mut self, text: &TextItem, ts: Transform) {
        let origin = Point::zero().transform(ts);
        // Text scaled or rotated keeps its origin; its advances follow the horizontal scale.
        let scale = ts.sx.get();
        let size = text.size.to_pt();
        let metrics = text.font.metrics();
        let ascent = (metrics.ascender.get() * size * scale) as f32;
        let descent = (-metrics.descender.get() * size * scale) as f32;
        let dir_flag = if crate::text::run_dir(text) == Some(typst::layout::Dir::RTL) { RTL } else { 0 };
        let mut x = 0.0;
        let mut i = 0;
        let glyphs = &text.glyphs;
        while i < glyphs.len() {
            // A cluster: glyphs sharing their text (a base and its marks, a ligature's parts).
            let first = &glyphs[i];
            let mut advance = 0.0;
            let mut j = i;
            while j < glyphs.len() && glyphs[j].range == first.range {
                advance += glyphs[j].x_advance.at(text.size).to_pt();
                j += 1;
            }
            let (from, to, mut flags) = self.source(first);
            flags |= dir_flag;
            let left = origin.x.to_pt() + x * scale;
            self.glyphs.extend_from_slice(&[
                left as f32,
                origin.y.to_pt() as f32,
                (advance * scale) as f32,
                ascent,
                descent,
                from,
                to,
                flags as f32,
            ]);
            x += advance;
            i = j;
        }
    }

    /// The UTF-16 range of `/main.typ` a glyph shows, and its flags; `-1` when it isn't from `/main.typ`.
    fn source(&mut self, glyph: &typst::text::Glyph) -> (f32, f32, u32) {
        let (span, offset) = glyph.span;
        let Some((range, kind)) = self.spans.node(span) else { return (-1.0, -1.0, 0) };
        match kind {
            SyntaxKind::Text | SyntaxKind::MathText | SyntaxKind::MathIdent => {
                let start = (range.start + usize::from(offset)).min(range.end);
                let end = (start + glyph.range().len()).min(range.end);
                let math = if kind == SyntaxKind::Text { 0 } else { MATH };
                (self.spans.utf16(start), self.spans.utf16(end), EXACT | math)
            }
            _ => (self.spans.utf16(range.start), self.spans.utf16(range.end), 0),
        }
    }
}
