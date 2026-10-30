//! The document model a DOCX export is written from (#131): sections, paragraphs and runs, lists, tables, with the
//! geometry Typst laid them out with, so that a Word-like engine under the same layout profile (#129) breaks lines and
//! pages where Typst did. `@typstream/docx` writes the OOXML.
//!
//! The model comes from the laid-out pages, not from the content: what Typst decided (fonts, sizes, line breaks,
//! positions) is what the DOCX must reproduce. Structure comes from the introspection tags in the frames (as for the
//! text layer, text.rs): paragraphs (`par`, only where a paragraph has blocks around it), headings, lists and their
//! items (typst-layout's label and body markers), tables and grids and their cells, equations, images. Frames don't
//! keep their structure (typst-layout inlines soft frames into their parents), so everything else is geometry:
//!
//! - **Lines** are text items on one baseline; **paragraphs** are the lines between a `par` tag (or a block) and the
//!   next. Text without a `par` tag around it (a cell's, a list item's, a block's) is one paragraph.
//! - **Gaps** between blocks are measured: the space before a block is how far it is below the one before, so
//!   whatever spacing a document or plugin sets carries over. At the top of a page it is what's left after Typst
//!   dropped weak spacing, as Word drops space before there.
//! - **Tables and grids** get their columns from where their cells start (gutters go into the cells' margins), their
//!   borders and fills from the strokes and fills drawn on the cells' edges.
//! - **Blocks** drawn with a frame or a fill (a group whose first item is a rectangle as big as the group, or strokes on
//!   its edges) become one-cell tables.
//! - **Gaps inside a line** (`h()`, blanks drawn as underlined boxes) become exact-width runs; one that ends the line's
//!   last words at the right edge is a right tab, and an outline's dots (a `repeat`) a tab with Word's dot leader.
//!   An outline's entries are paragraphs of their own.
//! - **Equations** are Word math (#132): the DOCX compile marks each with its tree (math.rs), inline ones go in
//!   their line, display ones in a paragraph of their own as tall as Typst set them (with a number, a borderless row
//!   of three cells).
//! - **Pictures** (#133, picture.rs) are what the model can't express otherwise: images, CeTZ canvases, mind maps,
//!   edu's drawings, free-form boxes with rounded corners. A drawing holds its room (a paragraph as tall, an
//!   exact-width gap in a line) so lines and pages break where Typst broke them, and its picture is drawn there; a
//!   `place`d one is anchored to the page.
//!
//! Page margins aren't in the laid-out pages: the export appends a probe that records `page.margin`
//! (`MARGIN_PROBE`), and `auto` margins are resolved as typst-layout does.

use std::collections::{HashMap, HashSet};

use serde_json::{json, Map, Value as Json};
use typst::foundations::{Content, Label, Smart, StyleChain, Value};
use typst::introspection::{Introspector, Location, Tag};
use typst::layout::{
    Abs, Alignment, Dir, Frame, FrameItem, GridCell, HAlignment, PlaceElem, Point, Sides, Size,
    Transform, VAlignment,
};
use typst::model::{Destination, HeadingElem, Numbering, TableCell};
use typst::pdf::{PdfMarkerTag, PdfMarkerTagKind};
use typst::syntax::Span;
use typst::text::{Font, Locale};
use typst::visualize::{Color, CurveItem, FixedStroke, Geometry, Paint, Shape};
use typst_layout::{Page, PagedDocument};

use unicode_bidi::{bidi_class, BidiClass};

use crate::picture::{self, Picture};

/// Appended to a document before a DOCX export: records the page margins where the document ends, inside every
/// template's show rule.
pub const MARGIN_PROBE: &str = "\n#context [#metadata(page.margin) <typstream-docx-margin>]\n";

/// The line pitch of the layout profile, in em.
const PITCH: f64 = 1.3;
/// The profile's text edges, in em: a line box runs from `TOP` above the baseline to `BOTTOM` below it.
const TOP: f64 = 1.054;
const BOTTOM: f64 = 0.246;
/// Room added to a width Typst's lines exactly fill, in points: engines measure text a hair wider (the writer gives
/// table cells as much).
const SLACK: f64 = 1.0;
/// Slack stays this far under a paragraph's fit (how far a next word missed a line): engines measure some lines a
/// hair narrower than Typst too.
const FIT_MARGIN: f64 = 1.0;
/// The fit of a paragraph whose lines Typst was told to break (a code block): no more room moves a word up.
const FORCED_FIT: f64 = 100.0;
/// A block Typst starts a page with gets a page break before it when the page before had more room left than this,
/// in points: Typst moved it on (a heading kept with what follows, a table's header with its first row, a line that
/// didn't quite fit) where an engine measuring a hair shorter wouldn't. A page break before a paragraph that already
/// starts a page adds none.
const PAGE_ROOM: f64 = 1.0;

/// The model as JSON (see `@typstream/docx`'s `DocxModel`), the data of the fonts it names and its pictures, in its
/// order, and what free-form content its pictures hold (for `docx/fallback` warnings).
pub struct Model {
    pub json: String,
    pub fonts: Vec<Vec<u8>>,
    pub pictures: Vec<Picture>,
    pub fallbacks: Vec<(Span, &'static str)>,
}

pub fn model(doc: &PagedDocument) -> Model {
    let pages = doc.pages();
    let margin_value = doc
        .introspector()
        .query_label(Label::new(typst::utils::PicoStr::intern("typstream-docx-margin")).unwrap())
        .ok()
        .and_then(|c| {
            c.to_packed::<typst::introspection::MetadataElem>()
                .map(|m| m.value.clone())
        });
    let mut fonts = Fonts::default();
    let mut items = Vec::new();
    let mut geometry = Vec::new();
    let mut tables = Vec::new();
    let mut seen_cells = HashMap::new();
    let mut repeated = HashSet::new();
    for (i, page) in pages.iter().enumerate() {
        let size = page.frame.size();
        let margin = resolve_margin(margin_value.as_ref(), size);
        geometry.push((size, margin));
        let mut lin = Linearizer {
            page: i,
            items: &mut items,
            tables: &mut tables,
            seen_cells: &mut seen_cells,
            repeated: &mut repeated,
            skipping: None,
            marker: None,
            scripts: Vec::new(),
            size: 11.0,
            pieces: None,
        };
        lin.walk(&page.frame, Transform::identity());
    }
    let _ = &mut fonts;
    let mut builder = Builder {
        items: std::rc::Rc::new(items),
        geometry,
        fonts,
        lists: Vec::new(),
        repeated,
        pictures: Vec::new(),
        picture_json: Vec::new(),
        fallbacks: Vec::new(),
    };
    let sections = builder.sections(pages);
    let json = json!({
        "sections": sections,
        "fonts": builder.fonts.json(),
        "lists": builder.lists,
        "pictures": builder.picture_json,
    });
    Model {
        json: json.to_string(),
        fonts: builder.fonts.data,
        pictures: builder.pictures,
        fallbacks: builder.fallbacks,
    }
}

/// Margins from the probe's value, resolved against the page size; Typst's default (`auto`) otherwise.
fn resolve_margin(value: Option<&Value>, size: Size) -> Sides<f64> {
    let auto = (2.5 / 21.0) * size.x.min(size.y).to_pt();
    let resolve = |v: Option<&Value>, axis: f64| -> Option<f64> {
        match v? {
            Value::Auto => Some(auto),
            Value::Length(l) => Some(l.abs.to_pt() + l.em.get() * 11.0),
            Value::Relative(r) => Some(r.abs.abs.to_pt() + r.rel.get() * axis),
            Value::Ratio(r) => Some(r.get() * axis),
            _ => None,
        }
    };
    let (w, h) = (size.x.to_pt(), size.y.to_pt());
    let mut sides = Sides::splat(auto);
    match value {
        Some(Value::Dict(dict)) => {
            let get = |k: &str| dict.get(k).ok();
            // Typst's order: `rest`, then `x`/`y`, then each side.
            if let Some(v) = resolve(get("rest"), w) {
                sides = Sides::splat(v);
            }
            if let Some(v) = resolve(get("x"), w) {
                sides.left = v;
                sides.right = v;
            }
            if let Some(v) = resolve(get("y"), h) {
                sides.top = v;
                sides.bottom = v;
            }
            for (k, side) in [
                ("left", 0),
                ("inside", 0),
                ("top", 1),
                ("right", 2),
                ("outside", 2),
                ("bottom", 3),
            ] {
                let axis = if side % 2 == 0 { w } else { h };
                if let Some(v) = resolve(get(k), axis) {
                    match side {
                        0 => sides.left = v,
                        1 => sides.top = v,
                        2 => sides.right = v,
                        _ => sides.bottom = v,
                    }
                }
            }
        }
        Some(v) => {
            if let Some(m) = resolve(Some(v), w) {
                sides = Sides::splat(m);
            }
        }
        None => {}
    }
    sides
}

// --- Linearizing: the pages' frames as one stream of items in document order ------------------------------------

/// A rectangle on a page, in points.
#[derive(Clone, Copy, Debug)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

impl Rect {
    fn right(&self) -> f64 {
        self.x + self.w
    }
    fn bottom(&self) -> f64 {
        self.y + self.h
    }
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x - 0.5
            && x <= self.right() + 0.5
            && y >= self.y - 0.5
            && y <= self.bottom() + 0.5
    }
}

/// A stroke along an axis: a line, an edge of a framed rectangle, or a thin filled rectangle (Typst draws a box's
/// one-sided strokes as filled curves).
#[derive(Clone, Debug)]
struct Seg {
    /// Horizontal: from (x0, y) to (x1, y); vertical: from (x, y0) to (x, y1), as (x0, y0, x1, y1).
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
    thickness: f64,
    color: String,
    /// Dashed or dotted (Word's border styles), not solid.
    dash: Option<&'static str>,
}

impl Seg {
    fn horizontal(&self) -> bool {
        (self.y0 - self.y1).abs() < 0.01
    }
}

enum Kind {
    Start(Content, Point),
    End(Location),
    Text(Text),
    Seg(Seg),
    Fill(Rect, String),
    /// A group begins: its rectangle, and whether it is decorated (a frame or a fill on its edges).
    Group(Rect, bool),
    GroupEnd,
    /// Something drawn that the model can't express yet (curves, images): a placeholder of its bounding box.
    Drawing(Rect),
    /// A box drawn without a frame of its own (Typst inlines a `rect`'s frame where it can): its fill and strokes
    /// follow, then what is drawn in it.
    Rect(Rect),
    Link(Rect, String),
    /// An equation's Word math, from its marker (math.rs): inside the equation's tags, after what it draws.
    Math(Json),
}

struct Item {
    page: usize,
    kind: Kind,
    /// What it draws, where on its page: a picture of it is rendered from these (#133). One of the kinds a shape
    /// becomes (a rectangle's fill and strokes) has it.
    drawn: Option<(Point, FrameItem)>,
}

#[derive(Clone)]
struct Text {
    /// Start of the baseline.
    x: f64,
    y: f64,
    width: f64,
    size: f64,
    font: Font,
    color: String,
    text: String,
    /// Width of the item's first word (up to its first space): whether it would have fitted on the line before.
    first_word: f64,
    /// Width without trailing spaces: where the ink ends.
    inked: f64,
    /// In a `super` or `sub` Typst set with the font's own superscript or subscript glyphs (full size, on the baseline):
    /// Word's `superscript` or `subscript`.
    script: Option<&'static str>,
    /// Shaped right to left (#134).
    rtl: bool,
    /// Its language, as BCP 47 (`ar`, `zh-TW`).
    lang: String,
}

/// The text items of one shaped run being pushed (#134): Typst lays a run's pieces out left to right (one per font and
/// vertical offset), but lines' items are otherwise in logical order, so an RTL run's pieces are pushed reversed.
struct Pieces {
    /// Where its first item is in `items`.
    start: usize,
    /// Its direction, once a piece has a strong one.
    rtl: Option<bool>,
    /// Where its last piece ends, its baseline (once a piece that isn't a mark has it) and text size.
    right: f64,
    baseline: Option<f64>,
    size: f64,
}

struct Linearizer<'a> {
    page: usize,
    items: &'a mut Vec<Item>,
    /// Tables open, across pages (a table's end comes on its last page).
    tables: &'a mut Vec<Location>,
    /// Cells already laid out, by table and position: a header Typst repeats on a later page (as new cells) is
    /// Word's to repeat (`tblHeader`).
    seen_cells: &'a mut HashMap<(Location, usize, usize), usize>,
    /// The rows Typst repeated, by table.
    repeated: &'a mut HashSet<(Location, usize)>,
    /// A repeated cell being skipped, up to its end.
    skipping: Option<Location>,
    /// The last equation marker: its end tag is dropped with it.
    marker: Option<Location>,
    /// `super` and `sub` elements open, and the text size before each.
    scripts: Vec<(Location, &'static str, f64)>,
    /// The size of the last text.
    size: f64,
    /// The run of text items being pushed.
    pieces: Option<Pieces>,
}

impl Linearizer<'_> {
    fn push(&mut self, kind: Kind) {
        if !matches!(kind, Kind::Text(_)) {
            self.pieces = None;
        }
        self.items.push(Item {
            page: self.page,
            kind,
            drawn: None,
        });
    }

    /// Records what the items pushed since `from` draw: the first of them has it.
    fn drawn(&mut self, from: usize, at: Point, item: &FrameItem) {
        if let Some(first) = self.items.get_mut(from) {
            first.drawn = Some((at, item.clone()));
        }
    }

    fn walk(&mut self, frame: &Frame, ts: Transform) {
        let all = frame.items().as_slice();
        for (i, (pos, item)) in all.iter().enumerate() {
            let ts = ts.pre_concat(Transform::translate(pos.x, pos.y));
            let at = Point::zero().transform(ts);
            if let Some(loc) = self.skipping {
                match item {
                    FrameItem::Tag(Tag::End(end, ..)) if *end == loc => self.skipping = None,
                    FrameItem::Group(group) => {
                        self.walk(&group.frame, ts.pre_concat(group.transform))
                    }
                    _ => {}
                }
                continue;
            }
            match item {
                FrameItem::Group(group) => {
                    let gts = ts.pre_concat(group.transform);
                    let size = group.frame.size();
                    let rect = Rect {
                        x: at.x.to_pt(),
                        y: at.y.to_pt(),
                        w: size.x.to_pt(),
                        h: size.y.to_pt(),
                    };
                    // A grid or table drawn with curves (rounded cards) stays a grid: its cells are found inside. So
                    // does a block of paragraphs, lists or headings with a drawing in it: the drawing is a picture,
                    // not the text around it.
                    if !gts.is_only_translate()
                        || ((curvy(&group.frame) || canvas(&group.frame))
                            && !has_structure(&group.frame))
                    {
                        // Rotated or drawn content (CeTZ, edu's drawings): a picture of it. Tags of elements in it
                        // (a label's equation) are the picture's; those of elements around it (a cell it is in, a
                        // list a page broke) stay, so those still start and end, and the ones before anything it
                        // draws come before it.
                        let mut tags = Vec::new();
                        collect_tags(&group.frame, &mut tags, &mut false);
                        let starts: HashSet<Location> = tags
                            .iter()
                            .filter_map(|(_, t)| match t {
                                Tag::Start(elem, _) => elem.location(),
                                _ => None,
                            })
                            .collect();
                        let ends: HashSet<Location> = tags
                            .iter()
                            .filter_map(|(_, t)| match t {
                                Tag::End(loc, ..) => Some(*loc),
                                _ => None,
                            })
                            .collect();
                        // A drawing's description (its marker, `drawing_alt`) stays too.
                        let markers: HashSet<Location> = tags
                            .iter()
                            .filter_map(|(_, t)| match t {
                                Tag::Start(elem, _) if drawing_marker(elem) => elem.location(),
                                _ => None,
                            })
                            .collect();
                        tags.retain(|(_, t)| match t {
                            Tag::Start(elem, _) => elem
                                .location()
                                .is_none_or(|l| !ends.contains(&l) || markers.contains(&l)),
                            Tag::End(loc, ..) => !starts.contains(loc) || markers.contains(loc),
                        });
                        let lead = tags.iter().take_while(|(lead, _)| *lead).count();
                        for (_, tag) in &tags[..lead] {
                            self.tag(tag, at);
                        }
                        let from = self.items.len();
                        self.push(Kind::Drawing(rect));
                        self.drawn(from, at, item);
                        for (_, tag) in &tags[lead..] {
                            self.tag(tag, at);
                        }
                        continue;
                    }
                    self.push(Kind::Group(rect, decorated(&group.frame)));
                    self.walk(&group.frame, gts);
                    self.push(Kind::GroupEnd);
                }
                FrameItem::Text(text) => {
                    if text.text.is_empty() {
                        continue;
                    }
                    let dir = crate::text::run_dir(text).map(|d| d == Dir::RTL);
                    let size = text.size.to_pt();
                    let (x, mut baseline) = (at.x.to_pt(), at.y.to_pt());
                    // A mark's item (Arabic dots, Indic vowel signs: glyphs with a vertical offset are an item of
                    // their own, above or below the baseline) repeats its base's text: it is drawn, but has none.
                    // (A space trimmed at the end of a line is an item of no width too, but a space.)
                    let mark = !text.text.chars().all(char::is_whitespace)
                        && crate::text::mark(all, i, text);
                    // Width of the item's first word (up to its first space), in reading order.
                    let mut first_word = 0.0;
                    let glyphs: Vec<_> = if dir == Some(true) {
                        text.glyphs.iter().rev().collect()
                    } else {
                        text.glyphs.iter().collect()
                    };
                    for glyph in glyphs {
                        let start = glyph.range().start;
                        if text.text[start..].starts_with(char::is_whitespace) {
                            break;
                        }
                        first_word += glyph.x_advance.at(text.size).to_pt();
                    }
                    let mut trailing = 0.0;
                    for glyph in text.glyphs.iter().rev() {
                        if !text.text[glyph.range()].chars().all(char::is_whitespace) {
                            break;
                        }
                        trailing += glyph.x_advance.at(text.size).to_pt();
                    }
                    // Typst synthesizes a script the font has no glyphs for: smaller, off the baseline, as it is.
                    let script = self
                        .scripts
                        .last()
                        .filter(|(_, _, before)| (before - size).abs() < 0.01)
                        .map(|(_, script, _)| *script);
                    if self.scripts.is_empty() && !mark {
                        self.size = size;
                    }
                    let width = text.width().to_pt();
                    // The run this piece continues: it starts where the last one ended, on its baseline.
                    let joins = self.pieces.as_ref().is_some_and(|p| {
                        (p.right - x).abs() < 0.01
                            && (mark || p.baseline.is_none_or(|b| (b - baseline).abs() < 0.01))
                            && (p.size - size).abs() < 0.01
                            && (mark || dir.is_none() || p.rtl.is_none() || p.rtl == dir)
                    });
                    if !joins {
                        self.pieces = Some(Pieces {
                            start: self.items.len(),
                            rtl: None,
                            right: x,
                            baseline: None,
                            size,
                        });
                    }
                    let mut pieces = self.pieces.take().unwrap();
                    pieces.right = pieces.right.max(x + width);
                    // A mark is on its base's baseline, and so are the marks a run starts with once it has one.
                    if mark {
                        baseline = pieces.baseline.unwrap_or(baseline);
                    } else if pieces.baseline.is_none() {
                        pieces.baseline = Some(baseline);
                        for item in &mut self.items[pieces.start..] {
                            if let Kind::Text(t) = &mut item.kind {
                                t.y = baseline;
                            }
                        }
                    }
                    let mut rtl = pieces.rtl == Some(true);
                    if pieces.rtl.is_none() && !mark && dir.is_some() {
                        pieces.rtl = dir;
                        rtl = dir == Some(true);
                        // The pieces so far had no direction: now they read right to left.
                        if rtl {
                            self.items[pieces.start..].reverse();
                            for item in &mut self.items[pieces.start..] {
                                if let Kind::Text(t) = &mut item.kind {
                                    t.rtl = true;
                                }
                            }
                        }
                    }
                    let from = self.items.len();
                    self.items.push(Item {
                        page: self.page,
                        kind: Kind::Text(Text {
                            x,
                            y: baseline,
                            width,
                            inked: width - trailing,
                            size,
                            font: text.font.font().clone(),
                            color: paint_hex(&text.fill),
                            text: if mark {
                                String::new()
                            } else {
                                text.text.to_string()
                            },
                            first_word,
                            script,
                            rtl,
                            lang: Locale::new(text.lang, text.region).rfc_3066().to_string(),
                        }),
                        drawn: None,
                    });
                    self.drawn(from, at, item);
                    if rtl {
                        self.items[pieces.start..].rotate_right(1);
                    }
                    self.pieces = Some(pieces);
                }
                FrameItem::Shape(shape, _) => {
                    let from = self.items.len();
                    self.shape(shape, at);
                    self.drawn(from, at, item);
                }
                FrameItem::Image(_, size, _) => {
                    let from = self.items.len();
                    self.push(Kind::Drawing(Rect {
                        x: at.x.to_pt(),
                        y: at.y.to_pt(),
                        w: size.x.to_pt(),
                        h: size.y.to_pt(),
                    }));
                    self.drawn(from, at, item);
                }
                FrameItem::Link(Destination::Url(url), size) => self.push(Kind::Link(
                    Rect {
                        x: at.x.to_pt(),
                        y: at.y.to_pt(),
                        w: size.x.to_pt(),
                        h: size.y.to_pt(),
                    },
                    url.to_string(),
                )),
                FrameItem::Link(..) => {}
                FrameItem::Tag(Tag::Start(elem, _)) if self.math(elem) => {}
                FrameItem::Tag(Tag::End(loc, ..)) if Some(*loc) == self.marker => {}
                FrameItem::Tag(Tag::Start(elem, _)) => {
                    if matches!(elem.func().name(), "table" | "grid") {
                        self.tables.extend(elem.location());
                    }
                    let script = match elem.func().name() {
                        "super" => Some("superscript"),
                        "sub" => Some("subscript"),
                        _ => None,
                    };
                    if let (Some(script), Some(loc)) = (script, elem.location()) {
                        self.scripts.push((loc, script, self.size));
                    }
                    if let (Some(&table), Node::Cell { x, y, .. }) =
                        (self.tables.last(), classify(elem, at, self.page))
                    {
                        // Only on a later page: on the same one, a table nested in a row still open shares positions.
                        let first = *self.seen_cells.entry((table, x, y)).or_insert(self.page);
                        if first < self.page {
                            // A repeated header: Word repeats header rows itself.
                            self.repeated.insert((table, y));
                            self.skipping = elem.location();
                            continue;
                        }
                    }
                    self.push(Kind::Start(elem.clone(), at))
                }
                FrameItem::Tag(Tag::End(loc, ..)) => {
                    // Tables broken across pages may end out of order (a nested one after its row's table).
                    self.tables.retain(|t| t != loc);
                    self.scripts.retain(|(l, ..)| l != loc);
                    self.push(Kind::End(*loc))
                }
            }
        }
    }

    /// An equation's marker becomes its Word math.
    fn math(&mut self, elem: &Content) -> bool {
        let Some(math) = crate::math::marked(elem) else {
            return false;
        };
        self.marker = elem.location();
        self.push(Kind::Math(math));
        true
    }

    /// A tag in a frame whose content is a drawing, placed where the drawing is.
    fn tag(&mut self, tag: &Tag, at: Point) {
        match tag {
            Tag::Start(elem, _) if self.math(elem) => {}
            Tag::End(loc, ..) if Some(*loc) == self.marker => {}
            Tag::Start(elem, _) => self.push(Kind::Start(elem.clone(), at)),
            Tag::End(loc, ..) => self.push(Kind::End(*loc)),
        }
    }

    fn shape(&mut self, shape: &Shape, at: Point) {
        let (x, y) = (at.x.to_pt(), at.y.to_pt());
        match &shape.geometry {
            Geometry::Line(to) => {
                if let Some(stroke) = &shape.stroke {
                    let (dx, dy) = (to.x.to_pt(), to.y.to_pt());
                    if dx.abs() < 0.01 || dy.abs() < 0.01 {
                        self.push(Kind::Seg(seg(x, y, x + dx, y + dy, stroke)));
                    } else {
                        self.push(Kind::Drawing(Rect {
                            x: x.min(x + dx),
                            y: y.min(y + dy),
                            w: dx.abs(),
                            h: dy.abs(),
                        }));
                    }
                }
            }
            Geometry::Rect(size) => {
                let r = Rect {
                    x,
                    y,
                    w: size.x.to_pt(),
                    h: size.y.to_pt(),
                };
                // A gradient or a tiling: no table cell or shading has one, so a picture of the shape.
                if shape.fill.as_ref().is_some_and(patterned) {
                    self.push(Kind::Drawing(r));
                    return;
                }
                if r.w >= 6.0 && r.h >= 6.0 {
                    self.push(Kind::Rect(r));
                }
                if let Some(fill) = &shape.fill {
                    self.push(Kind::Fill(r, paint_hex(fill)));
                }
                if let Some(stroke) = &shape.stroke {
                    for (x0, y0, x1, y1) in [
                        (r.x, r.y, r.right(), r.y),
                        (r.x, r.bottom(), r.right(), r.bottom()),
                        (r.x, r.y, r.x, r.bottom()),
                        (r.right(), r.y, r.right(), r.bottom()),
                    ] {
                        self.push(Kind::Seg(seg(x0, y0, x1, y1, stroke)));
                    }
                }
            }
            Geometry::Curve(curve) => match (axis_rect(&curve.0), &shape.fill) {
                // A thin filled rectangle is a stroke; a wider one a fill.
                (Some(r), Some(fill)) if shape.stroke.is_none() && !patterned(fill) => {
                    let r = Rect {
                        x: x + r.x,
                        y: y + r.y,
                        ..r
                    };
                    let color = paint_hex(fill);
                    if r.h <= 3.0 && r.w > r.h {
                        let mid = r.y + r.h / 2.0;
                        self.push(Kind::Seg(Seg {
                            x0: r.x,
                            y0: mid,
                            x1: r.right(),
                            y1: mid,
                            thickness: r.h,
                            color,
                            dash: None,
                        }));
                    } else if r.w <= 3.0 && r.h > r.w {
                        let mid = r.x + r.w / 2.0;
                        self.push(Kind::Seg(Seg {
                            x0: mid,
                            y0: r.y,
                            x1: mid,
                            y1: r.bottom(),
                            thickness: r.w,
                            color,
                            dash: None,
                        }));
                    } else {
                        self.push(Kind::Fill(r, color));
                    }
                }
                _ => {
                    if let Some(b) = curve_bounds(&curve.0) {
                        self.push(Kind::Drawing(Rect {
                            x: x + b.x,
                            y: y + b.y,
                            ..b
                        }));
                    }
                }
            },
        }
    }
}

