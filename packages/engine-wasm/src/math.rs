//! Equations as Word math (#132): a DOCX compile replaces Typst's equation rule with one that shows the equation
//! as before and adds a `metadata` marker after it, holding the equation as a tree shaped after OMML's elements
//! (`@typstream/docx` writes the XML). The tree comes from Typst's own math IR (`resolve_equation`), the step its
//! page layout and its MathML export start from (typst-html's `mathml.rs` is the reference for this mapping): so
//! symbols are already Unicode, styles and show rules already applied, scripts already told from limits. The marker
//! travels in the laid-out pages, where docx.rs finds it between the equation's tags.
//!
//! The tree's nodes (`t`): `r` a run of text (`sty`: p, b, i, bi; `scr`: Word's math alphabets; `nor`: text in
//! math), `f` a fraction (`type`: noBar, skw), `s` scripts (`sub`, `sup`, `pre` for prescripts), `nary` a big operator
//! with its operand (`chr`, `limits`: under and over rather than beside), `func` an operator's name and its operand,
//! `lim` limits under and over a base, `rad`
//! a root (`deg`), `d` delimiters (`open`, `close`), `m` a matrix (`rows` of cells, `align` per column, `gap` between
//! columns in points when not Word's), `acc` an accent, `bar` a line over or under (`top`), `groupChr` a
//! stretched brace or bracket (`chr`, `top`), `box` a cancelled base (`strike`).

use std::collections::HashMap;
use std::sync::{LazyLock, OnceLock};

use codex::styling::{to_style, MathStyle};
use serde_json::{json, Map, Value as Json};
use typst::foundations::{Content, NativeElement, NativeShowRule, ShowFn, Target, Value};
use typst::introspection::{Locator, MetadataElem};
use typst::layout::{Abs, FixedAlignment};
use typst::math::ir::{resolve_equation, MathItem, MathKind, Position};
use typst::math::{EquationElem, LeftRightAlternator};
use typst::routines::Arenas;
use typst::text::TextElem;
use typst::Library;
use unicode_math_class::MathClass;

/// What a marker's string starts with.
pub const MARKER: &str = "typstream-omml:";

/// Typst's own rule, which the DOCX rule calls first.
static ORIGINAL: OnceLock<NativeShowRule> = OnceLock::new();

/// Makes a library's equations carry their Word math (for the DOCX compile only).
pub fn mark_equations(library: &mut Library) {
    let probe = EquationElem::new(Content::empty()).pack();
    if let Some(rule) = library.rules.get(Target::Paged, &probe) {
        ORIGINAL.get_or_init(|| rule);
        library
            .rules
            .replace::<EquationElem>(Target::Paged, EQUATION_RULE);
    }
}

const EQUATION_RULE: ShowFn<EquationElem> = |elem, engine, styles| {
    let shown = ORIGINAL
        .get()
        .unwrap()
        .apply(&elem.clone().pack(), engine, styles)?;
    let arenas = Arenas::default();
    // Resolved again here (layout resolves its own): the IR borrows the arenas, so it can't outlive this rule.
    let Ok(item) = resolve_equation(elem, engine, Locator::root(), &arenas, styles) else {
        return Ok(shown);
    };
    let mut nodes = Vec::new();
    Converter.item(&item, &mut nodes);
    let tree = json!({
        "block": elem.block.get(styles),
        // A display equation's number is laid out beside it, in its frame (docx.rs tells it apart).
        "numbered": elem.numbering.get_ref(styles).is_some(),
        "size": styles.resolve(TextElem::size).to_pt(),
        "math": nodes,
    });
    let marker = MetadataElem::new(Value::Str(format!("{MARKER}{tree}").into())).pack();
    Ok(shown + marker.spanned(elem.span()))
};

/// The equation behind a marker's metadata, if it is one.
pub fn marked(elem: &Content) -> Option<Json> {
    let meta = elem.to_packed::<MetadataElem>()?;
    let Value::Str(s) = &meta.value else {
        return None;
    };
    serde_json::from_str(s.strip_prefix(MARKER)?).ok()
}

