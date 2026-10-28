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
//! - **Gaps inside a line** (`h()`, blanks drawn as underlined boxes) become exact-width runs.
//! - **Equations, images and drawings** are placeholders of their size until #132 and #133, so lines and pages still
//!   break where Typst broke them.
//!
//! Page margins aren't in the laid-out pages: the export appends a probe that records `page.margin`
//! (`MARGIN_PROBE`), and `auto` margins are resolved as typst-layout does.

use std::collections::{HashMap, HashSet};

use serde_json::{json, Map, Value as Json};
use typst::foundations::{Content, Label, Smart, StyleChain, Value};
use typst::introspection::{Introspector, Location, Tag};
use typst::layout::{
    Abs, Alignment, Frame, FrameItem, GridCell, HAlignment, PlaceElem, Point, Sides, Size,
    Transform, VAlignment,
};
use typst::model::{Destination, HeadingElem, TableCell};
use typst::pdf::{PdfMarkerTag, PdfMarkerTagKind};
use typst::text::Font;
use typst::visualize::{Color, CurveItem, FixedStroke, Geometry, Paint, Shape};
use typst_layout::{Page, PagedDocument};

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
/// A block Typst starts a page with gets a page break before it when the page before had more room left than this,
/// in points: Typst moved it on (a heading kept with what follows, a table's header with its first row, a line that
/// didn't quite fit) where an engine measuring a hair shorter wouldn't. A page break before a paragraph that already
/// starts a page adds none.
const PAGE_ROOM: f64 = 1.0;

/// The model as JSON (see `@typstream/docx`'s `DocxModel`) and the data of the fonts it names, in its order.
pub struct Model {
    pub json: String,
    pub fonts: Vec<Vec<u8>>,
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
    };
    let sections = builder.sections(pages);
    let json = json!({
        "sections": sections,
        "fonts": builder.fonts.json(),
        "lists": builder.lists,
    });
    Model {
        json: json.to_string(),
        fonts: builder.fonts.data,
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
}

struct Item {
    page: usize,
    kind: Kind,
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
}