/// Whether a paint is a gradient or a tiling, which Word has for shapes, not for text, cells or paragraphs.
fn patterned(paint: &Paint) -> bool {
    !matches!(paint, Paint::Solid(_))
}

/// Whether an element is a drawing's description: `metadata((alt: …))` labelled `<typstream-drawing>`.
fn drawing_marker(elem: &Content) -> bool {
    elem.label()
        .is_some_and(|l| l.resolve().as_str() == "typstream-drawing")
}

/// The tags in a frame, in order, and whether each comes before anything the frame draws.
fn collect_tags(frame: &Frame, out: &mut Vec<(bool, Tag)>, drawn: &mut bool) {
    for (_, item) in frame.items() {
        match item {
            FrameItem::Group(g) => collect_tags(&g.frame, out, drawn),
            FrameItem::Tag(tag) => out.push((!*drawn, tag.clone())),
            _ => *drawn = true,
        }
    }
}

fn seg(x0: f64, y0: f64, x1: f64, y1: f64, stroke: &FixedStroke) -> Seg {
    Seg {
        x0: x0.min(x1),
        y0: y0.min(y1),
        x1: x0.max(x1),
        y1: y0.max(y1),
        thickness: stroke.thickness.to_pt(),
        color: paint_hex(&stroke.paint),
        // Dots are dashes no longer than the stroke is thick (round caps make them dots).
        dash: stroke.dash.as_ref().map(|d| {
            let first = d.array.first().map_or(0.0, |a| a.to_pt());
            if first <= stroke.thickness.to_pt() * 1.01 {
                "dotted"
            } else {
                "dashed"
            }
        }),
    }
}

/// The rectangle a closed curve of axis-aligned lines draws, relative to its origin.
fn axis_rect(items: &[CurveItem]) -> Option<Rect> {
    let mut points = Vec::new();
    for item in items {
        match item {
            CurveItem::Move(p) | CurveItem::Line(p) => points.push((p.x.to_pt(), p.y.to_pt())),
            CurveItem::Close => {}
            CurveItem::Cubic(..) => return None,
        }
    }
    if points.len() < 4 || points.len() > 5 {
        return None;
    }
    let axis = points
        .windows(2)
        .all(|w| (w[0].0 - w[1].0).abs() < 0.01 || (w[0].1 - w[1].1).abs() < 0.01);
    if !axis {
        return None;
    }
    let (x0, x1) = points
        .iter()
        .fold((f64::MAX, f64::MIN), |(a, b), p| (a.min(p.0), b.max(p.0)));
    let (y0, y1) = points
        .iter()
        .fold((f64::MAX, f64::MIN), |(a, b), p| (a.min(p.1), b.max(p.1)));
    Some(Rect {
        x: x0,
        y: y0,
        w: x1 - x0,
        h: y1 - y0,
    })
}

fn curve_bounds(items: &[CurveItem]) -> Option<Rect> {
    let mut b: Option<(f64, f64, f64, f64)> = None;
    let mut add = |p: &Point| {
        let (x, y) = (p.x.to_pt(), p.y.to_pt());
        b = Some(match b {
            None => (x, y, x, y),
            Some((a, c, d, e)) => (a.min(x), c.min(y), d.max(x), e.max(y)),
        });
    };
    for item in items {
        match item {
            CurveItem::Move(p) | CurveItem::Line(p) => add(p),
            CurveItem::Cubic(a, c, p) => {
                add(a);
                add(c);
                add(p);
            }
            CurveItem::Close => {}
        }
    }
    b.map(|(x0, y0, x1, y1)| Rect {
        x: x0,
        y: y0,
        w: x1 - x0,
        h: y1 - y0,
    })
}

/// Whether a frame draws something a document model can't: curves that aren't axis-aligned rectangles (a CeTZ
/// canvas, edu's number line), outside text and equations. Equations draw fraction lines; those are their
/// placeholders' business.
fn curvy(frame: &Frame) -> bool {
    let mut lines = 0;
    let mut text = 0;
    let mut curvy = false;
    count(frame, &mut lines, &mut text, &mut curvy, 0);
    curvy || (lines >= 6 && text * 2 < lines)
}

fn count(frame: &Frame, lines: &mut usize, text: &mut usize, curvy: &mut bool, equation: usize) {
    let mut eq = equation;
    for (_, item) in frame.items() {
        match item {
            FrameItem::Group(g) => count(&g.frame, lines, text, curvy, eq),
            FrameItem::Text(_) => *text += 1,
            FrameItem::Tag(Tag::Start(elem, _)) if elem.func().name() == "equation" => eq += 1,
            FrameItem::Tag(Tag::End(..)) => eq = eq.saturating_sub(0),
            FrameItem::Shape(shape, _) if eq == 0 => match &shape.geometry {
                Geometry::Curve(c) => {
                    if axis_rect(&c.0).is_none() {
                        *curvy = true
                    }
                }
                Geometry::Line(to) => {
                    if to.x.to_pt().abs() > 0.01 && to.y.to_pt().abs() > 0.01 {
                        *curvy = true
                    } else {
                        *lines += 1
                    }
                }
                Geometry::Rect(_) => {}
            },
            _ => {}
        }
    }
}

/// Whether a frame is a canvas: pieces `place`d in it (a CeTZ canvas, edu's drawings), one of them a shape. Placed text
/// alone isn't one.
fn canvas(frame: &Frame) -> bool {
    let placed = frame.items().any(|(_, item)| match item {
        FrameItem::Tag(Tag::Start(elem, _)) => elem
            .to_packed::<PlaceElem>()
            .is_some_and(|p| !p.float.get(StyleChain::default())),
        _ => false,
    });
    placed && draws_shape(frame)
}

fn draws_shape(frame: &Frame) -> bool {
    frame.items().any(|(_, item)| match item {
        FrameItem::Shape(..) | FrameItem::Image(..) => true,
        FrameItem::Group(g) => draws_shape(&g.frame),
        _ => false,
    })
}

/// Whether a frame holds what flows as text: paragraphs, headings, list items (their elements and typst-layout's body
/// markers), table or grid cells. A drawing's labels are boxes of text, which aren't paragraphs (a block's one
/// paragraph has no `par` either).
fn has_structure(frame: &Frame) -> bool {
    frame.items().any(|(_, item)| match item {
        FrameItem::Group(g) => has_structure(&g.frame),
        FrameItem::Tag(Tag::Start(elem, _)) => {
            elem.is::<TableCell>()
                || elem.is::<GridCell>()
                || matches!(elem.func().name(), "par" | "heading" | "item")
                || elem.to_packed::<PdfMarkerTag>().is_some_and(|m| {
                    matches!(
                        m.kind,
                        PdfMarkerTagKind::ListItemBody | PdfMarkerTagKind::TermsItemBody
                    )
                })
        }
        _ => false,
    })
}

/// A group drawn as a framed or filled block: its first items are a rectangle as big as the group, or strokes along
/// its edges.
fn decorated(frame: &Frame) -> bool {
    let size = frame.size();
    let (w, h) = (size.x.to_pt(), size.y.to_pt());
    if w < 1.0 || h < 1.0 {
        return false;
    }
    for (pos, item) in frame.items().take(5) {
        let FrameItem::Shape(shape, _) = item else {
            return false;
        };
        let (x, y) = (pos.x.to_pt(), pos.y.to_pt());
        let full = |r: &Rect| {
            (r.x - 0.0).abs() < 1.0
                && (r.y - 0.0).abs() < 1.0
                && (r.w - w).abs() < 1.0
                && (r.h - h).abs() < 1.0
        };
        let edge = |r: &Rect| {
            let r = Rect {
                x: x + r.x,
                y: y + r.y,
                ..*r
            };
            (r.w <= 3.0 && (r.h - h).abs() < 1.0) || (r.h <= 3.0 && (r.w - w).abs() < 1.0)
        };
        match &shape.geometry {
            Geometry::Rect(s) => {
                if full(&Rect {
                    x,
                    y,
                    w: s.x.to_pt(),
                    h: s.y.to_pt(),
                }) {
                    return true;
                }
            }
            Geometry::Curve(c) => {
                if let Some(r) = axis_rect(&c.0) {
                    if full(&Rect {
                        x: x + r.x,
                        y: y + r.y,
                        ..r
                    }) || edge(&r)
                    {
                        return true;
                    }
                }
            }
            Geometry::Line(to) => {
                let (dx, dy) = (to.x.to_pt(), to.y.to_pt());
                if (dx.abs() < 0.01 && (dy.abs() - h).abs() < 1.0)
                    || (dy.abs() < 0.01 && (dx.abs() - w).abs() < 1.0)
                {
                    return true;
                }
            }
        }
    }
    false
}

fn paint_hex(paint: &Paint) -> String {
    let color = match paint {
        Paint::Solid(c) => c.clone(),
        Paint::Gradient(g) => g.sample_at((0.0, 0.0), (1.0, 1.0)),
        Paint::Tiling(_) => Color::BLACK,
    };
    let rgb = color.to_rgb();
    // Word's colours are opaque: a translucent one (`highlight`'s default yellow) as it shows on white paper.
    let byte = |v: f32| ((v * rgb.alpha + 1.0 - rgb.alpha).clamp(0.0, 1.0) * 255.0).round() as u8;
    format!(
        "{:02X}{:02X}{:02X}",
        byte(rgb.red),
        byte(rgb.green),
        byte(rgb.blue)
    )
}

// --- Fonts --------------------------------------------------------------------------------------------------------

/// The faces runs use, as Word names them: the legacy family (name ID 1) and the style it links to (bold, italic).
#[derive(Default)]
struct Fonts {
    index: HashMap<u128, usize>,
    /// Legacy family, bold, italic, and the no-break space's advance in em (what an exact-width gap is made of).
    meta: Vec<(String, bool, bool, f64)>,
    /// How far below the baseline Word-like engines centre an underline, in em: the post table's position.
    underline: Vec<f64>,
    data: Vec<Vec<u8>>,
}

impl Fonts {
    fn get(&mut self, font: &Font) -> usize {
        let key = typst::utils::hash128(font);
        if let Some(&i) = self.index.get(&key) {
            return i;
        }
        let data = font.data().as_slice();
        let (family, sub) = legacy_names(data, font.index())
            .unwrap_or_else(|| (font.info().family.clone(), "Regular".into()));
        let sub = sub.to_lowercase();
        let bold = sub.contains("bold");
        let italic = sub.contains("italic") || sub.contains("oblique");
        let face = ttf_parser::Face::parse(data, font.index()).ok();
        let nbsp = face
            .as_ref()
            .and_then(|face| {
                let gid = face
                    .glyph_index('\u{a0}')
                    .or_else(|| face.glyph_index(' '))?;
                Some(face.glyph_hor_advance(gid)? as f64 / face.units_per_em() as f64)
            })
            .unwrap_or(0.25);
        let underline = face
            .as_ref()
            .and_then(|face| {
                Some(-(face.underline_metrics()?.position as f64) / face.units_per_em() as f64)
            })
            .unwrap_or(0.078);
        self.meta.push((family, bold, italic, nbsp));
        self.underline.push(underline);
        self.data.push(data.to_vec());
        self.index.insert(key, self.data.len() - 1);
        self.data.len() - 1
    }

    fn json(&self) -> Json {
        self.meta
            .iter()
            .map(|(name, bold, italic, nbsp)| json!({ "name": name, "bold": bold, "italic": italic, "nbsp": nbsp }))
            .collect()
    }
}

fn legacy_names(data: &[u8], index: u32) -> Option<(String, String)> {
    let face = ttf_parser::Face::parse(data, index).ok()?;
    let name = |id: u16| {
        face.names()
            .into_iter()
            .filter(|n| n.name_id == id && n.is_unicode())
            .find_map(|n| n.to_string())
    };
    Some((
        name(ttf_parser::name_id::FAMILY)?,
        name(ttf_parser::name_id::SUBFAMILY)?,
    ))
}

// --- Building blocks from the stream ------------------------------------------------------------------------------

/// An element the stream's tags open, while its items are gathered.
#[derive(Clone)]
enum Node {
    Par,
    Heading(usize),
    List,
    ItemLabel,
    ItemBody,
    Table {
        at: Point,
        page: usize,
        grid: bool,
        gutters: (Vec<f64>, Vec<f64>),
    },
    Cell {
        at: Point,
        page: usize,
        x: usize,
        y: usize,
        colspan: usize,
        rowspan: usize,
        inset: Sides<f64>,
        valign: &'static str,
    },
    Equation {
        block: bool,
    },
    Opaque,
}

/// A run of a paragraph, before it is JSON.
#[derive(Clone)]
enum Run {
    Text {
        text: String,
        font: usize,
        size: f64,
        color: String,
        /// Underlined, in the stroke's colour.
        underline: Option<String>,
        link: Option<String>,
        script: Option<&'static str>,
        /// Right to left, and its language (#134).
        rtl: bool,
        lang: String,
        /// Shaded behind (a `highlight`, a filled box around words), in this colour.
        fill: Option<String>,
        /// Struck through (`strike`).
        strike: bool,
    },
    /// An exact-width space: a gap in a line, a blank, a placeholder. `raise` (points, negative lowers) moves its
    /// underline to where Typst drew the stroke: nothing is written on it to move with it. `fill`: shaded, as the
    /// inset of a filled box beside its words.
    Gap {
        width: f64,
        underline: Option<String>,
        raise: f64,
        font: usize,
        size: f64,
        fill: Option<String>,
    },
    Tab,
    /// A line break Typst was told to make (`\`), not one it chose.
    Break,
    /// A picture in the line (#133): an exact-width gap where there is none. `picture` is `{ index, y }`, `y` its
    /// top below the baseline.
    Picture {
        width: f64,
        font: usize,
        size: f64,
        picture: Option<Json>,
    },
    /// An equation (math.rs): its tree, in the math font.
    Math {
        math: Json,
        font: usize,
        size: f64,
        color: String,
        display: bool,
    },
}

/// An inline equation in a paragraph's lines.
struct Equation {
    math: Option<Json>,
    /// Its math font and colour, from the first glyph it draws.
    font: Option<(usize, String)>,
    size: f64,
    /// Written in the line it starts in.
    written: bool,
}

struct Line {
    page: usize,
    baseline: f64,
    /// Largest text size on the line: its pitch is 1.3 times it.
    size: f64,
    left: f64,
    right: f64,
    runs: Vec<Run>,
    /// Taller than the profile's line box (math, a box): Word gets "at least".
    tall: bool,
    /// What a `repeat` on the line fills its room with, as Word's tab leader (an outline's dots).
    leader: Option<&'static str>,
    /// Width of its first word, or of whatever it starts with.
    first_word: f64,
    top: f64,
    bottom: f64,
    /// Its base direction is right to left (#134).
    rtl: bool,
}

struct Builder {
    items: std::rc::Rc<Vec<Item>>,
    geometry: Vec<(Size, Sides<f64>)>,
    fonts: Fonts,
    lists: Vec<Json>,
    /// Header rows Typst repeated on later pages, by table.
    repeated: HashSet<(Location, usize)>,
    /// Pictures of what the model can't express (#133), as blocks and runs refer to them, and their JSON.
    pictures: Vec<Picture>,
    picture_json: Vec<Json>,
    /// Free-form content a picture holds (a rounded box), for `docx/fallback` warnings: where, and what.
    fallbacks: Vec<(Span, &'static str)>,
}

/// A region blocks flow in: the page's content area, a cell, a framed block.
#[derive(Clone, Copy)]
struct Area {
    left: f64,
    right: f64,
}

/// A laid-out block, with where it sits, before it is JSON.
struct Block {
    page: usize,
    /// The page it ends on: a table or paragraph can run over pages.
    end_page: usize,
    top: f64,
    bottom: f64,
    json: Map<String, Json>,
}

impl Builder {
    fn content_top(&self, page: usize) -> f64 {
        self.geometry[page].1.top
    }

    /// How far to raise a gap in `font` at `size` so its underline lands `depth` below the baseline, where Typst
    /// drew a blank's stroke (a box's bottom edge sits on the baseline; Word underlines at the font's position).
    fn raise(&self, font: usize, size: f64, depth: f64) -> f64 {
        self.fonts.underline.get(font).copied().unwrap_or(0.078) * size - depth
    }

