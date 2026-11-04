//! Pictures of what a DOCX can't express (#133): CeTZ canvases, mind maps, edu's drawings, images, rounded boxes.
//! The frame items that draw it go on a frame of their own, which typst-svg writes as SVG and the raster renderer
//! (raster/, typst-render's) as a PNG, so the picture is drawn with the same vectors as the PDF and the canvas.
//!
//! A frame doesn't clip what it draws, and strokes are centred on their paths: a picture's bounds are its items' ink,
//! which may reach past the room Typst gave it (half a box's stroke, a canvas's label). Its `x` and `y` say where.

use typst::foundations::{Content, Smart};
use typst::layout::{Abs, Frame, FrameItem, Point, Sides, Size, Transform};
use typst::syntax::Span;
use typst::visualize::{CurveItem, Geometry, Paint, Shape};
use typst_layout::Page;

/// Pixels per point of the PNG: 300 dots per inch.
const PIXEL_PER_PT: f64 = 300.0 / 72.0;
/// The most pixels a PNG has: a picture bigger than this at 300 DPI (a page-sized canvas at 250 DPI and more) is
/// rendered at a lower resolution.
const MAX_PIXELS: f64 = 24e6;

/// A stroke outside a picture's view box, which no one draws (see `render`).
const OUTSIDE: &str =
    r##"<path fill="none" stroke="#000000" stroke-width="0.01" d="M -1 -1 h 0.01"/>"##;

/// A picture: where its top left is on its page and its size, in points, and the two renderings.
pub struct Picture {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub svg: String,
    pub png: Vec<u8>,
}

/// A picture of `items` (frame items at their positions on a page) covering `room` (`x, y, w, h`), and with `ink`
/// whatever they draw outside it.
pub fn render(
    items: &[(Point, FrameItem)],
    room: (f64, f64, f64, f64),
    ink: bool,
) -> Option<Picture> {
    if items.is_empty() || room.2 <= 0.0 || room.3 <= 0.0 {
        return None;
    }
    let (mut x0, mut y0) = (room.0, room.1);
    let (mut x1, mut y1) = (room.0 + room.2, room.1 + room.3);
    for (at, item) in items.iter().filter(|_| ink) {
        if let Some((a, b, c, d)) = bounds(item, Transform::translate(at.x, at.y)) {
            (x0, y0, x1, y1) = (x0.min(a), y0.min(b), x1.max(c), y1.max(d));
        }
    }
    // Whole hundredths of a point, as the model rounds.
    let (x0, y0) = ((x0 * 100.0).floor() / 100.0, (y0 * 100.0).floor() / 100.0);
    let (x1, y1) = ((x1 * 100.0).ceil() / 100.0, (y1 * 100.0).ceil() / 100.0);
    let size = Size::new(Abs::pt(x1 - x0), Abs::pt(y1 - y0));
    let mut frame = Frame::hard(size);
    for (at, item) in items {
        frame.push(
            Point::new(at.x - Abs::pt(x0), at.y - Abs::pt(y0)),
            item.clone(),
        );
    }
    let page = Page {
        frame,
        bleed: Sides::default(),
        // Transparent: what is under it on the page shows through, as in Typst's.
        fill: Smart::Custom(None),
        numbering: None,
        supplement: Content::empty(),
        number: 1,
    };
    let svg = inline_svg_images(flat_gradients(typst_svg::svg(
        &page,
        &typst_svg::SvgOptions::default(),
    )));
    // LibreOffice draws an SVG whose content stays inside its view box a pixel at 96 DPI smaller than its frame (0.75 pt
    // narrower and shorter, 0.31 pt in from the top left, whatever its size); content reaching outside the view box,
    // which nothing draws, makes it draw the SVG exactly.
    let svg = match svg.find('>') {
        Some(end) => format!("{}{OUTSIDE}{}", &svg[..=end], &svg[end + 1..]),
        None => svg,
    };
    let pixels = (x1 - x0) * (y1 - y0) * PIXEL_PER_PT * PIXEL_PER_PT;
    let scale = if pixels > MAX_PIXELS {
        PIXEL_PER_PT * (MAX_PIXELS / pixels).sqrt()
    } else {
        PIXEL_PER_PT
    };
    let options = crate::raster::RenderOptions {
        pixel_per_pt: scale.into(),
        render_bleed: false,
    };
    let png = crate::raster::render(&page, &options)
        .encode_png()
        .unwrap_or_default();
    Some(Picture {
        x: x0,
        y: y0,
        width: x1 - x0,
        height: y1 - y0,
        svg,
        png,
    })
}

