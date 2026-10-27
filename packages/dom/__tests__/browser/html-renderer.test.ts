/// <reference lib="dom" />
// The HTML renderer on hand-written Typst-shaped HTML: block identity, source
// anchors, word fade-in, the caret, wrappers, styles and theme.

import { afterEach, describe, expect, it } from "vitest";
import { registerMathFont } from "../../src/html/fonts";
import { createHtmlRenderer, type HtmlRenderer, type HtmlRendererOptions } from "../../src/html/renderer";
import { htmlRendererCss } from "../../src/html/styles";

const anchor = (n: number) => `<typstream-anchor data-src="${n}"></typstream-anchor>`;
const doc = (body: string) => `<!DOCTYPE html><html><head></head><body>${body}</body></html>`;

const mounted: HtmlRenderer[] = [];
const mount = (options: HtmlRendererOptions = {}): HtmlRenderer => {
  const root = document.createElement("div");
  document.body.append(root);
  const renderer = createHtmlRenderer(root, options);
  mounted.push(renderer);
  return renderer;
};
afterEach(() => {
  for (const r of mounted.splice(0)) {
    r.dispose();
    r.root.remove();
  }
});

const children = (r: HtmlRenderer) => Array.from(r.root.children);

describe("blocks", () => {
  it("keeps unchanged blocks and replaces changed ones", () => {
    const r = mount();
    r.update(doc("<h2>T</h2><p>one</p><p>two</p>"));
    const [h, p1, p2] = children(r);
    const result = r.update(doc("<h2>T</h2><p>one</p><p>two and</p><p>three</p>"));
    expect(result).toMatchObject({ blocks: 4, created: 2, removed: 1 });
    const after = children(r);
    expect(after[0]).toBe(h);
    expect(after[1]).toBe(p1);
    expect(after[2]).not.toBe(p2);
    expect(r.root.textContent).toBe("Tonetwo andthree");
  });

  it("keeps blocks across insertions, deletions, moves and duplicates", () => {
    const r = mount();
    r.update(doc("<p>a</p><hr><p>b</p><hr><p>c</p>"));
    const [a, hr1, b, hr2, c] = children(r);
    r.update(doc("<p>new</p><p>a</p><hr><p>c</p><hr><p>b</p>"));
    const after = children(r);
    expect(after.map((e) => e.textContent)).toEqual(["new", "a", "", "c", "", "b"]);
    expect(after[1]).toBe(a);
    expect([hr1, hr2]).toContain(after[2]);
    expect([hr1, hr2]).toContain(after[4]);
    expect(after[3]).toBe(c);
    expect(after[5]).toBe(b);
  });

  it("renders a document that doesn't split as one block", () => {
    const r = mount();
    r.update(doc("<p>a</p><div><p>b</p>"));
    expect(r.root.innerHTML).toBe("<p>a</p><div><p>b</p></div>");
  });

  it("clears and starts over", () => {
    const r = mount();
    r.update(doc("<p>a</p>"));
    r.clear();
    expect(r.root.innerHTML).toBe("");
    r.update(doc("<p>b</p>"));
    expect(r.root.innerHTML).toBe("<p>b</p>");
  });

  it("splits inside a template's wrapper and rebuilds it when it changes", () => {
    const r = mount({ plugins: [{ key: "t", sanitize: { allowClasses: ["tpl", "other"] } }] });
    r.update(doc(`${anchor(0)}<div class="tpl">${anchor(10)}<p>a</p><p>b</p></div>`));
    const wrapper = r.root.firstElementChild as Element;
    expect(wrapper.className).toBe("tpl");
    const [a] = Array.from(wrapper.children);
    r.update(doc(`${anchor(0)}<div class="tpl">${anchor(10)}<p>a</p><p>b</p><p>c</p></div>`));
    expect(r.root.firstElementChild).toBe(wrapper);
    expect(wrapper.firstElementChild).toBe(a);
    expect(wrapper.children).toHaveLength(3);
    r.update(doc(`<div class="other"><p>a</p><p>b</p></div>`));
    expect(r.root.innerHTML).toBe('<div class="other"><p>a</p><p>b</p></div>');
  });

  it("prefixes ids per renderer", () => {
    const html = doc(
      '<p>see <a href="#loc-1">note</a></p><section role="doc-endnotes"><ol><li id="loc-1">n</li></ol></section>',
    );
    const one = mount();
    const two = mount();
    one.update(html);
    two.update(html);
    const ids = [one, two].map((r) => r.root.querySelector("li")?.id);
    expect(ids[0]).not.toBe(ids[1]);
    expect(one.root.querySelector("a")?.getAttribute("href")).toBe(`#${ids[0]}`);
  });
});

