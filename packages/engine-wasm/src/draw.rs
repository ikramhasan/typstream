//! A page as drawing operations for a canvas (#14): what the paged renderer
//! paints instead of putting typst-svg's SVG in the DOM.
//!
//! An SVG page draws each glyph as a `<use>` (~1,700 on a dense A4 page), and
//! the browser styles and lays out every one of them: 12–31 ms per streamed
//! update in the three browsers, where painting the same operations on a
//! canvas with cached glyph `Path2D`s takes 1–2 ms (Firefox: 10–15 ms; see
//! the #14 comment). This walks the page frame as typst-svg's `render_frame`
//! does and writes what it draws as numbers, with the strings they name in a
//! table:
//!
//! - glyph outlines in font units, keyed by font and glyph, so the renderer
//!   builds one `Path2D` per glyph for every page and update;
//! - each item with its absolute transform, so the painter needs `save` and
//!   `restore` only around clips;
//! - links as rectangles in page coordinates.
//!
//! What typst-svg draws that this doesn't (gradients, tilings, colour glyphs)
//! makes the page come as SVG instead: `page_drawing` returns `None`.
//!
//! The format, read by `@typstream/dom` (`src/paged/paint.ts`): `ops` is a
//! flat list of little-endian `f32`s. Transforms are `a b c d e f` of a
//! canvas `setTransform` in points; strings are indices into `strings`,
//! `-1` for none.
//!
//! ```text
//! CLIP   1  transform path            save, then clip (nonzero)
//! POP    2                            restore
//! TEXT   3  transform fill stroke n (glyph x y)×n
//!           the transform maps font units; glyph indexes `glyphs`
//! SHAPE  4  transform path fill rule stroke     rule: 0 nonzero, 1 evenodd
//! IMAGE  5  transform url width height scaling  scaling: 0 auto, 1 smooth, 2 pixelated
//!
//! stroke: -1, or colour width cap join miter-limit n dash×n phase
//!         cap: 0 butt, 1 round, 2 square; join: 0 miter, 1 round, 2 bevel
//! ```

use std::collections::HashMap;
use std::fmt::Write;

use typst::foundations::Smart;
use typst::layout::{Abs, Frame, FrameItem, GroupItem, Point, Size, Transform};
use typst::model::Destination;
use typst::text::color::should_outline;
use typst::text::{FontInstance, TextItem};
use typst::visualize::{
    Curve, CurveItem, FillRule, FixedStroke, Geometry, Image, ImageScaling, LineCap, LineJoin,
    Paint,
};
use typst_layout::Page;
use wasm_bindgen::prelude::*;

use crate::js::set;

const CLIP: f32 = 1.0;
const POP: f32 = 2.0;
const TEXT: f32 = 3.0;
const SHAPE: f32 = 4.0;
const IMAGE: f32 = 5.0;

/// A page's drawing as it is being written.
struct Drawing {
    ops: Vec<f32>,
    strings: Vec<String>,
    string_ids: HashMap<String, u32>,
    /// `[key, path]` pairs.
    glyphs: js_sys::Array,
    glyph_ids: HashMap<(FontInstance, u16), Option<u32>>,
    fonts: HashMap<FontInstance, String>,
    links: js_sys::Array,
}

/// The drawing of `page` (`PageDrawing` in `TS_TYPES`), or `None` when the
/// page has something it can't express, so it must come as SVG.
pub fn page_drawing(page: &Page) -> Option<JsValue> {
    let mut d = Drawing {
        ops: Vec::new(),
        strings: Vec::new(),
        string_ids: HashMap::new(),
        glyphs: js_sys::Array::new(),
        glyph_ids: HashMap::new(),
        fonts: HashMap::new(),
        links: js_sys::Array::new(),
    };
    // typst-svg's `render_page`: the page's fill first, white by default.
    if let Some(fill) = page.fill_or_white() {
        let shape = Geometry::Rect(page.frame.size()).filled(fill);
        d.shape(
            Transform::identity(),
            &shape.geometry,
            shape.fill.as_ref(),
            shape.fill_rule,
            None,
        )?;
    }
    d.frame(Transform::identity(), &page.frame)?;

    let obj = js_sys::Object::new();
    // Copied out of wasm memory into a fresh buffer: byte offset 0, so the
    // renderer can read it as a Float32Array without copying again.
    let ops = js_sys::Float32Array::from(&d.ops[..]);
    set(&obj, "ops", js_sys::Uint8Array::new(&ops.buffer()));
    let strings = js_sys::Array::new();
    for s in &d.strings {
        strings.push(&JsValue::from_str(s));
    }
    set(&obj, "strings", strings);
    set(&obj, "glyphs", d.glyphs);
    set(&obj, "links", d.links);
    Some(obj.into())
}

impl Drawing {
    fn string(&mut self, s: &str) -> f32 {
        if let Some(&id) = self.string_ids.get(s) {
            return id as f32;
        }
        let id = self.strings.len() as u32;
        self.strings.push(s.to_string());
        self.string_ids.insert(s.to_string(), id);
        id as f32
    }

