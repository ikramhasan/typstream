/// <reference lib="dom" />
// The sanitizer against hostile markup (PLAN §9, §11.7): what `html.elem` lets a
// document write, plus the classic XSS vectors. Nothing may run, load or navigate
// to another scheme; Typst's own output (MathML, frame SVG, html-compat) survives.

import { describe, expect, it } from "vitest";
import { createHtmlRenderer } from "../../src/html/renderer";
import { createSanitizer } from "../../src/html/sanitize";

declare global {
  interface Window {
    pwned?: string;
  }
}

const clean = (html: string, linkTarget?: string | null): HTMLElement => {
  const doc = document.implementation.createHTMLDocument("");
  const template = doc.createElement("template");
  template.innerHTML = html;
  createSanitizer({ idPrefix: "p-", ...(linkTarget === undefined ? {} : { linkTarget }) })(template.content);
  const div = document.createElement("div");
  div.append(...Array.from(template.content.childNodes));
  return div;
};

const out = (html: string) => clean(html).innerHTML;

describe("sanitizer", () => {
  it("removes scripts, styles, frames, objects and forms with their content", () => {
    for (const tag of ["script", "style", "iframe", "object", "noscript", "textarea", "title", "template"]) {
      expect(out(`<p>a</p><${tag}>x</${tag}><p>b</p>`), tag).toBe("<p>a</p><p>b</p>");
    }
    expect(out('<form action="https://x"><input name="a"><button>go</button></form>')).toBe("");
    expect(
      out(
        '<meta http-equiv="refresh" content="0;url=https://x"><base href="https://x"><link rel="stylesheet" href="https://x">',
      ),
    ).toBe("");
    expect(out('<iframe srcdoc="<script>x</script>"></iframe><embed src="https://x/a.swf">')).toBe("");
  });

  it("removes event handlers and attributes that load or act", () => {
    // `is` would upgrade the element to a customized built-in the page defines.
    expect(clean('<p is="x-y">a</p>').querySelector("p")?.outerHTML).toBe("<p>a</p>");
    expect(out('<p onclick="x" onmouseover="y" data-bs-toggle="modal" name="config" is="x-y">a</p>')).toBe("<p>a</p>");
    expect(out('<img src="data:image/png;base64,AA" onerror="x" srcset="https://x 2x" loading="lazy">')).toBe(
      '<img src="data:image/png;base64,AA">',
    );
    expect(out('<details open ontoggle="x"><summary>s</summary>d</details>')).toBe(
      '<details open=""><summary>s</summary>d</details>',
    );
  });

  it("allows only http(s), mailto and in-document links", () => {
    const hrefs = [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      " javascript:alert(1)",
      "java\tscript:alert(1)",
      "\u0001javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:x",
      "relative/path",
      "//evil.example",
    ];
    for (const href of hrefs) {
      const a = clean(`<a href="${href.replace(/"/g, "&quot;")}">x</a>`).querySelector("a");
      expect(a?.hasAttribute("href"), JSON.stringify(href)).toBe(false);
    }
    expect(out('<a href="&#106;avascript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(out('<a href="https://example.com">x</a>')).toBe(
      '<a href="https://example.com" rel="noopener noreferrer" target="_blank">x</a>',
    );
    expect(clean('<a href="https://example.com">x</a>', null).innerHTML).toBe(
      '<a href="https://example.com" rel="noopener noreferrer">x</a>',
    );
    expect(out('<a href="mailto:t@example.com">x</a>')).toBe('<a href="mailto:t@example.com">x</a>');
  });

  it("allows only embedded images", () => {
    expect(out('<img src="https://tracker.example/p.gif">')).toBe("<img>");
    expect(out('<img src="data:text/html;base64,AA">')).toBe("<img>");
    expect(out('<img src="data:image/svg+xml;base64,AA">')).toBe('<img src="data:image/svg+xml;base64,AA">');
    expect(out('<img src="blob:https://x/1">')).toBe('<img src="blob:https://x/1">');
  });

  it("drops CSS that loads or escapes the document", () => {
    const p = clean(
      '<p style="color: red; background: url(https://x/a.png) red; position: fixed; inset: 0; z-index: 9">a</p>',
    ).querySelector("p") as HTMLElement;
    expect(p.style.color).toBe("red");
    expect(p.style.backgroundImage).toBe("");
    expect(p.style.backgroundColor).toBe("red");
    expect(p.style.position).toBe("");
    expect(p.getAttribute("style")).not.toMatch(/url|fixed/);
    // CSS escapes are resolved before the check.
    expect(out('<p style="background-image: u\\72l(https://x)">a</p>')).toBe("<p>a</p>");
    expect(out('<span style="display: grid; grid-template-columns: 1fr 2fr">a</span>')).toBe(
      '<span style="display: grid; grid-template-columns: 1fr 2fr">a</span>',
    );
  });

  it("unwraps unknown elements, keeping their text", () => {
    expect(out("<x-widget><b>bold</b> text</x-widget>")).toBe("<b>bold</b> text");
    expect(out('<p>a<typstream-anchor data-src="3"></typstream-anchor>b</p>')).toBe("<p>ab</p>");
    expect(out("<p>a<!-- comment -->b</p>")).toBe("<p>ab</p>");
  });

  it("keeps MathML but not its links or HTML annotations", () => {
    const math =
      '<math display="block"><mrow><msup><mi>x</mi><mn>2</mn></msup><mo stretchy="false">(</mo><mfrac><mn>1</mn><mn>2</mn></mfrac></mrow></math>';
    expect(out(math)).toBe(math);
    expect(out('<math><mi href="javascript:x">x</mi></math>')).toBe("<math><mi>x</mi></math>");
    expect(
      out(
        '<math><semantics><mi>x</mi><annotation-xml encoding="text/html"><img src="x" onerror="y"></annotation-xml></semantics></math>',
      ),
    ).toBe("<math><semantics><mi>x</mi></semantics></math>");
    expect(out('<math><mtext><img src="x" onerror="y"></mtext></math>')).toBe("<math><mtext><img></mtext></math>");
  });

  it("keeps frame SVG, prefixing its ids and references, and drops its active parts", () => {
    const svg =
      '<svg viewBox="0 0 10 10" width="10pt" height="10pt" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
      '<defs><symbol id="g1"><path d="M 0 0 L 1 1"/></symbol><clipPath id="c1"><rect width="5" height="5"/></clipPath></defs>' +
      '<g clip-path="url(#c1)"><use xlink:href="#g1" fill="#000"/></g></svg>';
    const el = clean(svg).querySelector("svg") as SVGSVGElement;
    expect(el.querySelector("symbol")?.id).toBe("p-g1");
    expect(el.querySelector("clipPath")?.id).toBe("p-c1");
    expect(el.querySelector("g")?.getAttribute("clip-path")).toBe("url(#p-c1)");
    expect(el.querySelector("use")?.getAttribute("xlink:href")).toBe("#p-g1");
    expect(el.getAttribute("viewBox")).toBe("0 0 10 10");

    expect(out("<svg><foreignObject><p>x</p></foreignObject><script>x</script><style>*{}</style></svg>")).toBe(
      "<svg></svg>",
    );
    expect(out('<svg><a xlink:href="javascript:alert(1)"><rect width="1"/></a></svg>')).toBe(
      '<svg><a><rect width="1"></rect></a></svg>',
    );
    expect(
      out(
        '<svg><a href="#x"><animate attributeName="href" values="javascript:alert(1)"/><set attributeName="href" to="javascript:x"/></a></svg>',
      ),
    ).toBe('<svg><a href="#p-x"></a></svg>');
    expect(
      out('<svg><use href="https://x/sprite.svg#a"/><image href="https://x/a.png"/><g fill="url(https://x#a)"/></svg>'),
    ).toBe("<svg><use></use><image></image><g></g></svg>");
    expect(out("<svg><title>A triangle</title></svg>")).toBe("<svg><title>A triangle</title></svg>");
  });

  it("prefixes ids and the links, id lists and labels that point at them", () => {
    expect(out('<p id="config">a</p><a href="#config">to</a><span aria-labelledby="l1">x</span>')).toBe(
      '<p id="p-config">a</p><a href="#p-config">to</a><span aria-labelledby="p-l1">x</span>',
    );
    expect(out('<table><tbody><tr><th id="h1">h</th><td headers="h1 h2">d</td></tr></tbody></table>')).toBe(
      '<table><tbody><tr><th id="p-h1">h</th><td headers="p-h1 p-h2">d</td></tr></tbody></table>',
    );
  });

  it("keeps html-compat's markup", () => {
    const html =
      '<div class="ts-grid" style="display: grid; grid-template-columns: 1fr 1fr" role="group" aria-label="grid"><span class="ts-b">a</span></div>';
    expect(out(html)).toBe(html);
  });

  it("lets plugins allow more, but never handlers or scripts", () => {
    const sanitize = createSanitizer({
      idPrefix: "",
      plugins: [
        { key: "t", sanitize: { allowTags: ["x-card", "script"], allowAttrs: { "x-card": ["kind", "onclick"] } } },
      ],
    });
    const template = document.createElement("template");
    template.innerHTML = '<x-card kind="tip" onclick="x">a</x-card><script>x</script>';
    sanitize(template.content);
    expect(template.innerHTML).toBe('<x-card kind="tip">a</x-card>');
  });

  it("runs nothing when rendered", async () => {
    window.pwned = undefined;
    const root = document.createElement("div");
    document.body.append(root);
    const renderer = createHtmlRenderer(root);
    const payloads = [
      '<img src="x" onerror="window.pwned=\'img\'">',
      "<script>window.pwned='script'</script>",
      '<svg><image href="x" onerror="window.pwned=\'svg\'"/></svg>',
      "<svg onload=\"window.pwned='onload'\"></svg>",
      "<details open ontoggle=\"window.pwned='toggle'\"><summary>x</summary></details>",
      "<math><mtext><table><mglyph><style><img src=x onerror=\"window.pwned='mxss'\"></style></mglyph></table></mtext></math>",
      "<noscript><p title=\"</noscript><img src=x onerror=window.pwned='noscript'>\"></p></noscript>",
      '<a href="javascript:window.pwned=\'link\'" id="l">x</a>',
    ];
    renderer.update(`<html><head></head><body>${payloads.map((p) => `<div>${p}</div>`).join("")}</body></html>`);
    (root.querySelector("a") as HTMLAnchorElement | null)?.click();
    await new Promise((r) => setTimeout(r, 200));
    expect(window.pwned).toBeUndefined();
    expect(root.querySelector("[onerror], [onload], [ontoggle], script, style, noscript")).toBeNull();
    renderer.dispose();
    root.remove();
  });
});