/// typst-svg's SVG images inlined: an `<image>` whose data is SVG (`data:image/svg+xml;base64,…`, a Mermaid diagram's
/// shapes) becomes a nested `<svg>` of the image's box with the image's content. LibreOffice 26.2 draws an SVG image
/// inside an SVG with some strokes a fraction of a point off (round-capped lines and dashes, against the PDF), while it
/// draws the same vectors inline as Typst's PDF has them; and an image in an image is the part of SVG readers support
/// least. The image's ids get a prefix of their own, since typst-svg's (`f1`, `r1`) and the image's may be the same.
/// An image that can't be read as SVG, or has a doctype (entities), stays as it is.
fn inline_svg_images(svg: String) -> String {
    const DATA: &str = "data:image/svg+xml;base64,";
    let mut out = String::with_capacity(svg.len());
    let mut rest = svg.as_str();
    let mut n = 0;
    while let Some(at) = rest.find("<image ") {
        out.push_str(&rest[..at]);
        let Some(end) = tag_end(&rest[at..]).map(|e| at + e) else {
            break;
        };
        let tag = &rest[at..=end];
        let attrs = attributes(tag);
        let get = |name: &str| {
            attrs
                .iter()
                .find(|(k, _)| k == name)
                .map(|(_, v)| v.as_str())
        };
        let inlined = get("xlink:href")
            .or_else(|| get("href"))
            .and_then(|href| href.strip_prefix(DATA))
            .and_then(base64_decode)
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .and_then(|image| {
                n += 1;
                nested(&image, &format!("i{n}-"), &attrs)
            });
        out.push_str(inlined.as_deref().unwrap_or(tag));
        rest = &rest[end + 1..];
    }
    out.push_str(rest);
    out
}

/// The SVG document `image` as a nested `<svg>` in the box of the `<image>` whose attributes are `image_attrs`, its ids
/// prefixed with `prefix`.
fn nested(image: &str, prefix: &str, image_attrs: &[(String, String)]) -> Option<String> {
    let start = image.find("<svg")?;
    if image[..start].contains("<!DOCTYPE") {
        return None;
    }
    let root_end = start + tag_end(&image[start..])?;
    let root = &image[start..=root_end];
    if root.ends_with("/>") {
        return None;
    }
    let attrs = attributes(root);
    let get = |list: &[(String, String)], name: &str| {
        list.iter().find(|(k, _)| k == name).map(|(_, v)| v.clone())
    };
    let number =
        |v: Option<String>| v.and_then(|v| v.trim_end_matches("px").trim().parse::<f64>().ok());
    let view_box = match get(&attrs, "viewBox") {
        Some(v) => v,
        None => format!(
            "0 0 {} {}",
            number(get(&attrs, "width"))?,
            number(get(&attrs, "height"))?
        ),
    };
    let mut tag = String::from("<svg");
    for (k, v) in &attrs {
        if !matches!(
            k.as_str(),
            "width" | "height" | "x" | "y" | "viewBox" | "preserveAspectRatio"
        ) {
            tag.push_str(&format!(" {k}=\"{v}\""));
        }
    }
    for k in ["x", "y", "width", "height"] {
        if let Some(v) = get(image_attrs, k) {
            tag.push_str(&format!(" {k}=\"{v}\""));
        }
    }
    let aspect = get(image_attrs, "preserveAspectRatio").unwrap_or_else(|| "xMidYMid meet".into());
    tag.push_str(&format!(
        " viewBox=\"{view_box}\" preserveAspectRatio=\"{aspect}\">"
    ));
    let mut body = format!("{tag}{}", &image[root_end + 1..]);
    // Its ids, and what refers to them, with the prefix.
    let ids: Vec<String> = body
        .match_indices(" id=\"")
        .filter_map(|(i, m)| body[i + m.len()..].split('"').next().map(String::from))
        .collect();
    for id in ids {
        for (from, to) in [
            ("id=\"", "id=\""),
            ("url(#", "url(#"),
            ("href=\"#", "href=\"#"),
        ] {
            let close = if from == "url(#" { ")" } else { "\"" };
            body = body.replace(
                &format!("{from}{id}{close}"),
                &format!("{to}{prefix}{id}{close}"),
            );
        }
    }
    Some(match get(image_attrs, "transform") {
        Some(t) => format!("<g transform=\"{t}\">{body}</g>"),
        None => body,
    })
}

