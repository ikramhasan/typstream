// standaloneHtml as a string transform. Opening its files in browsers (styles
// apply, scripts don't run) is in browser/standalone.test.ts.
import { describe, expect, it } from "vitest";
import { standaloneHtml } from "../src/export/standalone";

// What typst-html 0.15.1 writes, minus its MathML <style>.
const TYPST =
  '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><h2>Title</h2><p>Hi</p></body></html>';

const csp = (html: string): string =>
  /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html)?.[1] ?? "";

describe("standaloneHtml", () => {
  it("puts a Content-Security-Policy first in <head>, then the CSS last", () => {
    const out = standaloneHtml(TYPST, { stylesheets: [".x { color: red }"] });
    expect(out).toMatch(/^<!DOCTYPE html><html lang="en"><head>\n<meta http-equiv="Content-Security-Policy"/);
    expect(csp(out).split("; ")).toEqual([
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      "img-src data:",
      "font-src data:",
      "base-uri 'none'",
      "form-action 'none'",
    ]);
    const style = /<style>\n([\s\S]*)<\/style>\n<\/head>/.exec(out)?.[1] ?? "";
    expect(style).toContain("--typstream-foreground");
    expect(style.trimEnd().endsWith(".x { color: red }")).toBe(true);
    // The document is otherwise untouched.
    expect(out).toContain("<h2>Title</h2><p>Hi</p></body></html>");
  });

  it("adds plugins' stylesheets after the theme, in the order given, then its own, each once", () => {
    const compat = { key: "compat", stylesheets: [".compat {}"] };
    const edu = { key: "edu", dependencies: ["compat"], stylesheets: [".edu {}"] };
    const out = standaloneHtml(TYPST, { plugins: [compat, edu], stylesheets: [".app {}", ".edu {}"] });
    const style = /<style>\n([\s\S]*)<\/style>/.exec(out)?.[1] ?? "";
    const at = (css: string) => style.indexOf(css);
    expect(at("--typstream-foreground")).toBeLessThan(at(".compat {}"));
    expect(at(".compat {}")).toBeLessThan(at(".edu {}"));
    expect(at(".edu {}")).toBeLessThan(at(".app {}"));
    expect(style.split(".edu {}")).toHaveLength(2);
  });

  it("puts the root class and theme on <body>, keeping its own class", () => {
    expect(standaloneHtml(TYPST)).toContain('<body class="typstream" data-typstream-theme="light">');
    expect(standaloneHtml(TYPST, { theme: "dark" })).toContain('data-typstream-theme="dark"');
    const auto = standaloneHtml(TYPST.replace("<body>", '<body class="doc">'), { theme: "auto" });
    expect(auto).toContain('<body class="doc typstream">');
    expect(auto).toContain('<meta name="color-scheme" content="light dark">');
  });

  it("adds a title only when the document has none", () => {
    expect(standaloneHtml(TYPST, { title: "Fractions <1>" })).toContain("<title>Fractions &lt;1&gt;</title>");
    const titled = TYPST.replace("</head>", "<title>Own</title></head>");
    expect(standaloneHtml(titled, { title: "Other" })).not.toContain("Other");
  });

  it("embeds a math font, or allows the origin of a linked one", () => {
    const embedded = standaloneHtml(TYPST, { mathFont: new Uint8Array([79, 84, 84, 79]) });
    expect(embedded).toContain('font-family: "New Computer Modern Math";\n  src: url("data:font/otf;base64,T1RUTw==")');
    expect(csp(embedded)).toContain("font-src data:;");
    const linked = standaloneHtml(TYPST, { mathFont: "https://cdn.example.com/fonts/NewCMMath.otf" });
    expect(linked).toContain('src: url("https://cdn.example.com/fonts/NewCMMath.otf")');
    expect(csp(linked)).toContain("font-src data: https://cdn.example.com;");
    expect(() => standaloneHtml(TYPST, { mathFont: "fonts/NewCMMath.otf" })).toThrow();
  });

  it("removes refresh redirects and keeps stylesheets from closing <style>", () => {
    const html = TYPST.replace(
      "<p>Hi</p>",
      '<p>Hi</p><meta http-equiv="refresh" content="0; url=https://evil.example">',
    );
    const out = standaloneHtml(html, { stylesheets: ["/* </style><script>alert(1)</script> */"] });
    expect(out).not.toContain("refresh");
    expect(out).not.toContain("</style><script>");
    expect(out.match(/<\/style>/g)).toHaveLength(1);
  });

  it("sets the direction of right-to-left documents from their language", () => {
    const arabic = standaloneHtml(TYPST.replace('lang="en"', 'lang="ar"'));
    expect(arabic).toMatch(/^<!DOCTYPE html><html lang="ar" dir="rtl"><head>/);
    expect(standaloneHtml(TYPST.replace('lang="en"', 'lang="he-IL"'))).toContain('<html lang="he-IL" dir="rtl">');
    // Left to right is the default; a direction already there stays.
    expect(standaloneHtml(TYPST)).toContain('<html lang="en"><head>');
    expect(standaloneHtml(TYPST.replace('lang="en"', 'lang="ar" dir="ltr"'))).toContain('<html lang="ar" dir="ltr">');
  });

  it("creates <head> when the document has none", () => {
    expect(standaloneHtml("<html><body><p>Hi</p></body></html>")).toMatch(
      /^<html>\n<head>\n<meta http-equiv="Content-Security-Policy"[^>]*>\n<style>[\s\S]*<\/style>\n<\/head><body class="typstream"/,
    );
  });
});
