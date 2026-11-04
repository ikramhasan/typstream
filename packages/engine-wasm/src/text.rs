//! The text drawn on a page, for the renderer's selectable text layer (#14),
//! with its structure, language and direction for assistive technology (#63).
//!
//! typst-svg draws glyphs as `<use>`s of outline paths, so an SVG page has no
//! text a browser can select, search or read aloud. This walks the page frame
//! the way typst-svg does (`render_frame`, `render_group`) and returns its text
//! with where it sits on the page, so the renderer can lay invisible text over
//! the glyphs.
//!
//! Runs are in logical order: a line's frame holds its items in logical order
//! (typst-layout's `commit` sorts them back for introspection), but one shaped
//! run becomes a `TextItem` per stretch of glyphs with the same font and
//! vertical offset (`ShapedText::build`), laid out left to right. An Arabic
//! word in Noto Naskh is several of them, because its dots are mark glyphs
//! with an offset, and each mark's item repeats the letter it sits on (a mark
//! belongs to its base's cluster). So marks are dropped, and touching pieces
//! of one run are joined back, right to left for RTL text.
//!
//! Structure comes from the introspection tags Typst puts in every frame
//! (`FrameItem::Tag`), the ones typst-pdf builds a tagged PDF's structure tree
//! from (`tags/tree/build.rs`): headings, lists, tables and their cells. List
//! items come from the label and body markers typst-layout wraps around them
//! (`PdfMarkerTag`), not from the items' own tags, which stay where the items
//! were before realization grouped them into a list. Rows aren't elements:
//! cells are grouped by their `y`.

use std::ops::Range;

use typst::foundations::{Content, Packed, StyleChain};
use typst::introspection::{Location, Tag};
use typst::layout::{Abs, Dir, Frame, FrameItem, Point, Transform};
use typst::model::{EnumElem, HeadingElem, ListElem, TableCell, TableElem, TermsElem, TitleElem};
use typst::pdf::{PdfMarkerTag, PdfMarkerTagKind, TableCellKind};
use typst::text::{Locale, TextItem};
use typst_layout::Page;
use unicode_bidi::{bidi_class, BidiClass};
use wasm_bindgen::prelude::*;

use crate::js::set;

/// Rounds to 1/100 pt: invisible text doesn't need more, and it keeps the
/// numbers short when they cross the worker boundary as JSON.
fn round(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

fn ratio(v: f64) -> f64 {
    (v * 10_000.0).round() / 10_000.0
}

/// What a page's text layer is made of (see `TS_TYPES`).
pub struct PageText {
    /// `TextRun[]`.
    pub runs: js_sys::Array,
    /// `TextNode[]`: the outermost structure elements on the page.
    pub structure: js_sys::Array,
}

/// The text runs of a page and the structure around them. `open` are the
/// elements that began on an earlier page and go on here (a list or table
/// broken across pages; `OpenElements`), outermost first. `lang` and `dir` are
/// the document's: runs only carry their own when they differ.
pub fn page_text(page: &Page, open: &[Content], lang: &str, dir: Dir) -> PageText {
    let mut walker = Walker {
        runs: js_sys::Array::new(),
        count: 0,
        lang,
        dir,
        pieces: Vec::new(),
        stack: vec![Node::new(Role::Root, 0, None)],
    };
    for elem in open {
        walker.start(elem);
    }
    walker.walk(&page.frame, Transform::identity());
    walker.flush();
    while walker.stack.len() > 1 {
        walker.close();
    }
    let root = walker.stack.pop().unwrap();
    PageText {
        runs: walker.runs,
        structure: root.children.iter().map(Node::to_js).collect(),
    }
}

/// The structure elements open where each page starts: started on an earlier
/// page, not ended before this one. A page has the tags of the elements that
/// start or end on it, not of those it is in the middle of (page 2 of a table
/// on three pages), so this follows the tags of every page before it. Ask for
/// pages in ascending order.
pub struct OpenElements {
    stack: Vec<Content>,
    /// Pages whose tags `stack` has followed.
    seen: usize,
}

impl OpenElements {
    pub fn new() -> Self {
        OpenElements {
            stack: Vec::new(),
            seen: 0,
        }
    }

    pub fn at(&mut self, pages: &[Page], index: usize) -> &[Content] {
        for page in &pages[self.seen..index] {
            follow(&page.frame, &mut self.stack);
        }
        self.seen = index;
        &self.stack
    }
}

fn follow(frame: &Frame, stack: &mut Vec<Content>) {
    for (_, item) in frame.items() {
        match item {
            FrameItem::Group(group) => follow(&group.frame, stack),
            FrameItem::Tag(Tag::Start(elem, _)) if structural(elem) => stack.push(elem.clone()),
            FrameItem::Tag(Tag::End(loc, ..)) => {
                if let Some(at) = stack.iter().rposition(|e| e.location() == Some(*loc)) {
                    stack.truncate(at);
                }
            }
            _ => {}
        }
    }
}

/// Elements `Walker::start` gives the layer structure for.
fn structural(elem: &Content) -> bool {
    elem.is::<HeadingElem>()
        || elem.is::<TitleElem>()
        || elem.is::<ListElem>()
        || elem.is::<EnumElem>()
        || elem.is::<TermsElem>()
        || elem.is::<TableElem>()
        || elem.is::<TableCell>()
        || elem.is::<PdfMarkerTag>()
}

#[derive(Clone, Copy, PartialEq)]
enum Role {
    Root,
    /// `aria-level`: a Typst heading of level n is n + 1, as typst-html makes
    /// it `<h{n+1}>` (h1 is the document's title).
    Heading(usize),
    List,
    ListItem,
    Table,
    Row(usize),
    Cell,
    ColumnHeader,
}

impl Role {
    fn name(self) -> &'static str {
        match self {
            Role::Root => "root",
            Role::Heading(_) => "heading",
            Role::List => "list",
            Role::ListItem => "listitem",
            Role::Table => "table",
            Role::Row(_) => "row",
            Role::Cell => "cell",
            Role::ColumnHeader => "columnheader",
        }
    }
}

