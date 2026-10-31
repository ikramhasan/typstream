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
//! Elements: Typst 0.15 tags nearly every element it lays out (`FrameItem::Tag`,
//! what introspection and PDF tagging use), so each element on the page comes
//! with the box around everything drawn inside it and the range of `/main.typ`
//! it covers: its own node's, if `/main.typ` made it, and what the glyphs and
//! elements inside it came from. A plugin's component made in its package (an
//! edu question: a `context` around a grid) covers the document text written
//! into it, so the editor finds the component's whole box, its numbering and
//! points included, as the outermost element covering only that call. Where
//! elements start also places a caret where there is no glyph: an empty table
//! cell. Table cells give their place in the grid.
//!
//! Glyphs are written as little-endian 32-bit floats, `GLYPH_STRIDE` a glyph,
//! as `draw.rs` writes drawings: thousands of objects would cost more to make
//! and to send than the numbers. Offsets are exact in a float up to 2^24.

use std::ops::Range;

use typst::foundations::{Content, StyleChain};
use typst::introspection::{Location, Tag};
use typst::layout::{Abs, Frame, FrameItem, Point, Rect, Size, Transform};
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
    /// In the order they start: only those that cover some of `/main.typ`.
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
        open: Vec::new(),
    };
    walker.walk(&page.frame, Transform::identity());
    PagePositions {
        glyphs: walker.glyphs,
        elements: walker.elements.into_iter().filter(|e| e.covers.is_some()).collect(),
    }
}

/// An element laid out on the page (see the module docs).
pub struct Element {
    /// The element function's name (`heading`, `table`, `context`), `cell` for a table cell.
    pub kind: &'static str,
    /// The UTF-16 range of its own node in `/main.typ`, if `/main.typ` made it.
    pub node: Option<(f32, f32)>,
    /// The UTF-16 range of `/main.typ` it covers: its node and what is drawn inside it.
    pub covers: Option<(f32, f32)>,
    /// How many elements it is inside on this page.
    pub depth: usize,
    /// Where its tags are: it starts, and ends if that is on this page.
    pub start: Point,
    pub end: Option<Point>,
    /// The box around what is drawn inside it, if anything is.
    pub bbox: Option<Rect>,
    loc: Option<Location>,
    /// A table cell's column and row.
    pub cell: Option<(usize, usize)>,
}

impl Element {
    /// `{ kind, from, to, x, y, depth, node?, endX?, endY?, box?, cell? }`: `from`/`to` what it covers.
    pub fn to_js(&self) -> wasm_bindgen::JsValue {
        let obj = js_sys::Object::new();
        let (from, to) = self.covers.unwrap_or((-1.0, -1.0));
        set(&obj, "kind", self.kind);
        set(&obj, "from", from as f64);
        set(&obj, "to", to as f64);
        set(&obj, "x", round(self.start.x));
        set(&obj, "y", round(self.start.y));
        set(&obj, "depth", self.depth as f64);
        if let Some((from, to)) = self.node {
            set(&obj, "node", pair(from as f64, to as f64));
        }
        if let Some(end) = self.end {
            set(&obj, "endX", round(end.x));
            set(&obj, "endY", round(end.y));
        }
        if let Some(b) = self.bbox {
            let arr = js_sys::Array::new();
            for v in [b.min.x, b.min.y, b.max.x - b.min.x, b.max.y - b.min.y] {
                arr.push(&round(v).into());
            }
            set(&obj, "box", arr);
        }
        if let Some((col, row)) = self.cell {
            set(&obj, "cell", pair(col as f64, row as f64));
        }
        obj.into()
    }
}

fn pair(a: f64, b: f64) -> js_sys::Array {
    let arr = js_sys::Array::new();
    arr.push(&a.into());
    arr.push(&b.into());
    arr
}

fn round(v: Abs) -> f64 {
    (v.to_pt() * 100.0).round() / 100.0
}

fn union(range: &mut Option<(f32, f32)>, from: f32, to: f32) {
    *range = Some(match *range {
        Some((a, b)) => (a.min(from), b.max(to)),
        None => (from, to),
    });
}

struct Walker<'a> {
    spans: Spans<'a>,
    glyphs: Vec<f32>,
    elements: Vec<Element>,
    /// Indices of the elements started and not ended yet, outermost first.
    open: Vec<usize>,
}

