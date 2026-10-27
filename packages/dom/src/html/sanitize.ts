// The sanitizer for compiled output (PLAN §9, #16). Typst documents are written
// by an LLM, and `html.elem` lets them emit any tag and attribute, so their
// HTML is untrusted.
//
// An allowlist walk over an inert tree, not DOMPurify (11.8 KB gzipped, most of
// the bindings' budget, and configured tag by tag for MathML and SVG anyway).
// The renderer parses markup into an inert <template> (no scripts run, nothing
// loads, no handlers fire), this cleans that tree, and the renderer moves the
// same nodes into the page. Nothing is serialized and parsed again, so the
// mutation XSS that DOMPurify defends against (markup that changes meaning
// when re-parsed) can't happen.
//
// It also handles the SVG Typst writes for `html.frame` (and for paged output).
//
// Inline styles never reach the parser as `style` attributes: under a strict
// Content-Security-Policy (`style-src` without 'unsafe-inline'), Chromium and
// Firefox refuse those, even in an inert template, and report each one. The
// renderer renames them (`hideStyles`) and the sanitizer applies them through
// the CSSOM (`style.cssText`), which no policy restricts (#29, apps/website/content/docs/guides/security.mdx).
//
// Classes are allowlisted too (#69): a document's `class` would otherwise take
// the page's own styles (Tailwind's `fixed inset-0 z-50`, an app's button) and
// whatever its scripts hang on them. The renderer's CSS keeps what is left
// inside the root (styles.ts).

import type { TypstreamPlugin } from "@typstream/core";

const HTML_NS = "http://www.w3.org/1999/xhtml";
const SVG_NS = "http://www.w3.org/2000/svg";
const MATHML_NS = "http://www.w3.org/1998/Math/MathML";

const set = (s: string): ReadonlySet<string> => new Set(s.split(/\s+/).filter(Boolean));

/** HTML elements Typst's export and html-compat write, and their own attributes. */
const HTML_TAGS = new Map<string, ReadonlySet<string>>([
  ["a", set("href")],
  ["img", set("src alt width height")],
  ["ol", set("start reversed type")],
  ["li", set("value")],
  ["td", set("colspan rowspan headers")],
  ["th", set("colspan rowspan headers scope abbr")],
  ["col", set("span")],
  ["colgroup", set("span")],
  ["time", set("datetime")],
  ["details", set("open")],
  ...[
    "abbr address article aside b bdi bdo blockquote br caption cite code dd del dfn div dl dt em figcaption",
    "figure footer h1 h2 h3 h4 h5 h6 header hgroup hr i ins kbd main mark nav p pre q rp rt ruby s samp",
    "section small span strong sub summary sup table tbody tfoot thead tr u ul var wbr",
  ]
    .join(" ")
    .split(" ")
    .map((tag): [string, ReadonlySet<string>] => [tag, set("")]),
]);

/** MathML Core, without `annotation-xml` (it can hold HTML) and without links. */
const MATHML_TAGS = set(
  "math annotation maction menclose merror mfrac mi mmultiscripts mn mo mover mpadded mphantom mprescripts mroot " +
    "mrow ms mspace msqrt mstyle msub msubsup msup mtable mtd mtext mtr munder munderover none semantics",
);
const MATHML_ATTRS = set(
  "display displaystyle scriptlevel mathvariant mathsize mathcolor mathbackground lspace rspace stretchy symmetric " +
    "largeop movablelimits fence separator form minsize maxsize accent accentunder linethickness columnalign " +
    "rowalign columnspan rowspan width height depth voffset notation encoding",
);

/** What typst-svg writes, without scripting, animation or `foreignObject`. */
const SVG_TAGS = set(
  "svg g path use defs symbol clipPath mask linearGradient radialGradient stop pattern image rect circle ellipse " +
    "line polyline polygon text tspan title desc a",
);
const SVG_ATTRS = set(
  "viewBox width height x y x1 y1 x2 y2 cx cy r rx ry fx fy fr d points transform fill fill-rule fill-opacity " +
    "stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset " +
    "stroke-opacity opacity clip-path clip-rule mask preserveAspectRatio gradientUnits gradientTransform " +
    "spreadMethod offset stop-color stop-opacity patternUnits patternTransform patternContentUnits href xlink:href " +
    "overflow shape-rendering text-anchor dominant-baseline font-size font-family font-weight visibility display",
);