struct Node {
    role: Role,
    /// Run indices `[from, to)`.
    from: usize,
    to: usize,
    children: Vec<Node>,
    /// The location whose end tag ends the node. Rows have none; a list item
    /// gets its body's once the body starts.
    loc: Option<Location>,
    /// A table's header rows (Typst's row indices, without gutters).
    headers: Vec<Range<usize>>,
}

impl Node {
    fn new(role: Role, from: usize, loc: Option<Location>) -> Self {
        Node {
            role,
            from,
            to: from,
            children: Vec::new(),
            loc,
            headers: Vec::new(),
        }
    }

    fn to_js(&self) -> JsValue {
        let obj = js_sys::Object::new();
        set(&obj, "role", self.role.name());
        if let Role::Heading(level) = self.role {
            set(&obj, "level", level as f64);
        }
        set(&obj, "from", self.from as f64);
        set(&obj, "to", self.to as f64);
        if !self.children.is_empty() {
            let children: js_sys::Array = self.children.iter().map(Node::to_js).collect();
            set(&obj, "children", children);
        }
        obj.into()
    }
}

/// Header rows of a table, from its resolved grid (as typst-pdf's `TableCtx`).
fn header_rows(table: &Packed<TableElem>) -> Vec<Range<usize>> {
    let Some(grid) = table.grid.as_ref() else {
        return Vec::new();
    };
    // With gutters, grid rows alternate with gutter rows (a header starts on a real one).
    let step = if grid.has_gutter { 2 } else { 1 };
    grid.headers
        .iter()
        .map(|h| h.range.start / step..h.range.end.div_ceil(step))
        .collect()
}

/// A `TextItem` as the layer gets it, before touching pieces are joined.
struct Piece {
    text: String,
    /// Start of the baseline on the page, in points.
    x: f64,
    y: f64,
    size: f64,
    width: f64,
    matrix: Option<[f64; 4]>,
    lang: String,
    dir: Option<Dir>,
}

struct Walker<'a> {
    runs: js_sys::Array,
    /// Runs pushed so far.
    count: usize,
    lang: &'a str,
    dir: Dir,
    /// Pieces of the run being joined, left to right.
    pieces: Vec<Piece>,
    /// Open elements, the root first.
    stack: Vec<Node>,
}