struct Converter;

impl Converter {
    /// An item's nodes, appended to `out`.
    fn item(&self, item: &MathItem, out: &mut Vec<Json>) {
        let comp = match item {
            MathItem::Component(comp) => comp,
            MathItem::Spacing(amount, font_size, _) => {
                let em = amount.em.get() + ratio(amount.abs, *font_size);
                push_text(out, &spaces(em), Style::default());
                return;
            }
            // Typst sets a source space between items as a medium math space (mathml.rs: 4/18 em).
            MathItem::Space => {
                push_text(out, "\u{205F}", Style::default());
                return;
            }
            MathItem::Tag(_) => return,
        };
        // An operator starting a column after an alignment point is still infix: Word-like engines set one at a
        // cell's start without the space before it (Typst's `align_form_infix`).
        if comp.props.align_form_infix {
            let space = match comp.props.class() {
                MathClass::Relation => "\u{2005}",
                _ => "\u{205F}",
            };
            push_text(
                out,
                space,
                Style {
                    sty: Some("p"),
                    ..Style::default()
                },
            );
        }
        match &comp.kind {
            MathKind::Group(group) => self.seq(&group.items, out),
            MathKind::Multiline(m) => {
                // Lines with alignment points: a matrix whose columns alternate right and left with no gap between
                // them, as Typst sets them. (Word's equation array marks alignment points with `&` in the text,
                // which LibreOffice prints.)
                if m.rows.len() == 1 {
                    for col in m.rows[0].iter() {
                        self.item(col, out);
                    }
                } else {
                    let rows: Vec<Vec<Json>> = m
                        .rows
                        .iter()
                        .map(|row| row.iter().map(|col| Json::Array(self.nodes(col))).collect())
                        .collect();
                    let n = m.rows.first().map_or(0, |row| row.len());
                    let align: Vec<&str> = (0..n)
                        .map(|i| match (n, i % 2) {
                            (1, _) => "center",
                            (_, 0) => "right",
                            _ => "left",
                        })
                        .collect();
                    out.push(json!({ "t": "m", "rows": rows, "align": align, "gap": 0 }));
                }
            }
            MathKind::Radical(r) => {
                let mut node = json!({ "t": "rad", "e": self.nodes(&r.radicand) });
                if let Some(index) = &r.index {
                    node["deg"] = Json::Array(self.nodes(index));
                }
                out.push(node);
            }
            MathKind::Fenced(f) => {
                let open = f.open.as_ref().map(glyph_text).unwrap_or_default();
                let close = f.close.as_ref().map(glyph_text).unwrap_or_default();
                let body = self.nodes(&f.body);
                if open.is_empty() && close.is_empty() {
                    out.extend(body);
                } else if body.iter().any(tall) {
                    out.push(json!({ "t": "d", "open": open, "close": close, "e": body }));
                } else {
                    // Around one line, Typst's delimiters keep their size: characters, as typed. (LibreOffice draws
                    // stretchy ones in Typst's math font as bars.)
                    push_text(
                        out,
                        &open,
                        Style {
                            sty: Some("p"),
                            ..Style::default()
                        },
                    );
                    out.extend(body);
                    push_text(
                        out,
                        &close,
                        Style {
                            sty: Some("p"),
                            ..Style::default()
                        },
                    );
                }
            }
            MathKind::Fraction(f) => {
                let mut node = json!({
                    "t": "f",
                    "num": self.nodes(&f.numerator),
                    "den": self.nodes(&f.denominator),
                });
                if !f.line {
                    node["type"] = json!("noBar");
                }
                out.push(node);
            }
            MathKind::SkewedFraction(f) => out.push(json!({
                "t": "f",
                "type": "skw",
                "num": self.nodes(&f.numerator),
                "den": self.nodes(&f.denominator),
            })),
            MathKind::Table(table) => {
                // Each cell's sub-columns (its `&`s) are columns of their own.
                let rows: Vec<Vec<Json>> = table
                    .cells
                    .iter()
                    .map(|row| {
                        row.iter()
                            .flat_map(|cell| cell.iter().map(|col| Json::Array(self.nodes(col))))
                            .collect()
                    })
                    .collect();
                let mut align = Vec::new();
                for cell in table.cells.first().into_iter().flatten() {
                    for i in 0..cell.len() {
                        align.push(match (table.alternator, table.align, cell.len() > 1) {
                            (LeftRightAlternator::Right, _, true) if i % 2 == 0 => "right",
                            (LeftRightAlternator::Right, _, true) => "left",
                            (_, FixedAlignment::Start, _) => "left",
                            (_, FixedAlignment::End, _) => "right",
                            _ => "center",
                        });
                    }
                }
                out.push(json!({ "t": "m", "rows": rows, "align": align }));
            }
            MathKind::Scripts(s) => self.scripts(s, out),
            MathKind::Accent(a) => {
                let chr = glyph_text(&a.accent);
                let e = self.nodes(&a.base);
                let top = a.position == Position::Above;
                // Braces, brackets and the like stretch over their base (`exact_frame_width`); accents don't.
                out.push(if a.exact_frame_width || !top {
                    json!({ "t": "groupChr", "chr": chr, "top": top, "e": e })
                } else {
                    json!({ "t": "acc", "chr": chr, "e": e })
                });
            }
            MathKind::Cancel(c) => {
                let strike = if c.cross {
                    "both"
                } else if c.invert_first_line {
                    "tlbr"
                } else {
                    "bltr"
                };
                out.push(json!({ "t": "box", "strike": strike, "e": self.nodes(&c.base) }));
            }
            MathKind::Line(l) => out.push(json!({
                "t": "bar",
                "top": l.position == Position::Above,
                "e": self.nodes(&l.base),
            })),
            MathKind::Primes(p) => push_text(out, &"′".repeat(p.count), Style::default()),
            MathKind::Text(t) => {
                // An operator's name (`op`, `lim`, `sin`) is math, upright; other text is text in math.
                if comp.props.class() == MathClass::Large {
                    push_styled(out, &t.text);
                } else {
                    push_text(
                        out,
                        &t.text,
                        Style {
                            nor: true,
                            ..Style::default()
                        },
                    );
                }
            }
            MathKind::Number(n) => push_styled(out, &n.text),
            MathKind::Glyph(g) => push_styled(out, &g.text),
            MathKind::Box(b) => {
                let text = b
                    .elem
                    .body
                    .get_cloned(comp.styles)
                    .map(|c| c.plain_text())
                    .unwrap_or_default();
                if !text.is_empty() {
                    push_text(
                        out,
                        &text,
                        Style {
                            nor: true,
                            ..Style::default()
                        },
                    );
                }
            }
            MathKind::External(e) => {
                let text = e.content.plain_text();
                if !text.is_empty() {
                    push_text(
                        out,
                        &text,
                        Style {
                            nor: true,
                            ..Style::default()
                        },
                    );
                }
            }
            MathKind::Mathml(m) => {
                if let Some(body) = &m.body {
                    self.item(body, out);
                }
            }
        }
    }