    fn transform(&mut self, ts: Transform) {
        self.ops.extend([
            ts.sx.get() as f32,
            ts.ky.get() as f32,
            ts.kx.get() as f32,
            ts.sy.get() as f32,
            ts.tx.to_pt() as f32,
            ts.ty.to_pt() as f32,
        ]);
    }

    /// A solid paint's colour, or `None` for gradients and tilings.
    fn paint(&mut self, paint: &Paint) -> Option<f32> {
        match paint {
            Paint::Solid(color) => Some(self.string(&color.to_hex())),
            Paint::Gradient(_) | Paint::Tiling(_) => None,
        }
    }

    /// A stroke, its lengths divided by `scale` (text strokes are drawn in font units).
    fn stroke(&mut self, stroke: Option<&FixedStroke>, scale: f64) -> Option<()> {
        let Some(stroke) = stroke else {
            self.ops.push(-1.0);
            return Some(());
        };
        let color = self.paint(&stroke.paint)?;
        self.ops.extend([
            color,
            (stroke.thickness.to_pt() / scale) as f32,
            match stroke.cap {
                LineCap::Butt => 0.0,
                LineCap::Round => 1.0,
                LineCap::Square => 2.0,
            },
            match stroke.join {
                LineJoin::Miter => 0.0,
                LineJoin::Round => 1.0,
                LineJoin::Bevel => 2.0,
            },
            stroke.miter_limit.get() as f32,
        ]);
        match &stroke.dash {
            Some(dash) => {
                self.ops.push(dash.array.len() as f32);
                self.ops
                    .extend(dash.array.iter().map(|l| (l.to_pt() / scale) as f32));
                self.ops.push((dash.phase.to_pt() / scale) as f32);
            }
            None => self.ops.extend([0.0, 0.0]),
        }
        Some(())
    }

    /// typst-svg's `render_frame`.
    fn frame(&mut self, ts: Transform, frame: &Frame) -> Option<()> {
        for (pos, item) in frame.items() {
            let ts = ts.pre_concat(Transform::translate(pos.x, pos.y));
            match item {
                FrameItem::Group(group) => self.group(ts, group)?,
                FrameItem::Text(text) => self.text(ts, text)?,
                FrameItem::Shape(shape, _) => self.shape(
                    ts,
                    &shape.geometry,
                    shape.fill.as_ref(),
                    shape.fill_rule,
                    shape.stroke.as_ref(),
                )?,
                FrameItem::Image(image, size, _) => self.image(ts, image, *size),
                FrameItem::Link(dest, size) => self.link(ts, dest, *size),
                FrameItem::Tag(_) => {}
            }
        }
        Some(())
    }

    /// typst-svg's `render_group`: soft and hard frames draw alike here, since
    /// transforms are absolute.
    fn group(&mut self, ts: Transform, group: &GroupItem) -> Option<()> {
        let ts = ts.pre_concat(group.transform);
        let Some(clip) = &group.clip else {
            return self.frame(ts, &group.frame);
        };
        self.ops.push(CLIP);
        self.transform(ts);
        let path = curve_path(clip);
        let path = self.string(&path);
        self.ops.push(path);
        let drawn = self.frame(ts, &group.frame);
        self.ops.push(POP);
        drawn
    }

    /// typst-svg's `render_text`: outline glyphs only.
    fn text(&mut self, ts: Transform, text: &TextItem) -> Option<()> {
        let font = &text.font;
        let scale = text.size.to_pt() / font.units_per_em();
        self.ops.push(TEXT);
        // Fonts are Y-up; the glyphs' offsets are in font units from here on.
        self.transform(ts.pre_concat(Transform::scale(
            typst::layout::Ratio::new(scale),
            typst::layout::Ratio::new(-scale),
        )));
        let fill = self.paint(&text.fill)?;
        self.ops.push(fill);
        self.stroke(text.stroke.as_ref(), scale)?;
        let count = self.ops.len();
        self.ops.push(0.0);
        let mut n = 0;
        let mut x = Abs::zero();
        let mut y = Abs::zero();
        for glyph in &text.glyphs {
            let id = self.glyph(font, glyph.id)?;
            if let Some(id) = id {
                let gx = x + glyph.x_offset.at(text.size);
                let gy = y + glyph.y_offset.at(text.size);
                self.ops.extend([
                    id as f32,
                    (gx.to_pt() / scale) as f32,
                    (gy.to_pt() / scale) as f32,
                ]);
                n += 1;
            }
            x += glyph.x_advance.at(text.size);
            y += glyph.y_advance.at(text.size);
        }
        self.ops[count] = n as f32;
        Some(())
    }