    fn sections(&mut self, pages: &[Page]) -> Json {
        let n = self.items.len();
        // Each page's number as Typst shows it (its numbering's first numeral system: i, ii, …) and Word's format.
        let numbering: Vec<(&'static str, u64, String)> =
            pages.iter().map(page_numbering).collect();
        // Split each page's items into header, body and footer by position.
        // Groups in a margin (the header's and footer's frames) go whole, and elements started there take their ends:
        // a table broken across pages has the next page's header among its items.
        let mut body = Vec::new();
        let mut header: HashMap<usize, Vec<usize>> = HashMap::new();
        let mut footer: HashMap<usize, Vec<usize>> = HashMap::new();
        let all: Vec<usize> = (0..n).collect();
        let mut marginal_ends: HashMap<Location, bool> = HashMap::new();
        let mut i = 0;
        while i < n {
            let item = &self.items[i];
            let (size, m) = self.geometry[item.page];
            let bottom_edge = size.y.to_pt() - m.bottom;
            // `Some(true)`: the header's; `Some(false)`: the footer's.
            let zone = |y0: f64, y1: f64| {
                if y1 <= m.top + 0.5 {
                    Some(true)
                } else if y0 >= bottom_edge - 0.5 {
                    Some(false)
                } else {
                    None
                }
            };
            let (to, end) = match &item.kind {
                Kind::Group(r, _) => (zone(r.y, r.bottom()), group_end(&self.items, &all, i)),
                Kind::Text(t) => (
                    zone(t.y, t.y).filter(|_| t.y < m.top || t.y > bottom_edge),
                    i,
                ),
                // All of it: a table's vertical strokes start half their thickness above the page's top margin
                // where it goes on.
                Kind::Seg(s) => {
                    let (y0, y1) = (s.y0.min(s.y1), s.y0.max(s.y1));
                    (zone(y0, y1).filter(|_| y1 < m.top || y0 > bottom_edge), i)
                }
                Kind::Start(elem, at) => {
                    let y = at.y.to_pt();
                    let to = zone(y, y).filter(|_| y < m.top || y > bottom_edge);
                    if let (Some(h), Some(loc)) = (to, elem.location()) {
                        marginal_ends.insert(loc, h);
                    }
                    (to, i)
                }
                Kind::End(loc) => (marginal_ends.get(loc).copied(), i),
                _ => (None, i),
            };
            match to {
                Some(true) => header.entry(item.page).or_default().extend(i..=end),
                Some(false) => footer.entry(item.page).or_default().extend(i..=end),
                None => body.extend(i..=end),
            }
            i = end + 1;
        }
        let area = |g: &(Size, Sides<f64>)| Area {
            left: g.1.left,
            right: g.0.x.to_pt() - g.1.right,
        };
        let first_area = area(&self.geometry[0]);
        let blocks = self.flow(&body, first_area, true);
        let mut blocks = self.with_gaps(blocks, true);
        // Where Typst's page numbering changes format or starts again (`counter(page).update(1)` after the front
        // matter), Word starts a section on a new page, numbered from there.
        for p in 1..numbering.len() {
            let (format, number, _) = &numbering[p];
            let (prev_format, prev, _) = &numbering[p - 1];
            if format == prev_format && *number == prev + 1 {
                continue;
            }
            if let Some(b) = blocks.iter_mut().find(|b| b.page == p && !out_of_flow(b)) {
                b.json.remove("pageBreak");
                b.json.insert(
                    "pageNumbering".into(),
                    json!({ "format": format, "start": number }),
                );
            }
        }
        let page_count = self.geometry.len();
        let marginal = |b: &mut Builder,
                        map: &HashMap<usize, Vec<usize>>,
                        page: usize|
         -> (Vec<Json>, String) {
            let ids = map.get(&page).cloned().unwrap_or_default();
            let blocks = b.flow(&ids, area(&b.geometry[page]), false);
            let key = blocks
                .iter()
                .map(|bl| Json::Object(bl.json.clone()).to_string())
                .collect::<String>();
            (
                blocks.into_iter().map(|bl| Json::Object(bl.json)).collect(),
                key,
            )
        };
        // Headers and footers: the first page's, and the rest's when they are the same on every other page (page
        // numbers become fields).
        let mut marginals = Map::new();
        for (name, map) in [("header", &header), ("footer", &footer)] {
            let pages: Vec<(Vec<Json>, String)> =
                (0..page_count).map(|p| marginal(self, map, p)).collect();
            let labels: Vec<String> = numbering.iter().map(|n| n.2.clone()).collect();
            let roles = field_roles(
                &pages.iter().map(|(b, _)| b.clone()).collect::<Vec<_>>(),
                &labels,
            );
            let fielded: Vec<(Vec<Json>, String)> = pages
                .iter()
                .map(|(blocks, _)| {
                    let mut k = 0;
                    let blocks: Vec<Json> = blocks
                        .iter()
                        .map(|b| with_fields(b, &roles, &mut k))
                        .collect();
                    let key = blocks.iter().map(|b| b.to_string()).collect();
                    (blocks, key)
                })
                .collect();
            let rest_same = fielded
                .iter()
                .skip(1)
                .all(|(_, k)| *k == fielded.get(1).map(|f| f.1.clone()).unwrap_or_default());
            if page_count > 1 && rest_same {
                marginals.insert(name.into(), json!(fielded[1].0));
                if fielded[0].1 != fielded[1].1 {
                    marginals.insert(format!("{name}First"), json!(fielded[0].0));
                }
            } else {
                marginals.insert(name.into(), json!(fielded[0].0));
            }
            // Where the marginal's text sits: the header's top, the footer's bottom.
            let ys: Vec<f64> = map
                .get(&0)
                .or_else(|| map.get(&1))
                .map(|ids| {
                    ids.iter()
                        .filter_map(|&i| match &self.items[i].kind {
                            Kind::Text(t) => Some(if name == "header" {
                                t.y - TOP * t.size
                            } else {
                                t.y + BOTTOM * t.size
                            }),
                            _ => None,
                        })
                        .collect()
                })
                .unwrap_or_default();
            if !ys.is_empty() {
                let (size, _) = self.geometry[0];
                let v = if name == "header" {
                    ys.iter().cloned().fold(f64::MAX, f64::min)
                } else {
                    size.y.to_pt() - ys.iter().cloned().fold(f64::MIN, f64::max)
                };
                marginals.insert(format!("{name}Distance"), json!(round(v)));
            }
        }
        let (size, m) = self.geometry[0];
        let mut section = Map::new();
        section.insert("width".into(), json!(round(size.x.to_pt())));
        section.insert("height".into(), json!(round(size.y.to_pt())));
        section.insert(
            "margin".into(),
            json!({ "top": round(m.top), "right": round(m.right), "bottom": round(m.bottom), "left": round(m.left) }),
        );
        if let Some((format, number, _)) = numbering.first() {
            if *format != "decimal" || *number != 1 {
                section.insert(
                    "pageNumbering".into(),
                    json!({ "format": format, "start": number }),
                );
            }
        }
        section.insert(
            "blocks".into(),
            Json::Array(blocks.into_iter().map(|b| Json::Object(b.json)).collect()),
        );
        section.extend(marginals);
        json!([section])
    }

    /// Spaces before blocks, measured: how far each is below the one before on its page. A block that starts a page
    /// gets what Typst left above it (Word drops space before at the top of a page), and a page break before it when
    /// the page before had room left (a `pagebreak()`).
    fn with_gaps(&self, mut blocks: Vec<Block>, body: bool) -> Vec<Block> {
        let mut prev: Option<(usize, f64)> = None;
        let mut owed = Owed::default();
        for b in blocks.iter_mut() {
            // A framed paragraph (placed text) or a placed picture is out of the flow: no room before it, none taken.
            if out_of_flow(b) {
                b.json.insert("before".into(), json!(0.0));
                continue;
            }
            // Lines that fill the text width: engines that measure a hair wider (LibreOffice rounds each glyph's
            // advance to twips) need room past it, less than any next word missed the line by. Cells have theirs in
            // their margins.
            if let Some(fit) = b.json.remove("fit").and_then(|f| f.as_f64()) {
                let slack = (3.0 * SLACK).min(fit - FIT_MARGIN);
                if body && slack > 0.05 {
                    let right = b.json["indent"]
                        .get("right")
                        .and_then(|r| r.as_f64())
                        .unwrap_or(0.0);
                    b.json["indent"]["right"] = json!(round(right - slack));
                }
            }
            let before = match prev {
                Some((page, bottom)) if page == b.page => b.top - bottom,
                Some((page, bottom)) if body => {
                    let (size, m) = self.geometry[page];
                    let room = size.y.to_pt() - m.bottom - bottom;
                    if room > PAGE_ROOM {
                        b.json.insert("pageBreak".into(), json!(true));
                    }
                    b.top - self.content_top(b.page)
                }
                _ if body => b.top - self.content_top(b.page),
                _ => 0.0,
            };
            // A block ending at the bottom of its page after a gap (pushed down by `v(1fr)`) gets a point less: a hair
            // more and an engine moves it to the next page.
            let (size, m) = self.geometry[b.end_page];
            let last = b
                .json
                .remove("last")
                .and_then(|l| l.as_f64())
                .unwrap_or(b.bottom);
            let at_bottom = body && last > size.y.to_pt() - m.bottom - 1.0;
            let before = if at_bottom && before > 2.0 * SLACK {
                before - SLACK
            } else {
                before
            };
            let before = owed.pay(b, before);
            b.json.insert("before".into(), json!(round(before)));
            prev = Some((b.end_page, b.bottom));
        }
        // A placed picture goes in a paragraph next to it, on its page: the one after it, unless that is on a later page.
        for k in 0..blocks.len() {
            if !blocks[k].json.contains_key("placed") {
                continue;
            }
            let next = blocks[k + 1..].iter().find(|b| !out_of_flow(b));
            if next.is_none_or(|n| n.page != blocks[k].page) {
                blocks[k].json.insert("host".into(), json!("previous"));
            }
        }
        blocks
    }

    /// Blocks from items `ids` (indices into `self.items`, in order) flowing in `area`.
    fn flow(&mut self, ids: &[usize], area: Area, body: bool) -> Vec<Block> {
        let mut out = Vec::new();
        // Text gathered for the paragraph being built.
        let mut pending: Vec<usize> = Vec::new();
        let mut heading: Option<usize> = None;
        // The paragraph open: what follows its end is another block, even without a paragraph of its own (a block's
        // inline content, edu's shown answer under its question).
        let mut par: Option<Location> = None;
        let items = self.items.clone();
        let mut i = 0;
        while i < ids.len() {
            let id = ids[i];
            match &items[id].kind {
                Kind::End(loc) if par == Some(*loc) => {
                    par = None;
                    pending.push(id);
                    self.flush(&mut pending, &mut out, area, heading);
                }
                Kind::Start(elem, at) => {
                    // Text placed out of the flow (`place`, not floating): a frame at Typst's position on the page,
                    // which takes no room. Placed drawings stay drawings; in a cell, a frame would leave the table.
                    if body
                        && elem
                            .to_packed::<PlaceElem>()
                            .is_some_and(|p| !p.float.get(StyleChain::default()))
                    {
                        let end = self.end_of(ids, i, elem);
                        if let Some(frames) = self.placed(&ids[i + 1..end], area) {
                            out.extend(frames);
                            i = end + 1;
                            continue;
                        }
                        // Anything else placed is a picture anchored where Typst put it, and takes no room either.
                        if let Some(b) = self.placed_picture(&ids[i + 1..end]) {
                            out.push(b);
                            i = end + 1;
                            continue;
                        }
                    }
                    let node = classify(elem, *at, items[id].page);
                    match node {
                        Node::Par => {
                            self.flush(&mut pending, &mut out, area, heading);
                            par = elem.location();
                            i += 1;
                            continue;
                        }
                        Node::Heading(level) => {
                            self.flush(&mut pending, &mut out, area, heading);
                            heading = Some(level);
                            let end = self.end_of(ids, i, elem);
                            let inner: Vec<usize> = ids[i + 1..end].to_vec();
                            pending.extend(inner);
                            self.flush(&mut pending, &mut out, area, heading);
                            heading = None;
                            i = end + 1;
                            continue;
                        }
                        Node::List => {
                            self.flush(&mut pending, &mut out, area, heading);
                            let end = self.end_of(ids, i, elem);
                            let blocks = self.list(&ids[i + 1..end], area);
                            out.extend(blocks);
                            i = end + 1;
                            continue;
                        }
                        Node::Table { .. } => {
                            self.flush(&mut pending, &mut out, area, heading);
                            let end = self.end_of(ids, i, elem);
                            if let Some(t) = self.table(&ids[i..end], area, node) {
                                out.push(t);
                            }
                            i = end + 1;
                            continue;
                        }
                        Node::Equation { block: true } => {
                            self.flush(&mut pending, &mut out, area, heading);
                            let end = self.end_of(ids, i, elem);
                            let inner = &ids[i + 1..end];
                            if let Some(b) = self
                                .display_equation(inner, area)
                                .or_else(|| self.equation_picture(inner, area))
                            {
                                out.push(b);
                            }
                            i = end + 1;
                            continue;
                        }
                        // An inline equation goes to its paragraph whole: what it draws (a fraction's bar) isn't
                        // the flow's.
                        Node::Equation { block: false } => {
                            let end = self.end_of(ids, i, elem);
                            pending.extend_from_slice(&ids[i..=end.min(ids.len() - 1)]);
                            i = end + 1;
                            continue;
                        }
                        _ => {}
                    }
                    pending.push(id);
                }
                Kind::Group(rect, true) => {
                    // A framed or filled block, unless it sits in a line (an inline box): those have text beside,
                    // before them or (a box starting a line, a checkbox) after.
                    let end = group_end(&items, ids, i);
                    let beside = |p: usize| match &self.items[p].kind {
                        Kind::Text(t) => {
                            self.items[p].page == self.items[id].page
                                && t.y > rect.y
                                && t.y - TOP * t.size < rect.bottom()
                        }
                        _ => false,
                    };
                    let after = ids[(end + 1).min(ids.len())..]
                        .iter()
                        .find(|&&p| matches!(self.items[p].kind, Kind::Text(_)))
                        .is_some_and(|&p| {
                            beside(p)
                                && matches!(&self.items[p].kind, Kind::Text(t) if t.x >= rect.right() - 0.5)
                        });
                    // A box shorter than a line of the text in it (edu's blanks: their text's edges are tight) is set
                    // on a line, even with nothing beside it (a cell's only content).
                    let mut baselines = ids[i..=end.min(ids.len() - 1)].iter().filter_map(|&p| {
                        match &self.items[p].kind {
                            Kind::Text(t) => Some((t.y, t.size)),
                            _ => None,
                        }
                    });
                    let short = baselines.next().is_some_and(|(y, size)| {
                        rect.h < (TOP + BOTTOM) * size - 0.5
                            && baselines.all(|(y2, _)| (y2 - y).abs() < 0.5)
                    });
                    let inline = after || short || pending.iter().any(|&p| beside(p));
                    if inline || rect.h < 6.0 {
                        pending.extend_from_slice(&ids[i..=end.min(ids.len() - 1)]);
                    } else {
                        self.flush(&mut pending, &mut out, area, heading);
                        if let Some(b) = self.framed(&ids[i..=end.min(ids.len() - 1)], *rect, area)
                        {
                            // Framed blocks one under another, as wide (ruled lines): rows of one table, as Word
                            // would merge tables that touch anyway.
                            let joins = out.last().is_some_and(|prev: &Block| {
                                prev.json.get("framed").is_some()
                                    && prev.page == b.page
                                    && (prev.bottom - b.top).abs() < 0.5
                                    && prev.json.get("columns") == b.json.get("columns")
                                    && prev.json.get("indent") == b.json.get("indent")
                            });
                            if joins {
                                let prev = out.last_mut().unwrap();
                                let row = b.json["rows"][0].clone();
                                if let Some(Json::Array(rows)) = prev.json.get_mut("rows") {
                                    rows.push(row);
                                }
                                prev.bottom = b.bottom;
                            } else {
                                out.push(b);
                            }
                        }
                    }
                    i = end + 1;
                    continue;
                }
                // Word has columns in sections only: across the page's text width, not in a cell or a box.
                Kind::Group(rect, false)
                    if body
                        && (rect.x - area.left).abs() < 0.5
                        && (rect.right() - area.right).abs() < 0.5
                        && !self.beside(&pending, *rect, items[id].page)
                        && self.columns_of(ids, i, *rect).is_some() =>
                {
                    self.flush(&mut pending, &mut out, area, heading);
                    let end = group_end(&items, ids, i).min(ids.len() - 1);
                    let cols = self.columns_of(ids, i, *rect).unwrap();
                    out.push(self.columns(&ids[i + 1..end], *rect, &cols, items[id].page));
                    i = end + 1;
                    continue;
                }
                Kind::Group(rect, false)
                    if rect.right() < area.right - 1.0
                        // Centred in the area (a `place`d title), its lines are centred paragraphs of the area.
                        && ((rect.x - area.left) - (area.right - rect.right())).abs() >= 1.0
                        && !self.beside(&pending, *rect, items[id].page) =>
                {
                    // A block narrower than the area on its right (a padded quote): where its wrapped lines end is
                    // its right edge, an indent for its paragraphs. A group with one line may be only as wide as its
                    // text, and says nothing about wrapping.
                    let end = group_end(&items, ids, i).min(ids.len() - 1);
                    let inner = &ids[i + 1..end];
                    // An equation's pieces (a fraction's numerator) aren't lines of their own.
                    let mut equations: Vec<Option<Location>> = Vec::new();
                    let baselines: Vec<f64> = inner
                        .iter()
                        .filter_map(|&j| match &items[j].kind {
                            Kind::Start(elem, _) if elem.func().name() == "equation" => {
                                equations.push(elem.location());
                                None
                            }
                            Kind::End(loc) if equations.last() == Some(&Some(*loc)) => {
                                equations.pop();
                                None
                            }
                            Kind::Text(t) if equations.is_empty() => Some(t.y),
                            _ => None,
                        })
                        .collect();
                    let wrapped = baselines.iter().any(|y| (y - baselines[0]).abs() > 1.0);
                    if !wrapped {
                        pending.push(id);
                        i += 1;
                        continue;
                    }
                    self.flush(&mut pending, &mut out, area, heading);
                    let right = (area.right - rect.right() - SLACK).max(0.0);
                    let mut blocks = self.flow(
                        inner,
                        Area {
                            left: area.left,
                            right: rect.right(),
                        },
                        body,
                    );
                    for b in &mut blocks {
                        if b.json.get("type").and_then(|t| t.as_str()) == Some("p") {
                            // A right-to-left paragraph's indents are logical: the room on the right is its start's.
                            let side = if b.json.get("rtl").is_some() {
                                "left"
                            } else {
                                "right"
                            };
                            let had = b.json["indent"]
                                .get(side)
                                .and_then(|r| r.as_f64())
                                .unwrap_or(0.0);
                            b.json["indent"][side] = json!(round(had + right));
                        }
                    }
                    out.extend(blocks);
                    i = end + 1;
                    continue;
                }
                Kind::Seg(s)
                    if s.horizontal()
                        && ((s.x1 - s.x0) > 0.9 * (area.right - area.left)
                            || self.after_par(ids, i)) =>
                {
                    // A rule across the area (`line(length: 100%)`), or a shorter one between paragraphs (a blank
                    // under a label): an empty paragraph with a bottom border.
                    let inline = pending.iter().any(|&p| matches!(&self.items[p].kind, Kind::Text(t) if (t.y - s.y0).abs() < t.size));
                    // Dashed or dotted (a "cut here" line): a paragraph's shading is solid, so a picture of it, which
                    // holds no text to edit.
                    if !inline && s.dash.is_some() {
                        self.flush(&mut pending, &mut out, area, heading);
                        let t = s.thickness / 2.0;
                        let room = Rect { x: s.x0, y: s.y0 - t, w: s.x1 - s.x0, h: s.thickness };
                        let mut json = Map::new();
                        json.insert("type".into(), json!("drawing"));
                        json.insert("width".into(), json!(round(room.w)));
                        json.insert("height".into(), json!(round(room.h)));
                        json.insert("indent".into(), json!(round(room.x - area.left)));
                        if let Some((k, p)) = self.picture(&ids[i..=i], room, true) {
                            json.insert(
                                "picture".into(),
                                json!({ "index": k, "x": round(p.x - room.x), "y": round(p.y - room.y) }),
                            );
                        }
                        out.push(Block {
                            page: self.items[id].page,
                            end_page: self.items[id].page,
                            top: room.y,
                            bottom: room.bottom(),
                            json,
                        });
                        i += 1;
                        continue;
                    }
                    if !inline {
                        self.flush(&mut pending, &mut out, area, heading);
                        let mut json = Map::new();
                        json.insert("type".into(), json!("rule"));
                        json.insert("thickness".into(), json!(round(s.thickness)));
                        json.insert("color".into(), json!(s.color));
                        json.insert("indent".into(), json!({ "left": round(s.x0 - area.left), "right": round(area.right - s.x1) }));
                        out.push(Block {
                            page: self.items[id].page,
                            end_page: self.items[id].page,
                            top: s.y0 - s.thickness / 2.0,
                            bottom: s.y0 + s.thickness / 2.0,
                            json,
                        });
                        i += 1;
                        continue;
                    }
                    pending.push(id);
                }
                Kind::Rect(rect)
                    if !self.beside(&pending, *rect, items[id].page) && !self.highlight(ids, i, *rect) =>
                {
                    // A box drawn without a frame: a framed block of what is drawn in it, as a framed group is.
                    let end = self.drawn_over(ids, i, *rect);
                    self.flush(&mut pending, &mut out, area, heading);
                    if let Some(b) =
                        self.framed_items(items[id].page, &ids[i + 1..=end], *rect, area)
                    {
                        out.push(b);
                    }
                    i = end + 1;
                    continue;
                }
                Kind::Drawing(rect) if !self.in_line(&pending, *rect, self.items[id].page) => {
                    self.flush(&mut pending, &mut out, area, heading);
                    // What is drawn over it (a rounded card's text) is part of the picture.
                    let end = self.drawn_over(ids, i, *rect);
                    let mut json = Map::new();
                    json.insert("type".into(), json!("drawing"));
                    json.insert("width".into(), json!(round(rect.w)));
                    json.insert("height".into(), json!(round(rect.h)));
                    json.insert("indent".into(), json!(round(rect.x - area.left)));
                    if let Some((k, p)) = self.picture(&ids[i..=end], *rect, true) {
                        json.insert(
                            "picture".into(),
                            json!({ "index": k, "x": round(p.x - rect.x), "y": round(p.y - rect.y) }),
                        );
                    }
                    out.push(Block {
                        page: self.items[id].page,
                        end_page: self.items[id].page,
                        top: rect.y,
                        bottom: rect.bottom(),
                        json,
                    });
                    i = end;
                }
                _ => pending.push(id),
            }
            i += 1;
        }
        self.flush(&mut pending, &mut out, area, heading);
        out
    }

    /// A picture of what items draw on the page of the first (#133), covering `room` (and with `ink` what they draw
    /// outside it): its index in the model's pictures, and where it is on the page.
    fn picture(&mut self, ids: &[usize], room: Rect, ink: bool) -> Option<(usize, Rect)> {
        let page = self.items[*ids.first()?].page;
        let drawn: Vec<(Point, FrameItem)> = ids
            .iter()
            .filter(|&&id| self.items[id].page == page)
            .filter_map(|&id| self.items[id].drawn.clone())
            .collect();
        let p = picture::render(&drawn, (room.x, room.y, room.w, room.h), ink)?;
        // Free-form content with text in it: Word would keep the text editable if Typst drew the box otherwise.
        let text = ids
            .iter()
            .any(|&id| matches!(self.items[id].kind, Kind::Text(_)));
        if let Some((span, what)) = drawn
            .first()
            .and_then(|(_, item)| picture::free_form(item))
            .filter(|_| text || matches!(drawn[0].1, FrameItem::Group(_)))
        {
            if !self.fallbacks.iter().any(|(s, _)| *s == span) {
                self.fallbacks.push((span, what));
            }
        }
        let rect = Rect {
            x: p.x,
            y: p.y,
            w: p.width,
            h: p.height,
        };
        let mut json = json!({
            "width": round(p.width),
            "height": round(p.height),
            "page": page,
            "x": round(p.x),
            "y": round(p.y),
        });
        // Its description: an image's `alt`, or the one a marker before it carries (edu's drawings).
        let alt = drawn
            .iter()
            .find_map(|(_, item)| match item {
                FrameItem::Image(image, ..) => image.alt().map(str::to_string),
                _ => None,
            })
            .or_else(|| self.drawing_alt(ids[0]));
        if let Some(alt) = alt.filter(|a| !a.is_empty()) {
            json["alt"] = json!(alt);
        }
        self.picture_json.push(json);
        self.pictures.push(p);
        Some((self.pictures.len() - 1, rect))
    }

    /// The description a `<typstream-drawing>` marker (`metadata((alt: …))`, edu's drawings) carries for the drawing
    /// right after it: only tags and groups opening between them.
    fn drawing_alt(&self, id: usize) -> Option<String> {
        for item in self.items[..id].iter().rev().take(8) {
            match &item.kind {
                Kind::Start(elem, _) => {
                    let value = elem
                        .to_packed::<typst::introspection::MetadataElem>()
                        .map(|m| m.value.clone());
                    if let (true, Some(Value::Dict(dict))) = (drawing_marker(elem), value) {
                        return match dict.get("alt") {
                            Ok(Value::Str(s)) => Some(s.to_string()),
                            _ => None,
                        };
                    }
                }
                Kind::End(_) | Kind::Group(..) => {}
                _ => return None,
            }
        }
        None
    }

    /// The columns a group at `ids[i]` lays out (Typst's `columns`): its direct groups, as wide as each other, side by
    /// side at its top, filling it; the first one may be inlined into the group. Their left edges.
    fn columns_of(&self, ids: &[usize], i: usize, rect: Rect) -> Option<Vec<f64>> {
        let end = group_end(&self.items, ids, i).min(ids.len() - 1);
        let mut depth = 0;
        let mut children: Vec<Rect> = Vec::new();
        for &id in &ids[i + 1..end] {
            match &self.items[id].kind {
                Kind::Group(r, _) => {
                    if depth == 0 {
                        children.push(*r);
                    }
                    depth += 1;
                }
                Kind::GroupEnd => depth -= 1,
                _ => {}
            }
        }
        let top: Vec<Rect> = children
            .into_iter()
            .filter(|r| (r.y - rect.y).abs() < 0.5)
            .collect();
        let w = top.iter().map(|r| r.w).fold(0.0, f64::max);
        let mut xs: Vec<f64> = top
            .iter()
            .filter(|r| (r.w - w).abs() < 0.5)
            .map(|r| r.x)
            .collect();
        xs.dedup_by(|a, b| (*a - *b).abs() < 0.5);
        if xs.first().is_some_and(|x| *x > rect.x + 0.5) {
            xs.insert(0, rect.x);
        }
        if xs.len() < 2 || w < 10.0 {
            return None;
        }
        let gap = xs[1] - xs[0] - w;
        let even = xs.windows(2).all(|p| (p[1] - p[0] - w - gap).abs() < 0.5);
        let fills =
            (xs.last().unwrap() + w - rect.right()).abs() < 1.0 && (xs[0] - rect.x).abs() < 0.5;
        (gap >= 0.0 && even && fills).then_some(xs)
    }

    /// Typst's columns as Word's: each column's blocks, a column break between them, in a section of their own.
    fn columns(&mut self, ids: &[usize], rect: Rect, xs: &[f64], page: usize) -> Block {
        let w = rect.right() - xs.last().unwrap();
        let gap = if xs.len() > 1 { xs[1] - xs[0] - w } else { 0.0 };
        let column = |x: f64| xs.iter().rposition(|c| x >= c - 0.5).unwrap_or(0);
        // Items go to the column they are drawn in; ends follow their starts.
        let mut parts: Vec<Vec<usize>> = vec![Vec::new(); xs.len()];
        let mut started: HashMap<Location, usize> = HashMap::new();
        let mut groups: Vec<usize> = Vec::new();
        let mut current = 0;
        for &id in ids {
            let k = match &self.items[id].kind {
                Kind::Text(t) => column(t.x),
                Kind::Seg(s) => column(s.x0),
                Kind::Fill(r, _) | Kind::Drawing(r) | Kind::Link(r, _) | Kind::Rect(r) => {
                    column(r.x)
                }
                Kind::Group(r, _) => {
                    let k = column(r.x);
                    groups.push(k);
                    k
                }
                Kind::GroupEnd => groups.pop().unwrap_or(current),
                Kind::Start(elem, at) => {
                    let k = column(at.x.to_pt());
                    if let Some(loc) = elem.location() {
                        started.insert(loc, k);
                    }
                    k
                }
                Kind::End(loc) => started.get(loc).copied().unwrap_or(current),
                // With its equation.
                Kind::Math(_) => current,
            };
            current = k;
            parts[k].push(id);
        }
        let mut cols = Vec::new();
        let mut last = rect.y;
        for (k, part) in parts.iter().enumerate() {
            let area = Area {
                left: xs[k],
                right: xs[k] + w,
            };
            let blocks = self.flow(part, area, false);
            last = blocks.iter().map(|b| b.bottom).fold(last, f64::max);
            let blocks = self.with_gaps_from(blocks, rect.y);
            cols.push(Json::Array(
                blocks.into_iter().map(|b| Json::Object(b.json)).collect(),
            ));
        }
        let mut json = Map::new();
        json.insert("type".into(), json!("columns"));
        json.insert("gap".into(), json!(round(gap)));
        json.insert("columns".into(), Json::Array(cols));
        // Where its text ends, for `with_gaps`: columns filling the page don't end at its bottom.
        json.insert("last".into(), json!(last));
        Block {
            page,
            end_page: page,
            top: rect.y,
            bottom: rect.bottom().max(last),
            json,
        }
    }

    /// Index (into `ids`) of the last item after `ids[i]` drawn inside `rect`, on its page.
    /// Whether the box at `ids[i]` is a fill behind one line of words and no frame (a `highlight` starting a line or
    /// a list item's body): their runs' shading, not a framed block.
    fn highlight(&self, ids: &[usize], i: usize, rect: Rect) -> bool {
        let end = self.drawn_over(ids, i, rect);
        let inner = &ids[i + 1..=end.min(ids.len() - 1)];
        let mut baselines = inner.iter().filter_map(|&p| match &self.items[p].kind {
            Kind::Text(t) => Some((t.y, t.size)),
            _ => None,
        });
        let filled = inner.first().is_some_and(|&p| matches!(self.items[p].kind, Kind::Fill(..)));
        let framed = inner.iter().any(|&p| matches!(self.items[p].kind, Kind::Seg(_)));
        filled
            && !framed
            && baselines.next().is_some_and(|(y, size)| {
                rect.h < (TOP + BOTTOM) * size + 5.0 && baselines.all(|(y2, _)| (y2 - y).abs() < 0.5)
            })
    }

    fn drawn_over(&self, ids: &[usize], i: usize, rect: Rect) -> usize {
        let page = self.items[ids[i]].page;
        let inside = |r: Rect| {
            r.x >= rect.x - 0.5
                && r.y >= rect.y - 0.5
                && r.right() <= rect.right() + 0.5
                && r.bottom() <= rect.bottom() + 0.5
        };
        // Elements that start inside: their ends go with them.
        let mut opened = Vec::new();
        let mut j = i;
        while j + 1 < ids.len() {
            let next = &self.items[ids[j + 1]];
            if next.page != page {
                break;
            }
            let end = match &next.kind {
                Kind::Text(t) => inside(Rect {
                    x: t.x,
                    y: t.y - 0.75 * t.size,
                    w: t.width,
                    h: 0.75 * t.size,
                })
                .then_some(j + 1),
                Kind::Seg(s) => inside(Rect {
                    x: s.x0,
                    y: s.y0,
                    w: s.x1 - s.x0,
                    h: s.y1 - s.y0,
                })
                .then_some(j + 1),
                Kind::Fill(r, _) | Kind::Drawing(r) | Kind::Link(r, _) | Kind::Rect(r) => {
                    inside(*r).then_some(j + 1)
                }
                Kind::Group(r, _) => inside(*r).then(|| group_end(&self.items, ids, j + 1)),
                // With its equation, which came before.
                Kind::Math(_) => Some(j + 1),
                // A start on the drawing's right or bottom edge is something beside it (the next cell).
                Kind::Start(elem, at) => {
                    let (x, y) = (at.x.to_pt(), at.y.to_pt());
                    let ok = x >= rect.x - 0.5
                        && y >= rect.y - 0.5
                        && x < rect.right() - 0.5
                        && y < rect.bottom() - 0.5;
                    if ok {
                        opened.extend(elem.location());
                    }
                    ok.then_some(j + 1)
                }
                Kind::End(loc) => opened.contains(loc).then_some(j + 1),
                Kind::GroupEnd => None,
            };
            match end {
                Some(e) => j = e,
                None => break,
            }
        }
        j
    }

    /// Placed text as framed paragraphs, at the page position of its lines; `None` when it draws anything else.
    fn placed(&mut self, ids: &[usize], area: Area) -> Option<Vec<Block>> {
        let mut texts = Vec::new();
        for &id in ids {
            match &self.items[id].kind {
                Kind::Text(t) => texts.push(t.clone()),
                Kind::Start(..)
                | Kind::End(_)
                | Kind::Group(_, false)
                | Kind::GroupEnd
                | Kind::Link(..) => {}
                _ => return None,
            }
        }
        let x0 = texts.iter().map(|t| t.x).fold(f64::MAX, f64::min);
        let x1 = texts.iter().map(|t| t.x + t.inked).fold(f64::MIN, f64::max);
        let top = texts
            .iter()
            .map(|t| t.y - TOP * t.size)
            .fold(f64::MAX, f64::min);
        let bottom = texts
            .iter()
            .map(|t| t.y + BOTTOM * t.size)
            .fold(f64::MIN, f64::max);
        if texts.is_empty() {
            return None;
        }
        let mut blocks = self.paragraphs(ids, area, None);
        for b in &mut blocks {
            b.json
                .insert("indent".into(), json!({ "left": 0.0, "firstLine": 0.0 }));
            b.json.insert("align".into(), json!("start"));
            b.json.remove("tabs");
            b.json.remove("fit");
            b.json.insert(
                "frame".into(),
                json!({ "x": round(x0), "y": round(top), "width": round(x1 - x0 + 2.0 * SLACK), "height": round(bottom - top) }),
            );
        }
        Some(blocks)
    }

    /// A picture of what a `place` draws, anchored to the page where Typst drew it.
    fn placed_picture(&mut self, ids: &[usize]) -> Option<Block> {
        let page = self.items[*ids.first()?].page;
        let mut room: Option<Rect> = None;
        for &id in ids.iter().filter(|&&id| self.items[id].page == page) {
            let r = match &self.items[id].kind {
                Kind::Text(t) => Rect {
                    x: t.x,
                    y: t.y - TOP * t.size,
                    w: t.width,
                    h: PITCH * t.size,
                },
                Kind::Seg(s) => Rect {
                    x: s.x0,
                    y: s.y0,
                    w: s.x1 - s.x0,
                    h: s.y1 - s.y0,
                },
                Kind::Fill(r, _) | Kind::Drawing(r) | Kind::Rect(r) | Kind::Group(r, _) => *r,
                _ => continue,
            };
            room = Some(match room {
                None => r,
                Some(a) => {
                    let (x0, y0) = (a.x.min(r.x), a.y.min(r.y));
                    Rect {
                        x: x0,
                        y: y0,
                        w: a.right().max(r.right()) - x0,
                        h: a.bottom().max(r.bottom()) - y0,
                    }
                }
            });
        }
        let room = room?;
        let (k, p) = self.picture(ids, room, true)?;
        let mut json = Map::new();
        json.insert("type".into(), json!("drawing"));
        json.insert("width".into(), json!(round(p.w)));
        json.insert("height".into(), json!(round(p.h)));
        json.insert("indent".into(), json!(0.0));
        json.insert("placed".into(), json!(true));
        json.insert("picture".into(), json!({ "index": k, "x": 0.0, "y": 0.0 }));
        Some(Block {
            page,
            end_page: page,
            top: p.y,
            bottom: p.bottom(),
            json,
        })
    }

    /// Whether text gathered for the paragraph shares a line with `rect` (an inline box, not a block).
    fn beside(&self, pending: &[usize], rect: Rect, page: usize) -> bool {
        pending.iter().any(|&p| match &self.items[p].kind {
            Kind::Text(t) => {
                self.items[p].page == page && t.y > rect.y && t.y - TOP * t.size < rect.bottom()
            }
            _ => false,
        })
    }

    fn in_line(&self, pending: &[usize], rect: Rect, page: usize) -> bool {
        pending.iter().any(|&p| match &self.items[p].kind {
            Kind::Text(t) => {
                self.items[p].page == page && (t.y - rect.bottom()).abs() < 2.0 * t.size
            }
            _ => false,
        })
    }

    /// Index (into `ids`) of the end tag of the element started at `ids[i]`, or the last item.
    fn end_of(&self, ids: &[usize], i: usize, elem: &Content) -> usize {
        let Some(loc) = elem.location() else { return i };
        for (j, &id) in ids.iter().enumerate().skip(i + 1) {
            if let Kind::End(l) = &self.items[id].kind {
                if *l == loc {
                    return j;
                }
            }
        }
        ids.len() - 1
    }

    /// The paragraph in `pending`, if it has text.
    fn flush(
        &mut self,
        pending: &mut Vec<usize>,
        out: &mut Vec<Block>,
        area: Area,
        heading: Option<usize>,
    ) {
        if pending.is_empty() {
            return;
        }
        let ids = std::mem::take(pending);
        out.extend(self.paragraphs(&ids, area, heading));
    }

    /// Lines from text items, links and underline strokes.
    fn lines(&mut self, ids: &[usize]) -> Vec<Line> {
        let mut texts: Vec<(usize, Text)> = Vec::new();
        let mut text_ids: Vec<usize> = Vec::new();
        let mut segs: Vec<(usize, Seg)> = Vec::new();
        let mut links: Vec<(usize, Rect, String)> = Vec::new();
        // Boxes of what is drawn: an equation's pieces (with its index in `equations`, and their baseline), or
        // drawings (with the item); and the item they come from.
        let mut boxes: Vec<(usize, Rect, Option<usize>, Option<usize>, usize, f64)> = Vec::new();
        let mut sides: Vec<(usize, Seg)> = Vec::new();
        let mut rects: Vec<(usize, Rect, usize)> = Vec::new();
        // What is drawn behind words in their line (a `highlight`, a filled box): their runs' shading.
        let mut fills: Vec<(usize, Rect, String)> = Vec::new();
        let mut equations: Vec<Equation> = Vec::new();
        // The equation open, and its end tag.
        let mut equation: Option<(usize, Option<Location>)> = None;
        // A `repeat` open (an outline's dots), its end tag, and its fill's leader; then the leaders by page and band.
        let mut repeat: Option<(Option<Location>, Option<&'static str>)> = None;
        let mut leaders: Vec<(usize, f64, &'static str)> = Vec::new();
        for &id in ids {
            let page = self.items[id].page;
            let eq = equation.map(|(e, _)| e);
            // What a repeat draws is room a tab's leader fills in Word.
            if let Some((end, leader)) = &mut repeat {
                match &self.items[id].kind {
                    Kind::End(loc) if Some(*loc) == *end => {
                        repeat = None;
                    }
                    Kind::Text(t) => {
                        if leader.is_none() {
                            *leader = tab_leader(t.text.trim());
                            if let Some(l) = *leader {
                                leaders.push((page, t.y, l));
                            }
                        }
                    }
                    _ => {}
                }
                continue;
            }
            match &self.items[id].kind {
                Kind::Start(elem, _) if elem.func().name() == "repeat" && eq.is_none() => {
                    repeat = Some((elem.location(), None));
                }
                Kind::Text(t) if eq.is_none() => {
                    texts.push((page, t.clone()));
                    text_ids.push(id);
                }
                Kind::Text(t) => {
                    let e = &mut equations[eq.unwrap()];
                    if e.font.is_none() {
                        e.font = Some((self.fonts.get(&t.font), t.color.clone()));
                    }
                    boxes.push((
                        page,
                        Rect {
                            x: t.x,
                            y: t.y - t.size,
                            w: t.width,
                            h: t.size * 1.2,
                        },
                        eq,
                        None,
                        id,
                        t.y,
                    ));
                }
                Kind::Start(elem, _) if elem.func().name() == "equation" && eq.is_none() => {
                    equations.push(Equation {
                        math: None,
                        font: None,
                        size: 11.0,
                        written: false,
                    });
                    equation = Some((equations.len() - 1, elem.location()));
                }
                Kind::End(loc) if equation.is_some_and(|(_, end)| end == Some(*loc)) => {
                    equation = None
                }
                Kind::Math(math) => {
                    // Its marker comes after what the equation draws, inside its tags.
                    if let Some(e) = equations.last_mut().filter(|e| e.math.is_none()) {
                        e.size = math["size"].as_f64().unwrap_or(11.0);
                        e.math = Some(math["math"].clone());
                    }
                }
                // A fraction's bar, a root's line: part of the equation.
                Kind::Seg(s) if eq.is_some() => boxes.push((
                    page,
                    Rect {
                        x: s.x0.min(s.x1),
                        y: s.y0.min(s.y1),
                        w: (s.x1 - s.x0).abs(),
                        h: (s.y1 - s.y0).abs().max(0.1),
                    },
                    eq,
                    None,
                    id,
                    s.y0,
                )),
                Kind::Seg(s) if s.horizontal() => segs.push((page, s.clone())),
                Kind::Seg(s) => sides.push((page, s.clone())),
                Kind::Rect(r) if eq.is_none() => rects.push((page, *r, id)),
                Kind::Fill(r, c) if eq.is_none() => fills.push((page, *r, c.clone())),
                Kind::Link(r, url) => links.push((page, *r, url.clone())),
                Kind::Drawing(r) => boxes.push((page, *r, eq, Some(id), id, r.bottom())),
                _ => {}
            }
        }
        // An empty box stroked on its sides (a checkbox): Word underlines, it can't draw sides. A picture of it.
        for (page, r, id) in rects {
            let side = |x: f64| {
                sides.iter().find(|(p, s)| {
                    *p == page
                        && (s.x0 - x).abs() < 0.5
                        && s.y0.min(s.y1) <= r.y + r.h / 2.0
                        && s.y0.max(s.y1) >= r.y + r.h / 2.0
                })
            };
            let empty = !texts.iter().any(|(p, t)| {
                let x = t.x + t.width / 2.0;
                *p == page && x > r.x && x < r.right() && t.y > r.y && t.y < r.bottom()
            });
            if let (Some((_, s)), Some(_), true) = (side(r.x), side(r.right()), empty) {
                // With its stroke's outer half: a picture shows only what is inside it.
                let t = s.thickness / 2.0;
                let r = Rect {
                    x: r.x - t,
                    y: r.y - t,
                    w: r.w + 2.0 * t,
                    h: r.h + 2.0 * t,
                };
                boxes.push((page, r, None, Some(id), id, r.bottom()));
            }
        }
        // An equation's pieces merge into one box per line (two, when Typst broke it over lines).
        let mut lines: Vec<Line> = Vec::new();
        // page, x, w, baseline, text or box, the box's equation, the drawings in the box, its first item
        let mut atoms: Vec<(
            usize,
            f64,
            f64,
            f64,
            Option<Text>,
            Option<Rect>,
            Option<usize>,
            Vec<usize>,
            usize,
        )> = Vec::new();
        // Boxes: attach to the line whose baseline is inside them.
        let mut placeholders: Vec<(usize, Rect, Option<usize>, Vec<usize>, usize)> = Vec::new();
        let mut placeholder_lines: Vec<usize> = Vec::new();
        // Typst breaks an inline equation over lines: its pieces are on the text line whose baseline is nearest theirs
        // (a numerator's is above its line's, but less than a line's pitch). Baselines a few points apart (a
        // superscript's) are one line's.
        let mut baselines: Vec<(usize, f64)> = texts.iter().map(|(p, t)| (*p, t.y)).collect();
        baselines.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.total_cmp(&b.1)));
        baselines.dedup_by(|b, a| a.0 == b.0 && b.1 - a.1 < 4.0);
        let line_of = |page: usize, y: f64| {
            baselines
                .iter()
                .enumerate()
                .filter(|(_, (p, _))| *p == page)
                .min_by(|a, b| (a.1 .1 - y).abs().total_cmp(&(b.1 .1 - y).abs()))
                .map_or(0, |(k, _)| k)
        };
        for (page, r, eq, drawing, id, baseline) in boxes {
            let eq_line = if eq.is_some() {
                line_of(page, baseline)
            } else {
                0
            };
            // An equation's pieces on a line (a numerator, a denominator) make one box, wherever they are.
            let same = |(p, l): (&(usize, Rect, Option<usize>, Vec<usize>, usize), &usize)| {
                p.0 == page
                    && p.2 == eq
                    && (eq.is_some() && *l == eq_line
                        || eq.is_none()
                            && r.x <= p.1.right() + 1.0
                            && r.y < p.1.bottom()
                            && r.bottom() > p.1.y)
            };
            let at = match eq {
                Some(_) => placeholders.iter().zip(&placeholder_lines).rposition(same),
                None => placeholders
                    .len()
                    .checked_sub(1)
                    .filter(|&k| same((&placeholders[k], &placeholder_lines[k]))),
            };
            if let Some(last) = at.map(|k| &mut placeholders[k]) {
                {
                    let x0 = last.1.x.min(r.x);
                    let y0 = last.1.y.min(r.y);
                    let x1 = last.1.right().max(r.right());
                    let y1 = last.1.bottom().max(r.bottom());
                    last.1 = Rect {
                        x: x0,
                        y: y0,
                        w: x1 - x0,
                        h: y1 - y0,
                    };
                    last.3.extend(drawing);
                    continue;
                }
            }
            placeholders.push((page, r, eq, drawing.into_iter().collect(), id));
            placeholder_lines.push(eq_line);
        }
        // Text drawn on a drawing in the line (a rounded box's words) is part of its picture.
        let mut pictured = vec![false; texts.len()];
        for p in placeholders
            .iter_mut()
            .filter(|p| p.2.is_none() && !p.3.is_empty())
        {
            for (j, (page, t)) in texts.iter().enumerate() {
                let inside = *page == p.0
                    && t.x >= p.1.x - 0.5
                    && t.x + t.inked <= p.1.right() + 0.5
                    && t.y - 0.75 * t.size >= p.1.y - 0.5
                    && t.y <= p.1.bottom() + 0.5;
                if inside && !pictured[j] {
                    pictured[j] = true;
                    p.3.push(text_ids[j]);
                }
            }
            p.3.sort_unstable();
        }
        for (j, (page, t)) in texts.iter().enumerate() {
            // A mark's item has no text (its base has it).
            if !pictured[j] && !t.text.is_empty() {
                atoms.push((
                    *page,
                    t.x,
                    t.width,
                    t.y,
                    Some(t.clone()),
                    None,
                    None,
                    Vec::new(),
                    text_ids[j],
                ));
            }
        }
        for (page, r, eq, drawings, id) in placeholders {
            let baseline = texts
                .iter()
                .filter(|(p, t)| *p == page && t.y >= r.y - 1.0 && t.y <= r.bottom() + 1.0)
                .map(|(_, t)| t.y)
                .next()
                .unwrap_or(r.bottom());
            atoms.push((page, r.x, r.w, baseline, None, Some(r), eq, drawings, id));
        }
        // Atoms in document order by (page, baseline band, x) — text items keep their logical order within a line. A
        // band starts at a baseline 0.6 pt or more below the one before's start; bands are found first, as comparing
        // baselines with that tolerance isn't a total order (sorting by it panics).
        let mut by_y: Vec<usize> = (0..atoms.len()).collect();
        by_y.sort_by(|&a, &b| {
            atoms[a]
                .0
                .cmp(&atoms[b].0)
                .then(atoms[a].3.total_cmp(&atoms[b].3))
        });
        let mut band = vec![0usize; atoms.len()];
        let mut start: Option<(usize, f64)> = None;
        let mut n = 0;
        for &k in &by_y {
            let (page, y) = (atoms[k].0, atoms[k].3);
            if start.is_none_or(|(p, y0)| p != page || y - y0 >= 0.6) {
                n += 1;
                start = Some((page, y));
            }
            band[k] = n;
        }
        // A line with right-to-left text keeps its items' order, which is logical (typst-layout sorts a line's items
        // back for introspection; the Linearizer reversed RTL runs' pieces): by x, it would be visual (#134).
        let mut rtl_band = vec![false; n + 1];
        for (k, a) in atoms.iter().enumerate() {
            if a.4.as_ref().is_some_and(|t| t.rtl) {
                rtl_band[band[k]] = true;
            }
        }
        let mut order: Vec<usize> = (0..atoms.len()).collect();
        order.sort_by(|&a, &b| {
            band[a].cmp(&band[b]).then(if rtl_band[band[a]] {
                atoms[a].8.cmp(&atoms[b].8)
            } else {
                atoms[a].1.total_cmp(&atoms[b].1)
            })
        });
        // The line's base direction: right to left when it reads leftwards, or holds one run that does.
        let mut base_rtl = vec![false; n + 1];
        for b in (1..=n).filter(|&b| rtl_band[b]) {
            let line: Vec<usize> = order.iter().copied().filter(|&k| band[k] == b).collect();
            if let (Some(&first), Some(&last)) = (line.first(), line.last()) {
                base_rtl[b] = if atoms[first].1 > atoms[last].1 + 0.01 {
                    true
                } else if atoms[first].1 + atoms[first].2 < atoms[last].1 + 0.01 && first != last {
                    false
                } else {
                    atoms[first].4.as_ref().is_some_and(|t| t.rtl)
                };
            }
        }
        let mut prev: Option<usize> = None;
        for k in order {
            let (page, x, w, baseline, text, rect, eq, drawings, _) = atoms[k].clone();
            let new_line = match lines.last() {
                Some(l) => l.page != page || (l.baseline - baseline).abs() >= 0.6,
                None => true,
            };
            if new_line {
                prev = None;
                let first_word = text.as_ref().map(|t| t.first_word).unwrap_or(w);
                lines.push(Line {
                    page,
                    baseline,
                    size: 0.0,
                    left: x,
                    right: x + w,
                    runs: Vec::new(),
                    tall: false,
                    leader: None,
                    top: f64::MAX,
                    bottom: f64::MIN,
                    first_word,
                    rtl: base_rtl[band[k]],
                });
            }
            let line = lines.last_mut().unwrap();
            // A gap since the last atom: an exact-width space. In logical order, the room between it and the atom
            // before when nothing is drawn between them.
            let (gap, from) = match prev.filter(|_| rtl_band[band[k]]) {
                Some(p) => {
                    let (px, pw) = (atoms[p].1, atoms[p].2);
                    let (a, b) = if x + w <= px + 0.05 {
                        (x + w, px)
                    } else {
                        (px + pw, x)
                    };
                    let between = atoms.iter().enumerate().any(|(j, o)| {
                        band[j] == band[k]
                            && j != k
                            && j != p
                            && o.1 + o.2 > a + 0.05
                            && o.1 < b - 0.05
                    });
                    (if between { 0.0 } else { b - a }, a)
                }
                None => (x - line.right, line.right),
            };
            prev = Some(k);
            let (font, size) = match &text {
                Some(t) => (self.fonts.get(&t.font), t.size),
                None => (last_font(&line.runs).unwrap_or(0), 11.0),
            };
            if !line.runs.is_empty() && gap > 0.05 {
                // Split where strokes under it start and end: a blank next to `h(1fr)` is two gaps, one underlined.
                let mut cuts = vec![from, from + gap];
                for (p, s) in &segs {
                    if *p == page && underlines(s, baseline) {
                        cuts.extend(
                            [s.x0, s.x1]
                                .into_iter()
                                .filter(|&x| x > from + 0.5 && x < from + gap - 0.5),
                        );
                    }
                }
                // And where fills behind it start and end: a filled box's inset is shaded, the room beside it not.
                for (p, r, _) in &fills {
                    if *p == page {
                        cuts.extend(
                            [r.x, r.right()]
                                .into_iter()
                                .filter(|&x| x > from + 0.5 && x < from + gap - 0.5),
                        );
                    }
                }
                cuts.sort_by(f64::total_cmp);
                for c in cuts.windows(2).filter(|c| c[1] - c[0] > 0.05) {
                    let under = underlined(&segs, page, c[0], c[1], baseline);
                    let raise = under.as_ref().map_or(0.0, |u| self.raise(font, size, u.1));
                    line.runs.push(Run::Gap {
                        width: c[1] - c[0],
                        underline: under.map(|u| u.0),
                        raise,
                        font,
                        size,
                        fill: shaded(&fills, page, c[0], c[1], baseline),
                    });
                }
            }
            match (text, rect) {
                (Some(t), _) => {
                    let underline =
                        underlined(&segs, page, t.x, t.x + t.width, baseline).map(|u| u.0);
                    let link = links
                        .iter()
                        .find(|(p, r, _)| {
                            *p == page && r.contains(t.x + t.width / 2.0, t.y - t.size / 3.0)
                        })
                        .map(|l| l.2.clone());
                    line.size = line.size.max(t.size);
                    line.top = line.top.min(t.y - TOP * t.size);
                    line.bottom = line.bottom.max(t.y + BOTTOM * t.size);
                    // Text with no letters of a direction (punctuation, spaces, digits) in a right-to-left line reads
                    // right to left too, as the line around it: engines lay runs out by their direction.
                    let neutral = !t.text.chars().any(|c| bidi_class(c) == BidiClass::L);
                    let t = Text {
                        rtl: t.rtl || (line.rtl && neutral),
                        ..t
                    };
                    let fill = shaded(&fills, page, t.x, t.x + t.width, t.y);
                    // A stroke through the middle of the words (Typst's `strike`, at the font's strikeout position).
                    let mid = t.x + t.width / 2.0;
                    let strike = segs.iter().any(|(p, s)| {
                        *p == page
                            && s.x0 <= mid
                            && s.x1 >= mid
                            && s.y0 < t.y - 0.15 * t.size
                            && s.y0 > t.y - 0.6 * t.size
                            && s.thickness < 2.0
                    });
                    push_text(&mut line.runs, &t, font, underline, link, fill, strike);
                }
                (None, Some(r)) => {
                    match eq.map(|e| &mut equations[e]) {
                        // An equation broken over lines is Word's to break: all of it goes where it starts.
                        Some(Equation { written: true, .. }) => {}
                        Some(Equation {
                            math: Some(math),
                            font: Some((math_font, color)),
                            size: math_size,
                            written,
                        }) => {
                            *written = true;
                            line.runs.push(Run::Math {
                                math: math.clone(),
                                font: *math_font,
                                size: *math_size,
                                color: color.clone(),
                                display: false,
                            });
                        }
                        _ => {
                            // A picture as big as the room Typst gave it: Word sets one in a line as a character.
                            let picture = self
                                .picture(&drawings, r, false)
                                .map(|(k, p)| json!({ "index": k, "y": round(p.y - baseline) }));
                            line.runs.push(Run::Picture {
                                width: r.w,
                                font,
                                size,
                                picture,
                            })
                        }
                    }
                    if r.y < baseline - TOP * line.size.max(11.0) - 0.5
                        || r.bottom() > baseline + BOTTOM * line.size.max(11.0) + 0.5
                    {
                        line.tall = true;
                    }
                    line.top = line.top.min(r.y);
                    line.bottom = line.bottom.max(r.bottom());
                }
                _ => {}
            }
            line.left = line.left.min(x);
            line.right = line.right.max(x + w);
        }
        for line in lines.iter_mut() {
            line.leader = leaders
                .iter()
                .find(|(p, y, _)| *p == line.page && (y - line.baseline).abs() < 0.6)
                .map(|l| l.2);
        }
        // Underlines past the last atom (a blank at the end of a line: on its left in right-to-left text), and before
        // the first (a blank alone in a cell, its answer centred on it; one starting a line), nearest first: right
        // after the text, or after room (a term list's separator before a blank that is the whole description),
        // which is a gap of its own.
        for line in lines.iter_mut() {
            for end in [true, false] {
                let left_side = end == line.rtl;
                for _ in 0..segs.len() {
                    let (left, right) = (line.left, line.right);
                    let Some((_, s)) = segs
                        .iter()
                        .filter(|(p, s)| {
                            *p == line.page
                                && s.horizontal()
                                && s.y0 > line.baseline - 1.0
                                && s.y0 < line.baseline + 0.6 * line.size.max(8.0)
                                && if left_side {
                                    s.x0 < left - 0.5
                                } else {
                                    s.x1 > right + 0.5
                                }
                        })
                        .min_by(|(_, a), (_, b)| {
                            if left_side {
                                b.x1.total_cmp(&a.x1)
                            } else {
                                a.x0.total_cmp(&b.x0)
                            }
                        })
                    else {
                        break;
                    };
                    let (room, width) = if left_side {
                        (left - s.x1, left.min(s.x1) - s.x0)
                    } else {
                        (s.x0 - right, s.x1 - right.max(s.x0))
                    };
                    let (font, size) = (last_font(&line.runs).unwrap_or(0), line.size.max(8.0));
                    let mut gaps = vec![Run::Gap {
                        width,
                        underline: Some(s.color.clone()),
                        raise: self.raise(font, size, s.y0 - line.baseline),
                        font,
                        size,
                        fill: None,
                    }];
                    if room > 0.05 {
                        gaps.insert(
                            0,
                            Run::Gap {
                                width: room,
                                underline: None,
                                raise: 0.0,
                                font,
                                size,
                                fill: None,
                            },
                        );
                    }
                    if end {
                        line.runs.extend(gaps);
                    } else {
                        gaps.reverse();
                        for (k, gap) in gaps.into_iter().enumerate() {
                            line.runs.insert(k, gap);
                        }
                    }
                    if left_side {
                        line.left = s.x0;
                    } else {
                        line.right = s.x1;
                    }
                }
            }
        }
        // A fill reaching past a line's words (a filled box's inset at its start or end): shaded room as wide.
        for line in lines.iter_mut() {
            let band = |r: &Rect| r.h < 36.0 && r.y < line.baseline && r.bottom() > line.baseline;
            let (font, size) = (last_font(&line.runs).unwrap_or(0), line.size.max(8.0));
            let gap = |width: f64, color: &str| Run::Gap {
                width,
                underline: None,
                raise: 0.0,
                font,
                size,
                fill: Some(color.to_string()),
            };
            let (left, right) = (line.left, line.right);
            if let Some((_, r, c)) = fills.iter().find(|(p, r, _)| {
                *p == line.page && band(r) && r.right() > right + 0.5 && r.x < right + 0.5
            }) {
                let run = gap(r.right() - right, c);
                if line.rtl {
                    line.runs.insert(0, run);
                } else {
                    line.runs.push(run);
                }
                line.right = r.right();
            }
            if let Some((_, r, c)) = fills.iter().find(|(p, r, _)| {
                *p == line.page && band(r) && r.x < left - 0.5 && r.right() > left - 0.5
            }) {
                let run = gap(left - r.x, c);
                if line.rtl {
                    line.runs.push(run);
                } else {
                    line.runs.insert(0, run);
                }
                line.left = r.x;
            }
        }
        lines.retain(|l| !l.runs.is_empty());
        for l in lines.iter_mut() {
            if l.size == 0.0 {
                l.size = 11.0;
            }
            if l.top == f64::MAX {
                l.top = l.baseline - TOP * l.size;
                l.bottom = l.baseline + BOTTOM * l.size;
            }
        }
        lines
    }

    /// Paragraphs from items: one, or one per run of lines Typst was told to break (`\`) when their pitches
    /// differ, as Word's exact spacing is one pitch per paragraph; lines of one pitch get a line break.
    fn paragraphs(&mut self, ids: &[usize], area: Area, heading: Option<usize>) -> Vec<Block> {
        let lines = self.lines(ids);
        if lines.len() < 2 {
            return self
                .paragraph_of(lines, ids, area, heading)
                .into_iter()
                .collect();
        }
        let width = area.right - area.left;
        let mut groups: Vec<Vec<Line>> = vec![Vec::new()];
        let mut breaks: Vec<bool> = Vec::new();
        let n = lines.len();
        let mut iter = lines.into_iter().peekable();
        let mut k = 0;
        // How much wider the area would have to be for a line to take the next one's first word (a line's text ends
        // with the space before it, where there is one): room up to that is slack an engine measuring a hair wider
        // can use.
        let mut fit = f64::MAX;
        while let Some(line) = iter.next() {
            // Room left on the line: on its right (its left in right-to-left text), or on both sides when it is
            // centered.
            let centered = ((line.left - area.left) - (area.right - line.right)).abs() < 1.0;
            let room = if centered {
                width - (line.right - line.left)
            } else if line.rtl {
                line.left - area.left
            } else {
                area.right - line.right
            };
            let forced = match iter.peek() {
                // The next line's first word would have fitted after this one: Typst didn't choose to break. Or the
                // line ends in a word without the space Typst keeps where it breaks a line (Latin text breaks at
                // spaces): a `\` there took it, where Typst would have broken anyway (a card's question).
                Some(next) if next.page == line.page => {
                    (room > next.first_word + 1.0 && (line.right - line.left) < width - 1.0)
                        || (!line.rtl && ends_word(&line.runs))
                }
                _ => false,
            };
            // Only where Typst chose to break: more room doesn't move a word over a line break it was told to make
            // (a code block's lines, `\`), which would leave such a paragraph no slack at all.
            if let Some(next) = iter.peek().filter(|n| n.page == line.page && !forced) {
                fit = fit.min(
                    next.first_word
                        - if centered {
                            area.right - line.right
                        } else {
                            room
                        },
                );
            }
            let next_size = iter.peek().map(|n| n.size);
            // Lines broken on purpose further apart than the pitch (an empty line, `\` alone, between stanzas):
            // Word's exact spacing has one pitch for a paragraph's lines, so the next starts a paragraph, the room
            // above it its space before.
            let spaced = forced
                && iter.peek().is_some_and(|n| {
                    !n.tall
                        && !line.tall
                        && n.baseline - line.baseline > PITCH * n.size.max(line.size) + 0.5
                });
            groups.last_mut().unwrap().push(line);
            k += 1;
            // A line in another size is another paragraph whatever broke it: Word's exact spacing is one pitch for a
            // paragraph.
            let resized = next_size
                .is_some_and(|s| (s - groups.last().unwrap().last().unwrap().size).abs() >= 0.01);
            if resized && !forced && k < n {
                groups.push(Vec::new());
                breaks.push(false);
            } else if forced && k < n {
                let same = !spaced
                    && next_size.is_some_and(|s| {
                        (s - groups.last().unwrap().last().unwrap().size).abs() < 0.01
                    });
                if same {
                    breaks.push(true);
                } else {
                    groups.push(Vec::new());
                    breaks.push(false);
                }
            } else if k < n {
                breaks.push(false);
            }
        }
        let mut out = Vec::new();
        let mut b = 0;
        for mut group in groups {
            // Lines broken on purpose within a group end with a line break.
            let count = group.len();
            for (j, line) in group.iter_mut().enumerate() {
                if j + 1 < count && breaks.get(b).copied().unwrap_or(false) {
                    line.runs.push(Run::Break);
                }
                b += 1;
            }
            out.extend(self.paragraph_of(group, ids, area, heading));
        }
        // Lines all broken on purpose: any room past them is slack.
        let fit = fit.min(FORCED_FIT);
        for b in &mut out {
            b.json.insert("fit".into(), json!(fit));
        }
        out
    }

    /// A paragraph from its lines.
    fn paragraph_of(
        &mut self,
        mut lines: Vec<Line>,
        ids: &[usize],
        area: Area,
        heading: Option<usize>,
    ) -> Option<Block> {
        let list: Option<Json> = None;
        // A right-to-left paragraph (#134) is measured from the right: Word's alignment, indents and tab stops are
        // logical in one (`bidi`).
        let rtl = lines.first().is_some_and(|l| l.rtl);
        if rtl {
            for line in lines.iter_mut() {
                (line.left, line.right) = (
                    area.left + area.right - line.right,
                    area.left + area.right - line.left,
                );
            }
        }
        // A gap that takes what's left of a line (`h(1fr)`), so its last words end at the right edge: a tab to a
        // right tab stop there, as Word writes it. An exact gap would fill the line to a hundredth of a point, and an
        // engine measuring a hair wider would push the last words onto a line of their own.
        // An outline entry's dots (a `repeat`) are a tab too, with a leader, to where its page number ends.
        let mut right_tab = false;
        let mut tab_at = area.right;
        for line in lines.iter_mut() {
            if line.leader.is_some() {
                tab_at = line.right;
            } else if (line.right - area.right).abs() > 0.6 {
                continue;
            }
            if let Some(k) = line.runs.iter().rposition(
                |r| matches!(r, Run::Gap { width, underline: None, fill: None, .. } if *width >= 2.0),
            ) {
                let after_text = line.runs[k + 1..]
                    .iter()
                    .any(|r| matches!(r, Run::Text { .. }));
                if after_text {
                    line.runs[k] = Run::Tab;
                    right_tab = true;
                }
            }
        }
        // A line with only blank, space-like runs can't hold a paragraph of its own unless it underlines something.
        if lines.is_empty() {
            // An empty paragraph that only draws strokes (a cell's blank line): one gap run.
            let segs: Vec<(usize, Seg)> = ids
                .iter()
                .filter_map(|&id| match &self.items[id].kind {
                    Kind::Seg(s) if s.horizontal() => Some((self.items[id].page, s.clone())),
                    _ => None,
                })
                .collect();
            let (page, s) = segs.first()?.clone();
            let size = 11.0;
            // The baseline where the underline of a gap in the paragraph's font lands on the stroke.
            let baseline = s.y0 - self.raise(0, size, 0.0);
            lines.push(Line {
                page,
                baseline,
                size,
                left: s.x0,
                right: s.x1,
                runs: vec![Run::Gap {
                    width: s.x1 - s.x0,
                    underline: Some(s.color.clone()),
                    raise: 0.0,
                    font: 0,
                    size,
                    fill: None,
                }],
                tall: false,
                leader: None,
                first_word: s.x1 - s.x0,
                rtl: false,
                top: baseline - TOP * size,
                bottom: baseline + BOTTOM * size,
            });
            if self.fonts.data.is_empty() {
                return None;
            }
        }
        let first = &lines[0];
        let width = area.right - area.left;
        let lefts: Vec<f64> = lines.iter().map(|l| l.left - area.left).collect();
        let rights: Vec<f64> = lines.iter().map(|l| area.right - l.right).collect();
        // (A centred paragraph's longest line may fill the area.)
        let centered = !right_tab
            && lines
                .iter()
                .all(|l| ((l.left - area.left) - (area.right - l.right)).abs() < 1.0)
            && lefts.iter().any(|l| *l > 2.0);
        let right_aligned = !right_tab
            && !centered
            && rights.iter().all(|r| r.abs() < 1.0)
            && lefts.iter().all(|l| *l > 2.0);
        let (align, indent_left, first_line) = if centered {
            ("center", 0.0, 0.0)
        } else if right_aligned {
            ("end", 0.0, 0.0)
        } else {
            let rest = if lefts.len() > 1 {
                lefts[1..].iter().cloned().fold(f64::MAX, f64::min)
            } else {
                lefts[0]
            };
            let indent = rest.min(lefts[0]).max(0.0);
            ("start", indent, lefts[0] - indent)
        };
        let _ = width;
        let size = lines.iter().map(|l| l.size).fold(0.0, f64::max);
        let tall = lines.iter().any(|l| l.tall);
        let mut runs: Vec<Json> = Vec::new();
        for (k, line) in lines.iter().enumerate() {
            // A line after one broken on purpose that starts further in (`\ #h(1.5em) A) …`): Word starts it at the
            // indent, so room as wide first.
            let after_break = k > 0 && matches!(lines[k - 1].runs.last(), Some(Run::Break));
            let extra = lefts[k] - indent_left;
            if after_break && align == "start" && !rtl && extra > 0.5 {
                let font = line.runs.iter().find_map(|r| match r {
                    Run::Text { font, .. } => Some(*font),
                    _ => None,
                });
                runs.push(json!({ "gap": round(extra), "font": font.unwrap_or(0), "size": round(line.size) }));
            }
            for run in &line.runs {
                let mut run = run_json(run);
                // A raised or lowered run makes an "at least" line taller (an exact one keeps its height).
                if tall {
                    run.as_object_mut().map(|m| m.remove("raise"));
                }
                // A picture Typst lowered below the baseline (a box with `baseline: 20%`): LibreOffice won't lower
                // a drawing in the line, so it is anchored to the line, its top this far below the line's (in an
                // exact line, the baseline is `TOP` ems below it).
                if let Some(p) = run.get_mut("picture").filter(|_| !tall) {
                    let (index, y) = (
                        p["index"].as_u64().unwrap_or(0) as usize,
                        p["y"].as_f64().unwrap_or(0.0),
                    );
                    let height = self.picture_json[index]["height"].as_f64().unwrap_or(0.0);
                    // (Not one whose stroke only reaches past it.)
                    if y + height > 0.5 {
                        p["line"] = json!(round(y + TOP * size));
                    }
                }
                runs.push(run);
            }
            // Lines join as they are: a line keeps the space it broke at.
            let _ = k;
        }
        let mut json = Map::new();
        json.insert("type".into(), json!("p"));
        if rtl {
            json.insert("rtl".into(), json!(true));
        }
        json.insert("align".into(), json!(align));
        json.insert(
            "indent".into(),
            json!({ "left": round(indent_left), "firstLine": round(first_line) }),
        );
        json.insert("pitch".into(), json!(round(PITCH * size)));
        if tall {
            json.insert("atLeast".into(), json!(true));
        }
        if right_tab {
            let mut tab = json!({ "pos": round(tab_at - area.left), "align": "end" });
            if let Some(leader) = lines.iter().find_map(|l| l.leader) {
                tab["leader"] = json!(leader);
            }
            json.insert("tabs".into(), json!([tab]));
        }
        json.insert("lines".into(), json!(lines.len()));
        if let Some(level) = heading {
            json.insert("heading".into(), json!(level));
        }
        if let Some(list) = list {
            json.insert("list".into(), list);
        }
        json.insert("runs".into(), Json::Array(runs));
        let last = lines.last().unwrap();
        Some(Block {
            page: first.page,
            end_page: last.page,
            top: first.top.min(first.baseline - TOP * first.size),
            bottom: last.bottom.max(last.baseline + BOTTOM * last.size),
            json,
        })
    }

    /// Whether `ids[i]` comes right after a paragraph's end: it is a block of its own.
    fn after_par(&self, ids: &[usize], i: usize) -> bool {
        let Some(Kind::End(loc)) = i.checked_sub(1).map(|k| &self.items[ids[k]].kind) else {
            return false;
        };
        ids[..i].iter().rev().any(|&j| {
            matches!(&self.items[j].kind, Kind::Start(e, _) if e.location() == Some(*loc) && e.func().name() == "par")
        })
    }

    /// A list: one paragraph per item's first paragraph, numbered; later paragraphs and nested lists indented.
    fn list(&mut self, ids: &[usize], area: Area) -> Vec<Block> {
        let mut out = Vec::new();
        let mut items: Vec<(Vec<usize>, Vec<usize>)> = Vec::new();
        // Where each item's body starts (its marker's position).
        let mut body_x: Vec<Option<f64>> = Vec::new();
        let mut depth = 0usize;
        let mut mode = 0; // 1: label, 2: body
        let mut stack: Vec<Location> = Vec::new();
        for &id in ids {
            match &self.items[id].kind {
                Kind::Start(elem, at) if depth == 0 => {
                    if let Some(marker) = elem.to_packed::<PdfMarkerTag>() {
                        match marker.kind {
                            PdfMarkerTagKind::ListItemLabel => {
                                items.push((Vec::new(), Vec::new()));
                                body_x.push(None);
                                mode = 1;
                                if let Some(l) = elem.location() {
                                    stack.push(l);
                                }
                                continue;
                            }
                            PdfMarkerTagKind::ListItemBody | PdfMarkerTagKind::TermsItemBody => {
                                if items.is_empty() || !items.last().unwrap().1.is_empty() {
                                    items.push((Vec::new(), Vec::new()));
                                    body_x.push(None);
                                }
                                if let Some(x) = body_x.last_mut() {
                                    *x = Some(at.x.to_pt());
                                }
                                mode = 2;
                                if let Some(l) = elem.location() {
                                    stack.push(l);
                                }
                                continue;
                            }
                            _ => {}
                        }
                    }
                    if mode == 2 {
                        if let Some(last) = items.last_mut() {
                            last.1.push(id);
                        }
                    }
                    if matches!(classify(elem, Point::zero(), 0), Node::List) {
                        depth += 1;
                    }
                }
                Kind::End(loc) if depth == 0 && stack.last() == Some(loc) => {
                    stack.pop();
                    mode = 0;
                }
                kind => {
                    if let Kind::End(_) = kind {
                        // A nested list's end.
                        if depth > 0 {
                            if let Some(last) = items.last_mut() {
                                last.1.push(id);
                            }
                            if self.ends_list(id, ids) {
                                depth -= 1;
                            }
                            continue;
                        }
                    }
                    match (mode, items.last_mut()) {
                        (1, Some(item)) => item.0.push(id),
                        (2, Some(item)) => item.1.push(id),
                        (_, Some(item)) if depth > 0 => item.1.push(id),
                        _ => {}
                    }
                }
            }
        }
        if items.is_empty() {
            return self.flow(ids, area, false);
        }
        // The labels' face, size and colour, as the first is set: Word sets a number as its paragraph's mark (the
        // first run's: a bold "T." made every number bold) unless its numbering says otherwise.
        let label_text = items.iter().find_map(|(label, _)| {
            label.iter().find_map(|&id| match &self.items[id].kind {
                Kind::Text(t) => Some(t.clone()),
                _ => None,
            })
        });
        let label_style = label_text.map(|t| (self.fonts.get(&t.font), t.size, t.color));
        // Labels: their text and where they sit.
        let labels: Vec<(String, f64, f64)> = items
            .iter()
            .map(|(label, _)| {
                let mut text = String::new();
                let (mut x0, mut x1) = (f64::MAX, f64::MIN);
                for &id in label {
                    if let Kind::Text(t) = &self.items[id].kind {
                        text.push_str(&t.text);
                        x0 = x0.min(t.x);
                        x1 = x1.max(t.x + t.width);
                    }
                }
                (text, x0, x1)
            })
            .collect();
        // The list's slot, taken before its items: a list nested in one takes the next.
        let id = self.lists.len();
        self.lists.push(Json::Null);
        let mut numbering = numbering(&labels.iter().map(|l| l.0.clone()).collect::<Vec<_>>());
        // A right-to-left list (#134) has its labels right of its bodies: measured from the area's right, as Word's
        // numbering is in a right-to-left paragraph, its bodies flowing in the whole area.
        let rtl = labels
            .iter()
            .zip(&body_x)
            .any(|(l, x)| x.is_some_and(|x| l.1 != f64::MAX && l.1 > x + 0.5));
        let labels: Vec<(String, f64, f64)> = if rtl {
            labels
                .into_iter()
                .map(|(t, x0, x1)| match x0 == f64::MAX {
                    true => (t, x0, x1),
                    false => (t, area.left + area.right - x1, area.left + area.right - x0),
                })
                .collect()
        } else {
            labels
        };
        let lefts: Vec<f64> = labels
            .iter()
            .filter(|l| l.1 != f64::MAX)
            .map(|l| l.1)
            .collect();
        let rights: Vec<f64> = labels
            .iter()
            .filter(|l| l.2 != f64::MIN)
            .map(|l| l.2)
            .collect();
        let same_left = lefts.windows(2).all(|w| (w[0] - w[1]).abs() < 0.3);
        let label_left = lefts.iter().cloned().fold(f64::MAX, f64::min);
        let label_right = rights.iter().cloned().fold(f64::MIN, f64::max);
        let mut body_left = f64::MAX;
        // Items whose body starts where Typst set its text: where in `out`, and that x.
        let mut starts: Vec<(usize, f64)> = Vec::new();
        for (k, (_, body)) in items.iter().enumerate() {
            // The body flows from where it starts, so a line as long as the room left reads as flush, not as
            // centred in the area; its blocks are then indented by as much.
            let left = body_x[k]
                .filter(|x| *x > area.left && *x < area.right && !rtl)
                .unwrap_or(area.left);
            let nested = self.lists.len();
            let body_area = Area {
                left,
                right: area.right,
            };
            // An item that is a blank on its label's line (`1. #box(stroke: (bottom: …))`, a matching exercise's): the
            // flow alone would see a framed box with nothing beside it, a rule under the label.
            let flow = match self.blank_line(&items[k].0, body) {
                Some(line) => self
                    .paragraph_of(vec![line], body, body_area, None)
                    .into_iter()
                    .collect(),
                None => self.flow(body, body_area, false),
            };
            // Lists nested in the body were measured from its start too.
            for l in &mut self.lists[nested..] {
                for key in ["labelLeft", "labelRight", "bodyLeft"] {
                    if let Some(v) = l.get(key).and_then(|v| v.as_f64()) {
                        l[key] = json!(round(v + left - area.left));
                    }
                }
            }
            let mut first = true;
            for (j, mut b) in flow.into_iter().enumerate() {
                shift(&mut b.json, left - area.left);
                if first && j == 0 && b.json.get("type") != Some(&json!("p")) {
                    // An item starting with a table or a drawing: Word numbers paragraphs only, so its label is text
                    // in a frame where Typst set it, and the list's labels are all text.
                    let label = &items[k].0;
                    if let Some(frame) = self.label_frame(label) {
                        out.push(frame);
                        numbering.0 = "none".into();
                    }
                    first = false;
                }
                if first && b.json.get("type") == Some(&json!("p")) {
                    // A one-line body Typst centred or right-aligned beside its label (`[1. run]` in a centred cell
                    // is a list): Word would centre the label with it. It starts where Typst set its text instead,
                    // from the list's body start or after a gap, its label where Typst has it.
                    let aligned = b.json.get("align").is_some_and(|a| a != "start");
                    let one_line = b.json.get("lines").and_then(|l| l.as_u64()) == Some(1);
                    if let Some(x) = self.text_start(body).filter(|_| aligned && one_line && !rtl) {
                        b.json.insert("align".into(), json!("start"));
                        b.json
                            .insert("indent".into(), json!({ "left": round(x - area.left), "firstLine": 0.0 }));
                        starts.push((out.len(), x));
                    }
                    let left = area.left + b.json["indent"]["left"].as_f64().unwrap_or(0.0);
                    body_left = body_left.min(left);
                    b.json
                        .insert("list".into(), json!({ "id": id, "label": labels[k].0 }));
                    first = false;
                }
                out.push(b);
            }
        }
        // Bodies set further right than the list's body start: a gap first.
        for (i, x) in starts {
            let runs = out[i].json.get_mut("runs").and_then(|r| r.as_array_mut());
            if let Some(runs) = runs.filter(|_| x - body_left > 0.05) {
                let first = runs.iter().find(|r| r.get("text").is_some());
                let (font, size) = first.map_or((json!(0), json!(11.0)), |r| (r["font"].clone(), r["size"].clone()));
                runs.insert(0, json!({ "gap": round(x - body_left), "font": font, "size": size }));
            }
        }
        self.lists[id] = json!({
            "format": numbering.0,
            "text": numbering.1,
            "start": numbering.2,
            "align": if same_left { "start" } else { "end" },
            "labelLeft": round(label_left - area.left),
            "labelRight": round(label_right - area.left),
            "bodyLeft": round(body_left - area.left),
        });
        if let Some((font, size, color)) = label_style {
            self.lists[id]["labelFont"] = json!(font);
            self.lists[id]["labelSize"] = json!(round(size));
            if color != "000000" {
                self.lists[id]["labelColor"] = json!(color);
            }
        }
        out
    }

    /// Where the first text of `ids` starts: the left of a one-line body's line.
    fn text_start(&self, ids: &[usize]) -> Option<f64> {
        ids.iter()
            .filter_map(|&id| match &self.items[id].kind {
                Kind::Text(t) => Some(t.x),
                _ => None,
            })
            .min_by(f64::total_cmp)
    }

    /// The line of a list item whose body is only blanks on its label's line, without text: an underlined gap per
    /// stroke, raised so Word's underline lands where Typst drew it.
    fn blank_line(&mut self, label: &[usize], body: &[usize]) -> Option<Line> {
        let (page, t) = label.iter().find_map(|&id| match &self.items[id].kind {
            Kind::Text(t) => Some((self.items[id].page, t.clone())),
            _ => None,
        })?;
        let mut segs: Vec<Seg> = Vec::new();
        for &id in body {
            match &self.items[id].kind {
                Kind::Seg(s)
                    if self.items[id].page == page
                        && s.horizontal()
                        && s.y0 > t.y - TOP * t.size
                        && s.y0 < t.y + BOTTOM * t.size + 1.0 =>
                {
                    segs.push(s.clone())
                }
                // A box's other edges, drawn as nothing (no stroke there).
                Kind::Seg(_) => return None,
                Kind::Text(_) | Kind::Fill(..) | Kind::Drawing(_) | Kind::Rect(_) | Kind::Math(_) => return None,
                _ => {}
            }
        }
        segs.sort_by(|a, b| a.x0.total_cmp(&b.x0));
        let first = segs.first()?;
        let font = self.fonts.get(&t.font);
        let mut runs = Vec::new();
        let mut right = first.x0;
        for s in &segs {
            if s.x0 > right + 0.05 {
                runs.push(Run::Gap {
                    width: s.x0 - right,
                    underline: None,
                    raise: 0.0,
                    font,
                    size: t.size,
                    fill: None,
                });
            }
            runs.push(Run::Gap {
                width: s.x1 - s.x0.max(right),
                underline: Some(s.color.clone()),
                raise: self.raise(font, t.size, s.y0 - t.y),
                font,
                size: t.size,
                fill: None,
            });
            right = right.max(s.x1);
        }
        Some(Line {
            page,
            baseline: t.y,
            size: t.size,
            left: first.x0,
            right,
            runs,
            tall: false,
            leader: None,
            first_word: right - first.x0,
            top: t.y - TOP * t.size,
            bottom: t.y + BOTTOM * t.size,
            rtl: t.rtl,
        })
    }

    /// A list label's text as a paragraph in a frame at its page position, taking no room (as `placed` text).
    fn label_frame(&mut self, ids: &[usize]) -> Option<Block> {
        let texts: Vec<(usize, Text)> = ids
            .iter()
            .filter_map(|&id| match &self.items[id].kind {
                Kind::Text(t) => Some((self.items[id].page, t.clone())),
                _ => None,
            })
            .collect();
        let (page, first) = texts.first()?.clone();
        let mut runs = Vec::new();
        for (_, t) in &texts {
            push_text(&mut runs, t, self.fonts.get(&t.font), None, None, None, false);
        }
        let x0 = texts.iter().map(|(_, t)| t.x).fold(f64::MAX, f64::min);
        let x1 = texts
            .iter()
            .map(|(_, t)| t.x + t.inked)
            .fold(f64::MIN, f64::max);
        let top = first.y - TOP * first.size;
        let mut json = Map::new();
        json.insert("type".into(), json!("p"));
        json.insert("align".into(), json!("start"));
        json.insert("indent".into(), json!({ "left": 0.0, "firstLine": 0.0 }));
        json.insert("pitch".into(), json!(round(PITCH * first.size)));
        json.insert("lines".into(), json!(1));
        json.insert(
            "runs".into(),
            Json::Array(runs.iter().map(run_json).collect()),
        );
        json.insert(
            "frame".into(),
            json!({ "x": round(x0), "y": round(top), "width": round(x1 - x0 + 2.0 * SLACK), "height": round(PITCH * first.size) }),
        );
        Some(Block {
            page,
            end_page: page,
            top,
            bottom: top + PITCH * first.size,
            json,
        })
    }

    fn ends_list(&self, id: usize, ids: &[usize]) -> bool {
        // Whether the end tag at `id` closes a list started among `ids`.
        let Kind::End(loc) = &self.items[id].kind else {
            return false;
        };
        ids.iter().any(|&j| matches!(&self.items[j].kind, Kind::Start(e, _) if e.location() == Some(*loc) && matches!(classify(e, Point::zero(), 0), Node::List)))
    }

    /// A display equation: a paragraph of its own, as tall as Typst set it, centred or where Typst put it; with its
    /// number, the equation goes to a centre tab and the number to a right one.
    fn display_equation(&mut self, ids: &[usize], area: Area) -> Option<Block> {
        let mut math = None;
        let mut numbered = false;
        let mut size = 11.0;
        let mut texts: Vec<(usize, &Text)> = Vec::new();
        let mut rects: Vec<(usize, Rect)> = Vec::new();
        // The equation's frame: as tall as Typst set it (glyphs' boxes are a guess at their extent).
        let mut frame: Option<Rect> = None;
        for &id in ids {
            let page = self.items[id].page;
            match &self.items[id].kind {
                Kind::Group(g, _) if frame.is_none() => frame = Some(*g),
                Kind::Math(m) => {
                    math = Some(m["math"].clone());
                    numbered = m["numbered"].as_bool().unwrap_or(false);
                    size = m["size"].as_f64().unwrap_or(11.0);
                }
                Kind::Text(t) => texts.push((page, t)),
                Kind::Seg(s) => rects.push((
                    page,
                    Rect {
                        x: s.x0.min(s.x1),
                        y: s.y0.min(s.y1),
                        w: (s.x1 - s.x0).abs(),
                        h: (s.y1 - s.y0).abs().max(0.1),
                    },
                )),
                Kind::Drawing(r) => rects.push((page, *r)),
                _ => {}
            }
        }
        let math = math?;
        let &(page, first) = texts.first()?;
        // The number: the last text, apart from the rest (Typst sets it at the area's edge).
        let mut number = None;
        if numbered && texts.len() > 1 {
            let (_, last) = texts[texts.len() - 1];
            let body = &texts[..texts.len() - 1];
            let right = body
                .iter()
                .map(|(_, t)| t.x + t.width)
                .fold(f64::MIN, f64::max);
            let left = body.iter().map(|(_, t)| t.x).fold(f64::MAX, f64::min);
            if last.x > right + 2.0 || last.x + last.width < left - 2.0 {
                number = texts.pop().map(|(_, t)| t.clone());
            }
        }
        for (p, t) in &texts {
            rects.push((
                *p,
                Rect {
                    x: t.x,
                    y: t.y - t.size,
                    w: t.width,
                    h: t.size * 1.25,
                },
            ));
        }
        let mut r = rects
            .iter()
            .filter(|(p, _)| *p == page)
            .map(|(_, r)| *r)
            .reduce(|a, b| {
                let x0 = a.x.min(b.x);
                let y0 = a.y.min(b.y);
                Rect {
                    x: x0,
                    y: y0,
                    w: a.right().max(b.right()) - x0,
                    h: a.bottom().max(b.bottom()) - y0,
                }
            })?;
        if let Some(f) = frame.filter(|f| f.h > 0.0) {
            r.y = f.y;
            r.h = f.h;
        }
        let font = self.fonts.get(&first.font);
        let width = area.right - area.left;
        let centered = ((r.x - area.left) - (area.right - r.right())).abs() < 2.0;
        let equation = |left: f64, align: &str| {
            let run = Run::Math {
                math: math.clone(),
                font,
                size,
                color: first.color.clone(),
                display: true,
            };
            json!({
                "type": "p",
                "align": align,
                "indent": { "left": round(left), "firstLine": 0.0 },
                "pitch": round(r.h),
                "atLeast": true,
                "lines": 1,
                "runs": [run_json(&run)],
            })
        };
        let json = match &number {
            // Numbered: a borderless row of three cells, the equation centred in the middle one and the number at
            // the right (Word sets an equation between tab stops inline, its fractions smaller).
            Some(n) => {
                let side = (n.width + 2.0).min(width / 4.0);
                let mut runs = Vec::new();
                push_text(
                    &mut runs,
                    &Text {
                        script: None,
                        ..n.clone()
                    },
                    self.fonts.get(&n.font),
                    None,
                    None,
                    None,
                    false,
                );
                // The number's line, its baseline where Typst set it.
                let number = json!({
                    "type": "p",
                    "align": "end",
                    "indent": { "left": 0.0, "firstLine": 0.0 },
                    "pitch": round(PITCH * n.size),
                    "lines": 1,
                    "before": round((n.y - TOP * n.size - r.y).max(0.0)),
                    "runs": runs.iter().map(run_json).collect::<Vec<_>>(),
                });
                let cell = |col: usize, blocks: Vec<Json>| {
                    json!({
                        "col": col,
                        "margins": { "top": 0.0, "right": 0.0, "bottom": 0.0, "left": 0.0 },
                        "borders": {},
                        "blocks": blocks,
                    })
                };
                json!({
                    "type": "table",
                    "indent": 0.0,
                    "columns": [round(side), round(width - 2.0 * side), round(side)],
                    "rows": [{
                        "cantSplit": true,
                        "cells": [cell(0, vec![]), cell(1, vec![equation(0.0, "center")]), cell(2, vec![number])],
                    }],
                })
            }
            None if centered => equation(0.0, "center"),
            None => equation((r.x - area.left).max(0.0), "start"),
        };
        let Json::Object(json) = json else {
            unreachable!()
        };
        Some(Block {
            page,
            end_page: page,
            top: r.y,
            bottom: r.bottom(),
            json,
        })
    }

    /// A display equation without its Word math (math.rs had no tree for it): a picture of it.
    fn equation_picture(&mut self, ids: &[usize], area: Area) -> Option<Block> {
        let mut r: Option<(usize, Rect)> = None;
        for &id in ids {
            let page = self.items[id].page;
            let b = match &self.items[id].kind {
                Kind::Text(t) => Rect {
                    x: t.x,
                    y: t.y - t.size,
                    w: t.width,
                    h: t.size * 1.25,
                },
                Kind::Seg(s) => Rect {
                    x: s.x0,
                    y: s.y0,
                    w: s.x1 - s.x0,
                    h: (s.y1 - s.y0).max(0.1),
                },
                Kind::Group(g, _) => *g,
                _ => continue,
            };
            r = Some(match r {
                None => (page, b),
                Some((p, a)) => {
                    let x0 = a.x.min(b.x);
                    let y0 = a.y.min(b.y);
                    (
                        p,
                        Rect {
                            x: x0,
                            y: y0,
                            w: a.right().max(b.right()) - x0,
                            h: a.bottom().max(b.bottom()) - y0,
                        },
                    )
                }
            });
        }
        let (page, r) = r?;
        let mut json = Map::new();
        json.insert("type".into(), json!("drawing"));
        json.insert("width".into(), json!(round(r.w)));
        json.insert("height".into(), json!(round(r.h)));
        json.insert("indent".into(), json!(round(r.x - area.left)));
        if let Some((k, p)) = self.picture(ids, r, true) {
            json.insert(
                "picture".into(),
                json!({ "index": k, "x": round(p.x - r.x), "y": round(p.y - r.y) }),
            );
        }
        Some(Block {
            page,
            end_page: page,
            top: r.y,
            bottom: r.bottom(),
            json,
        })
    }

    /// A framed or filled block as a one-cell table.
    fn framed(&mut self, ids: &[usize], rect: Rect, area: Area) -> Option<Block> {
        let page = self.items[ids[0]].page;
        self.framed_items(page, &ids[1..ids.len().saturating_sub(1)], rect, area)
    }

    /// A framed block from what is drawn in it: its fill and strokes first.
    fn framed_items(
        &mut self,
        page: usize,
        ids: &[usize],
        rect: Rect,
        area: Area,
    ) -> Option<Block> {
        let mut segs = Vec::new();
        let mut fill = None;
        let mut inner = Vec::new();
        let mut leading = true;
        for &id in ids {
            match &self.items[id].kind {
                // The box's own marker (a framed group's first shape).
                Kind::Rect(r)
                    if leading && (r.w - rect.w).abs() < 1.0 && (r.h - rect.h).abs() < 1.0 => {}
                Kind::Seg(s) if leading => segs.push(s.clone()),
                Kind::Fill(r, c) if leading && (r.w - rect.w).abs() < 1.0 => fill = Some(c.clone()),
                _ => {
                    leading = false;
                    inner.push(id);
                }
            }
        }
        let borders = sides_json(&segs, rect);
        // The inset on the sides: where the content's leftmost text starts (blocks are drawn with even insets), or a
        // box in it (a nested frame's text is inset in that frame).
        let extent = |id: usize| match &self.items[id].kind {
            Kind::Text(t) => Some((t.x, t.x + t.width)),
            Kind::Rect(r) | Kind::Fill(r, _) | Kind::Group(r, true) | Kind::Drawing(r) => {
                Some((r.x, r.right()))
            }
            Kind::Seg(s) => Some((s.x0.min(s.x1), s.x0.max(s.x1))),
            _ => None,
        };
        let inset_left = inner
            .iter()
            .filter_map(|&id| extent(id).map(|e| e.0 - rect.x))
            .fold(f64::MAX, f64::min);
        let inset_left = if inset_left == f64::MAX {
            0.0
        } else {
            inset_left.max(0.0)
        };
        // On the right, ragged lines don't show the inset. Blocks mostly have even insets, but the widest line bounds
        // it: an inset of `(left: 1em, rest: 0.6em)` leaves lines longer than the left inset allows.
        let max_right = inner
            .iter()
            .filter_map(|&id| extent(id).map(|e| e.1))
            .fold(f64::MIN, f64::max);
        let inset_right = if max_right == f64::MIN {
            inset_left
        } else {
            inset_left.min(rect.right() - max_right).max(0.0)
        };
        // Centred content (a card's question): its leftmost line's room on the left is as much as on the right, not
        // the inset. The inset is no more than what the content leaves on the right.
        let leftmost = inner
            .iter()
            .filter_map(|&id| match &self.items[id].kind {
                Kind::Text(t) => Some(t.clone()),
                _ => None,
            })
            .min_by(|a, b| a.x.total_cmp(&b.x));
        let centred = leftmost.is_some_and(|first| {
            let on_line = inner.iter().filter_map(|&id| match &self.items[id].kind {
                Kind::Text(t) if (t.y - first.y).abs() < 0.6 => Some(t.x + t.inked),
                _ => None,
            });
            let right = on_line.fold(f64::MIN, f64::max);
            ((first.x - rect.x) - (rect.right() - right)).abs() < 1.0 && first.x - rect.x > inset_right + 1.0
        });
        let inset_left = if centred { inset_right } else { inset_left };
        let blocks = self.flow(
            &inner,
            Area {
                left: rect.x + inset_left,
                right: rect.right() - inset_right,
            },
            false,
        );
        let first_top = blocks.first().map(|b| b.top).unwrap_or(rect.y);
        let last_bottom = blocks.last().map(|b| b.bottom).unwrap_or(rect.bottom());
        let thickness = |side: &str| {
            borders
                .get(side)
                .and_then(|b| b.get("width"))
                .and_then(|w| w.as_f64())
                .unwrap_or(0.0)
        };
        // Engines add a table's borders to its height, where Typst draws its strokes over the inset: a one-row
        // table's top and bottom borders count in full (between rows, a border is shared, #118's spike).
        let inset = Sides {
            left: (inset_left - thickness("left") / 2.0).max(0.0),
            right: (inset_right - thickness("right") / 2.0).max(0.0),
            top: (first_top - rect.y - thickness("top")).max(0.0),
            bottom: (rect.bottom() - last_bottom - thickness("bottom")).max(0.0),
        };
        // An empty box ruled underneath only (edu's answer lines) is a ruled line: a paragraph with a bottom border,
        // which engines split pages between, where they won't break a row holding a nested table.
        if blocks.is_empty() && fill.is_none() {
            if let Some(Json::Object(sides)) = Some(&borders) {
                if sides.len() == 1 && sides.contains_key("bottom") {
                    let t = thickness("bottom");
                    let mut json = Map::new();
                    json.insert("type".into(), json!("rule"));
                    json.insert("thickness".into(), json!(round(t)));
                    json.insert("color".into(), sides["bottom"]["color"].clone());
                    json.insert(
                        "indent".into(),
                        json!({ "left": round(rect.x - area.left), "right": round((area.right - rect.right()).max(0.0)) }),
                    );
                    return Some(Block {
                        page,
                        end_page: page,
                        top: rect.bottom() - t,
                        bottom: rect.bottom(),
                        json,
                    });
                }
            }
        }
        let blocks = self.with_gaps_from(blocks, first_top);
        let mut blocks: Vec<Json> = blocks.into_iter().map(|b| Json::Object(b.json)).collect();
        // Nothing in it (a ruled line, an empty box): its height held by an empty paragraph.
        let mut inset = inset;
        if blocks.is_empty() {
            // A one-row table: engines add its outer borders in full, as above.
            let height = (rect.h - thickness("top") - thickness("bottom")).max(0.05);
            blocks.push(json!({ "type": "drawing", "width": round(rect.w - 2.0 * inset_left), "height": round(height), "indent": 0.0, "before": 0.0 }));
            inset.top = 0.0;
            inset.bottom = 0.0;
        }
        let mut cell = Map::new();
        cell.insert("col".into(), json!(0));
        cell.insert("blocks".into(), Json::Array(blocks));
        cell.insert("margins".into(), sides(inset));
        cell.insert("borders".into(), borders);
        if let Some(f) = fill {
            cell.insert("fill".into(), json!(f));
        }
        let mut json = Map::new();
        json.insert("type".into(), json!("table"));
        json.insert("framed".into(), json!(true));
        json.insert("indent".into(), json!(round(rect.x - area.left)));
        json.insert("columns".into(), json!([round(rect.w)]));
        json.insert(
            "rows".into(),
            json!([{ "cantSplit": true, "cells": [Json::Object(cell)] }]),
        );
        Some(Block {
            page,
            end_page: page,
            top: rect.y,
            bottom: rect.bottom(),
            json,
        })
    }

    /// A table or grid: columns from where cells start, rows likewise, each cell's blocks.
    fn table(&mut self, ids: &[usize], area: Area, node: Node) -> Option<Block> {
        let Node::Table {
            at,
            page,
            grid,
            gutters,
        } = node
        else {
            return None;
        };
        // The grid's frame on each page it is on: the innermost group at its left edge, as wide as the first there,
        // opened before anything is drawn there (where a row continues on a page, the page's flow opens around it
        // first; a first cell's group is narrower).
        // Its left edge: the frame right after its tag, which sits where the flow was (an `align`'s left edge, when
        // the table is centred).
        let x0 = match ids.get(1).map(|&j| &self.items[j]) {
            Some(Item {
                kind: Kind::Group(r, _),
                page: p,
                ..
            }) if *p == page => r.x,
            _ => at.x.to_pt(),
        };
        let mut frames: HashMap<usize, Rect> = HashMap::new();
        let mut drawn: HashSet<usize> = HashSet::new();
        // What it draws on each page, as (x0, y0, x1, y1): where a page has no frame of its own (the flow inlines it
        // where a row moved on whole), where it ends there.
        let mut extents: HashMap<usize, (f64, f64, f64, f64)> = HashMap::new();
        for &id in &ids[1..] {
            let page = self.items[id].page;
            let extent = match &self.items[id].kind {
                Kind::Seg(s) => Some((
                    s.x0.min(s.x1),
                    s.y0.min(s.y1),
                    s.x0.max(s.x1),
                    s.y0.max(s.y1),
                )),
                Kind::Fill(r, _) => Some((r.x, r.y, r.right(), r.bottom())),
                Kind::Text(t) => Some((
                    t.x,
                    t.y - TOP * t.size,
                    t.x + t.width,
                    t.y + BOTTOM * t.size,
                )),
                _ => None,
            };
            if let Some((x0, y0, x1, y1)) = extent {
                let e = extents.entry(page).or_insert((x0, y0, x1, y1));
                *e = (e.0.min(x0), e.1.min(y0), e.2.max(x1), e.3.max(y1));
            }
            match &self.items[id].kind {
                Kind::Group(r, _)
                    if !drawn.contains(&page)
                        && (r.x - x0).abs() < 0.5
                        && frames.get(&page).is_none_or(|f| r.w >= f.w - 0.5) =>
                {
                    frames.insert(page, *r);
                }
                Kind::Text(_)
                | Kind::Seg(_)
                | Kind::Fill(..)
                | Kind::Drawing(_)
                | Kind::Link(..) => {
                    drawn.insert(page);
                }
                _ => {}
            }
        }
        let frame = frames.get(&page).copied();
        // Cells, and what is drawn outside them (strokes, fills).
        let mut cells: Vec<(Node, Vec<usize>)> = Vec::new();
        let mut segs = Vec::new();
        let mut fills = Vec::new();
        let mut open: Option<Location> = None;
        // What lies outside every cell's tags: a row broken across pages has its cells' tags first, then their
        // content, and nothing but content where it continues. It goes to cells by where it is, once columns are known.
        let mut orphans: Vec<usize> = Vec::new();
        let mut header_rows: HashSet<usize> = HashSet::new();
        let table_loc = match &self.items[ids[0]].kind {
            Kind::Start(elem, _) => elem.location(),
            _ => None,
        };
        // A table nested in such content: cells starting across its frame are its own, not this table's (it may
        // end on a later page, after this row's next cells).
        let mut nested: Vec<(Location, f64, f64)> = Vec::new();
        let within = |nested: &[(Location, f64, f64)], x: f64| {
            nested
                .iter()
                .any(|(_, x0, x1)| x >= x0 - 0.5 && x < x1 - 0.5)
        };
        for (k, &id) in ids.iter().enumerate().skip(1) {
            match &self.items[id].kind {
                Kind::Start(elem, at) if open.is_none() => {
                    let node = classify(elem, *at, self.items[id].page);
                    if let Node::Cell { y, .. } = node {
                        if !within(&nested, at.x.to_pt()) {
                            if table_loc.is_some_and(|t| self.repeated.contains(&(t, y))) {
                                header_rows.insert(y);
                            }
                            open = elem.location();
                            cells.push((node, Vec::new()));
                            continue;
                        }
                    }
                    if let (Node::Table { .. }, Some(loc)) = (node, elem.location()) {
                        // Its frame: the first group after it, where it starts.
                        let x0 = at.x.to_pt();
                        let x1 = ids[k + 1..]
                            .iter()
                            .find_map(|&j| match &self.items[j].kind {
                                Kind::Group(r, _) if (r.x - x0).abs() < 0.5 => Some(r.right()),
                                _ => None,
                            })
                            .unwrap_or(f64::MAX);
                        nested.push((loc, x0, x1));
                    }
                }
                Kind::End(loc) if open.is_none() && nested.iter().any(|n| n.0 == *loc) => {
                    nested.retain(|n| n.0 != *loc);
                }
                Kind::End(loc) if open.as_ref() == Some(loc) => {
                    open = None;
                    continue;
                }
                _ => {}
            }
            if open.is_some() {
                if let Some(cell) = cells.last_mut() {
                    cell.1.push(id);
                }
            } else {
                orphans.push(id);
            }
        }
        if cells.is_empty() {
            return None;
        }
        let ncols = cells
            .iter()
            .map(|(n, _)| {
                if let Node::Cell { x, colspan, .. } = n {
                    x + colspan
                } else {
                    0
                }
            })
            .max()
            .unwrap_or(1);
        let nrows = cells
            .iter()
            .map(|(n, _)| {
                if let Node::Cell { y, rowspan, .. } = n {
                    y + rowspan
                } else {
                    0
                }
            })
            .max()
            .unwrap_or(1);
        // A right-to-left table (#134) has its first column on the right: its columns are numbered as they are drawn,
        // left to right, and its cells' paragraphs are right to left.
        let rtl = cells.iter().any(|(a, _)| {
            cells.iter().any(|(b, _)| match (a, b) {
                (
                    Node::Cell {
                        at: p,
                        x: i,
                        y: r,
                        page: g,
                        ..
                    },
                    Node::Cell {
                        at: q,
                        x: j,
                        y: s,
                        page: h,
                        ..
                    },
                ) => r == s && g == h && i < j && p.x.to_pt() > q.x.to_pt() + 0.5,
                _ => false,
            })
        });
        let mut gutters = gutters;
        if rtl {
            for (n, _) in cells.iter_mut() {
                if let Node::Cell { x, colspan, .. } = n {
                    *x = ncols - *x - *colspan;
                }
            }
            let between = ncols.saturating_sub(1).min(gutters.0.len());
            gutters.0[..between].reverse();
        }
        let left = x0;
        let right = frame.map(|f| f.right()).unwrap_or(area.right);
        // Column starts: from cells that start in each column.
        let mut starts: Vec<Option<f64>> = vec![None; ncols + 1];
        for (n, _) in &cells {
            if let Node::Cell { at, x, .. } = n {
                starts[*x] = Some(at.x.to_pt());
            }
        }
        starts[0] = Some(left);
        starts[ncols] = Some(
            right
                + gutters
                    .0
                    .get(ncols.saturating_sub(1))
                    .copied()
                    .unwrap_or(0.0)
                    * 0.0,
        );
        let mut starts = fill_gaps(starts);
        // Columns run left to right: a start out of order (a cell drawn elsewhere) takes the room evenly.
        for c in 1..starts.len() {
            if starts[c] < starts[c - 1] + 1.0 {
                starts[c] = starts[c - 1] + 1.0;
            }
        }
        // Gutters sit between tracks: none after the last.
        let col_gutter = |c: usize| {
            if c + 1 < ncols {
                gutters.0.get(c).copied().unwrap_or(0.0)
            } else {
                0.0
            }
        };
        let widths: Vec<f64> = (0..ncols).map(|c| starts[c + 1] - starts[c]).collect();
        self.adopt(&mut cells, &orphans, &starts, &mut segs, &mut fills);
        // Rows: their tops, per page, from the cells that start them.
        let mut row_top: Vec<Option<(usize, f64)>> = vec![None; nrows];
        for (n, _) in &cells {
            if let Node::Cell { at, y, page, .. } = n {
                if row_top[*y].is_none() {
                    row_top[*y] = Some((*page, at.y.to_pt()));
                }
            }
        }
        let frame_bottom = |p: usize| {
            frames
                .get(&p)
                .map(|f| f.bottom())
                .or(extents.get(&p).map(|e| e.3))
        };
        let row_gutter = |r: usize| {
            if r + 1 < nrows {
                gutters.1.get(r).copied().unwrap_or(0.0)
            } else {
                0.0
            }
        };
        let row_height = |r: usize| -> f64 {
            let Some((p, top)) = row_top[r] else {
                return 0.0;
            };
            match row_top.get(r + 1).copied().flatten() {
                Some((q, next)) if q == p => next - top - row_gutter(r),
                _ => frame_bottom(p).map(|b| b - top).unwrap_or(0.0).max(0.0),
            }
        };
        // Where a row's last part ends: at the next row on its page, or at the bottom of the grid's frame. A row goes
        // on to the pages after its first where the grid's frame starts above the next row (a cell broken across
        // pages, or a block Typst moved on whole, as an answer space).
        let row_end = |r: usize| -> (usize, f64) {
            let Some((p, top)) = row_top[r] else {
                return (page, at.y.to_pt());
            };
            let next = row_top.get(r + 1).copied().flatten();
            if let Some((q, n)) = next {
                if q == p {
                    return (p, n - row_gutter(r));
                }
            }
            let mut end = (p, frame_bottom(p).unwrap_or(top));
            let last = frames.keys().copied().max().unwrap_or(p);
            for k in p + 1..=last {
                let Some(f) = frames.get(&k) else { break };
                match next {
                    Some((q, n)) if q == k => {
                        if f.y < n - row_gutter(r) - 0.5 {
                            end = (k, n - row_gutter(r));
                        }
                        break;
                    }
                    _ => end = (k, f.bottom()),
                }
            }
            end
        };
        let mut rows: Vec<Vec<Json>> = vec![Vec::new(); nrows];
        let mut first_bottom = at.y.to_pt();
        let mut last_page = page;
        let mut last_bottom = at.y.to_pt();
        // Each cell's blocks and where its content sits, before the row's margins are known.
        struct Laid {
            x: usize,
            y: usize,
            colspan: usize,
            rowspan: usize,
            inset: Sides<f64>,
            valign: &'static str,
            border: Json,
            /// Border widths on the left and right: engines draw them inside the cell, Typst over its inset.
            side_borders: (f64, f64),
            fill: Option<String>,
            blocks: Vec<Block>,
            /// The content's distance from the cell's top and bottom edges, inside the borders.
            above: f64,
            below: f64,
            /// Room the row goes on for past the content, a page's each, and where the content ends.
            tail: Vec<f64>,
            reach: (usize, f64),
        }
        let mut laid: Vec<Laid> = Vec::new();
        for (n, cell_ids) in cells.clone() {
            let Node::Cell {
                at: cat,
                x,
                y,
                colspan,
                rowspan,
                inset,
                valign,
                page: cpage,
            } = n
            else {
                continue;
            };
            let cx = cat.x.to_pt();
            let cy = cat.y.to_pt();
            let cw = starts[x + colspan] - starts[x] - col_gutter(x + colspan - 1);
            let ch: f64 = (y..y + rowspan).map(row_height).sum::<f64>()
                + (y..y + rowspan - 1).map(row_gutter).sum::<f64>();
            let cell_rect = Rect {
                x: cx,
                y: cy,
                w: cw,
                h: ch,
            };
            let content = Area {
                left: cx + inset.left,
                right: cx + cw - inset.right,
            };
            // Typst lets a word too long for the cell run past its inset; engines break it there. The inset on the
            // right gives way to the widest line (an outer edge can't).
            let widest = cell_ids
                .iter()
                .filter_map(|&id| match &self.items[id].kind {
                    Kind::Text(t) => Some(t.x + t.inked - content.left),
                    _ => None,
                })
                .fold(0.0, f64::max);
            let mut inset = inset;
            if widest > content.right - content.left {
                inset.right = inset.right.min(cw - inset.left - widest - 0.5).max(0.0);
            }
            let mut blocks = self.flow(&cell_ids, content, false);
            // A block Typst moved on to the next page whole (an answer space, kept together): the room it left on the
            // page before as an empty paragraph that fills it to its bottom (breakable: a line goes on where the text
            // above came out a hair lower), or engines fill that room with the block's start.
            let mut k = 1;
            while k < blocks.len() {
                let prev = (blocks[k - 1].end_page, blocks[k - 1].bottom);
                let (size, m) = self.geometry[prev.0];
                let room = size.y.to_pt() - m.bottom - prev.1;
                if blocks[k].page > prev.0 && room > SLACK {
                    let mut json = Map::new();
                    json.insert("type".into(), json!("drawing"));
                    json.insert("width".into(), json!(1.0));
                    json.insert("height".into(), json!(round(room)));
                    json.insert("indent".into(), json!(0.0));
                    json.insert("breakable".into(), json!(true));
                    blocks.insert(
                        k,
                        Block {
                            page: prev.0,
                            end_page: prev.0,
                            top: prev.1,
                            bottom: prev.1 + room,
                            json,
                        },
                    );
                    k += 1;
                }
                k += 1;
            }
            let content_top = blocks.first().map(|b| b.top).unwrap_or(cy + inset.top);
            // A cell broken across pages ends on its last page: the room left on the first is the page's, not a
            // margin (engines put the bottom margin under each part of a split row).
            let end_page = blocks.iter().map(|b| b.end_page).max().unwrap_or(cpage);
            let content_bottom = blocks
                .iter()
                .filter(|b| b.end_page == end_page)
                .map(|b| b.bottom)
                .fold(
                    if end_page == cpage {
                        content_top
                    } else {
                        f64::MIN
                    },
                    f64::max,
                );
            let (rpage, rend) = row_end(y + rowspan - 1);
            // Where the row goes on past the content, what is left is empty paragraphs, a page's room each, which
            // engines break between; not a margin, which they would put under each part of the row.
            let mut tail: Vec<f64> = Vec::new();
            let cell_bottom = if rpage > end_page {
                tail.push(
                    frame_bottom(end_page).unwrap_or(content_bottom) - content_bottom - SLACK,
                );
                for k in end_page + 1..rpage {
                    tail.push(frames.get(&k).map(|f| f.h).unwrap_or(0.0));
                }
                tail.push(rend - frames.get(&rpage).map(|f| f.y).unwrap_or(rend));
                content_bottom
            } else if end_page == cpage && rpage == cpage {
                cy + ch
            } else {
                rend
            };
            let blocks = self.with_gaps_from(blocks, content_top);
            // Its page's strokes: another page's could be where it is too.
            let on_page: Vec<Seg> = segs
                .iter()
                .filter(|(p, _)| *p == cpage)
                .map(|(_, s)| s.clone())
                .collect();
            let border = sides_json(&on_page, cell_rect);
            let thickness = |side: &str| {
                border
                    .get(side)
                    .and_then(|b| b.get("width"))
                    .and_then(|w| w.as_f64())
                    .unwrap_or(0.0)
            };
            let fill = fills
                .iter()
                .find(|(r, _)| (r.x - cx).abs() < 1.0 && (r.y - cy).abs() < 1.0)
                .map(|f| f.1.clone());
            // Engines add horizontal borders to the rows' heights, where Typst draws them over the inset: a border
            // between rows is shared, half from each (#118's spike); the table's outer ones count in full.
            let top_share = if y == 0 { 1.0 } else { 0.5 };
            let bottom_share = if y + rowspan == nrows { 1.0 } else { 0.5 };
            let above = (content_top - cy - thickness("top") * top_share).max(0.0);
            let below =
                (cell_bottom - content_bottom - thickness("bottom") * bottom_share).max(0.0);
            if cpage == page {
                first_bottom = first_bottom.max(cy + ch);
            }
            // Where the table ends: the last page a cell reaches, a split one's included.
            let (epage, ebottom) = (rpage, rend);
            if epage >= last_page {
                if epage > last_page {
                    last_bottom = 0.0;
                }
                last_page = epage;
                last_bottom = last_bottom.max(ebottom);
            }
            let side_borders = (thickness("left"), thickness("right"));
            laid.push(Laid {
                x,
                y,
                colspan,
                rowspan,
                inset,
                valign,
                border,
                side_borders,
                fill,
                blocks,
                above,
                below,
                tail,
                reach: (end_page, content_bottom),
            });
        }
        // One cell holds a row's height where it goes on past every cell's content (as empty paragraphs, its tail):
        // the one whose content reaches furthest. Engines won't split a row across pages where its other cells hold
        // them too.
        let mut holder: HashMap<usize, usize> = HashMap::new();
        for (k, c) in laid.iter().enumerate() {
            let last = c.y + c.rowspan - 1;
            if laid
                .iter()
                .any(|o| o.y + o.rowspan - 1 == last && o.tail.is_empty())
            {
                continue;
            }
            let better = holder.get(&last).is_none_or(|&h| {
                let r = laid[h].reach;
                c.reach.0 > r.0 || (c.reach.0 == r.0 && c.reach.1 > r.1)
            });
            if better {
                holder.insert(last, k);
            }
        }
        let holders: HashSet<usize> = holder.values().copied().collect();
        for (k, c) in laid.iter_mut().enumerate() {
            if !holders.contains(&k) {
                c.tail.clear();
            }
            let width = c.blocks.first().and_then(|b| b.json.get("width")).cloned();
            for &h in c.tail.iter().filter(|h| **h > 0.05) {
                let mut json = Map::new();
                json.insert("type".into(), json!("drawing"));
                json.insert("width".into(), width.clone().unwrap_or(json!(1.0)));
                json.insert("height".into(), json!(round(h)));
                json.insert("indent".into(), json!(0.0));
                json.insert("before".into(), json!(0.0));
                c.blocks.push(Block {
                    page: c.reach.0,
                    end_page: c.reach.0,
                    top: c.reach.1,
                    bottom: c.reach.1,
                    json,
                });
            }
        }
        // The margins above and below are the row's, the same in every cell: a row is as tall as its tallest content
        // and its largest margins (LibreOffice takes the largest of any cell's for the whole row). They are the
        // smallest gaps Typst left; a cell whose content sits lower gets the rest as space before it.
        let mut row_above = vec![f64::MAX; nrows];
        let mut row_below = vec![f64::MAX; nrows];
        for c in &laid {
            row_above[c.y] = row_above[c.y].min(c.above);
            if c.rowspan == 1 {
                row_below[c.y] = row_below[c.y].min(c.below);
            }
        }
        let fix = |v: f64| if v == f64::MAX { 0.0 } else { v };
        // Typst leaves out a gutter where the grid breaks across pages.
        let gutter_below = |r: usize| match (row_end(r), row_top.get(r + 1).copied().flatten()) {
            ((p, _), Some((q, _))) if q > p => 0.0,
            _ => row_gutter(r),
        };
        for c in laid {
            let top = fix(row_above[c.y]);
            let bottom = fix(row_below[c.y + c.rowspan - 1]);
            let mut blocks = c.blocks;
            // A centred or bottom-aligned cell is placed by its alignment: an offset too would count twice.
            if c.valign != "top" {
                if let Some(first) = blocks.first_mut() {
                    first.json.insert("before".into(), json!(0.0));
                }
            } else if let Some(first) = blocks.first_mut() {
                let before = first
                    .json
                    .get("before")
                    .and_then(|b| b.as_f64())
                    .unwrap_or(0.0);
                first
                    .json
                    .insert("before".into(), json!(round(before + c.above - top)));
            }
            let mut cell = Map::new();
            cell.insert("col".into(), json!(c.x));
            if c.colspan > 1 {
                cell.insert("span".into(), json!(c.colspan));
            }
            if c.rowspan > 1 {
                cell.insert("rowSpan".into(), json!(c.rowspan));
            }
            cell.insert(
                "margins".into(),
                sides(Sides {
                    left: (c.inset.left - c.side_borders.0 / 2.0).max(0.0),
                    right: (c.inset.right - c.side_borders.1 / 2.0).max(0.0)
                        + col_gutter(c.x + c.colspan - 1),
                    top,
                    bottom: bottom + gutter_below(c.y + c.rowspan - 1),
                }),
            );
            cell.insert("borders".into(), c.border);
            if let Some(f) = c.fill {
                cell.insert("fill".into(), json!(f));
            }
            if c.valign != "top" {
                cell.insert("valign".into(), json!(c.valign));
            }
            cell.insert(
                "blocks".into(),
                Json::Array(blocks.into_iter().map(|b| Json::Object(b.json)).collect()),
            );
            rows[c.y].push(Json::Object(cell));
        }
        let headers: Vec<usize> = header_rows.into_iter().collect();
        // A row Typst starts a page with, the page before having room left (a row that can't split, moved on whole):
        // a page break before it, as before a block.
        let breaks_page = |r: usize| -> bool {
            let (Some((p, _)), Some(prev)) = (row_top[r], r.checked_sub(1)) else {
                return false;
            };
            let (q, end) = row_end(prev);
            let (size, m) = self.geometry[q];
            p > q && size.y.to_pt() - m.bottom - end > PAGE_ROOM
        };
        let rows: Vec<Json> = rows
            .into_iter()
            .enumerate()
            .map(|(r, cells)| {
                let mut row = json!({
                    "cantSplit": !grid,
                    "header": headers.contains(&r),
                    "cells": cells,
                });
                if breaks_page(r) {
                    row["pageBreak"] = json!(true);
                }
                row
            })
            .collect();
        let mut json = Map::new();
        json.insert("type".into(), json!("table"));
        json.insert("indent".into(), json!(round(left - area.left)));
        json.insert(
            "columns".into(),
            json!(widths.iter().map(|w| round(*w)).collect::<Vec<_>>()),
        );
        json.insert("rows".into(), Json::Array(rows));
        let bottom = frame_bottom(last_page).unwrap_or(last_bottom);
        let _ = first_bottom;
        // It starts where its first row does: Typst moves a table whose header would end a page on to the next, its
        // start tag left behind.
        let (page, top) = row_top[0].unwrap_or((page, at.y.to_pt()));
        Some(Block {
            page,
            end_page: last_page.max(page),
            top,
            bottom,
            json,
        })
    }

    /// Gives what lies outside the cells' tags to the cell it is drawn in: the latest one started in its column.
    /// Strokes and fills along cell edges are the table's (borders, backgrounds); groups spanning columns are
    /// the rows' and the grid's frames, not content.
    fn adopt(
        &self,
        cells: &mut [(Node, Vec<usize>)],
        orphans: &[usize],
        starts: &[f64],
        segs: &mut Vec<(usize, Seg)>,
        fills: &mut Vec<(Rect, String)>,
    ) {
        let column = |x: f64| {
            (0..starts.len() - 1).find(|&c| x >= starts[c] - 0.5 && x < starts[c + 1] - 0.5)
        };
        let cell_at = |page: usize, x: f64, y: f64| -> Option<usize> {
            let c = column(x)?;
            cells
                .iter()
                .enumerate()
                .filter_map(|(k, (n, _))| match n {
                    Node::Cell {
                        at,
                        page: p,
                        x,
                        colspan,
                        ..
                    } if *x <= c && c < x + colspan && (*p, at.y.to_pt()) <= (page, y + 0.5) => {
                        Some((k, (*p, at.y.to_pt())))
                    }
                    _ => None,
                })
                .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap())
                .map(|(k, _)| k)
        };
        // Inside a column, not on its left edge.
        let within = |x: f64| column(x).is_some_and(|c| x > starts[c] + 0.5);
        let mut groups: Vec<Option<usize>> = Vec::new();
        let mut started: HashMap<Location, usize> = HashMap::new();
        let mut adopted: Vec<(usize, usize)> = Vec::new();
        for &id in orphans {
            let page = self.items[id].page;
            // What a group a cell adopted draws is the cell's too: a stroke across the column (an answer line's
            // rule) isn't the table's.
            let inside = groups.last().copied().flatten();
            let to = match &self.items[id].kind {
                Kind::Group(..) | Kind::GroupEnd => None,
                _ => inside,
            };
            let to = to.or_else(|| match &self.items[id].kind {
                Kind::Group(r, _) => {
                    let one = column(r.x).is_some_and(|c| r.right() <= starts[c + 1] + 0.5);
                    let to = if one { cell_at(page, r.x, r.y) } else { None };
                    groups.push(to);
                    to
                }
                Kind::GroupEnd => groups.pop().flatten(),
                Kind::Text(t) => cell_at(page, t.x, t.y - t.size),
                Kind::Drawing(r) | Kind::Link(r, _) => cell_at(page, r.x, r.y),
                // A box in a cell, not a cell's background (on its column's edge, the table's).
                Kind::Rect(r) if within(r.x) => cell_at(page, r.x, r.y),
                Kind::Rect(_) => None,
                Kind::Seg(s) if within(s.x0) && within(s.x1 - 0.01) => cell_at(page, s.x0, s.y0),
                Kind::Seg(s) => {
                    segs.push((page, s.clone()));
                    None
                }
                Kind::Fill(r, _) if within(r.x) => cell_at(page, r.x, r.y),
                Kind::Fill(r, c) => {
                    fills.push((*r, c.clone()));
                    None
                }
                Kind::Start(elem, at) => {
                    let to = cell_at(page, at.x.to_pt(), at.y.to_pt());
                    if let (Some(k), Some(loc)) = (to, elem.location()) {
                        started.insert(loc, k);
                    }
                    to
                }
                Kind::End(loc) => started.get(loc).copied(),
                // With its equation.
                Kind::Math(_) => adopted.last().map(|&(k, _)| k),
            });
            if let Some(k) = to {
                adopted.push((k, id));
            }
        }
        for (k, id) in adopted {
            cells[k].1.push(id);
        }
        for (_, ids) in cells.iter_mut() {
            ids.sort_unstable();
        }
    }