/** On every allowed element. */
const GLOBAL_ATTRS = set("class style id lang dir title role");

/**
 * Classes Typst's HTML export writes (typst-html 0.15.1: mathml.rs's equation
 * tables and accents, rules.rs's bibliography). Plugins add theirs; `typstream-*`
 * (the engine's placeholders and error blocks) is always kept.
 */
const TYPST_CLASSES = set(
  "multiline-equation aligned left-align right-align cases flushed left-flush right-flush dotted prefix light indent " +
    "hanging-indent",
);

/** Removed with everything inside; no plugin can allow them. */
const REMOVE = set(
  "script style template iframe frame frameset object embed applet noscript noembed noframes textarea title xmp " +
    "plaintext select option optgroup button input form fieldset legend label datalist output canvas audio video " +
    "source track picture map area base link meta param portal dialog slot foreignObject annotation-xml animate " +
    "animateMotion animateTransform set discard handler listener",
);

/** URL-bearing attributes nothing may allow (the ones we check are href, xlink:href and src). */
const DENY_ATTRS = /^(?:on|formaction$|action$|srcdoc$|srcset$|poster$|background$|ping$|codebase$|data$|is$)/i;

/** The URL attributes the sanitizer checks; a plugin may allow them by tag, not with `"*"`. */
const URL_ATTRS = set("href xlink:href src");

/**
 * Attributes that hold id references, and `name`, which a plugin may allow: it is
 * prefixed like an id, or `<img name="cookie">` would clobber `document.cookie`.
 */
const IDREFS = set(
  "name headers for aria-labelledby aria-describedby aria-controls aria-owns aria-activedescendant aria-details " +
    "aria-errormessage aria-flowto",
);

/** Presentation attributes whose `url(#id)` references point into the document. */
const URL_REF_ATTRS = set("fill stroke clip-path mask filter marker-start marker-mid marker-end");

/** The URL as a browser reads it: no leading/trailing controls or spaces, no tabs or newlines inside. */
const normalizeUrl = (value: string): string =>
  // biome-ignore lint/suspicious/noControlCharactersInRegex: browsers strip these from URLs, so must we.
  value.replace(/^[\u0000- ]+|[\u0000- ]+$/g, "").replace(/[\t\n\r]/g, "");

const LINK = /^(?:https?|mailto):/i;
const EXTERNAL = /^https?:/i;
const IMAGE = /^(?:data:image\/(?:png|jpe?g|gif|webp|avif|bmp|svg\+xml)[;,]|blob:)/i;