impl Walker<'_> {
    fn walk(&mut self, frame: &Frame, ts: Transform) {
        for (pos, item) in frame.items() {
            let ts = ts.pre_concat(Transform::translate(pos.x, pos.y));
            match item {
                FrameItem::Group(group) => self.walk(&group.frame, ts.pre_concat(group.transform)),
                FrameItem::Text(text) => self.text(text, ts),
                FrameItem::Tag(Tag::Start(elem, _)) => self.start(elem, Point::zero().transform(ts)),
                FrameItem::Tag(Tag::End(loc, ..)) => self.end(loc, Point::zero().transform(ts)),
                FrameItem::Shape(shape, _) => self.drawn(shape.bbox(true), ts),
                FrameItem::Image(_, size, _) => self.drawn(Rect::new(Point::zero(), size.to_point()), ts),
                FrameItem::Link(..) => {}
            }
        }
    }

    /// Something was drawn over `rect` (in the frame's coordinates): it's inside every open element.
    fn drawn(&mut self, rect: Rect, ts: Transform) {
        let corners = [
            rect.min,
            Point::new(rect.max.x, rect.min.y),
            Point::new(rect.min.x, rect.max.y),
            rect.max,
        ]
        .map(|p| p.transform(ts));
        let min = corners.iter().fold(corners[0], |a, p| Point::new(a.x.min(p.x), a.y.min(p.y)));
        let max = corners.iter().fold(corners[0], |a, p| Point::new(a.x.max(p.x), a.y.max(p.y)));
        for &i in &self.open {
            let e = &mut self.elements[i];
            e.bbox = Some(match e.bbox {
                Some(b) => Rect::new(
                    Point::new(b.min.x.min(min.x), b.min.y.min(min.y)),
                    Point::new(b.max.x.max(max.x), b.max.y.max(max.y)),
                ),
                None => Rect::new(min, max),
            });
        }
    }

    /// `/main.typ`'s `[from, to)` was drawn: every open element covers it.
    fn covered(&mut self, from: f32, to: f32) {
        for &i in &self.open {
            union(&mut self.elements[i].covers, from, to);
        }
    }

    fn start(&mut self, elem: &Content, at: Point) {
        let kind = if let Some(marker) = elem.to_packed::<PdfMarkerTag>() {
            match marker.kind {
                PdfMarkerTagKind::ListItemBody | PdfMarkerTagKind::TermsItemBody => "item-body",
                PdfMarkerTagKind::ListItemLabel => "item-label",
                _ => "marker",
            }
        } else if elem.is::<TableCell>() {
            "cell"
        } else {
            // The others by their function's name: `heading`, `equation`, `table`, `context`, …
            elem.func().name()
        };
        let node = self
            .spans
            .node(elem.span())
            .map(|(range, _)| (self.spans.utf16(range.start), self.spans.utf16(range.end)));
        let cell = elem.to_packed::<TableCell>().map(|cell| {
            let styles = StyleChain::default();
            (cell.x.get(styles).custom().unwrap_or(0), cell.y.get(styles).custom().unwrap_or(0))
        });
        if let Some((from, to)) = node {
            self.covered(from, to);
        }
        self.elements.push(Element {
            kind,
            node,
            covers: node,
            depth: self.open.len(),
            start: at,
            end: None,
            bbox: None,
            loc: elem.location(),
            cell,
        });
        self.open.push(self.elements.len() - 1);
    }

    fn end(&mut self, loc: &Location, at: Point) {
        // Elements that didn't end before this one end with it.
        if let Some(k) = self.open.iter().rposition(|&i| self.elements[i].loc.as_ref() == Some(loc)) {
            for &i in &self.open[k..] {
                self.elements[i].end.get_or_insert(at);
            }
            self.open.truncate(k);
        }
    }

    fn text(&mut self, text: &TextItem, ts: Transform) {
        let origin = Point::zero().transform(ts);
        // Text scaled or rotated keeps its origin; its advances follow the horizontal scale.
        let scale = ts.sx.get();
        let size = text.size.to_pt();
        let metrics = text.font.metrics();
        let ascent = metrics.ascender.get() * size;
        let descent = -metrics.descender.get() * size;
        let dir_flag = if crate::text::run_dir(text) == Some(typst::layout::Dir::RTL) { RTL } else { 0 };
        let mut x = 0.0;
        let mut i = 0;
        let glyphs = &text.glyphs;
        let mut covered: Option<(f32, f32)> = None;
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
            if from >= 0.0 {
                union(&mut covered, from, to);
            }
            flags |= dir_flag;
            let left = origin.x.to_pt() + x * scale;
            self.glyphs.extend_from_slice(&[
                left as f32,
                origin.y.to_pt() as f32,
                (advance * scale) as f32,
                (ascent * scale) as f32,
                (descent * scale) as f32,
                from,
                to,
                flags as f32,
            ]);
            x += advance;
            i = j;
        }
        if let Some((from, to)) = covered {
            self.covered(from, to);
        }
        let height = Abs::pt(ascent + descent);
        let top = Point::new(Abs::zero(), Abs::pt(-ascent));
        self.drawn(Rect::new(top, top + Size::new(text.width(), height).to_point()), ts);
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