    /// Spaces before blocks in a cell: the first from the cell's content top.
    fn with_gaps_from(&self, mut blocks: Vec<Block>, top: f64) -> Vec<Block> {
        let mut prev: Option<(usize, f64)> = None;
        let mut owed = Owed::default();
        for b in blocks.iter_mut() {
            // `fit` stays: the writer gives a cell no more slack than its paragraphs' fit.
            b.json.remove("last");
            if out_of_flow(b) {
                b.json.insert("before".into(), json!(0.0));
                continue;
            }
            let before = match prev {
                Some((p, bottom)) if p == b.page => b.top - bottom,
                // Where a cell goes on onto a later page, from that page's top.
                Some(_) => (b.top - self.content_top(b.page)).max(0.0),
                None => b.top - top,
            };
            let before = owed.pay(b, before);
            b.json.insert("before".into(), json!(round(before)));
            prev = Some((b.end_page, b.bottom));
        }
        blocks
    }
}

/// Room a rule took that Typst didn't give it: a rule is a paragraph as tall as its stroke, where Typst's `line` has
/// no height and its stroke reaches half its thickness into the gaps around it, so the gap after it measures less than
/// nothing. A gap can't be negative: what is missing comes off the next ones on the page, or every rule in a list
/// would push what follows down by half its thickness. (Other overlaps, a float's, stay as they were.)
#[derive(Default)]
struct Owed {
    page: usize,
    owed: f64,
    rule: bool,
}

impl Owed {
    /// The space before `b`, `before` measured, with what is owed taken off it.
    fn pay(&mut self, b: &Block, before: f64) -> f64 {
        if b.page != self.page {
            *self = Owed {
                page: b.page,
                ..Owed::default()
            };
        }
        let before = before - self.owed;
        self.owed = if self.rule || self.owed > 0.0 {
            (-before).max(0.0)
        } else {
            0.0
        };
        self.rule = b.json.get("type").and_then(|t| t.as_str()) == Some("rule");
        before.max(0.0)
    }
}

fn fill_gaps(starts: Vec<Option<f64>>) -> Vec<f64> {
    let n = starts.len();
    let mut out = vec![0.0; n];
    let mut i = 0;
    while i < n {
        if let Some(v) = starts[i] {
            out[i] = v;
            i += 1;
            continue;
        }
        // Spread missing starts evenly between known ones.
        let prev = i - 1;
        let mut next = i;
        while starts[next].is_none() {
            next += 1;
        }
        let (a, b) = (out[prev], starts[next].unwrap());
        for k in i..next {
            out[k] = a + (b - a) * (k - prev) as f64 / (next - prev) as f64;
        }
        i = next;
    }
    out
}

/// Index (into `ids`) of the `GroupEnd` matching the group at `ids[i]`.
fn group_end(items: &[Item], ids: &[usize], i: usize) -> usize {
    let mut depth = 0;
    for (j, &id) in ids.iter().enumerate().skip(i) {
        match items[id].kind {
            Kind::Group(..) => depth += 1,
            Kind::GroupEnd => {
                depth -= 1;
                if depth == 0 {
                    return j;
                }
            }
            _ => {}
        }
    }
    ids.len() - 1
}

/// The borders on a rectangle's sides: the strokes that run along them.
fn sides_json(segs: &[Seg], r: Rect) -> Json {
    let mut out = Map::new();
    for side in ["top", "right", "bottom", "left"] {
        let found = segs.iter().find(|s| match side {
            "top" | "bottom" => {
                let y = if side == "top" { r.y } else { r.bottom() };
                s.horizontal()
                    && (s.y0 - y).abs() < 1.0
                    && s.x0 <= r.x + r.w * 0.5
                    && s.x1 >= r.x + r.w * 0.5
            }
            _ => {
                let x = if side == "left" { r.x } else { r.right() };
                !s.horizontal()
                    && (s.x0 - x).abs() < 1.0
                    && s.y0 <= r.y + r.h * 0.5
                    && s.y1 >= r.y + r.h * 0.5
            }
        });
        if let Some(s) = found {
            let mut border = json!({ "width": round(s.thickness), "color": s.color });
            if let Some(dash) = s.dash {
                border["style"] = json!(dash);
            }
            out.insert(side.into(), border);
        }
    }
    Json::Object(out)
}

fn sides(s: Sides<f64>) -> Json {
    json!({ "top": round(s.top), "right": round(s.right), "bottom": round(s.bottom), "left": round(s.left) })
}

/// The colour of the stroke under `x0..x1` on the line at `baseline`, if one underlines it, and how far below the
/// baseline it is.
fn underlined(
    segs: &[(usize, Seg)],
    page: usize,
    x0: f64,
    x1: f64,
    baseline: f64,
) -> Option<(String, f64)> {
    let mid = (x0 + x1) / 2.0;
    segs.iter()
        .find(|(p, s)| *p == page && s.x0 <= mid && s.x1 >= mid && underlines(s, baseline))
        .map(|(_, s)| (s.color.clone(), s.y0 - baseline))
}

/// The colour drawn behind `[x0, x1)` of the line at `baseline` on `page`: a fill around a line's words (not a block's
/// background, which its table cell has).
fn shaded(fills: &[(usize, Rect, String)], page: usize, x0: f64, x1: f64, baseline: f64) -> Option<String> {
    let mid = (x0 + x1) / 2.0;
    fills
        .iter()
        .rev()
        .find(|(p, r, _)| {
            *p == page && r.h < 36.0 && r.x <= mid && r.right() >= mid && r.y < baseline && r.bottom() > baseline
        })
        .map(|(_, _, c)| c.clone())
}

/// Whether a line's runs end in a word or after it, without the space Typst keeps at a line it broke: a line broken on
/// purpose. (Not after a hyphen or a dash, or in text without spaces, where Typst may break too.)
fn ends_word(runs: &[Run]) -> bool {
    let Some(Run::Text { text, .. }) = runs.last() else {
        return false;
    };
    text.chars().last().is_some_and(|c| {
        (c.is_alphanumeric() || ".,;:!?)]}\"'’”»".contains(c))
            && !matches!(c, '\u{2E80}'..='\u{9FFF}' | '\u{AC00}'..='\u{D7AF}' | '\u{F900}'..='\u{FAFF}' | '\u{FF00}'..='\u{FFEF}')
    })
}

/// Whether `s` is drawn where it underlines the line at `baseline`.
fn underlines(s: &Seg, baseline: f64) -> bool {
    s.y0 > baseline - 1.0 && s.y0 < baseline + 6.0 && s.thickness < 2.0
}

/// Word's tab leader for what a `repeat` fills with, if Word has one like it.
fn tab_leader(fill: &str) -> Option<&'static str> {
    match fill {
        "." => Some("dot"),
        "-" | "‐" | "–" => Some("hyphen"),
        "_" => Some("underscore"),
        "·" | "⋅" => Some("middleDot"),
        _ => None,
    }
}

