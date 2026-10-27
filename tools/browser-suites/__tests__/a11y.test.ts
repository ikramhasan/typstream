/// <reference lib="dom" />
// Accessibility (PLAN §11.4, #19): every edu corpus document, finished, in both
// targets, checked with axe-core (WCAG 2.2 A/AA and best practices; page-level
// rules are off, since a document is a component of a page) and with what axe
// doesn't check:
// - HTML: the root carries the document's language and direction (Typst writes
//   `lang` on <html>, outside what the renderer shows, and no `dir` at all);
//   equations are MathML; tables Typst gave a header have header cells. (Heading
//   order is axe's `heading-order`.) Dark as well as light: contrast differs.
// - Paged: page SVGs are hidden from assistive technology and the text layer
//   holds the document's text: what a screen reader gets of the HTML target.

import { mountTypstream } from "@typstream/dom";
import type { Engine } from "@typstream/engine";
import axe from "axe-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { server } from "vitest/browser";
import {
  appOptions,
  type CorpusDocument,
  finished,
  host,
  loadCorpus,
  loadMathFont,
  pageEls,
  shown,
  startEngine,
  steady,
  svgOf,
  type Target,
  textLayerOf,
  until,
  warmFonts,
} from "./support/mount";

const browser = server.browser;

let engine: Engine;
let corpus: CorpusDocument[];
beforeAll(async () => {
  engine = startEngine();
  await engine.ready;
  await warmFonts(engine);
  await loadMathFont();
  corpus = (await loadCorpus()).filter((e) => e.set === "edu");
}, 60_000);
afterAll(() => engine.dispose());

/** Rules about whole pages (landmarks, a page title, a main heading), which a document inside an app doesn't own. */
const PAGE_RULES = ["region", "landmark-one-main", "page-has-heading-one", "bypass", "document-title", "html-has-lang"];

/**
 * Violations that come from Typst's own HTML or from axe, not from typstream:
 * each is allowed only where it says, with why.
 */
const KNOWN: { rule: string; where: (el: Element) => boolean; why: string }[] = [
  {
    rule: "aria-allowed-role",
    where: (el) => el.localName === "sup" && /^doc-(noteref|backlink)$/.test(el.getAttribute("role") ?? ""),
    why: "typst-html writes footnote references as <sup role=doc-noteref> (ARIA in HTML allows it on <a>)",
  },
  {
    rule: "landmark-unique",
    where: (el) => el.matches('nav[role="doc-toc"]'),
    why: "typst-html writes every outline (contents, list of figures) as an unlabelled <nav>",
  },
  {
    rule: "target-size",
    where: (el) => !!el.closest('nav[role="doc-toc"]'),
    why: "outline entries are lines of text: WCAG 2.5.8's inline exception (their size is the line height)",
  },
  {
    rule: "empty-table-header",
    where: (el) => !!el.querySelector("math") && (el.textContent ?? "").trim() !== "",
    why: "the header cell holds an equation: axe doesn't count MathML as text",
  },
  {
    rule: "color-contrast",
    where: (el) => !!el.closest("pre"),
    why: "Typst's syntax highlighting colors (its default theme, written inline) on the document's code background",
  },
  {
    rule: "color-contrast",
    where: (el) => !!el.closest(".ts-place")?.parentElement?.closest('[style*="background"]'),
    why: "#64: dark theme, `place`d text inside a filled area (CSS can't tell it from a label placed outside)",
  },
];

const audit = async (el: HTMLElement): Promise<string[]> => {
  const results = await axe.run(el, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
    rules: Object.fromEntries(PAGE_RULES.map((id) => [id, { enabled: false }])),
    resultTypes: ["violations"],
    elementRef: true,
  });
  return results.violations.flatMap((v) =>
    v.nodes
      .filter((n) => !KNOWN.some((k) => k.rule === v.id && n.element && k.where(n.element)))
      .map((n) => `${v.id} (${v.impact}): ${n.target.join(" ")}: ${n.failureSummary?.split("\n")[1]?.trim()}`),
  );
};