/** CSS that might load something or escape the document's box. */
const RISKY_CSS = /url|image|element|expression|binding|behavior|fixed|\\/i;
const LOADING_CSS = /url\(|image\(|image-set\(|element\(|expression\(|-moz-binding|behavior/i;

/** What `hideStyles` renames `style` attributes to; the sanitizer applies and removes it. */
const STYLE_ATTR = "data-typstream-style";

/**
 * An attribute in a start tag, with its value if it has one: double-quoted, as
 * Typst writes them all. Neither may contain `<`, so a match never runs past the
 * next tag and hostile raw text (`<a x="<a x="…`) costs linear time.
 */
const ATTRIBUTE = /(?<=\s)([^\s"'<>/=]+)(="[^"<]*")?/g;
const START_TAG = /<[a-zA-Z][^\s/<>]*(?:\s+[^\s"'<>/=]+(?:="[^"<]*")?)*\s*\/?>/g;

/**
 * Renames the `style` attributes in markup's start tags, so parsing it doesn't
 * apply them (see the header). Typst's serializer escapes `<` in text and `"`
 * in attribute values, so start tags are found exactly, except one with `<` in
 * an attribute value, whose style a strict policy then refuses. Anything else
 * that looks like a tag is in raw text (`script`, `style`), which the sanitizer
 * removes.
 * @internal
 */
export const hideStyles = (html: string): string =>
  html.replace(START_TAG, (tag) =>
    tag.replace(ATTRIBUTE, (all, name: string, value = "") =>
      name.toLowerCase() === "style" ? STYLE_ATTR + value : all,
    ),
  );

/** Sanitizer settings. @public */
export interface SanitizeOptions {
  /**
   * Prefixed to every id, and to the links and references pointing at them, so
   * two documents on a page don't collide (`loc-1`) and a label can't clobber a
   * global (`<config>` would otherwise define `window.config`).
   */
  idPrefix: string;
  /** Plugins whose `sanitize` facet allows more tags, attributes and classes. */
  plugins?: readonly TypstreamPlugin[];
  /** `target` for links to http(s) URLs; `null` leaves them in the same tab. Default `_blank`. */
  linkTarget?: string | null;
}

/** Cleans a tree in place. @internal */
export type Sanitizer = (root: ParentNode) => void;

const ELEMENT = 1;
const TEXT = 3;

/** The next node after `node` in document order, skipping its subtree; `null` past `root`. */
const after = (node: Node, root: Node): Node | null => {
  let n: Node | null = node;
  while (n && n !== root) {
    if (n.nextSibling) return n.nextSibling;
    n = n.parentNode;
  }
  return null;
};

/** Builds a sanitizer. @internal */
export const createSanitizer = (options: SanitizeOptions): Sanitizer => {
  const { idPrefix } = options;
  const linkTarget = options.linkTarget === undefined ? "_blank" : options.linkTarget;
  const extraTags = new Set<string>();
  const extraAttrs = new Map<string, Set<string>>();
  const classes = new Set(TYPST_CLASSES);
  const classPrefixes = ["typstream-"];
  for (const plugin of options.plugins ?? []) {
    for (const tag of plugin.sanitize?.allowTags ?? []) extraTags.add(tag.toLowerCase());
    for (const name of plugin.sanitize?.allowClasses ?? [])
      if (name.endsWith("*")) classPrefixes.push(name.slice(0, -1));
      else classes.add(name);
    for (const [tag, attrs] of Object.entries(plugin.sanitize?.allowAttrs ?? {})) {
      const key = tag.toLowerCase();
      const allowed = extraAttrs.get(key) ?? new Set<string>();
      for (const attr of attrs) if (!DENY_ATTRS.test(attr)) allowed.add(attr.toLowerCase());
      extraAttrs.set(key, allowed);
    }
  }

  /** `keep`, `unwrap` (keep the content) or `remove` (with the content). */
  const verdict = (el: Element): "keep" | "unwrap" | "remove" => {
    const name = el.localName;
    const ns = el.namespaceURI;
    // SVG's <title> is an accessible name, not the page's.
    if (REMOVE.has(name) && !(ns === SVG_NS && name === "title")) return "remove";
    if (ns === HTML_NS) return HTML_TAGS.has(name) || extraTags.has(name) ? "keep" : "unwrap";
    if (ns === SVG_NS) return SVG_TAGS.has(name) || extraTags.has(name.toLowerCase()) ? "keep" : "unwrap";
    if (ns === MATHML_NS) return MATHML_TAGS.has(name) || extraTags.has(name) ? "keep" : "unwrap";
    return "remove";
  };

  const allowed = (el: Element, attr: string): boolean => {
    if (DENY_ATTRS.test(attr)) return false;
    if (GLOBAL_ATTRS.has(attr) || attr.startsWith("aria-")) return true;
    const ns = el.namespaceURI;
    const tag = el.localName;
    if (ns === SVG_NS) return SVG_ATTRS.has(attr);
    if (ns === MATHML_NS) return MATHML_ATTRS.has(attr);
    // `"*"` is every HTML element (SVG and MathML keep their lists above), but never a URL attribute.
    return !!(
      HTML_TAGS.get(tag)?.has(attr) ||
      extraAttrs.get(tag)?.has(attr) ||
      (!URL_ATTRS.has(attr) && extraAttrs.get("*")?.has(attr))
    );
  };

  /** A fragment link into this document, prefixed; `null` if `value` isn't one. */
  const fragment = (value: string): string | null => (value.startsWith("#") ? `#${idPrefix}${value.slice(1)}` : null);

  /** The value to keep for a URL attribute, or `null` to drop it. */
  const url = (el: Element, attr: string, raw: string): string | null => {
    const value = normalizeUrl(raw);
    const name = el.localName;
    if (attr === "src" || (el.namespaceURI === SVG_NS && name === "image")) return IMAGE.test(value) ? value : null;
    if (name === "a") {
      if (LINK.test(value)) return value;
      return fragment(value);
    }
    // `use`, gradients and patterns reference elements of the same frame.
    return fragment(value);
  };

  /** `url(#id)` references, prefixed; `null` if the value references anything else. */
  const urlRefs = (value: string): string | null => {
    let external = false;
    const out = value.replace(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi, (_, q: string, target: string) => {
      if (!target.startsWith("#")) external = true;
      return `url(${q}#${idPrefix}${target.slice(1)}${q})`;
    });
    return external || /url\(/i.test(out.replace(/url\(\s*['"]?#[^)]*\)/gi, "")) ? null : out;
  };

  const cleanStyle = (el: Element & ElementCSSInlineStyle): void => {
    const text = el.getAttribute("style") ?? "";
    if (!RISKY_CSS.test(text)) return;
    // The inert document parses it (CSSOM), shorthands into longhands, escapes resolved.
    const style = el.style;
    for (let i = style.length - 1; i >= 0; i--) {
      const property = style.item(i);
      const value = style.getPropertyValue(property);
      if (LOADING_CSS.test(value) || (property === "position" && /fixed/i.test(value))) {
        style.removeProperty(property);
      }
    }
    if (style.length === 0) el.removeAttribute("style");
  };

  const cleanAttributes = (el: Element): void => {
    // Through the CSSOM, which a CSP doesn't restrict; the attribute it writes is what cleanStyle checks.
    const css = el.getAttribute(STYLE_ATTR);
    if (css !== null) {
      el.removeAttribute(STYLE_ATTR);
      (el as Element & ElementCSSInlineStyle).style.cssText = css;
    }
    for (const { name: qualified, value } of Array.from(el.attributes)) {
      // HTML attribute names are lowercase already; SVG's are case-sensitive (viewBox).
      const attr = el.namespaceURI === SVG_NS ? qualified : qualified.toLowerCase();
      if (!allowed(el, attr)) {
        el.removeAttribute(qualified);
        continue;
      }
      let next: string | null = value;
      if (URL_ATTRS.has(attr)) next = url(el, attr, value);
      else if (attr === "id") next = idPrefix + value;
      else if (attr === "class")
        next =
          value
            .split(/\s+/)
            .filter((name) => classes.has(name) || classPrefixes.some((prefix) => name.startsWith(prefix)))
            .join(" ") || null;
      else if (IDREFS.has(attr))
        next = value
          .split(/\s+/)
          .filter(Boolean)
          .map((id) => idPrefix + id)
          .join(" ");
      else if (URL_REF_ATTRS.has(attr) && /url\(/i.test(value)) next = urlRefs(value);
      if (next === null) el.removeAttribute(qualified);
      else if (next !== value) el.setAttribute(qualified, next);
    }
    if (el.hasAttribute("style")) cleanStyle(el as Element & ElementCSSInlineStyle);
    if (el.localName === "a" && el.namespaceURI === HTML_NS) {
      const href = el.getAttribute("href");
      if (href && EXTERNAL.test(href)) {
        el.setAttribute("rel", "noopener noreferrer");
        if (linkTarget) el.setAttribute("target", linkTarget);
      }
    }
  };

  return (root) => {
    let node: Node | null = root.firstChild;
    while (node) {
      if (node.nodeType === TEXT) {
        node = after(node, root);
        continue;
      }
      if (node.nodeType !== ELEMENT) {
        // Comments, processing instructions.
        const next = after(node, root);
        node.parentNode?.removeChild(node);
        node = next;
        continue;
      }
      let el = node as Element;
      const action = verdict(el);
      if (action === "keep" && el.hasAttribute("is")) {
        // Removing `is` leaves the element's "is value", which would upgrade it
        // to a customized built-in the page defines. A fresh element has none.
        const fresh = el.ownerDocument.createElementNS(el.namespaceURI, el.localName);
        for (const { name, value } of Array.from(el.attributes)) if (name !== "is") fresh.setAttribute(name, value);
        fresh.append(...Array.from(el.childNodes));
        el.replaceWith(fresh);
        el = fresh;
      }
      if (action === "keep") {
        cleanAttributes(el);
        node = el.firstChild ?? after(el, root);
      } else if (action === "remove") {
        const next = after(el, root);
        el.remove();
        node = next;
      } else {
        // Unwrap: its children take its place and are checked next.
        const first = el.firstChild;
        const next = after(el, root);
        el.replaceWith(...Array.from(el.childNodes));
        node = first ?? next;
      }
    }
  };
};