fn last_font(runs: &[Run]) -> Option<usize> {
    runs.iter().rev().find_map(|r| match r {
        Run::Text { font, .. } | Run::Gap { font, .. } | Run::Picture { font, .. } => Some(*font),
        Run::Tab | Run::Break | Run::Math { .. } => None,
    })
}

/// Appends `t`'s text in `font`, to the last run when it is set alike.
fn push_text(
    runs: &mut Vec<Run>,
    t: &Text,
    font: usize,
    underline: Option<String>,
    link: Option<String>,
    fill: Option<String>,
    strike: bool,
) {
    if let Some(Run::Text {
        text,
        font: f,
        size,
        color,
        underline: u,
        link: l,
        script,
        rtl,
        lang,
        fill: shade,
        strike: struck,
    }) = runs.last_mut()
    {
        if *f == font
            && (*size - t.size).abs() < 0.01
            && *color == t.color
            && *u == underline
            && *l == link
            && *script == t.script
            && *rtl == t.rtl
            && *lang == t.lang
            && *shade == fill
            && *struck == strike
        {
            text.push_str(&t.text);
            return;
        }
    }
    runs.push(Run::Text {
        text: t.text.clone(),
        font,
        size: t.size,
        color: t.color.clone(),
        underline,
        link,
        script: t.script,
        rtl: t.rtl,
        lang: t.lang.clone(),
        fill,
        strike,
    });
}