const render = async (entry: CorpusDocument, target: Target, theme?: "light" | "dark") => {
  // The page takes the theme too: wide tables and equations overflow the element onto it.
  document.documentElement.style.cssText = theme ? `color-scheme: ${theme}; background: Canvas` : "";
  const el = host(600);
  const view = mountTypstream(el, appOptions(engine, entry, { target, ...(theme ? { theme } : {}) }));
  await until(view, finished);
  await shown(el, (await steady(() => view.getState())).artifact);
  return {
    el,
    done: () => {
      view.destroy();
      el.remove();
    },
  };
};

/** The language a document sets first (`#set text(lang: "ar")`), or Typst's default. */
const languageOf = (source: string) => /#set text\([^)]*\blang: "([a-z]+)"/.exec(source)?.[1] ?? "en";

/** Letters and digits, counted: text compared across targets whatever its spacing and line breaks. */
const letters = (text: string) => {
  const counts = new Map<string, number>();
  for (const c of text.normalize("NFC").match(/[\p{L}\p{N}]/gu) ?? []) counts.set(c, (counts.get(c) ?? 0) + 1);
  return counts;
};

describe(`accessibility in ${browser}`, () => {
  it("paged: axe finds nothing; pages are hidden and their text layers hold the document's text", async () => {
    const problems: string[] = [];
    for (const entry of corpus) {
      const paged = await render(entry, "paged");
      problems.push(...(await audit(paged.el)).map((v) => `${entry.name}: ${v}`));
      const pages = pageEls(paged.el);
      for (const [i, page] of pages.entries()) {
        if (svgOf(page)?.getAttribute("aria-hidden") !== "true")
          problems.push(`${entry.name}: page ${i + 1}'s SVG is exposed`);
      }
      const layerText = pages.map((p) => textLayerOf(p)?.textContent ?? "").join("\n");
      paged.done();

      // What the HTML target reads out, the text layers must too (they may hold more: page numbers, headers).
      const html = await render(entry, "html");
      const want = letters(html.el.textContent ?? "");
      html.done();
      const have = letters(layerText);
      let total = 0;
      let missing = 0;
      for (const [c, n] of want) {
        total += n;
        missing += Math.max(0, n - (have.get(c) ?? 0));
      }
      if (missing > total * 0.02) problems.push(`${entry.name}: text layers miss ${missing} of ${total} letters`);
    }
    expect(problems).toEqual([]);
  }, 900_000);

  for (const theme of ["light", "dark"] as const) {
    it(`html, ${theme}: axe finds nothing; language, direction, MathML, table headers`, async () => {
      const problems: string[] = [];
      for (const entry of corpus) {
        const { el, done } = await render(entry, "html", theme);
        const at = (what: string) => problems.push(`${entry.name}: ${what}`);
        for (const v of await audit(el)) at(v);
        const root = el.querySelector<HTMLElement>(".typstream");
        // Typst writes the language with its region (`zh-CN`).
        const lang = languageOf(entry.source);
        if (root?.lang.split("-")[0] !== lang) at(`lang is "${root?.lang}", not "${lang}"`);
        const dir = lang === "ar" ? "rtl" : "ltr";
        if (root?.dir !== dir) at(`dir is "${root?.dir}", not "${dir}"`);
        // Equations are MathML (drawings html-compat makes of some are labelled images, which axe checks).
        const equations = (entry.source.match(/\$/g)?.length ?? 0) > 0;
        if (equations && el.querySelectorAll("math").length === 0) at("no MathML for its equations");
        for (const m of el.querySelectorAll("math"))
          if (m.namespaceURI !== "http://www.w3.org/1998/Math/MathML") at("<math> outside the MathML namespace");
        // Every `table.header` is a row of header cells.
        const headers = entry.source.match(/table\.header\(/g)?.length ?? 0;
        const withTh = [...el.querySelectorAll("table")].filter((t) => t.querySelector("th")).length;
        if (withTh < headers) at(`${headers} table headers in the source, ${withTh} tables with <th>`);
        done();
      }
      expect(problems).toEqual([]);
    }, 900_000);
  }
});
