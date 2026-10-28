// Shared helpers: the answer switch, colors, and HTML elements. Not exported by lib.typ.
#import "i18n.typ": _dir

/// Whether answers are shown: the app sets the input `showAnswers` to `"true"` and recompiles
/// (PLAN §8.3). Hidden answers produce no output at all, in either target.
#let _answers-shown = sys.inputs.at("showAnswers", default: "false") == "true"

/// Questions, numbered through the whole document.
#let _question = counter("edu-question")

/// Settings templates make for the whole document, e.g. `points-label`.
#let _config = state("edu-config", (points-label: auto))

/// The ink answers are written in: a teacher's red pen.
#let _accent = rgb("#c0392b")
#let _rule = luma(120)
#let _faint = luma(200)

/// Whether this compile writes HTML. Needs context; inside `html.frame` it is the paged target.
#let _html() = target() == "html"

// Typst's default text edges (a line box from the cap height to the baseline) inside an inline box whose stroke or
// fill hugs its text. The engine's layout profile (#129) makes every line box the full line pitch, which would push
// a circle or an underline away from the text; a later show-set rule wins over the profile's.
#let _tight(body) = {
  show text: set text(top-edge: "cap-height", bottom-edge: "baseline")
  body
}

/// A text size `factor` times the current one, rounded to half a point: Word sets text in half points, so a DOCX
/// export keeps the size and the line breaks (#130). Needs context.
#let _half(factor) = calc.round(text.size.to-absolute() / 0.5pt * factor) * 0.5pt

/// An HTML element with edu's classes (a string, an array of them, or none). In right-to-left
/// text it gets `dir="rtl"`, so CSS grids and logical properties flip. Needs context.
#let _el(tag, cls, body, ..attrs) = {
  let a = attrs.named()
  if cls != none { a.insert("class", if type(cls) == array { cls.filter(c => c != none).join(" ") } else { cls }) }
  if _dir() == rtl { a.insert("dir", "rtl") }
  html.elem(tag, attrs: a, body)
}

/// A length as CSS. Relative lengths (`em`) stay relative; ratios become percentages.
#let _css(l) = {
  if type(l) == ratio { return repr(l) }
  if type(l) == relative { return "calc(" + repr(l.ratio) + " + " + _css(l.length) + ")" }
  if l.abs == 0pt { return str(l.em) + "em" }
  if l.em == 0 { return str(calc.round(l.abs.pt(), digits: 2)) + "pt" }
  "calc(" + str(l.em) + "em + " + str(calc.round(l.abs.pt(), digits: 2)) + "pt)"
}

/// A drawing as inline SVG in HTML, with its description for screen readers; as itself on paper.
/// Needs context.
#let _drawing(body, label: "", inline: false) = {
  if not _html() { return body }
  let attrs = (role: "img")
  if label != "" { attrs.insert("aria-label", label) }
  _el(if inline { "span" } else { "div" }, "edu-drawing", html.frame(body), ..attrs)
}

/// A length parameter, or `default` while it isn't one yet: cut while streaming, `5em` arrives
/// as `5` first.
#let _length(v, default) = if type(v) == length { v } else { default }

/// An array parameter as an array. While a stream is cut, `(2` heals to `(2)`, which is the
/// number 2, and `("name"` to a string: one item stands for an array of one.
#let _array(v) = if type(v) == array { v } else if v == none or v == auto { () } else { (v,) }

/// An array-of-pairs parameter (`((1, 2), (3, 4))`) as one. Cut while streaming, `((1, 2` heals to
/// `((1, 2))`, which is the pair itself.
#let _pairs(v) = {
  let v = _array(v)
  if v.len() > 0 and type(v.at(0)) != array { (v,) } else { v }
}

/// Plain text of content, for labels and measuring option lengths.
#let _plain(c) = {
  if c == none { return "" }
  if type(c) in (str, int, float, bool) { return str(c) }
  if type(c) == array { return c.map(_plain).join(" ", default: "") }
  if type(c) != content { return "" }
  if c.func() in ([ ].func(), linebreak, parbreak) { return " " }
  let f = c.fields()
  if "text" in f and type(f.text) == str { return f.text }
  if "body" in f { return _plain(f.body) }
  if "children" in f { return f.children.map(_plain).join(default: "") }
  ""
}