fn run_json(run: &Run) -> Json {
    match run {
        Run::Text {
            text,
            font,
            size,
            color,
            underline,
            link,
            script,
            rtl,
            lang,
            fill,
            strike,
        } => {
            let mut m = Map::new();
            m.insert("text".into(), json!(text));
            m.insert("font".into(), json!(font));
            m.insert("size".into(), json!(round(*size)));
            if color != "000000" {
                m.insert("color".into(), json!(color));
            }
            if let Some(c) = underline {
                m.insert("underline".into(), json!(true));
                if c != "000000" {
                    m.insert("underlineColor".into(), json!(c));
                }
            }
            if let Some(l) = link {
                m.insert("link".into(), json!(l));
            }
            if let Some(script) = script {
                m.insert("script".into(), json!(script));
            }
            if *rtl {
                m.insert("rtl".into(), json!(true));
            }
            // English is the default (the writer's styles').
            if lang != "en" {
                m.insert("lang".into(), json!(lang));
            }
            if let Some(f) = fill {
                m.insert("fill".into(), json!(f));
            }
            if *strike {
                m.insert("strike".into(), json!(true));
            }
            Json::Object(m)
        }
        Run::Gap {
            width,
            underline,
            raise,
            font,
            size,
            fill,
        } => {
            let mut m = Map::new();
            m.insert("gap".into(), json!(round(*width)));
            m.insert("font".into(), json!(font));
            m.insert("size".into(), json!(round(*size)));
            if let Some(f) = fill {
                m.insert("fill".into(), json!(f));
            }
            if let Some(c) = underline {
                m.insert("underline".into(), json!(true));
                if c != "000000" {
                    m.insert("underlineColor".into(), json!(c));
                }
                // Word moves a run in half points.
                if (raise * 2.0).round() != 0.0 {
                    m.insert("raise".into(), json!(round(*raise)));
                }
            }
            Json::Object(m)
        }
        Run::Picture {
            width,
            font,
            size,
            picture,
        } => {
            let mut m = Map::new();
            m.insert("gap".into(), json!(round(*width)));
            m.insert("font".into(), json!(font));
            m.insert("size".into(), json!(round(*size)));
            if let Some(p) = picture {
                m.insert("picture".into(), p.clone());
            }
            Json::Object(m)
        }
        Run::Math {
            math,
            font,
            size,
            color,
            display,
        } => {
            let mut m = Map::new();
            m.insert("math".into(), math.clone());
            m.insert("font".into(), json!(font));
            m.insert("size".into(), json!(round(*size)));
            if color != "000000" {
                m.insert("color".into(), json!(color));
            }
            if *display {
                m.insert("display".into(), json!(true));
            }
            Json::Object(m)
        }
        Run::Tab => json!({ "tab": true }),
        Run::Break => json!({ "break": true }),
    }
}