    fn nodes(&self, item: &MathItem) -> Vec<Json> {
        let mut out = Vec::new();
        self.item(item, &mut out);
        out
    }

    /// A sequence of items: a big operator or an operator's name (`sin`, `lim`) takes what follows it, up to a
    /// relation, a binary operator, punctuation or another operator, as its operand. Word's n-ary and function
    /// structures have one, as Word writes them (LibreOffice reads `lim` only as a function's name); Typst only sets
    /// the operand after.
    fn seq(&self, items: &[MathItem], out: &mut Vec<Json>) {
        let mut i = 0;
        while i < items.len() {
            if is_function(&items[i]) {
                let mut name = self.nodes(&items[i]);
                // `lim` with its limit beside it (inline): LibreOffice reads a `lim` alone in a script's base as its
                // own operator, missing its operand, unless it is text.
                if let [Json::Object(s)] = name.as_mut_slice() {
                    if s.get("t") == Some(&json!("s")) {
                        if let Some(Json::Array(e)) = s.get_mut("e") {
                            if let [Json::Object(r)] = e.as_mut_slice() {
                                if matches!(
                                    r.get("text").and_then(|t| t.as_str()),
                                    Some("lim" | "liminf" | "limsup")
                                ) {
                                    r.remove("sty");
                                    r.insert("nor".into(), json!(true));
                                }
                            }
                        }
                    }
                }
                let e = self.operand(items, &mut i);
                out.push(json!({ "t": "func", "name": name, "e": e }));
                continue;
            }
            let Some(chr) = big_operator(&items[i]) else {
                self.item(&items[i], out);
                i += 1;
                continue;
            };
            let mut node = match &items[i] {
                MathItem::Component(c) => match &c.kind {
                    MathKind::Scripts(s) => {
                        let mut node = json!({ "t": "nary", "chr": chr, "limits": s.top.is_some() || s.bottom.is_some() });
                        if let Some(sub) = s.bottom.as_ref().or(s.bottom_right.as_ref()) {
                            node["sub"] = Json::Array(self.nodes(sub));
                        }
                        if let Some(sup) = s.top.as_ref().or(s.top_right.as_ref()) {
                            node["sup"] = Json::Array(self.nodes(sup));
                        }
                        node
                    }
                    _ => json!({ "t": "nary", "chr": chr, "limits": false }),
                },
                _ => unreachable!(),
            };
            node["e"] = Json::Array(self.operand(items, &mut i));
            out.push(node);
        }
    }