impl Walker<'_> {
    fn top(&self) -> &Node {
        self.stack.last().unwrap()
    }

    fn open(&mut self, node: Node) {
        self.stack.push(node);
    }

    /// Ends the innermost open element at the current run.
    fn close(&mut self) {
        let mut node = self.stack.pop().unwrap();
        node.to = self.count;
        // A heading without text would be an empty heading (an axe violation).
        if matches!(node.role, Role::Heading(_)) && node.from == node.to {
            return;
        }
        self.stack.last_mut().unwrap().children.push(node);
    }

    fn start(&mut self, elem: &Content) {
        let loc = elem.location();
        let role = if let Some(heading) = elem.to_packed::<HeadingElem>() {
            Role::Heading(heading.resolve_level(StyleChain::default()).get() + 1)
        } else if elem.is::<TitleElem>() {
            Role::Heading(1)
        } else if elem.is::<ListElem>() || elem.is::<EnumElem>() || elem.is::<TermsElem>() {
            Role::List
        } else if let Some(table) = elem.to_packed::<TableElem>() {
            let mut node = Node::new(Role::Table, self.count, loc);
            node.headers = header_rows(table);
            return self.open(node);
        } else if let Some(cell) = elem.to_packed::<TableCell>() {
            return self.start_cell(cell, loc);
        } else if let Some(marker) = elem.to_packed::<PdfMarkerTag>() {
            return self.start_marker(marker, loc);
        } else {
            return;
        };
        self.open(Node::new(role, self.count, loc));
    }

    /// A list item starts at its label (the bullet or number), or at its body
    /// if it has none, and ends with its body.
    fn start_marker(&mut self, marker: &Packed<PdfMarkerTag>, loc: Option<Location>) {
        let in_list = self.top().role == Role::List;
        match marker.kind {
            PdfMarkerTagKind::ListItemLabel if in_list => {
                self.open(Node::new(Role::ListItem, self.count, None));
            }
            PdfMarkerTagKind::ListItemBody
                if self.top().role == Role::ListItem && self.top().loc.is_none() =>
            {
                self.stack.last_mut().unwrap().loc = loc;
            }
            PdfMarkerTagKind::ListItemBody | PdfMarkerTagKind::TermsItemBody if in_list => {
                self.open(Node::new(Role::ListItem, self.count, loc));
            }
            _ => {}
        }
    }

    fn start_cell(&mut self, cell: &Packed<TableCell>, loc: Option<Location>) {
        // Only inside a table: grid layout uses table cells internally too.
        let Some(table) = self.stack.iter().rposition(|n| n.role == Role::Table) else {
            return;
        };
        let y = cell.y.get(StyleChain::default()).custom().unwrap_or(0);
        // Whatever the last cell left open ends, and its row if this cell starts a new one.
        while self.stack.len() > table + 2
            || (self.stack.len() == table + 2 && self.top().role != Role::Row(y))
        {
            self.close();
        }
        if self.stack.len() == table + 1 {
            self.open(Node::new(Role::Row(y), self.count, None));
        }
        let table = &self.stack[self.stack.len() - 2];
        let header = match cell.kind.get(StyleChain::default()).custom() {
            Some(kind) => matches!(kind, TableCellKind::Header(..)),
            None => table.headers.iter().any(|rows| rows.contains(&y)),
        };
        let role = if header {
            Role::ColumnHeader
        } else {
            Role::Cell
        };
        self.open(Node::new(role, self.count, loc));
    }

    fn end(&mut self, loc: &Location) {
        // Elements that didn't end before this one end with it (a row ends
        // with its table).
        if let Some(at) = self.stack.iter().rposition(|n| n.loc.as_ref() == Some(loc)) {
            while self.stack.len() > at {
                self.close();
            }
        }
    }

    fn walk(&mut self, frame: &Frame, ts: Transform) {
        let items = frame.items().as_slice();
        for (i, (pos, item)) in items.iter().enumerate() {
            let ts = ts.pre_concat(Transform::translate(pos.x, pos.y));
            match item {
                FrameItem::Group(group) => {
                    self.flush();
                    self.walk(&group.frame, ts.pre_concat(group.transform));
                    self.flush();
                }
                FrameItem::Text(text) => {
                    if !mark(items, i, text) {
                        self.piece(text, ts);
                    }
                }
                FrameItem::Tag(tag) => {
                    self.flush();
                    match tag {
                        Tag::Start(elem, _) => self.start(elem),
                        Tag::End(loc, ..) => self.end(loc),
                    }
                }
                FrameItem::Shape(..) | FrameItem::Image(..) | FrameItem::Link(..) => {}
            }
        }
    }

    fn piece(&mut self, text: &TextItem, ts: Transform) {
        let origin = Point::zero().transform(ts);
        let piece = Piece {
            text: text.text.to_string(),
            x: origin.x.to_pt(),
            y: origin.y.to_pt(),
            size: text.size.to_pt(),
            width: text.width().to_pt(),
            // Only rotated, skewed or scaled text needs the linear part.
            matrix: (!ts.is_only_translate())
                .then(|| [ts.sx.get(), ts.ky.get(), ts.kx.get(), ts.sy.get()]),
            lang: Locale::new(text.lang, text.region).rfc_3066().to_string(),
            dir: run_dir(text),
        };
        if let Some(last) = self.pieces.last() {
            let dir = self.pieces.iter().find_map(|p| p.dir);
            let touches = last.matrix.is_none()
                && piece.matrix.is_none()
                && last.size == piece.size
                && last.lang == piece.lang
                && (last.y - piece.y).abs() < 0.01
                && (last.x + last.width - piece.x).abs() < 0.01
                && (dir.is_none() || piece.dir.is_none() || dir == piece.dir);
            if !touches {
                self.flush();
            }
        }
        self.pieces.push(piece);
    }

    /// Pushes the pieces gathered so far as one run. Spaces are pieces too:
    /// Arabic text takes them from another font (the first in the list that
    /// has them), and they join the words around them.
    fn flush(&mut self) {
        // Shaping can produce runs of only spaces or default ignorables.
        if self.pieces.iter().all(|p| p.text.trim().is_empty()) {
            self.pieces.clear();
            return;
        }
        let first = &self.pieces[0];
        let last = self.pieces.last().unwrap();
        let dir = self.pieces.iter().find_map(|p| p.dir);
        let text: String = if dir == Some(Dir::RTL) {
            self.pieces.iter().rev().map(|p| p.text.as_str()).collect()
        } else {
            self.pieces.iter().map(|p| p.text.as_str()).collect()
        };
        let run = js_sys::Object::new();
        set(&run, "text", text);
        set(&run, "x", round(first.x));
        set(&run, "y", round(first.y));
        set(&run, "size", round(first.size));
        set(&run, "width", round(last.x + last.width - first.x));
        if let Some(matrix) = first.matrix {
            let matrix: js_sys::Array = matrix
                .into_iter()
                .map(|v| JsValue::from_f64(ratio(v)))
                .collect();
            set(&run, "matrix", matrix);
        }
        if first.lang != self.lang {
            set(&run, "lang", first.lang.as_str());
        }
        if let Some(dir) = dir.filter(|&d| d != self.dir) {
            set(&run, "dir", if dir == Dir::RTL { "rtl" } else { "ltr" });
        }
        self.runs.push(&run);
        self.count += 1;
        self.pieces.clear();
    }
}

