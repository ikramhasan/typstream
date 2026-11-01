//! Glyph outlines once per HTML document. A picture in Typst's HTML
//! (`html.frame`: html-compat's equations, drawings) carries the outline of
//! every glyph it draws, as a `<symbol id="g…">` that typst-svg names by a hash
//! of the glyph, and uses it. A document with many equations repeats each
//! outline in every one (2,860 outlines for 41 glyphs, 2.3 of 3.7 MB, in dom's
//! 20-page test), and every update of a stream sends them all to the page.
//!
//! An outline the same as one before it is dropped: the `<use>`s that drew it
//! find the first one, as they find any element of the document by its id. One
//! that only shares the id (a document's own `<symbol>`) stays.

use std::collections::HashMap;

/// Where a glyph's outline starts: typst-svg writes its id first.
const OPEN: &str = "<symbol id=\"g";
const CLOSE: &str = "</symbol>";

/// `html` with each glyph outline after its first copy dropped.
pub fn share_glyphs(html: String) -> String {
    if !html.contains(OPEN) {
        return html;
    }
    let mut first: HashMap<&str, &str> = HashMap::new();
    let mut out = String::with_capacity(html.len());
    let mut at = 0;
    while let Some(found) = html[at..].find(OPEN) {
        let start = at + found;
        let Some(end) = html[start..].find(CLOSE).map(|n| start + n + CLOSE.len()) else {
            break;
        };
        let symbol = &html[start..end];
        // From the `g` to the closing quote.
        let id_end = symbol[OPEN.len()..]
            .find('"')
            .map_or(symbol.len(), |n| OPEN.len() + n);
        let id = &symbol[OPEN.len() - 1..id_end];
        out.push_str(&html[at..start]);
        match first.get(id) {
            Some(&kept) if kept == symbol => {}
            Some(_) => out.push_str(symbol),
            None => {
                first.insert(id, symbol);
                out.push_str(symbol);
            }
        }
        at = end;
    }
    out.push_str(&html[at..]);
    out
}

#[cfg(test)]
mod tests {
    use super::share_glyphs;

    const A: &str = r#"<symbol id="gA1" overflow="visible"><path d="M 0 0h 1Z"/></symbol>"#;
    const B: &str = r#"<symbol id="gB2" overflow="visible"><path d="M 0 0v 1Z"/></symbol>"#;

    #[test]
    fn keeps_the_first_copy_of_each_outline() {
        let html =
            format!("<p><svg><defs>{A}{B}</defs></svg> and <svg><defs>{B}{A}</defs></svg></p>");
        assert_eq!(
            share_glyphs(html),
            format!("<p><svg><defs>{A}{B}</defs></svg> and <svg><defs></defs></svg></p>")
        );
    }

    #[test]
    fn keeps_a_symbol_that_only_shares_an_id() {
        let own = r#"<symbol id="gA1"><rect width="9" height="9"/></symbol>"#;
        let html = format!("{A}{own}{A}");
        assert_eq!(share_glyphs(html), format!("{A}{own}"));
    }

    #[test]
    fn leaves_documents_without_outlines_alone() {
        let html = "<p>x &lt;symbol id=\"g1\"&gt;</p>".to_string();
        assert_eq!(share_glyphs(html.clone()), html);
    }
}