impl Linearizer<'_> {
    fn push(&mut self, kind: Kind) {
        self.items.push(Item {
            page: self.page,
            kind,
        });
    }

    fn walk(&mut self, frame: &Frame, ts: Transform) {
        for (pos, item) in frame.items() {
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
                    // A grid or table drawn with curves (rounded cards) stays a grid: its cells are found inside.
                    if !gts.is_only_translate() || (curvy(&group.frame) && !has_cells(&group.frame))
                    {
                        // Rotated or drawn content (CeTZ, edu's drawings): an image later (#133). Its tags stay, so
                        // elements around it (a cell it is in) still start and end.
                        self.push(Kind::Drawing(rect));
                        self.tags(&group.frame, at);
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
                    let mut first_word = 0.0;
                    for glyph in &text.glyphs {
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
                    self.push(Kind::Text(Text {
                        x: at.x.to_pt(),
                        y: at.y.to_pt(),
                        width: text.width().to_pt(),
                        inked: text.width().to_pt() - trailing,
                        size: text.size.to_pt(),
                        font: text.font.font().clone(),
                        color: paint_hex(&text.fill),
                        text: text.text.to_string(),
                        first_word,
                    }))
                }
                FrameItem::Shape(shape, _) => self.shape(shape, at),
                FrameItem::Image(_, size, _) => self.push(Kind::Drawing(Rect {
                    x: at.x.to_pt(),
                    y: at.y.to_pt(),
                    w: size.x.to_pt(),
                    h: size.y.to_pt(),
                })),
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
                FrameItem::Tag(Tag::Start(elem, _)) => {
                    if matches!(elem.func().name(), "table" | "grid") {
                        self.tables.extend(elem.location());
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
                    self.push(Kind::End(*loc))
                }
            }
        }
    }

    /// The tags in a frame whose content is a drawing, placed where the drawing is.
    fn tags(&mut self, frame: &Frame, at: Point) {
        for (_, item) in frame.items() {
            match item {
                FrameItem::Group(g) => self.tags(&g.frame, at),
                FrameItem::Tag(Tag::Start(elem, _)) => self.push(Kind::Start(elem.clone(), at)),
                FrameItem::Tag(Tag::End(loc, ..)) => self.push(Kind::End(*loc)),
                _ => {}
            }
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
                (Some(r), Some(fill)) if shape.stroke.is_none() => {
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

fn seg(x0: f64, y0: f64, x1: f64, y1: f64, stroke: &FixedStroke) -> Seg {
    Seg {
        x0: x0.min(x1),
        y0: y0.min(y1),
        x1: x0.max(x1),
        y1: y0.max(y1),
        thickness: stroke.thickness.to_pt(),
        color: paint_hex(&stroke.paint),
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

/// Whether a frame holds table or grid cells.
fn has_cells(frame: &Frame) -> bool {
    frame.items().any(|(_, item)| match item {
        FrameItem::Group(g) => has_cells(&g.frame),
        FrameItem::Tag(Tag::Start(elem, _)) => elem.is::<TableCell>() || elem.is::<GridCell>(),
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
    let byte = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
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
        let nbsp = ttf_parser::Face::parse(data, font.index())
            .ok()
            .and_then(|face| {
                let gid = face
                    .glyph_index('\u{a0}')
                    .or_else(|| face.glyph_index(' '))?;
                Some(face.glyph_hor_advance(gid)? as f64 / face.units_per_em() as f64)
            })
            .unwrap_or(0.25);
        self.meta.push((family, bold, italic, nbsp));
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
        underline: bool,
        link: Option<String>,
    },
    /// An exact-width space: a gap in a line, a blank, a placeholder.
    Gap {
        width: f64,
        underline: bool,
        font: usize,
        size: f64,
    },
    Tab,
    /// A line break Typst was told to make (`\`), not one it chose.
    Break,
    /// Room held for what the model can't express yet (math, images): an exact-width gap until #132, #133.
    Placeholder {
        width: f64,
        font: usize,
        size: f64,
    },
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
    /// Width of its first word, or of whatever it starts with.
    first_word: f64,
    top: f64,
    bottom: f64,
}

struct Builder {
    items: std::rc::Rc<Vec<Item>>,
    geometry: Vec<(Size, Sides<f64>)>,
    fonts: Fonts,
    lists: Vec<Json>,
    /// Header rows Typst repeated on later pages, by table.
    repeated: HashSet<(Location, usize)>,
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

    fn sections(&mut self, pages: &[Page]) -> Json {
        let _ = pages;
        let n = self.items.len();
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
                Kind::Seg(s) => (
                    zone(s.y0, s.y0).filter(|_| s.y0 < m.top || s.y0 > bottom_edge),
                    i,
                ),
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
        let blocks = self.with_gaps(blocks, true);
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
            let roles = field_roles(
                &pages.iter().map(|(b, _)| b.clone()).collect::<Vec<_>>(),
                page_count,
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
        for b in blocks.iter_mut() {
            // A framed paragraph (placed text) is out of the flow: no room before it, none taken.
            if b.json.contains_key("frame") {
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
            let at_bottom = body && b.bottom > size.y.to_pt() - m.bottom - 1.0;
            let before = if at_bottom && before > 2.0 * SLACK {
                before - SLACK
            } else {
                before
            };
            b.json
                .insert("before".into(), json!(round(before.max(0.0))));
            prev = Some((b.end_page, b.bottom));
        }
        blocks
    }

    /// Blocks from items `ids` (indices into `self.items`, in order) flowing in `area`.
    fn flow(&mut self, ids: &[usize], area: Area, body: bool) -> Vec<Block> {
        let mut out = Vec::new();
        // Text gathered for the paragraph being built.
        let mut pending: Vec<usize> = Vec::new();
        let mut heading: Option<usize> = None;
        let items = self.items.clone();
        let mut i = 0;
        while i < ids.len() {
            let id = ids[i];
            match &items[id].kind {
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
                    }
                    let node = classify(elem, *at, items[id].page);
                    match node {
                        Node::Par => {
                            self.flush(&mut pending, &mut out, area, heading);
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
                            if let Some(b) = self.placeholder_block(&ids[i + 1..end], area) {
                                out.push(b);
                            }
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
                    let inline = after || pending.iter().any(|&p| beside(p));
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
                        && !self.beside(&pending, *rect, items[id].page) =>
                {
                    // A block narrower than the area on its right (a padded quote): where its wrapped lines end is
                    // its right edge, an indent for its paragraphs. A group with one line may be only as wide as its
                    // text, and says nothing about wrapping.
                    let end = group_end(&items, ids, i).min(ids.len() - 1);
                    let inner = &ids[i + 1..end];
                    let baselines: Vec<f64> = inner
                        .iter()
                        .filter_map(|&j| match &items[j].kind {
                            Kind::Text(t) => Some(t.y),
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
                            let had = b.json["indent"]
                                .get("right")
                                .and_then(|r| r.as_f64())
                                .unwrap_or(0.0);
                            b.json["indent"]["right"] = json!(round(had + right));
                        }
                    }
                    out.extend(blocks);
                    i = end + 1;
                    continue;
                }
                Kind::Seg(s)
                    if s.horizontal() && (s.x1 - s.x0) > 0.9 * (area.right - area.left) =>
                {
                    // A rule across the area (`line(length: 100%)`): an empty paragraph with a bottom border.
                    let inline = pending.iter().any(|&p| matches!(&self.items[p].kind, Kind::Text(t) if (t.y - s.y0).abs() < t.size));
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
                Kind::Rect(rect) if !self.beside(&pending, *rect, items[id].page) => {
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
                    let mut json = Map::new();
                    json.insert("type".into(), json!("drawing"));
                    json.insert("placeholder".into(), json!(true));
                    json.insert("width".into(), json!(round(rect.w)));
                    json.insert("height".into(), json!(round(rect.h)));
                    json.insert("indent".into(), json!(round(rect.x - area.left)));
                    out.push(Block {
                        page: self.items[id].page,
                        end_page: self.items[id].page,
                        top: rect.y,
                        bottom: rect.bottom(),
                        json,
                    });
                    // What is drawn over it (a rounded card's text) is part of the drawing.
                    i = self.drawn_over(ids, i, *rect);
                }
                _ => pending.push(id),
            }
            i += 1;
        }
        self.flush(&mut pending, &mut out, area, heading);
        out
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
            };
            current = k;
            parts[k].push(id);
        }
        let mut cols = Vec::new();
        let mut bottom = rect.bottom();
        for (k, part) in parts.iter().enumerate() {
            let area = Area {
                left: xs[k],
                right: xs[k] + w,
            };
            let blocks = self.flow(part, area, false);
            bottom = blocks.iter().map(|b| b.bottom).fold(bottom, f64::max);
            let blocks = self.with_gaps_from(blocks, rect.y);
            cols.push(Json::Array(
                blocks.into_iter().map(|b| Json::Object(b.json)).collect(),
            ));
        }
        let mut json = Map::new();
        json.insert("type".into(), json!("columns"));
        json.insert("gap".into(), json!(round(gap)));
        json.insert("columns".into(), Json::Array(cols));
        Block {
            page,
            end_page: page,
            top: rect.y,
            bottom,
            json,
        }
    }

    /// Index (into `ids`) of the last item after `ids[i]` drawn inside `rect`, on its page.
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
        let mut segs: Vec<(usize, Seg)> = Vec::new();
        let mut links: Vec<(usize, Rect, String)> = Vec::new();
        let mut boxes: Vec<(usize, Rect)> = Vec::new();
        let mut equation = 0usize;
        let mut eq_start: Option<(usize, f64)> = None;
        for &id in ids {
            let page = self.items[id].page;
            match &self.items[id].kind {
                Kind::Text(t) if equation == 0 => texts.push((page, t.clone())),
                Kind::Text(t) if equation > 0 => {
                    // Math: a placeholder covering the equation's items.
                    if let Some((_, x0)) = eq_start {
                        eq_start = Some((page, x0.min(t.x)));
                    }
                    boxes.push((
                        page,
                        Rect {
                            x: t.x,
                            y: t.y - t.size,
                            w: t.width,
                            h: t.size * 1.2,
                        },
                    ));
                }
                Kind::Start(elem, at) if elem.func().name() == "equation" => {
                    equation += 1;
                    eq_start = Some((page, at.x.to_pt()));
                }
                Kind::End(_) if equation > 0 => {
                    // Ends are matched loosely: equations don't nest.
                    equation = 0;
                }
                Kind::Seg(s) if s.horizontal() => segs.push((page, s.clone())),
                Kind::Link(r, url) => links.push((page, *r, url.clone())),
                Kind::Drawing(r) => boxes.push((page, *r)),
                _ => {}
            }
        }
        // Merge math pieces into placeholders per baseline-ish band.
        let mut lines: Vec<Line> = Vec::new();
        let mut atoms: Vec<(usize, f64, f64, f64, Option<Text>, Option<Rect>)> = Vec::new(); // page, x, w, baseline
        for (page, t) in &texts {
            atoms.push((*page, t.x, t.width, t.y, Some(t.clone()), None));
        }
        // Placeholders: attach to the line whose baseline is inside their box.
        let mut placeholders: Vec<(usize, Rect)> = Vec::new();
        for (page, r) in boxes {
            if let Some(last) = placeholders.last_mut() {
                if last.0 == page
                    && r.x <= last.1.right() + 1.0
                    && r.y < last.1.bottom()
                    && r.bottom() > last.1.y
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
                    continue;
                }
            }
            placeholders.push((page, r));
        }
        for (page, r) in placeholders {
            let baseline = texts
                .iter()
                .filter(|(p, t)| *p == page && t.y >= r.y - 1.0 && t.y <= r.bottom() + 1.0)
                .map(|(_, t)| t.y)
                .next()
                .unwrap_or(r.bottom());
            atoms.push((page, r.x, r.w, baseline, None, Some(r)));
        }
        // Atoms in document order by (page, baseline band, x) — text items keep their logical order within a line.
        let mut order: Vec<usize> = (0..atoms.len()).collect();
        order.sort_by(|&a, &b| {
            let (pa, ya) = (atoms[a].0, atoms[a].3);
            let (pb, yb) = (atoms[b].0, atoms[b].3);
            pa.cmp(&pb)
                .then(if (ya - yb).abs() < 0.6 {
                    std::cmp::Ordering::Equal
                } else {
                    ya.partial_cmp(&yb).unwrap()
                })
                .then(atoms[a].1.partial_cmp(&atoms[b].1).unwrap())
        });
        for k in order {
            let (page, x, w, baseline, text, rect) = atoms[k].clone();
            let new_line = match lines.last() {
                Some(l) => l.page != page || (l.baseline - baseline).abs() >= 0.6,
                None => true,
            };
            if new_line {
                let first_word = text.as_ref().map(|t| t.first_word).unwrap_or(w);
                lines.push(Line {
                    page,
                    baseline,
                    size: 0.0,
                    left: x,
                    right: x + w,
                    runs: Vec::new(),
                    tall: false,
                    top: f64::MAX,
                    bottom: f64::MIN,
                    first_word,
                });
            }
            let line = lines.last_mut().unwrap();
            // A gap since the last atom: an exact-width space.
            let gap = x - line.right;
            let (font, size) = match &text {
                Some(t) => (self.fonts.get(&t.font), t.size),
                None => (last_font(&line.runs).unwrap_or(0), 11.0),
            };
            if !line.runs.is_empty() && gap > 0.05 {
                let underline = underlined(&segs, page, line.right, x, baseline);
                line.runs.push(Run::Gap {
                    width: gap,
                    underline,
                    font,
                    size,
                });
            }
            match (text, rect) {
                (Some(t), _) => {
                    let underline = underlined(&segs, page, t.x, t.x + t.width, baseline);
                    let link = links
                        .iter()
                        .find(|(p, r, _)| {
                            *p == page && r.contains(t.x + t.width / 2.0, t.y - t.size / 3.0)
                        })
                        .map(|l| l.2.clone());
                    line.size = line.size.max(t.size);
                    line.top = line.top.min(t.y - TOP * t.size);
                    line.bottom = line.bottom.max(t.y + BOTTOM * t.size);
                    push_text(
                        &mut line.runs,
                        t.text,
                        font,
                        t.size,
                        t.color,
                        underline,
                        link,
                    );
                }
                (None, Some(r)) => {
                    line.runs.push(Run::Placeholder {
                        width: r.w,
                        font,
                        size,
                    });
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
        // Underlines past the last atom (a blank at the end of a line).
        for line in lines.iter_mut() {
            if let Some((_, s)) = segs.iter().find(|(p, s)| {
                *p == line.page
                    && s.x1 > line.right + 0.5
                    && s.y0 > line.baseline - 1.0
                    && s.y0 < line.baseline + 0.6 * line.size.max(8.0)
                    && s.x0 < line.right + 0.5
            }) {
                let font = last_font(&line.runs).unwrap_or(0);
                line.runs.push(Run::Gap {
                    width: s.x1 - line.right,
                    underline: true,
                    font,
                    size: line.size.max(8.0),
                });
                line.right = s.x1;
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
            if let Some(next) = iter.peek().filter(|n| n.page == line.page) {
                fit = fit.min(line.right + next.first_word - area.right);
            }
            let forced = match iter.peek() {
                // The next line's first word would have fitted after this one: Typst didn't choose to break.
                Some(next) if next.page == line.page => {
                    // Room left on the line: on its right, or on both sides when it is centered.
                    let centered =
                        ((line.left - area.left) - (area.right - line.right)).abs() < 1.0;
                    let room = if centered {
                        width - (line.right - line.left)
                    } else {
                        area.right - line.right
                    };
                    room > next.first_word + 1.0 && (line.right - line.left) < width - 1.0
                }
                _ => false,
            };
            let next_size = iter.peek().map(|n| n.size);
            groups.last_mut().unwrap().push(line);
            k += 1;
            if forced && k < n {
                let same = next_size.is_some_and(|s| {
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
        if fit < f64::MAX {
            for b in &mut out {
                b.json.insert("fit".into(), json!(fit));
            }
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
        // A gap that takes what's left of a line (`h(1fr)`), so its last words end at the right edge: a tab to a
        // right tab stop there, as Word writes it. An exact gap would fill the line to a hundredth of a point, and an
        // engine measuring a hair wider would push the last words onto a line of their own.
        let mut right_tab = false;
        for line in lines.iter_mut() {
            if (line.right - area.right).abs() > 0.6 {
                continue;
            }
            if let Some(k) = line.runs.iter().rposition(
                |r| matches!(r, Run::Gap { width, underline: false, .. } if *width >= 2.0),
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
            let baseline = s.y0 - BOTTOM * size;
            lines.push(Line {
                page,
                baseline,
                size,
                left: s.x0,
                right: s.x1,
                runs: vec![Run::Gap {
                    width: s.x1 - s.x0,
                    underline: true,
                    font: 0,
                    size,
                }],
                tall: false,
                first_word: s.x1 - s.x0,
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
        let centered = !right_tab
            && lines
                .iter()
                .all(|l| ((l.left - area.left) - (area.right - l.right)).abs() < 1.0)
            && lefts[0] > 2.0;
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
            for run in &line.runs {
                runs.push(run_json(run));
            }
            // Lines join as they are: a line keeps the space it broke at.
            let _ = k;
        }
        let mut json = Map::new();
        json.insert("type".into(), json!("p"));
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
            json.insert(
                "tabs".into(),
                json!([{ "pos": round(area.right - area.left), "align": "end" }]),
            );
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
        let numbering = numbering(&labels.iter().map(|l| l.0.clone()).collect::<Vec<_>>());
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
        for (k, (_, body)) in items.iter().enumerate() {
            // The body flows from where it starts, so a line as long as the room left reads as flush, not as
            // centred in the area; its blocks are then indented by as much.
            let left = body_x[k]
                .filter(|x| *x > area.left && *x < area.right)
                .unwrap_or(area.left);
            let nested = self.lists.len();
            let flow = self.flow(
                body,
                Area {
                    left,
                    right: area.right,
                },
                false,
            );
            // Lists nested in the body were measured from its start too.
            for l in &mut self.lists[nested..] {
                for key in ["labelLeft", "labelRight", "bodyLeft"] {
                    if let Some(v) = l.get(key).and_then(|v| v.as_f64()) {
                        l[key] = json!(round(v + left - area.left));
                    }
                }
            }
            let mut first = true;
            for mut b in flow {
                shift(&mut b.json, left - area.left);
                if first && b.json.get("type") == Some(&json!("p")) {
                    let left = area.left + b.json["indent"]["left"].as_f64().unwrap_or(0.0);
                    body_left = body_left.min(left);
                    b.json
                        .insert("list".into(), json!({ "id": id, "label": labels[k].0 }));
                    first = false;
                }
                out.push(b);
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
        out
    }

    fn ends_list(&self, id: usize, ids: &[usize]) -> bool {
        // Whether the end tag at `id` closes a list started among `ids`.
        let Kind::End(loc) = &self.items[id].kind else {
            return false;
        };
        ids.iter().any(|&j| matches!(&self.items[j].kind, Kind::Start(e, _) if e.location() == Some(*loc) && matches!(classify(e, Point::zero(), 0), Node::List)))
    }

    /// A placeholder for something the model can't express yet (a display equation): an empty paragraph as tall.
    fn placeholder_block(&mut self, ids: &[usize], area: Area) -> Option<Block> {
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
        json.insert("math".into(), json!(true));
        json.insert("placeholder".into(), json!(true));
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
        // The inset on the sides: where the content's leftmost text starts (blocks are drawn with even insets).
        let inset_left = inner
            .iter()
            .filter_map(|&id| match &self.items[id].kind {
                Kind::Text(t) => Some(t.x - rect.x),
                _ => None,
            })
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
            .filter_map(|&id| match &self.items[id].kind {
                Kind::Text(t) => Some(t.x + t.width),
                _ => None,
            })
            .fold(f64::MIN, f64::max);
        let inset_right = if max_right == f64::MIN {
            inset_left
        } else {
            inset_left.min(rect.right() - max_right).max(0.0)
        };
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
        let mut frames: HashMap<usize, Rect> = HashMap::new();
        let mut drawn: HashSet<usize> = HashSet::new();
        for &id in &ids[1..] {
            let page = self.items[id].page;
            match &self.items[id].kind {
                Kind::Group(r, _)
                    if !drawn.contains(&page)
                        && (r.x - at.x.to_pt()).abs() < 0.5
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
        let left = at.x.to_pt();
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
        let frame_bottom = |p: usize| frames.get(&p).map(|f| f.bottom());
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
            let blocks = self.flow(&cell_ids, content, false);
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
            let border = sides_json(&segs, cell_rect);
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
        segs: &mut Vec<Seg>,
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
            let to = match &self.items[id].kind {
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
                    segs.push(s.clone());
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
            };
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
        for b in blocks.iter_mut() {
            // `fit` stays: the writer gives a cell no more slack than its paragraphs' fit.
            if b.json.contains_key("frame") {
                b.json.insert("before".into(), json!(0.0));
                continue;
            }
            let before = match prev {
                Some((p, bottom)) if p == b.page => b.top - bottom,
                Some(_) => 0.0,
                None => b.top - top,
            };
            b.json
                .insert("before".into(), json!(round(before.max(0.0))));
            prev = Some((b.end_page, b.bottom));
        }
        blocks
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
            out.insert(
                side.into(),
                json!({ "width": round(s.thickness), "color": s.color }),
            );
        }
    }
    Json::Object(out)
}

fn sides(s: Sides<f64>) -> Json {
    json!({ "top": round(s.top), "right": round(s.right), "bottom": round(s.bottom), "left": round(s.left) })
}

fn underlined(segs: &[(usize, Seg)], page: usize, x0: f64, x1: f64, baseline: f64) -> bool {
    let mid = (x0 + x1) / 2.0;
    segs.iter().any(|(p, s)| {
        *p == page
            && s.x0 <= mid
            && s.x1 >= mid
            && s.y0 > baseline - 1.0
            && s.y0 < baseline + 6.0
            && s.thickness < 2.0
    })
}

fn last_font(runs: &[Run]) -> Option<usize> {
    runs.iter().rev().find_map(|r| match r {
        Run::Text { font, .. } | Run::Gap { font, .. } | Run::Placeholder { font, .. } => {
            Some(*font)
        }
        Run::Tab | Run::Break => None,
    })
}

fn push_text(
    runs: &mut Vec<Run>,
    text: String,
    font: usize,
    size: f64,
    color: String,
    underline: bool,
    link: Option<String>,
) {
    if let Some(Run::Text {
        text: t,
        font: f,
        size: s,
        color: c,
        underline: u,
        link: l,
    }) = runs.last_mut()
    {
        if *f == font && (*s - size).abs() < 0.01 && *c == color && *u == underline && *l == link {
            t.push_str(&text);
            return;
        }
    }
    runs.push(Run::Text {
        text,
        font,
        size,
        color,
        underline,
        link,
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
        } => {
            let mut m = Map::new();
            m.insert("text".into(), json!(text));
            m.insert("font".into(), json!(font));
            m.insert("size".into(), json!(round(*size)));
            if color != "000000" {
                m.insert("color".into(), json!(color));
            }
            if *underline {
                m.insert("underline".into(), json!(true));
            }
            if let Some(l) = link {
                m.insert("link".into(), json!(l));
            }
            Json::Object(m)
        }
        Run::Gap {
            width,
            underline,
            font,
            size,
        } => {
            let mut m = Map::new();
            m.insert("gap".into(), json!(round(*width)));
            m.insert("font".into(), json!(font));
            m.insert("size".into(), json!(round(*size)));
            if *underline {
                m.insert("underline".into(), json!(true));
            }
            Json::Object(m)
        }
        Run::Placeholder { width, font, size } => {
            json!({ "gap": round(*width), "font": font, "size": round(*size), "placeholder": true })
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
    } else if let Some(n) = roman(token) {
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
fn numbers(blocks: &[Json]) -> Vec<usize> {
    let mut out = Vec::new();
    for b in blocks {
        for run in b
            .get("runs")
            .and_then(|r| r.as_array())
            .into_iter()
            .flatten()
        {
            let text = run.get("text").and_then(|t| t.as_str()).unwrap_or("");
            let mut digits = String::new();
            for c in text.chars().chain(std::iter::once(' ')) {
                if c.is_ascii_digit() {
                    digits.push(c);
                } else if !digits.is_empty() {
                    out.push(digits.parse().unwrap_or(0));
                    digits.clear();
                }
            }
        }
    }
    out
}

/// What each number in the marginals is, by its index: the page's number (`PAGE`) where some page has it and not
/// the count, the page count (`NUMPAGES`) the other way round. "2 / 2" alone can't say which is which.
fn field_roles(pages: &[Vec<Json>], count: usize) -> Vec<Option<&'static str>> {
    let lists: Vec<Vec<usize>> = pages.iter().map(|p| numbers(p)).collect();
    let len = lists.iter().map(|l| l.len()).max().unwrap_or(0);
    (0..len)
        .map(|k| {
            let at = |p: usize| lists[p].get(k).copied();
            let page = (0..pages.len()).any(|p| at(p) == Some(p + 1) && p + 1 != count);
            let total = (0..pages.len()).any(|p| at(p) == Some(count) && p + 1 != count);
            let all_page = (0..pages.len()).all(|p| at(p).is_none() || at(p) == Some(p + 1));
            let all_total = (0..pages.len()).all(|p| at(p).is_none() || at(p) == Some(count));
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
            let mut rest = text.as_str();
            let mut buf = String::new();
            while !rest.is_empty() {
                let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
                if !digits.is_empty() {
                    let role = roles.get(*k).copied().flatten();
                    *k += 1;
                    if let Some(field) = role {
                        if !buf.is_empty() {
                            let mut r = run.clone();
                            r["text"] = json!(std::mem::take(&mut buf));
                            out.push(r);
                        }
                        let mut r = run.clone();
                        // The field's digits differ by page: compared without them.
                        r["text"] = json!("0");
                        r["field"] = json!(field);
                        out.push(r);
                    } else {
                        buf.push_str(&digits);
                    }
                    rest = &rest[digits.len()..];
                    continue;
                }
                let c = rest.chars().next().unwrap();
                buf.push(c);
                rest = &rest[c.len_utf8()..];
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
        "par" => Node::Par,
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

fn round(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

#[allow(dead_code)]
fn unused(_: &dyn Introspector, _: Abs) {}
