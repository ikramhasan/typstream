// Links in page SVGs (PLAN §9). typst-svg writes `link("…")` as
// `<a href="…" xlink:href="…">` around a transparent rect, with the URL exactly
// as the document wrote it, so `link("javascript:…")` arrives intact. Attribute
// values are XML-escaped (xmlwriter), so the URL is the only thing to check.
// Links to places in the document (`Destination::Location`) get no href in
// standalone page SVGs; they stay inert.

const XLINK = "http://www.w3.org/1999/xlink";

/** Schemes a page link may use; anything else loses its href. */
const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/**
 * Whether a link URL from a document may be followed: `http(s)` and `mailto`
 * only. Relative URLs are refused too: a page has no base the document controls.
 */
export const isSafeHref = (href: string): boolean => {
  // Browsers ignore leading control characters and spaces and tabs/newlines
  // anywhere in a URL (`java\tscript:`), so judge the URL as they would parse it.
  let url = "";
  for (const c of href) if (c > " ") url += c;
  const scheme = /^([a-z][a-z0-9+.-]*:)/i.exec(url)?.[1]?.toLowerCase();
  return scheme !== undefined && SAFE_SCHEMES.has(scheme);
};

/** Removes unsafe hrefs from a page's links and opens the rest in `target`. */
export const sanitizeLinks = (root: ParentNode, target: string | null): void => {
  for (const a of root.querySelectorAll("a")) {
    const href = a.getAttribute("href") ?? a.getAttributeNS(XLINK, "href") ?? "";
    if (!isSafeHref(href)) {
      a.removeAttribute("href");
      a.removeAttributeNS(XLINK, "href");
      continue;
    }
    if (target !== null) {
      a.setAttribute("target", target);
      a.setAttribute("rel", "noopener noreferrer");
    }
  }
  // typst-svg embeds images as data: URLs; nothing on a page may load from elsewhere.
  for (const image of root.querySelectorAll("image")) {
    const href = image.getAttribute("href") ?? image.getAttributeNS(XLINK, "href") ?? "";
    if (!href.startsWith("data:")) {
      image.removeAttribute("href");
      image.removeAttributeNS(XLINK, "href");
    }
  }
};