describe("source anchors", () => {
  it("mark blocks with their source offset and resolve ranges", () => {
    const r = mount();
    const notes = '<section role="doc-endnotes"><ol><li>n</li></ol></section>';
    r.update(doc(`<p>pre</p>${anchor(0)}<h2>T</h2>${anchor(5)}<p>a</p><p>b</p>${anchor(12)}<p>c</p>${notes}`));
    const [pre, h, a, b, c, n] = children(r);
    expect(children(r).map((e) => e.getAttribute("data-typstream-src"))).toEqual([null, "0", "5", "5", "12", null]);
    expect(r.sourceRange(pre as Element)).toBeNull();
    expect(r.sourceRange(h as Element)).toEqual({ from: 0, to: 5 });
    expect(r.sourceRange((a as Element).firstChild as Node)).toEqual({ from: 5, to: 12 });
    expect(r.sourceRange(b as Element)).toEqual({ from: 5, to: 12 });
    expect(r.sourceRange(c as Element)).toEqual({ from: 12, to: null });
    expect(r.sourceRange(n as Element)).toBeNull();
    expect(r.sourceRange(document.body)).toBeNull();
    expect(r.blockAt(0)).toBe(h);
    expect(r.blockAt(7)).toBe(a);
    expect(r.blockAt(500)).toBe(c);
  });

  it("move without re-creating the block when only offsets change", () => {
    const r = mount();
    r.update(doc(`${anchor(0)}<p>a</p>${anchor(5)}<p>b</p>`));
    const [, b] = children(r);
    // An edit above `b` shifts its source but not its HTML.
    r.update(doc(`${anchor(0)}<p>a2</p>${anchor(6)}<p>b</p>`));
    expect(children(r)[1]).toBe(b);
    expect((b as Element).getAttribute("data-typstream-src")).toBe("6");
  });
});

const animated = (r: HtmlRenderer) =>
  Array.from(r.root.querySelectorAll("[data-typstream-animate]")).map((el) => [
    el.textContent,
    Number.parseFloat((el as HTMLElement).style.getPropertyValue("--typstream-delay")),
  ]);