    /// The index of a glyph's outline, `Some(None)` for a glyph with nothing
    /// to draw (a space), or `None` for a colour or bitmap glyph.
    fn glyph(&mut self, font: &FontInstance, id: u16) -> Option<Option<u32>> {
        if let Some(&known) = self.glyph_ids.get(&(font.clone(), id)) {
            return Some(known);
        }
        let glyph = ttf_parser::GlyphId(id);
        if !should_outline(font, glyph) {
            return None;
        }
        let mut path = PathBuilder::default();
        let index = font.ttf().outline_glyph(glyph, &mut path).map(|_| {
            let font_key = self
                .fonts
                .entry(font.clone())
                .or_insert_with(|| format!("{:x}", typst::utils::hash128(font)))
                .clone();
            let pair = js_sys::Array::of2(
                &JsValue::from_str(&format!("{font_key}/{id}")),
                &JsValue::from_str(&path.0),
            );
            self.glyphs.push(&pair) - 1
        });
        self.glyph_ids.insert((font.clone(), id), index);
        Some(index)
    }

    /// typst-svg's `render_shape`.
    fn shape(
        &mut self,
        ts: Transform,
        geometry: &Geometry,
        fill: Option<&Paint>,
        rule: FillRule,
        stroke: Option<&FixedStroke>,
    ) -> Option<()> {
        self.ops.push(SHAPE);
        self.transform(ts);
        let path = match geometry {
            Geometry::Line(to) => format!("M0 0L{} {}", num(to.x.to_pt()), num(to.y.to_pt())),
            Geometry::Rect(size) => {
                let (w, h) = (num(size.x.to_pt()), num(size.y.to_pt()));
                format!("M0 0H{w}V{h}H0Z")
            }
            Geometry::Curve(curve) => curve_path(curve),
        };
        let path = self.string(&path);
        self.ops.push(path);
        let fill = match fill {
            Some(paint) => self.paint(paint)?,
            None => -1.0,
        };
        self.ops.push(fill);
        self.ops
            .push(if rule == FillRule::EvenOdd { 1.0 } else { 0.0 });
        self.stroke(stroke, 1.0)
    }

    /// typst-svg's `render_image`: the same `data:` URL it writes.
    fn image(&mut self, ts: Transform, image: &Image, size: Size) {
        self.ops.push(IMAGE);
        self.transform(ts);
        let url = typst_svg::WebImage::new(image).to_base64_url();
        let url = self.string(&url);
        self.ops.extend([
            url,
            size.x.to_pt() as f32,
            size.y.to_pt() as f32,
            match image.scaling() {
                Smart::Auto => 0.0,
                Smart::Custom(ImageScaling::Smooth) => 1.0,
                Smart::Custom(ImageScaling::Pixelated) => 2.0,
            },
        ]);
    }

    /// A link to a URL, as the box around its area on the page. Links within
    /// the document stay inert, as in typst-svg's standalone pages.
    fn link(&mut self, ts: Transform, dest: &Destination, size: Size) {
        let Destination::Url(url) = dest else { return };
        let corners = [
            Point::zero(),
            Point::with_x(size.x),
            Point::with_y(size.y),
            size.to_point(),
        ]
        .map(|p| p.transform(ts));
        let min = |f: fn(&Point) -> Abs| corners.iter().map(f).fold(Abs::inf(), Abs::min).to_pt();
        let max = |f: fn(&Point) -> Abs| corners.iter().map(f).fold(-Abs::inf(), Abs::max).to_pt();
        let (x, y) = (min(|p| p.x), min(|p| p.y));
        let link = js_sys::Object::new();
        set(&link, "url", url.as_str());
        set(&link, "x", round(x));
        set(&link, "y", round(y));
        set(&link, "width", round(max(|p| p.x) - x));
        set(&link, "height", round(max(|p| p.y) - y));
        self.links.push(&link);
    }
}

fn round(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

/// A number for path data: 1/1000 pt is far below a device pixel at any zoom.
fn num(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

/// SVG path data for a curve, in absolute coordinates.
fn curve_path(curve: &Curve) -> String {
    let mut path = String::new();
    let p = |p: Point| (num(p.x.to_pt()), num(p.y.to_pt()));
    for item in curve.0.iter() {
        let _ = match *item {
            CurveItem::Move(a) => {
                let (x, y) = p(a);
                write!(path, "M{x} {y}")
            }
            CurveItem::Line(a) => {
                let (x, y) = p(a);
                write!(path, "L{x} {y}")
            }
            CurveItem::Cubic(a, b, c) => {
                let ((ax, ay), (bx, by), (cx, cy)) = (p(a), p(b), p(c));
                write!(path, "C{ax} {ay} {bx} {by} {cx} {cy}")
            }
            CurveItem::Close => write!(path, "Z"),
        };
    }
    path
}

/// A glyph outline as SVG path data, in font units (Y-up).
#[derive(Default)]
struct PathBuilder(String);

impl ttf_parser::OutlineBuilder for PathBuilder {
    fn move_to(&mut self, x: f32, y: f32) {
        let _ = write!(self.0, "M{x} {y}");
    }
    fn line_to(&mut self, x: f32, y: f32) {
        let _ = write!(self.0, "L{x} {y}");
    }
    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        let _ = write!(self.0, "Q{x1} {y1} {x} {y}");
    }
    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        let _ = write!(self.0, "C{x1} {y1} {x2} {y2} {x} {y}");
    }
    fn close(&mut self) {
        self.0.push('Z');
    }
}