    /// The operand of the operator at `i`, which moves past it.
    fn operand(&self, items: &[MathItem], i: &mut usize) -> Vec<Json> {
        *i += 1;
        while *i < items.len() && matches!(items[*i], MathItem::Space) {
            *i += 1;
        }
        let start = *i;
        while *i < items.len() && !ends_operand(&items[*i]) {
            *i += 1;
        }
        let mut e = Vec::new();
        self.seq(&items[start..*i], &mut e);
        e
    }

    fn scripts(&self, s: &typst::math::ir::ScriptsItem, out: &mut Vec<Json>) {
        let mut e = self.nodes(&s.base);
        // Limits: under, then over.
        if let Some(bottom) = &s.bottom {
            e = vec![json!({ "t": "lim", "below": true, "e": e, "lim": self.nodes(bottom) })];
        }
        if let Some(top) = &s.top {
            e = vec![json!({ "t": "lim", "below": false, "e": e, "lim": self.nodes(top) })];
        }
        if s.top_right.is_some() || s.bottom_right.is_some() {
            let mut node = json!({ "t": "s", "e": e });
            if let Some(sub) = &s.bottom_right {
                node["sub"] = Json::Array(self.nodes(sub));
            }
            if let Some(sup) = &s.top_right {
                node["sup"] = Json::Array(self.nodes(sup));
            }
            e = vec![node];
        }
        if s.top_left.is_some() || s.bottom_left.is_some() {
            let mut node = json!({ "t": "s", "pre": true, "e": e });
            node["sub"] = Json::Array(
                s.bottom_left
                    .as_ref()
                    .map(|x| self.nodes(x))
                    .unwrap_or_default(),
            );
            node["sup"] = Json::Array(
                s.top_left
                    .as_ref()
                    .map(|x| self.nodes(x))
                    .unwrap_or_default(),
            );
            e = vec![node];
        }
        out.extend(e);
    }
}

/// Whether a node is taller than a line of text: what delimiters grow around.
fn tall(node: &Json) -> bool {
    match node["t"].as_str() {
        Some("f") => node["type"] != json!("skw"),
        Some("m" | "nary" | "lim" | "groupChr") => true,
        Some(_) => ["e", "name", "sub", "sup", "deg"]
            .iter()
            .any(|k| node[*k].as_array().is_some_and(|a| a.iter().any(tall))),
        None => false,
    }
}