describe("word fade-in", () => {
  it("animates new words only, in a cascade", () => {
    const r = mount({ animation: { stagger: 10 } });
    r.update(doc("<p>one two</p>"));
    const p0 = children(r)[0];
    r.update(doc("<p>one two</p><p>three four five</p>"), { animate: true });
    expect(children(r)[0]).toBe(p0);
    expect((p0 as Element).querySelector("[data-typstream-animate]")).toBeNull();
    const words = animated(r);
    expect(words.map(([w]) => w)).toEqual(["three ", "four ", "five"]);
    const delays = words.map(([, d]) => d as number);
    expect(delays[1]).toBeGreaterThan(delays[0] as number);
    expect(delays[2]).toBeGreaterThan(delays[1] as number);
  });

  it("doesn't animate text that was shown before the block changed", () => {
    const r = mount({ animation: { duration: 0 } });
    r.update(doc("<p>shown already</p>"));
    r.update(doc("<p>shown already and new</p>"), { animate: true });
    expect(animated(r).map(([w]) => w)).toEqual(["and ", "new"]);
    expect(r.root.textContent).toBe("shown already and new");
  });

  it("continues words still fading in when their block is re-created", () => {
    const r = mount({ animation: { duration: 10_000, stagger: 0 } });
    r.update(doc("<p>a</p>"), { animate: true });
    r.update(doc("<p>a b</p>"), { animate: true });
    const words = animated(r);
    expect(words.map(([w]) => w)).toEqual(["a ", "b"]);
    // `a` started before `b`: its delay is earlier (negative once time has passed).
    expect(words[0]?.[1] as number).toBeLessThanOrEqual(words[1]?.[1] as number);
  });

  it("fades math, images and list markers in as units, and leaves code alone", () => {
    const r = mount();
    r.update(doc("<ul><li>old</li></ul>"));
    r.update(
      doc("<ul><li>old</li><li>new</li></ul><p>x <math><mi>y</mi></math></p><pre><code>code here</code></pre>"),
      { animate: true },
    );
    const lis = r.root.querySelectorAll("li");
    expect(lis[0]?.hasAttribute("data-typstream-animate-marker")).toBe(false);
    expect(lis[1]?.hasAttribute("data-typstream-animate-marker")).toBe(true);
    expect(r.root.querySelector("math")?.hasAttribute("data-typstream-animate")).toBe(true);
    expect(r.root.querySelector("mi")?.hasAttribute("data-typstream-animate")).toBe(false);
    expect(r.root.querySelector("pre [data-typstream-animate]")).toBeNull();
  });

  it("plays your own keyframes, named typstream-<animation>", () => {
    // `animation: "pop"` plays `typstream-pop`, as AnimateOptions.animation says; a bare `pop` isn't used.
    const r = mount({
      animation: { animation: "pop", duration: 10_000 },
      stylesheets: ["@keyframes typstream-pop { from { opacity: 0 } }", "@keyframes pop { from { opacity: 0 } }"],
    });
    r.update(doc("<p>one two</p>"), { animate: true });
    const word = r.root.querySelector("[data-typstream-animate]") as HTMLElement;
    const names = word.getAnimations().map((a) => (a as CSSAnimation).animationName);
    expect(names).toEqual(["typstream-pop"]);
    expect(Number.parseFloat(getComputedStyle(word).opacity)).toBeLessThan(1);
  });

  it("splits CJK text into characters", () => {
    const r = mount();
    r.update(doc("<p>汉字 ok</p>"), { animate: true });
    expect(animated(r).map(([w]) => w)).toEqual(["汉", "字 ", "ok"]);
  });

  it("compresses the stagger of a large batch into the backlog budget", () => {
    const r = mount({ animation: { stagger: 40, maxBacklogMs: 100 } });
    const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
    r.update(doc(`<p>${words(20)}</p>`), { animate: true });
    let delays = animated(r).map(([, d]) => d as number);
    expect(delays).toHaveLength(20);
    expect(Math.max(...delays)).toBeLessThanOrEqual(101);
    // Never below a 4 ms step, even past the budget.
    r.clear();
    r.update(doc(`<p>${words(50)}</p>`), { animate: true });
    delays = animated(r).map(([, d]) => d as number);
    expect((delays[49] as number) - (delays[48] as number)).toBeGreaterThanOrEqual(3);
  });
});

