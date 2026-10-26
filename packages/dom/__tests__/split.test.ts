// splitHtml on hand-written markup in typst-html's serialization. The browser
// tests check it against real engine output (html-render.test.ts).

import { describe, expect, it } from "vitest";
import { splitHtml } from "../src/html/split";

const anchor = (n: number) => `<typstream-anchor data-src="${n}"></typstream-anchor>`;
const doc = (body: string, head = "") =>
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;
const blocks = (html: string) => splitHtml(html).blocks.map((b) => [b.html, b.src]);

describe("splitHtml", () => {
  it("splits the body's children and reads anchors", () => {
    const html = doc(`${anchor(0)}<h2>Title</h2><p>One</p>${anchor(12)}<ul><li>a</li><li>b</li></ul>`);
    expect(blocks(html)).toEqual([
      ["<h2>Title</h2>", 0],
      ["<p>One</p>", 0],
      ["<ul><li>a</li><li>b</li></ul>", 12],
    ]);
    expect(splitHtml(html).shell).toBe("");
  });

  it("gives blocks before the first anchor and footnotes no source", () => {
    const notes = '<section role="doc-endnotes"><ol><li id="loc-2">x</li></ol></section>';
    expect(blocks(doc(`<p>a</p>${anchor(3)}<p>b<sup><a href="#loc-2">1</a></sup></p>${notes}`))).toEqual([
      ["<p>a</p>", null],
      ['<p>b<sup><a href="#loc-2">1</a></sup></p>', 3],
      [notes, null],
    ]);
  });

  it("ignores the head, including its style", () => {
    expect(blocks(doc("<p>x</p>", "<style>p > b { color: red }</style>"))).toEqual([["<p>x</p>", null]]);
  });

  it("splits fragments without a body", () => {
    expect(blocks("<p>a</p><p>b</p>")).toEqual([
      ["<p>a</p>", null],
      ["<p>b</p>", null],
    ]);
  });

  it("handles void elements, foreign self-closing tags and quoted >", () => {
    const math = '<math><mi>x</mi><mspace width="1em"/><mn>2</mn></math>';
    const svg = '<svg viewBox="0 0 1 1"><path d="M 0 0 L 1 1"/><g transform="x>y"><use xlink:href="#g1"/></g></svg>';
    expect(blocks(doc(`<p>a<br>b<img src="data:image/png;base64,AA" alt="x>y"></p><hr>${math}${svg}`))).toEqual([
      ['<p>a<br>b<img src="data:image/png;base64,AA" alt="x>y"></p>', null],
      ["<hr>", null],
      [math, null],
      [svg, null],
    ]);
  });

  it("skips raw text, which may contain markup", () => {
    const script = "<script>if (a < b) document.write('<p>')</script>";
    expect(blocks(doc(`<div>${script}</div><p>after</p>`))).toEqual([
      [`<div>${script}</div>`, null],
      ["<p>after</p>", null],
    ]);
  });

  it("descends into a wrapper around the whole document", () => {
    const html = doc(`${anchor(0)}<div class="tpl">${anchor(30)}<h2>A</h2><p>b</p>${anchor(40)}<p>c</p></div>`);
    const split = splitHtml(html);
    expect(split.shell).toBe('<div class="tpl"></div>');
    expect(split.shellStart).toEqual(['<div class="tpl">']);
    expect(split.shellEnd).toEqual(["</div>"]);
    expect(blocks(html)).toEqual([
      ["<h2>A</h2>", 30],
      ["<p>b</p>", 30],
      ["<p>c</p>", 40],
    ]);
  });

  it("keeps the anchor before a wrapper for its first block", () => {
    expect(blocks(doc(`${anchor(5)}<main><p>a</p><p>b</p></main>`))).toEqual([
      ["<p>a</p>", 5],
      ["<p>b</p>", 5],
    ]);
  });

  it("doesn't descend into other single blocks", () => {
    expect(blocks(doc("<ul><li>a</li><li>b</li></ul>"))).toEqual([["<ul><li>a</li><li>b</li></ul>", null]]);
  });

  it("leaves anchors inside blocks to the block (a document can write its own)", () => {
    const p = `<p>x${anchor(9)}y</p>`;
    expect(blocks(doc(`${anchor(1)}${p}`))).toEqual([[p, 1]]);
  });

  it("falls back to one block for unbalanced markup", () => {
    expect(blocks(doc("<p>a</p><div><p>b</p>"))).toEqual([["<p>a</p><div><p>b</p>", null]]);
    expect(blocks(doc("<p>a</p></div><p>b</p>"))).toEqual([["<p>a</p></div><p>b</p>", null]]);
  });

  it("keeps text at the top level as a block", () => {
    expect(blocks(doc("text<p>p</p>"))).toEqual([
      ["text", null],
      ["<p>p</p>", null],
    ]);
  });
});

describe("splitHtml from a previous split", () => {
  const same = (html: string, previous: string) => {
    const resumed = splitHtml(html, splitHtml(previous));
    const fresh = splitHtml(html);
    expect(resumed.blocks).toEqual(fresh.blocks);
    expect(resumed.shell).toBe(fresh.shell);
    return resumed;
  };

  it("keeps the blocks before the change and agrees with a full split", () => {
    const before = doc(`${anchor(0)}<h2>T</h2><p>a</p>${anchor(9)}<p>b</p>`);
    const after = doc(`${anchor(0)}<h2>T</h2><p>a</p>${anchor(9)}<p>b c</p>${anchor(20)}<p>d</p>`, "<style>x</style>");
    const previous = splitHtml(before);
    const resumed = splitHtml(after, previous);
    expect(resumed.blocks[0]).toBe(previous.blocks[0]);
    expect(resumed.blocks[1]).toBe(previous.blocks[1]);
    same(after, before);
  });

  it("agrees with a full split when anchors, wrappers or text change", () => {
    same(doc(`${anchor(0)}<p>a</p>${anchor(5)}<p>b</p>`), doc(`${anchor(0)}<p>a</p><p>b</p>`));
    same(doc(`<p>a</p>text and more<p>b</p>`), doc(`<p>a</p>text`));
    const wrapped = (inner: string) => doc(`${anchor(0)}<div class="tpl">${inner}</div>`);
    same(wrapped(`<p>a</p>${anchor(4)}<p>b</p><p>c</p>`), wrapped(`<p>a</p>${anchor(4)}<p>b</p>`));
    same(wrapped("<p>a</p><p>b</p>"), doc("<p>a</p><p>b</p>"));
    same(doc("<p>a</p><p>b</p>"), wrapped("<p>a</p><p>b</p>"));
    same(doc('<div class="x"><p>a</p><p>b</p></div>'), doc('<div class="x"><p>a</p></div>'));
    same(doc("<p>a</p><div><p>b</p>"), doc("<p>a</p>"));
  });
});