/// A big operator's character (∑, ∫, ∏…), when the item is one, bare or with scripts or limits.
fn big_operator(item: &MathItem) -> Option<String> {
    let MathItem::Component(comp) = item else {
        return None;
    };
    match &comp.kind {
        MathKind::Glyph(g) if g.class == MathClass::Large => Some(g.text.to_string()),
        MathKind::Scripts(s) if s.top_left.is_none() && s.bottom_left.is_none() => {
            big_operator(&s.base)
        }
        _ => None,
    }
}

/// Whether an item is an operator's name (`op`, `sin`, `lim`), bare or with scripts or limits.
fn is_function(item: &MathItem) -> bool {
    let MathItem::Component(comp) = item else {
        return false;
    };
    match &comp.kind {
        MathKind::Text(_) => comp.props.class() == MathClass::Large,
        MathKind::Scripts(s) if s.top_left.is_none() && s.bottom_left.is_none() => {
            is_function(&s.base)
        }
        _ => false,
    }
}

/// Whether an item ends an operator's operand.
fn ends_operand(item: &MathItem) -> bool {
    match item {
        MathItem::Component(comp) => {
            big_operator(item).is_some()
                || is_function(item)
                || matches!(
                    comp.props.class(),
                    MathClass::Relation
                        | MathClass::Binary
                        | MathClass::Punctuation
                        | MathClass::Large
                )
        }
        _ => false,
    }
}

/// The text of a delimiter or accent: a glyph, perhaps with scripts (they are dropped).
fn glyph_text(item: &MathItem) -> String {
    let MathItem::Component(comp) = item else {
        return String::new();
    };
    match &comp.kind {
        MathKind::Glyph(g) => g.text.to_string(),
        MathKind::Text(t) => t.text.to_string(),
        MathKind::Group(g) => g.items.iter().map(glyph_text).collect(),
        MathKind::Scripts(s) => glyph_text(&s.base),
        _ => String::new(),
    }
}

fn ratio(abs: Abs, font_size: Abs) -> f64 {
    if font_size.to_pt() > 0.0 {
        abs.to_pt() / font_size.to_pt()
    } else {
        0.0
    }
}

/// Unicode spaces as wide as `em`: em, en, three-, four- and six-per-em spaces, widest first.
fn spaces(mut em: f64) -> String {
    const SPACES: [(f64, char); 5] = [
        (1.0, '\u{2003}'),
        (0.5, '\u{2002}'),
        (1.0 / 3.0, '\u{2004}'),
        (0.25, '\u{2005}'),
        (1.0 / 6.0, '\u{2006}'),
    ];
    let mut out = String::new();
    for (width, c) in SPACES {
        while em >= width - 1.0 / 24.0 {
            out.push(c);
            em -= width;
        }
    }
    out
}

/// A run's properties: Word's math style (`sty`: p, b, i, bi), alphabet (`scr`) and normal text (`nor`).
#[derive(Clone, Copy, Default, PartialEq)]
struct Style {
    sty: Option<&'static str>,
    scr: Option<&'static str>,
    nor: bool,
}

/// Appends text, joining the last run when its properties are the same.
fn push_text(out: &mut Vec<Json>, text: &str, style: Style) {
    if text.is_empty() {
        return;
    }
    if let Some(Json::Object(last)) = out.last_mut() {
        if last.get("t") == Some(&json!("r")) && run_style(last) == style {
            if let Some(Json::String(s)) = last.get_mut("text") {
                s.push_str(text);
                return;
            }
        }
    }
    let mut run = Map::new();
    run.insert("t".into(), json!("r"));
    run.insert("text".into(), json!(text));
    if let Some(sty) = style.sty {
        run.insert("sty".into(), json!(sty));
    }
    if let Some(scr) = style.scr {
        run.insert("scr".into(), json!(scr));
    }
    if style.nor {
        run.insert("nor".into(), json!(true));
    }
    out.push(Json::Object(run));
}