/// A Word numbering for list labels: (format, level text, start), or a literal one when the labels follow no
/// pattern Word has.
fn numbering(labels: &[String]) -> (String, String, u32) {
    let first = labels.first().map(|s| s.as_str()).unwrap_or("•");
    let token_at = first.find(|c: char| c.is_ascii_alphanumeric());
    let Some(at) = token_at else {
        // Labels that change are numbers Word has no format for (Bengali, Arabic-Indic digits, #134): text.
        if labels.iter().any(|l| l != first) {
            return ("none".into(), String::new(), 1);
        }
        return ("bullet".into(), first.into(), 1);
    };
    let rest = &first[at..];
    let end = rest
        .find(|c: char| !c.is_ascii_alphanumeric())
        .unwrap_or(rest.len());
    let token = &rest[..end];
    let (prefix, suffix) = (&first[..at], &rest[end..]);
    let (format, start) = if let Ok(n) = token.parse::<u32>() {
        ("decimal", n)
    } else if let Some(n) = roman(token).or_else(|| roman_start(token, labels.get(1))) {
        (
            if token.chars().all(|c| c.is_ascii_lowercase()) {
                "lowerRoman"
            } else {
                "upperRoman"
            },
            n,
        )
    } else if token.len() == 1 {
        let c = token.chars().next().unwrap();
        (
            if c.is_ascii_lowercase() {
                "lowerLetter"
            } else {
                "upperLetter"
            },
            (c.to_ascii_lowercase() as u32) - ('a' as u32) + 1,
        )
    } else {
        return ("none".into(), String::new(), 1);
    };
    // Letters that are also numerals: "i" after "h" is a letter. The first label decides; a list starting at "i" is
    // Roman.
    (format.into(), format!("{prefix}%1{suffix}"), start)
}

