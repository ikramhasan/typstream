// Chemical formulas and equations from plain text, a small subset of LaTeX's mhchem. The result
// is math, so HTML export writes MathML.
#import "util.typ": _plain

#let _is-upper(c) = c.match(regex("^\p{Lu}$")) != none
#let _is-lower(c) = c.match(regex("^\p{Ll}$")) != none
#let _is-digit(c) = c.match(regex("^[0-9]$")) != none

/// Upright text in math.
#let _up(s) = math.upright(s)

#let _states = ("aq", "s", "l", "g")

/// One species, e.g. `2H2O`, `SO4^2-`, `Na+`, `CuSO4*5H2O`, `Fe(OH)3`, `e-`.
#let _species(s) = {
  let cs = s.clusters()
  let n = cs.len()
  let out = ()
  let i = 0
  // Leading coefficient: digits, or a fraction such as 1/2.
  let coef = ""
  while i < n and (_is-digit(cs.at(i)) or (cs.at(i) == "/" and coef != "")) {
    coef += cs.at(i)
    i += 1
  }
  if coef != "" {
    out.push(if "/" in coef and not coef.ends-with("/") {
      let (a, b) = coef.split("/")
      math.frac(_up(a), _up(b))
    } else { _up(coef) })
  }
  // A stack of open groups; each holds its units so far. Units are (base, sub, sup).
  let stack = ((),)
  let attach(u) = math.attach(u.at(0), b: u.at(1), t: u.at(2))
  while i < n {
    let c = cs.at(i)
    if _is-upper(c) {
      let el = c
      i += 1
      while i < n and _is-lower(cs.at(i)) {
        el += cs.at(i)
        i += 1
      }
      stack.at(-1).push((_up(el), none, none))
    } else if c == "e" and stack.len() == 1 and stack.at(-1).len() == 0 {
      // An electron: e-, e^-.
      stack.at(-1).push((math.italic("e"), none, none))
      i += 1
    } else if _is-digit(c) {
      let d = ""
      while i < n and _is-digit(cs.at(i)) {
        d += cs.at(i)
        i += 1
      }
      // Digits after a unit are its subscript; after a dot (hydrate) they are a coefficient.
      let last = stack.at(-1).at(-1, default: none)
      if last != none and last.at(0) != sym.dot.c and last.at(1) == none and last.at(2) == none {
        stack.at(-1).at(-1).at(1) = _up(d)
      } else { stack.at(-1).push((_up(d), none, none)) }
    } else if c in ("(", "[") {
      // A state symbol: (aq), (s), (l), (g).
      let close = cs.slice(i).position(x => x == ")")
      let inner = if close != none { cs.slice(i + 1, i + close).join(default: "") }
      if c == "(" and inner in _states {
        stack.at(-1).push((_up("(" + inner + ")"), none, none))
        i += close + 1
      } else {
        stack.push(())
        i += 1
      }
    } else if c in (")", "]") and stack.len() > 1 {
      let units = stack.pop()
      let open = if c == ")" { "(" } else { "[" }
      stack.at(-1).push(([#_up(open)#units.map(attach).join()#_up(c)], none, none))
      i += 1
    } else if c == "^" {
      // A charge: ^2+, ^-, ^{3-}.
      i += 1
      let charge = ""
      if i < n and cs.at(i) == "{" {
        i += 1
        while i < n and cs.at(i) != "}" {
          charge += cs.at(i)
          i += 1
        }
        i += 1
      } else {
        while i < n and (_is-digit(cs.at(i)) or cs.at(i) in ("+", "-")) {
          charge += cs.at(i)
          i += 1
        }
      }
      let charge = charge.replace("-", "\u{2212}")
      if stack.at(-1).len() > 0 { stack.at(-1).at(-1).at(2) = _up(charge) }
    } else if c in ("+", "-") and stack.at(-1).len() > 0 {
      // A charge written without ^ at the end: Na+, Cl-, O2-- is not supported.
      let charge = cs.slice(i).filter(x => x in ("+", "-")).join(default: "")
      stack.at(-1).at(-1).at(2) = _up(charge.replace("-", "\u{2212}"))
      i += charge.len()
    } else if c in ("*", ".", "·") {
      stack.at(-1).push((sym.dot.c, none, none))
      i += 1
    } else {
      stack.at(-1).push((_up(c), none, none))
      i += 1
    }
  }
  // Unclosed groups (a formula cut off while streaming) close themselves.
  while stack.len() > 1 {
    let units = stack.pop()
    stack.at(-1).push(([#_up("(")#units.map(attach).join()], none, none))
  }
  out + stack.at(0).map(attach)
}

#let _tokens = (
  "+": sym.plus,
  "->": sym.arrow.r.long,
  "→": sym.arrow.r.long,
  "<-": sym.arrow.l.long,
  "<->": sym.arrow.l.r.long,
  "<=>": sym.harpoons.rtlb,
  "⇌": sym.harpoons.rtlb,
  "=": sym.eq,
  "^": sym.arrow.t,
  "v": sym.arrow.b,
)

/// A chemical formula or equation from plain text: digits after an element are subscripts, a
/// leading number is a coefficient, `^2+` or a trailing `+`/`-` is a charge, `(aq)`, `(s)`,
/// `(l)`, `(g)` are states, `*` is a hydrate's dot, and `->`, `<=>`, `<-` are arrows. Separate
/// species, `+` and arrows with spaces. Works in text and in math.
///
/// ```example
/// #ce("2H2 + O2 -> 2H2O") and #ce("CH3COOH <=> CH3COO- + H+"); copper sulfate is #ce("CuSO4*5H2O").
/// ```
#let ce(formula) = {
  let s = if type(formula) == str { formula } else { _plain(formula) }
  let parts = s.split(" ").filter(t => t != "").map(t => if t in _tokens { (_tokens.at(t),) } else { _species(t) })
  if parts.len() == 0 { return }
  math.equation(block: false, numbering: none, parts.flatten().join())
}