fn run_style(run: &Map<String, Json>) -> Style {
    let get = |k: &str| run.get(k).and_then(|v| v.as_str()).map(intern);
    Style {
        sty: get("sty"),
        scr: get("scr"),
        nor: run.get("nor").is_some(),
    }
}

fn intern(s: &str) -> &'static str {
    [
        "p",
        "b",
        "i",
        "bi",
        "script",
        "fraktur",
        "double-struck",
        "sans-serif",
        "monospace",
    ]
    .into_iter()
    .find(|v| *v == s)
    .unwrap_or("p")
}

/// Appends math text whose characters Typst styled (𝑥, 𝐀, ℝ): Word wants the plain letter and the style, as it
/// writes them itself.
fn push_styled(out: &mut Vec<Json>, text: &str) {
    for c in text.chars() {
        // Typst picks chancery or roundhand script with a variation selector; Word has one script.
        if matches!(c, '\u{FE00}' | '\u{FE01}') {
            continue;
        }
        // Every run says its style: ONLYOFFICE sets digits and operators without one in italic too.
        let (plain, style) = match UNSTYLED.get(&c) {
            Some(&(plain, style)) => (plain, word_style(style)),
            None => (
                c,
                Style {
                    sty: Some("p"),
                    ..Style::default()
                },
            ),
        };
        let mut buf = [0u8; 4];
        push_text(out, plain.encode_utf8(&mut buf), style);
    }
}

fn word_style(style: MathStyle) -> Style {
    use MathStyle::*;
    let (sty, scr) = match style {
        Italic => (Some("i"), None),
        Bold => (Some("b"), None),
        BoldItalic => (Some("bi"), None),
        Script | Chancery | Roundhand => (Some("p"), Some("script")),
        BoldScript | BoldChancery | BoldRoundhand => (Some("b"), Some("script")),
        Fraktur => (Some("p"), Some("fraktur")),
        BoldFraktur => (Some("b"), Some("fraktur")),
        SansSerif => (Some("p"), Some("sans-serif")),
        SansSerifBold => (Some("b"), Some("sans-serif")),
        SansSerifItalic => (Some("i"), Some("sans-serif")),
        SansSerifBoldItalic => (Some("bi"), Some("sans-serif")),
        Monospace => (Some("p"), Some("monospace")),
        DoubleStruck => (Some("p"), Some("double-struck")),
        DoubleStruckItalic => (Some("i"), Some("double-struck")),
        _ => (Some("p"), None),
    };
    Style {
        sty,
        scr,
        nor: false,
    }
}

/// Styled characters back to their letter and style: Typst's own `to_style`, inverted over the characters it styles.
static UNSTYLED: LazyLock<HashMap<char, (char, MathStyle)>> = LazyLock::new(|| {
    use MathStyle::*;
    let styles = [
        Italic,
        Bold,
        BoldItalic,
        Script,
        BoldScript,
        Fraktur,
        BoldFraktur,
        SansSerif,
        SansSerifBold,
        SansSerifItalic,
        SansSerifBoldItalic,
        Monospace,
        DoubleStruck,
        DoubleStruckItalic,
        Chancery,
        BoldChancery,
        Roundhand,
        BoldRoundhand,
    ];
    let plain = ('A'..='Z')
        .chain('a'..='z')
        .chain('0'..='9')
        .chain('\u{0391}'..='\u{03A9}')
        .chain('\u{03B1}'..='\u{03C9}')
        .chain([
            'ϴ', '∇', '∂', 'ϵ', 'ϑ', 'ϰ', 'ϕ', 'ϱ', 'ϖ', 'ı', 'ȷ', 'Ϝ', 'ϝ',
        ]);
    let mut map = HashMap::new();
    for c in plain {
        for style in styles {
            let mut styled = to_style(c, style);
            if let (Some(s), None) = (styled.next(), styled.next()) {
                if s != c {
                    map.entry(s).or_insert((c, style));
                }
            }
        }
    }
    map
});