/// Whether the `i`th item, `text`, is a mark's: it repeats the text of the base it sits on (see above).
pub(crate) fn mark(items: &[(Point, FrameItem)], i: usize, text: &TextItem) -> bool {
    let neighbor = |j: Option<usize>| match j.and_then(|j| items.get(j)) {
        Some((_, FrameItem::Text(other))) => other.text.contains(text.text.as_str()),
        _ => false,
    };
    text.width() == Abs::zero() && (neighbor(i.checked_sub(1)) || neighbor(Some(i + 1)))
}

/// The direction a piece was shaped in. Typst shapes each run at one bidi
/// level and lays its glyphs out left to right, so an RTL run's clusters go
/// backwards through its text. A piece of one cluster says nothing that way:
/// then its first strong character decides, and without one it has none.
pub fn run_dir(text: &TextItem) -> Option<Dir> {
    if let (Some(first), Some(last)) = (text.glyphs.first(), text.glyphs.last()) {
        if first.range.start > last.range.start {
            return Some(Dir::RTL);
        }
        if first.range.start < last.range.start {
            return Some(Dir::LTR);
        }
    }
    text.text.chars().find_map(|c| match bidi_class(c) {
        BidiClass::L => Some(Dir::LTR),
        BidiClass::R | BidiClass::AL => Some(Dir::RTL),
        _ => None,
    })
}