/// Where a start tag ends (its `>`), quotes respected.
fn tag_end(s: &str) -> Option<usize> {
    let mut quote = None;
    for (i, c) in s.char_indices() {
        match (quote, c) {
            (None, '"' | '\'') => quote = Some(c),
            (Some(q), _) if c == q => quote = None,
            (None, '>') => return Some(i),
            _ => {}
        }
    }
    None
}

/// A start tag's attributes, in order.
fn attributes(tag: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut rest = tag.trim_start_matches('<');
    rest = rest.trim_start_matches(|c: char| !c.is_whitespace());
    while let Some(eq) = rest.find('=') {
        let name = rest[..eq].trim().to_string();
        let after = rest[eq + 1..].trim_start();
        let Some(q) = after.chars().next().filter(|c| *c == '"' || *c == '\'') else {
            break;
        };
        let Some(close) = after[1..].find(q) else {
            break;
        };
        out.push((name, after[1..=close].to_string()));
        rest = &after[close + 2..];
    }
    out
}

/// Standard base64, padding optional; `None` on anything else.
fn base64_decode(s: &str) -> Option<Vec<u8>> {
    let value = |c: u8| match c {
        b'A'..=b'Z' => Some(c - b'A'),
        b'a'..=b'z' => Some(c - b'a' + 26),
        b'0'..=b'9' => Some(c - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    };
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let (mut acc, mut bits) = (0u32, 0);
    for c in s.trim_end_matches('=').bytes() {
        acc = (acc << 6) | u32::from(value(c)?);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Some(out)
}

/// typst-svg's gradients with their stops copied in. It fills a shape with a gradient that takes its stops from another
/// one (`href`) and scales it to the shape (`gradientTransform`), and LibreOffice doesn't follow the reference: it
/// draws the first stop's colour.
fn flat_gradients(svg: String) -> String {
    let mut out = String::with_capacity(svg.len());
    let mut rest = svg.as_str();
    // The next gradient of either kind: linear and radial ones can come in any order.
    let next = |s: &str| {
        let (l, r) = (s.find("<linearGradient "), s.find("<radialGradient "));
        l.into_iter().chain(r).min()
    };
    while let Some(at) = next(rest) {
        out.push_str(&rest[..at]);
        let tag_end = match rest[at..].find('>') {
            Some(e) => at + e,
            None => break,
        };
        let tag = &rest[at..=tag_end];
        // A reference: an empty element with an `href` to the gradient whose stops it takes.
        let target = tag
            .strip_suffix("/>")
            .and_then(|t| t.split(" href=\"#").nth(1))
            .and_then(|t| t.split('"').next());
        let base = target.and_then(|id| {
            let kind = &tag[1..tag.find(' ').unwrap_or(1)];
            let open = svg.find(&format!(" id=\"{id}\""))?;
            let start = svg[..=open].rfind(&format!("<{kind} "))?;
            let end = svg[start..].find(&format!("</{kind}>"))? + start;
            let inner_start = svg[start..end].find('>')? + start + 1;
            let attrs = &svg[start + kind.len() + 2..inner_start - 1];
            Some((kind, attrs, &svg[inner_start..end]))
        });
        match base {
            Some((kind, attrs, stops)) => {
                // Its own attributes (id, transform) and the base's others.
                let own = tag[kind.len() + 2..tag.len() - 2]
                    .split(" href=")
                    .next()
                    .unwrap_or("")
                    .trim_end();
                let inherited: Vec<&str> = attrs
                    .split("\" ")
                    .map(|a| a.trim().trim_end_matches('"'))
                    .filter(|a| {
                        let name = a.split('=').next().unwrap_or("");
                        !a.is_empty() && !own.contains(&format!("{name}=")) && name != "id"
                    })
                    .collect();
                let inherited: String = inherited.iter().map(|a| format!(" {a}\"")).collect();
                out.push_str(&format!("<{kind} {own}{inherited}>{stops}</{kind}>"));
            }
            None => out.push_str(tag),
        }
        rest = &rest[tag_end + 1..];
    }
    out.push_str(rest);
    out
}

/// The bounding box of what an item draws, `(x0, y0, x1, y1)` through `ts`.
fn bounds(item: &FrameItem, ts: Transform) -> Option<(f64, f64, f64, f64)> {
    let (x0, y0, x1, y1) = match item {
        FrameItem::Group(group) => {
            let ts = ts.pre_concat(group.transform);
            let mut b: Option<(f64, f64, f64, f64)> = None;
            for (pos, item) in group.frame.items() {
                if let Some((a, c, d, e)) =
                    bounds(item, ts.pre_concat(Transform::translate(pos.x, pos.y)))
                {
                    b = Some(match b {
                        None => (a, c, d, e),
                        Some((p, q, r, s)) => (p.min(a), q.min(c), r.max(d), s.max(e)),
                    });
                }
            }
            // A clipped group draws inside its frame at most.
            if group.clip.is_some() {
                let size = group.frame.size();
                let (p, q, r, s) = corners(ts, 0.0, 0.0, size.x.to_pt(), size.y.to_pt());
                b = b.map(|(a, c, d, e)| (a.max(p), c.max(q), d.min(r), e.min(s)));
            }
            return b.filter(|(a, c, d, e)| a < d && c < e);
        }
        FrameItem::Text(text) => {
            let metrics = text.font.metrics();
            let ascent = metrics.ascender.at(text.size).to_pt();
            let descent = -metrics.descender.at(text.size).to_pt();
            (0.0, -ascent, text.width().to_pt(), descent)
        }
        FrameItem::Shape(shape, _) => {
            let (a, b, c, d) = match &shape.geometry {
                Geometry::Line(to) => {
                    let (x, y) = (to.x.to_pt(), to.y.to_pt());
                    (x.min(0.0), y.min(0.0), x.max(0.0), y.max(0.0))
                }
                Geometry::Rect(size) => (0.0, 0.0, size.x.to_pt(), size.y.to_pt()),
                Geometry::Curve(curve) => {
                    let mut b: Option<(f64, f64, f64, f64)> = None;
                    for item in &curve.0 {
                        let points: &[Point] = match item {
                            CurveItem::Move(p) | CurveItem::Line(p) => std::slice::from_ref(p),
                            CurveItem::Cubic(p, q, r) => &[*p, *q, *r],
                            CurveItem::Close => &[],
                        };
                        for p in points {
                            let (x, y) = (p.x.to_pt(), p.y.to_pt());
                            b = Some(match b {
                                None => (x, y, x, y),
                                Some((a, c, d, e)) => (a.min(x), c.min(y), d.max(x), e.max(y)),
                            });
                        }
                    }
                    b?
                }
            };
            // Strokes are centred on the path; a miter or square cap reaches a little further, which the ceiling
            // of a hundredth of a point doesn't cover, but a pixel at 300 DPI is less.
            let half = shape
                .stroke
                .as_ref()
                .map(|s| s.thickness.to_pt() / 2.0)
                .unwrap_or(0.0);
            (a - half, b - half, c + half, d + half)
        }
        FrameItem::Image(_, size, _) => (0.0, 0.0, size.x.to_pt(), size.y.to_pt()),
        FrameItem::Link(..) | FrameItem::Tag(_) => return None,
    };
    Some(corners(ts, x0, y0, x1, y1))
}

/// The bounding box of a rectangle through `ts`.
fn corners(ts: Transform, x0: f64, y0: f64, x1: f64, y1: f64) -> (f64, f64, f64, f64) {
    let mut b = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for (x, y) in [(x0, y0), (x1, y0), (x0, y1), (x1, y1)] {
        let p = Point::new(Abs::pt(x), Abs::pt(y)).transform(ts);
        let (x, y) = (p.x.to_pt(), p.y.to_pt());
        b = (b.0.min(x), b.1.min(y), b.2.max(x), b.3.max(y));
    }
    b
}

/// What free-form content a picture's first item is, which Word could keep editable if it were drawn otherwise: a
/// box with rounded corners (its first shape, as big as it) or rotated text, with text in it. Where it is written.
pub fn free_form(item: &FrameItem) -> Option<(Span, &'static str)> {
    match item {
        // A gradient or a tiling, which no table cell or shading has.
        FrameItem::Shape(shape, span)
            if shape
                .fill
                .as_ref()
                .is_some_and(|f| !matches!(f, Paint::Solid(_))) =>
        {
            Some((*span, "a box filled with a gradient"))
        }
        FrameItem::Shape(shape, span) => {
            rounded(shape).then_some((*span, "a box with rounded corners"))
        }
        FrameItem::Group(group) => {
            let text = first_text(&group.frame)?;
            if !group.transform.is_only_translate() {
                return Some((text, "rotated text"));
            }
            let size = group.frame.size();
            let (pos, item) = group
                .frame
                .items()
                .find(|(_, i)| !matches!(i, FrameItem::Tag(_)))?;
            match item {
                FrameItem::Shape(shape, span)
                    if pos.x.to_pt().abs() < 1.0
                        && pos.y.to_pt().abs() < 1.0
                        && rounded(shape)
                        && bounds(item, Transform::identity()).is_some_and(|(a, b, c, d)| {
                            // Its bounds have half the stroke on each side.
                            let stroke = shape
                                .stroke
                                .as_ref()
                                .map(|s| s.thickness.to_pt())
                                .unwrap_or(0.0);
                            (c - a - stroke - size.x.to_pt()).abs() < 1.0
                                && (d - b - stroke - size.y.to_pt()).abs() < 1.0
                        }) =>
                {
                    Some((*span, "a box with rounded corners"))
                }
                _ => None,
            }
        }
        _ => None,
    }
}

/// Whether a shape is a rectangle with rounded corners: lines along the axes joined by curves.
fn rounded(shape: &Shape) -> bool {
    let Geometry::Curve(curve) = &shape.geometry else {
        return false;
    };
    let mut at = Point::zero();
    let (mut lines, mut cubics) = (0, 0);
    for item in &curve.0 {
        match item {
            CurveItem::Move(p) => at = *p,
            CurveItem::Line(p) => {
                let (dx, dy) = ((p.x - at.x).to_pt(), (p.y - at.y).to_pt());
                if dx.abs() > 0.01 && dy.abs() > 0.01 {
                    return false;
                }
                lines += 1;
                at = *p;
            }
            CurveItem::Cubic(_, _, p) => {
                cubics += 1;
                at = *p;
            }
            CurveItem::Close => {}
        }
    }
    cubics >= 2 && cubics <= 4 && lines >= 2
}

/// The span of the first glyph a frame draws.
fn first_text(frame: &Frame) -> Option<Span> {
    frame.items().find_map(|(_, item)| match item {
        FrameItem::Text(text) => text.glyphs.first().map(|g| g.span.0),
        FrameItem::Group(group) => first_text(&group.frame),
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use super::{base64_decode, flat_gradients, inline_svg_images};

    /// Standard base64, for the tests' data URLs.
    fn base64(bytes: &[u8]) -> String {
        const ABC: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::new();
        for chunk in bytes.chunks(3) {
            let b = [
                chunk[0],
                *chunk.get(1).unwrap_or(&0),
                *chunk.get(2).unwrap_or(&0),
            ];
            let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
            for i in 0..4 {
                out.push(if i <= chunk.len() {
                    ABC[(n >> (18 - 6 * i) & 63) as usize] as char
                } else {
                    '='
                });
            }
        }
        out
    }

    #[test]
    fn decodes_base64() {
        let text = "<svg>\u{e9}</svg>".as_bytes();
        assert_eq!(base64_decode(&base64(text)).unwrap(), text);
        assert_eq!(base64_decode("YQ==").unwrap(), b"a");
        assert!(base64_decode("a b").is_none());
    }

    #[test]
    fn inlines_an_svg_image_with_its_box_and_its_ids_prefixed() {
        let image = r##"<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20" width="40" height="20" fill="#1f1f1f"><defs><linearGradient id="f1"/></defs><path d="M0,0H4" stroke="url(#f1)" stroke-linecap="round"/></svg>"##;
        let svg = format!(
            r##"<svg><defs><linearGradient id="f1"/></defs><g transform="matrix(1 0 0 1 5 6)"><image xlink:href="data:image/svg+xml;base64,{}" width="80" height="40" preserveAspectRatio="none"/></g></svg>"##,
            base64(image.as_bytes())
        );
        let out = inline_svg_images(svg);
        assert_eq!(
            out,
            r##"<svg><defs><linearGradient id="f1"/></defs><g transform="matrix(1 0 0 1 5 6)"><svg xmlns="http://www.w3.org/2000/svg" fill="#1f1f1f" width="80" height="40" viewBox="0 0 40 20" preserveAspectRatio="none"><defs><linearGradient id="i1-f1"/></defs><path d="M0,0H4" stroke="url(#i1-f1)" stroke-linecap="round"/></svg></g></svg>"##
        );
    }

    #[test]
    fn leaves_raster_images_and_svgs_with_a_doctype() {
        let png = r#"<svg><image xlink:href="data:image/png;base64,iVBORw0KGgo=" width="1" height="1"/></svg>"#;
        assert_eq!(inline_svg_images(png.to_string()), png);
        let doctype = format!(
            r#"<svg><image xlink:href="data:image/svg+xml;base64,{}" width="1" height="1"/></svg>"#,
            base64(br#"<!DOCTYPE svg [<!ENTITY a "x">]><svg viewBox="0 0 1 1">&a;</svg>"#)
        );
        assert_eq!(inline_svg_images(doctype.clone()), doctype);
    }

    #[test]
    fn copies_a_referenced_gradients_stops_in() {
        let svg = r##"<svg><path fill="url(#r1)" d="M 0 0"/><defs><linearGradient id="f1" spreadMethod="pad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#ff4136"/><stop offset="100%" stop-color="#0074d9"/></linearGradient></defs><defs><linearGradient gradientTransform="scale(453 17)" id="r1" href="#f1" xlink:href="#f1"/></defs></svg>"##;
        let flat = flat_gradients(svg.to_string());
        assert!(
            flat.contains(r##"<linearGradient gradientTransform="scale(453 17)" id="r1" spreadMethod="pad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#ff4136"/><stop offset="100%" stop-color="#0074d9"/></linearGradient>"##),
            "{flat}"
        );
    }

    #[test]
    fn flattens_a_radial_reference_before_a_linear_gradient() {
        let svg = r##"<svg><defs><radialGradient id="f2" cx="0.5"><stop offset="0%" stop-color="#ffffff"/></radialGradient></defs><defs><radialGradient gradientTransform="scale(10 10)" id="r2" href="#f2" xlink:href="#f2"/></defs><defs><linearGradient id="f1" x1="0"><stop offset="0%" stop-color="#ff4136"/></linearGradient></defs></svg>"##;
        let flat = flat_gradients(svg.to_string());
        assert!(
            flat.contains(r##"<radialGradient gradientTransform="scale(10 10)" id="r2" cx="0.5"><stop offset="0%" stop-color="#ffffff"/></radialGradient>"##),
            "{flat}"
        );
        assert!(!flat.contains("href"), "{flat}");
    }
}