/// A list starting at "v", "x", "l" or "c" whose next label is the next Roman numeral ("v." then "vi."): Roman, though
/// a letter alone reads as one (`enum(numbering: "i.", start: 5)`).
fn roman_start(token: &str, next: Option<&String>) -> Option<u32> {
    let value = match token.to_ascii_uppercase().as_str() {
        "V" => 5,
        "X" => 10,
        "L" => 50,
        "C" => 100,
        _ => return None,
    };
    let next = next?;
    let at = next.find(|c: char| c.is_ascii_alphanumeric())?;
    let rest = &next[at..];
    let token = &rest[..rest.find(|c: char| !c.is_ascii_alphanumeric()).unwrap_or(rest.len())];
    (roman(token) == Some(value + 1)).then_some(value)
}

fn roman(s: &str) -> Option<u32> {
    let up = s.to_ascii_uppercase();
    if up.is_empty()
        || !up.chars().all(|c| "IVXLC".contains(c))
        || s.len() == 1 && "VXLC".contains(&up)
    {
        return None;
    }
    let value = |c| match c {
        'I' => 1,
        'V' => 5,
        'X' => 10,
        'L' => 50,
        _ => 100,
    };
    let digits: Vec<u32> = up.chars().map(value).collect();
    let mut n = 0;
    for (i, d) in digits.iter().enumerate() {
        if digits.get(i + 1).is_some_and(|next| next > d) {
            n -= *d as i64;
        } else {
            n += *d as i64;
        }
    }
    (n > 0).then_some(n as u32)
}

/// The numbers in a page's marginal text, in order.
fn numbers(blocks: &[Json]) -> Vec<String> {
    let mut out = Vec::new();
    for b in blocks {
        for run in b
            .get("runs")
            .and_then(|r| r.as_array())
            .into_iter()
            .flatten()
        {
            let text = run.get("text").and_then(|t| t.as_str()).unwrap_or("");
            out.extend(
                tokens(text)
                    .into_iter()
                    .filter(|t| t.1)
                    .map(|t| t.0.to_string()),
            );
        }
    }
    out
}

/// A text's words and what's between them: (piece, whether it is a word). Page numbers are words: `12`, `iv`.
fn tokens(text: &str) -> Vec<(&str, bool)> {
    let mut out = Vec::new();
    let mut start = 0;
    let mut word = None;
    for (i, c) in text.char_indices() {
        let w = c.is_alphanumeric();
        if word.is_some_and(|prev| prev != w) {
            out.push((&text[start..i], word.unwrap()));
            start = i;
        }
        word = Some(w);
    }
    if let Some(w) = word {
        out.push((&text[start..], w));
    }
    out
}

/// A page's number as Typst shows it, and Word's format for its numbering (its first numeral system).
fn page_numbering(page: &Page) -> (&'static str, u64, String) {
    use codex::numeral_systems::NamedNumeralSystem as N;
    let system = match &page.numbering {
        Some(Numbering::Pattern(p)) => p.pieces.first().map(|(_, s)| *s),
        _ => None,
    };
    let format = match system {
        Some(N::LowerRoman) => "lowerRoman",
        Some(N::UpperRoman) => "upperRoman",
        Some(N::LowerLatin) => "lowerLetter",
        Some(N::UpperLatin) => "upperLetter",
        // Numerals Word has (#134); Eastern Arabic, Persian and Bengali digits it hasn't: Western ones there.
        Some(N::Devanagari) => "hindiNumbers",
        Some(N::Hebrew) => "hebrew1",
        Some(N::ArabicAbjad) => "arabicAbjad",
        Some(N::LowerSimplifiedChinese) => "chineseCounting",
        Some(N::KoreanJamo) => "chosung",
        Some(N::KoreanSyllable) => "ganada",
        Some(N::KatakanaAiueo) => "aiueo",
        Some(N::KatakanaIroha) => "iroha",
        _ => "decimal",
    };
    let label = system
        .and_then(|s| {
            s.system()
                .represent(page.number)
                .ok()
                .map(|r| r.to_string())
        })
        .unwrap_or_else(|| page.number.to_string());
    (format, page.number, label)
}

/// What each number in the marginals is, by its index: the page's number (`PAGE`) where some page has it and not
/// the count, the page count (`NUMPAGES`) the other way round. "2 / 2" alone can't say which is which.
fn field_roles(pages: &[Vec<Json>], labels: &[String]) -> Vec<Option<&'static str>> {
    let count = pages.len();
    let total_label = count.to_string();
    let lists: Vec<Vec<String>> = pages.iter().map(|p| numbers(p)).collect();
    let len = lists.iter().map(|l| l.len()).max().unwrap_or(0);
    (0..len)
        .map(|k| {
            let at = |p: usize| lists[p].get(k).map(|s| s.as_str());
            let label = |p: usize| labels.get(p).map(|s| s.as_str()).unwrap_or("");
            let page = (0..count).any(|p| at(p) == Some(label(p)) && label(p) != total_label);
            let total =
                (0..count).any(|p| at(p) == Some(total_label.as_str()) && label(p) != total_label);
            let all_page = (0..count).all(|p| at(p).is_none() || at(p) == Some(label(p)));
            let all_total =
                (0..count).all(|p| at(p).is_none() || at(p) == Some(total_label.as_str()));
            if page && all_page {
                Some("PAGE")
            } else if total && all_total {
                Some("NUMPAGES")
            } else if count == 1 && all_page {
                Some("PAGE")
            } else {
                None
            }
        })
        .collect()
}

/// Page numbers in a header or footer as fields, by `roles` (`k` counts the numbers seen across its blocks).
fn with_fields(block: &Json, roles: &[Option<&'static str>], k: &mut usize) -> Json {
    let mut block = block.clone();
    if let Some(Json::Array(runs)) = block.get_mut("runs") {
        let mut out = Vec::new();
        for run in runs.drain(..) {
            let Some(text) = run.get("text").and_then(|t| t.as_str()).map(str::to_string) else {
                out.push(run);
                continue;
            };
            let mut buf = String::new();
            for (piece, word) in tokens(&text) {
                let role = if word {
                    *k += 1;
                    roles.get(*k - 1).copied().flatten()
                } else {
                    None
                };
                let Some(field) = role else {
                    buf.push_str(piece);
                    continue;
                };
                if !buf.is_empty() {
                    let mut r = run.clone();
                    r["text"] = json!(std::mem::take(&mut buf));
                    out.push(r);
                }
                let mut r = run.clone();
                // The field's text differs by page: compared without it.
                r["text"] = json!("0");
                r["field"] = json!(field);
                out.push(r);
            }
            if !buf.is_empty() {
                let mut r = run.clone();
                r["text"] = json!(buf);
                out.push(r);
            }
        }
        *runs = out;
    }
    block
}

/// What a tag's element is to the model.
fn classify(elem: &Content, at: Point, page: usize) -> Node {
    let name = elem.func().name();
    if let Some(heading) = elem.to_packed::<HeadingElem>() {
        return Node::Heading(heading.resolve_level(StyleChain::default()).get());
    }
    if let Some(cell) = elem.to_packed::<TableCell>() {
        return cell_node(
            at,
            page,
            cell.x.get(StyleChain::default()),
            cell.y.get(StyleChain::default()),
            cell.colspan.get(StyleChain::default()).get(),
            cell.rowspan.get(StyleChain::default()).get(),
            cell.inset.get(StyleChain::default()),
            cell.align.get(StyleChain::default()),
        );
    }
    if let Some(cell) = elem.to_packed::<GridCell>() {
        return cell_node(
            at,
            page,
            cell.x.get(StyleChain::default()),
            cell.y.get(StyleChain::default()),
            cell.colspan.get(StyleChain::default()).get(),
            cell.rowspan.get(StyleChain::default()).get(),
            cell.inset.get(StyleChain::default()),
            cell.align.get(StyleChain::default()),
        );
    }
    match name {
        // An outline's entries are paragraphs of their own (Typst sets each as a block).
        "par" | "entry" => Node::Par,
        "list" | "enum" | "terms" => Node::List,
        "table" | "grid" => {
            let gutters = gutters(elem);
            Node::Table {
                at,
                page,
                grid: name == "grid",
                gutters,
            }
        }
        "equation" => Node::Equation {
            block: elem
                .get_by_name("block")
                .ok()
                .and_then(|v| v.cast::<bool>().ok())
                .unwrap_or(false),
        },
        _ => Node::Opaque,
    }
}

/// Column and row gutters of a grid or table, resolved where they are lengths (em at 11pt).
fn gutters(elem: &Content) -> (Vec<f64>, Vec<f64>) {
    let get = |name: &str| -> Vec<f64> {
        let Ok(v) = elem.get_by_name(name) else {
            return Vec::new();
        };
        let one = |v: &Value| match v {
            Value::Length(l) => l.abs.to_pt() + l.em.get() * 11.0,
            Value::Relative(r) => r.abs.abs.to_pt() + r.abs.em.get() * 11.0,
            _ => 0.0,
        };
        // Typst repeats a list's last gutter for the tracks after it.
        let list: Vec<f64> = match &v {
            Value::Array(a) => a.iter().map(one).collect(),
            v => vec![one(v)],
        };
        let last = list.last().copied().unwrap_or(0.0);
        (0..512)
            .map(|i| list.get(i).copied().unwrap_or(last))
            .collect()
    };
    (get("column-gutter"), get("row-gutter"))
}

#[allow(clippy::too_many_arguments)]
fn cell_node(
    at: Point,
    page: usize,
    x: Smart<usize>,
    y: Smart<usize>,
    colspan: usize,
    rowspan: usize,
    inset: Smart<Sides<Option<typst::layout::Rel<typst::layout::Length>>>>,
    align: Smart<Alignment>,
) -> Node {
    let len = |r: Option<typst::layout::Rel<typst::layout::Length>>| {
        r.map(|r| r.abs.abs.to_pt() + r.abs.em.get() * 11.0)
            .unwrap_or(0.0)
    };
    let inset = match inset {
        Smart::Custom(s) => Sides {
            left: len(s.left),
            top: len(s.top),
            right: len(s.right),
            bottom: len(s.bottom),
        },
        Smart::Auto => Sides::splat(0.0),
    };
    let valign = match align {
        Smart::Custom(a) => match a.y() {
            Some(VAlignment::Horizon) => "center",
            Some(VAlignment::Bottom) => "bottom",
            _ => "top",
        },
        _ => "top",
    };
    let _ = HAlignment::Start;
    Node::Cell {
        at,
        page,
        x: x.custom().unwrap_or(0),
        y: y.custom().unwrap_or(0),
        colspan,
        rowspan,
        inset,
        valign,
    }
}

/// A block's indent moved right by `dx` (it was laid out in an area starting `dx` further right).
fn shift(json: &mut Map<String, Json>, dx: f64) {
    if dx == 0.0 {
        return;
    }
    match json.get_mut("indent") {
        Some(Json::Object(ind)) => {
            let left = ind.get("left").and_then(|l| l.as_f64()).unwrap_or(0.0);
            ind.insert("left".into(), json!(round(left + dx)));
        }
        Some(v @ Json::Number(_)) => {
            let n = v.as_f64().unwrap_or(0.0);
            *v = json!(round(n + dx));
        }
        _ => {}
    }
    // Tab stops are measured from the area's edge too.
    if let Some(Json::Array(tabs)) = json.get_mut("tabs") {
        for tab in tabs {
            if let Some(pos) = tab.get("pos").and_then(|p| p.as_f64()) {
                tab["pos"] = json!(round(pos + dx));
            }
        }
    }
}

/// Whether a block is placed where Typst put it on the page, taking no room in the flow: text in a frame, a picture.
fn out_of_flow(b: &Block) -> bool {
    b.json.contains_key("frame") || b.json.contains_key("placed")
}

fn round(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

#[allow(dead_code)]
fn unused(_: &dyn Introspector, _: Abs) {}