describe("caret", () => {
  const caretParent = (r: HtmlRenderer) => r.root.querySelector(".typstream-caret")?.parentElement?.localName;

  it("follows the last text and moves with each update", () => {
    const r = mount();
    r.update(doc("<p>a</p>"), { caret: true });
    expect(r.root.querySelectorAll(".typstream-caret")).toHaveLength(1);
    expect(caretParent(r)).toBe("p");
    r.update(doc("<p>a</p><ul><li>x</li><li>y <strong>z</strong></li></ul>"), { caret: true });
    expect(r.root.querySelectorAll(".typstream-caret")).toHaveLength(1);
    expect(caretParent(r)).toBe("strong");
    r.update(doc("<table><tbody><tr><td>1</td><td>2</td></tr></tbody></table>"), { caret: true });
    expect(r.root.querySelector(".typstream-caret")?.parentElement?.textContent).toBe("2");
    r.update(doc("<p>x <math><mi>y</mi></math></p>"), { caret: true });
    expect(caretParent(r)).toBe("p");
    r.update(doc('<p>t</p><section role="doc-endnotes"><ol><li>n</li></ol></section>'), { caret: true });
    expect(caretParent(r)).toBe("p");
    r.update(doc("<p>t</p>"));
    expect(r.root.querySelector(".typstream-caret")).toBeNull();
  });

  it("is hidden from assistive technology", () => {
    const r = mount();
    r.update(doc("<p>a</p>"), { caret: true });
    expect(r.root.querySelector(".typstream-caret")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("styles and theme", () => {
  it("injects its stylesheet once per document, and extra stylesheets", () => {
    const count = () => document.adoptedStyleSheets.length;
    mount();
    const before = count();
    mount({ stylesheets: [".typstream p { color: red }"] });
    expect(count()).toBe(before + 1);
    const css = document.adoptedStyleSheets.flatMap((s) => Array.from(s.cssRules).map((r) => r.cssText)).join("\n");
    expect(css).toContain("typstream-fadeIn");
    expect(css).toContain(".typstream p");
    mount({ stylesheets: [".typstream p { color: red }"] });
    expect(count()).toBe(before + 1);
  });

  it("injects into a shadow root", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const root = document.createElement("div");
    shadow.append(root);
    const r = createHtmlRenderer(root);
    expect(shadow.adoptedStyleSheets.length).toBe(1);
    r.dispose();
    host.remove();
  });

  it("sets the theme and animation variables, and removes them on dispose", () => {
    const r = mount({ theme: "dark", animation: { duration: 99 } });
    expect(r.root.classList.contains("typstream")).toBe(true);
    expect(r.root.getAttribute("data-typstream-theme")).toBe("dark");
    expect(r.root.style.getPropertyValue("--typstream-duration")).toBe("99ms");
    expect(getComputedStyle(r.root).colorScheme).toBe("dark");
    r.update(doc("<p>a</p>"));
    r.dispose();
    expect(r.root.innerHTML).toBe("");
    expect(r.root.classList.contains("typstream")).toBe(false);
    expect(r.root.getAttribute("style")).toBeFalsy();
  });

  it("keeps the document inside its element, whatever the page's CSS", () => {
    // Utility classes as Tailwind writes them, and a page rule on an element a document can write.
    const page = document.createElement("style");
    page.textContent =
      ".fixed{position:fixed}.inset-0{inset:0}.z-50{z-index:50} header{position:fixed;inset:0;z-index:50}" +
      " .typstream *{pointer-events:auto !important}";
    document.head.append(page);
    const r = mount();
    r.root.style.cssText += "width: 200px; margin: 100px";
    r.update(
      doc(
        '<p>text</p><div class="fixed inset-0 z-50">a</div><header>b</header>' +
          '<div style="position: absolute; inset: -100vh -100vw; z-index: 2147483647">c</div>' +
          '<div style="position: relative; left: -50vw; width: 300vw; height: 300vh">d</div>' +
          '<div style="margin: -500px; width: 2000px; height: 2000px; pointer-events: none">e</div>' +
          '<div style="transform: scale(100)">f</div>',
      ),
    );
    try {
      expect(r.root.querySelector(".fixed")).toBeNull();
      const box = r.root.getBoundingClientRect();
      const escaped: string[] = [];
      for (let x = 2; x < innerWidth; x += 10)
        for (let y = 2; y < innerHeight; y += 10) {
          if (x >= box.left - 1 && x <= box.right + 1 && y >= box.top - 1 && y <= box.bottom + 1) continue;
          const hit = document.elementFromPoint(x, y);
          if (hit && r.root.contains(hit)) escaped.push(`${x},${y} ${hit.textContent}`);
        }
      expect(escaped.slice(0, 5)).toEqual([]);
      // Inside, the document is still there.
      expect(r.root.contains(document.elementFromPoint(box.left + 5, box.top + 5))).toBe(true);
      // Nothing it overflows with makes the page scroll.
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
    } finally {
      page.remove();
    }
  });

  it("has Typst's MathML rules", () => {
    expect(htmlRendererCss).toContain(":where(.typstream) mtable.cases mtd");
  });

  it("registers the math font", async () => {
    await registerMathFont(new URL("../../../engine-wasm/dist/fonts/NewCMMath-Regular.otf", import.meta.url));
    expect(document.fonts.check('12px "New Computer Modern Math"')).toBe(true);
  });
});
