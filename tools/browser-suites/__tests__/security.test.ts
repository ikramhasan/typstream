/// <reference lib="dom" />
// Hostile documents (PLAN §9, §11.7, #29): every document of the corpus's
// hostile set, streamed into mountTypstream on the real worker and finished, in
// both targets. Whatever the document writes:
// - nothing on the page can run script, load from the network, submit a form or
//   escape into a fixed position: the sanitizer (HTML) and the paged view's link
//   filter leave only allowed elements, attributes, URLs and CSS;
// - nothing ran (`window.typstreamPwned` is what the documents' scripts set)
//   and nothing was fetched from the hosts they name;
// - the sandbox holds (reads, imports and plugins fail inside Typst; the engine
//   tests check the messages), and the documents' safe text survives;
// - runaways are stopped by the watchdog, or the worker traps and is replaced,
//   and the same mount renders the next document;
// - the limits on input length and live pages hold.

import type { PagedArtifact } from "@typstream/core";
import { mountTypstream } from "@typstream/dom";
import type { Engine, EngineEvent } from "@typstream/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { server } from "vitest/browser";
import {
  appOptions,
  type CorpusDocument,
  finished,
  host,
  loadCorpus,
  pageEls,
  shown,
  startEngine,
  steady,
  streamInto,
  type Target,
  textLayerOf,
  until,
} from "./support/mount";

const browser = server.browser;

// Short budgets: the runaways run into them, in every browser.
const WATCHDOG = { streamingMs: 1500, finalMs: 3000, probeMs: 1500 };

let engine: Engine;
let corpus: CorpusDocument[];
let hostile: CorpusDocument[];
const events: EngineEvent[] = [];
beforeAll(async () => {
  engine = startEngine({ watchdog: WATCHDOG });
  engine.onEvent((e) => events.push(e));
  await engine.ready;
  corpus = await loadCorpus();
  hostile = corpus.filter((e) => e.name.startsWith("hostile-"));
}, 60_000);
afterAll(() => engine.dispose());

declare global {
  interface Window {
    /** What the hostile documents' scripts and handlers would set. */
    typstreamPwned?: string;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Elements nothing may render: they run script, load, embed, submit or take over the page. */
const FORBIDDEN = new Set(
  (
    "script style iframe frame frameset object embed applet form input button textarea select option base link " +
    "meta template noscript dialog portal foreignobject animate animatemotion animatetransform set annotation-xml"
  ).split(" "),
);

/** Attributes nothing may keep, besides `on*` handlers and `data-*` (except the renderers' own, below). */
const FORBIDDEN_ATTRS = new Set("srcdoc srcset ping formaction action is name autofocus background poster".split(" "));

/** `data-*` attributes the renderers set: the HTML renderer's, and the paged view's on its pages. */
const RENDERER_DATA = /^data-(?:typstream-|layout$|page$)/;

/** Where a link may go, and where an image may come from (PLAN §9). */
const SAFE_HREF = /^(?:https?:|mailto:|#)/i;
const SAFE_SRC = /^(?:data:image\/|blob:)/i;

/** The hosts the hostile documents try to reach. */
const HOSTILE_HOSTS = /evil\.example|tracker\.example/;

/** Every element under `root`, through the paged view's shadow roots. */
const elements = (root: Element): Element[] => {
  const out: Element[] = [];
  const visit = (el: Element) => {
    out.push(el);
    if (el.shadowRoot) for (const child of el.shadowRoot.children) visit(child);
    for (const child of el.children) visit(child);
  };
  visit(root);
  return out;
};

/** What on the page breaks the rules above, as readable lines. */
const violations = (el: HTMLElement): string[] => {
  const found: string[] = [];
  for (const node of elements(el)) {
    const tag = node.localName.toLowerCase();
    const where = `<${node.localName}>`;
    if (FORBIDDEN.has(tag) || tag.includes("-")) found.push(`${where} element`);
    for (const { name, value } of node.attributes) {
      const attr = name.toLowerCase();
      if (attr.startsWith("on") || FORBIDDEN_ATTRS.has(attr)) found.push(`${where} ${name}="${value}"`);
      else if (attr.startsWith("data-") && !RENDERER_DATA.test(attr)) found.push(`${where} ${name}`);
      // Browsers strip spaces and controls around a URL and tabs and newlines inside it.
      // biome-ignore lint/suspicious/noControlCharactersInRegex: so must this check.
      const url = value.replace(/[\s\u0000-\u001f]+/g, "");
      if (
        (attr === "href" || attr === "xlink:href") &&
        !(SAFE_HREF.test(url) || (tag === "image" && SAFE_SRC.test(url)))
      )
        found.push(`${where} ${name}="${value}"`);
      if (attr === "src" && !SAFE_SRC.test(url)) found.push(`${where} src="${value}"`);
      if (attr === "style" && /url\(|image-set|expression|binding|fixed/i.test(value))
        found.push(`${where} style="${value}"`);
    }
    if (getComputedStyle(node).position === "fixed") found.push(`${where} position: fixed`);
  }
  return found;
};

/** Resource loads from the hostile hosts so far. */
const hostileLoads = () =>
  performance
    .getEntriesByType("resource")
    .map((r) => r.name)
    .filter((url) => HOSTILE_HOSTS.test(url));

/** The text a reader gets: the HTML, or the pages' text layers. */
const readable = (el: HTMLElement): string => {
  const pages = pageEls(el);
  return pages.length ? pages.map((p) => textLayerOf(p)?.textContent ?? "").join("\n") : (el.textContent ?? "");
};

/** The hrefs of the links left on the page. */
const hrefs = (el: HTMLElement): string[] =>
  elements(el)
    .filter((n) => n.localName === "a")
    .map((a) => a.getAttribute("href") ?? a.getAttribute("xlink:href"))
    .filter((h): h is string => h !== null)
    .map((h) => h.replace(/typstream-\d+-/, "typstream-N-"));

/** Text each hostile document keeps, in both targets. */
const SURVIVES: Record<string, string[]> = {
  "hostile-html-elements": ["Worksheet", "The worksheet"],
  "hostile-html-attributes": ["Worksheet", "Clobbering"],
  "hostile-links": ["Answer key", "the Typst docs", "Answers"],
  "hostile-markup-text": ["into the box", "A figure"],
  "hostile-layout-nonconvergent": ["The counter is"],
};

/** And in the HTML target, where `html.elem` exists (paged export ignores it). */
const SURVIVES_HTML: Record<string, string[]> = {
  "hostile-html-elements": ["A custom element is unwrapped; its text stays."],
  "hostile-html-attributes": ["Handlers", "Data and names"],
  "hostile-markup-text": ['<script>window.typstreamPwned = "raw"</script>', "<b onmouseover=", "Attribute value"],
};

/** Streams `entry` into a fresh mount, finishes it, and waits until it is on screen. */
const render = async (entry: CorpusDocument, target: Target) => {
  const el = host(600);
  const opts = appOptions(engine, entry, { target, source: "", isStreaming: true });
  const view = mountTypstream(el, opts);
  await streamInto(view, opts, entry, 1);
  const state = await until(view, (s) => s.final && finished(s), 120_000);
  await shown(el, (await steady(() => view.getState())).artifact);
  // Long enough for an image's onerror, a details' ontoggle or an autofocus to fire.
  await sleep(300);
  return { el, view, opts, state };
};

const targets: Target[] = ["html", "paged"];

describe(`hostile documents in ${browser}`, () => {
  for (const target of targets) {
    it(`renders every hostile document safely (${target})`, async () => {
      const problems: string[] = [];
      for (const entry of hostile.filter((e) => e.expect !== "limit")) {
        const { el, view, state } = await render(entry, target);
        try {
          const id = `${entry.name} (${target})`;
          for (const v of violations(el)) problems.push(`${id}: ${v}`);
          if (window.typstreamPwned) problems.push(`${id}: script ran (${window.typstreamPwned})`);
          // Documents Typst refuses (the sandbox) show an error block; the others render.
          if (entry.expect === "ok" && state.status !== "done") problems.push(`${id}: ${state.status}`);
          const text = readable(el);
          for (const s of [
            ...(SURVIVES[entry.name] ?? []),
            ...(target === "html" ? (SURVIVES_HTML[entry.name] ?? []) : []),
          ])
            if (!text.includes(s)) problems.push(`${id}: lost "${s}"`);
        } finally {
          view.destroy();
          el.remove();
        }
      }
      expect(problems).toEqual([]);
      expect(hostileLoads()).toEqual([]);
    }, 600_000);
  }

  it("keeps only http(s), mailto and in-document links", async () => {
    const entry = hostile.find((e) => e.name === "hostile-links") as CorpusDocument;
    const html = await render(entry, "html");
    // Every link is still there, as text; the hostile ones lost their href.
    expect(html.el.querySelectorAll("a")).toHaveLength(14);
    expect(hrefs(html.el)).toEqual(["https://typst.app/docs", "mailto:teacher@example.com", "#typstream-N-further"]);
    for (const a of html.el.querySelectorAll("a[href^=http]")) {
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
      expect(a.getAttribute("target")).toBe("_blank");
    }
    html.view.destroy();
    html.el.remove();
    // Page SVGs: links within the document have no href (they would need anchors).
    const paged = await render(entry, "paged");
    expect([...new Set(hrefs(paged.el))]).toEqual(["https://typst.app/docs", "mailto:teacher@example.com"]);
    paged.view.destroy();
    paged.el.remove();
  }, 120_000);

  for (const target of targets) {
    it(`stops runaways and renders the next document in the same mount (${target})`, async () => {
      for (const entry of hostile.filter((e) => e.expect === "limit")) {
        events.length = 0;
        const { el, view, opts, state } = await render(entry, target);
        try {
          const acted = events.map((e) => e.type).filter((t) => t === "watchdog" || t === "crash");
          // A loop in a plugin runs into the watchdog; content nested too deep traps the worker.
          expect(acted, entry.name).toContain(entry.name === "hostile-plugin-loop" ? "watchdog" : "crash");
          expect(
            events.filter((e) => e.type === "failed"),
            entry.name,
          ).toEqual([]);
          expect(finished(state), entry.name).toBe(true);
          expect(violations(el), entry.name).toEqual([]);

          view.update({ ...opts, source: "= Recovered\n\nThe engine is back.", isStreaming: false });
          const after = await until(view, (s) => s.status === "done" && s.heal.source.includes("Recovered"), 60_000);
          await shown(el, (await steady(() => view.getState())).artifact);
          expect(after.failure, entry.name).toBeNull();
          expect(readable(el), entry.name).toContain("The engine is back.");
        } finally {
          view.destroy();
          el.remove();
        }
      }
    }, 300_000);
  }
});

describe(`limits in ${browser}`, () => {
  const byName = (name: string) => corpus.find((e) => e.name === name) as CorpusDocument;

  it("stops healing and compiling input past maxLength, and renders shorter input again", async () => {
    const limited = startEngine({ limits: { maxLength: 20_000 } });
    const entry = byName("single-line-200k");
    const el = host(600);
    const opts = appOptions(limited, entry, {
      target: "html",
      source: entry.source.slice(0, 10_000),
      isStreaming: true,
    });
    const view = mountTypstream(el, opts);
    try {
      const first = await until(view, (s) => s.artifact !== null && s.status === "idle");
      await streamInto(view, opts, entry, 2);
      const s = await until(view, (s) => s.final && finished(s));
      expect(s.status).toBe("error");
      expect(s.failure?.reason).toBe("too-large");
      // The healer stopped at the limit; what compiled before stays on screen.
      expect(s.heal.source.length).toBeLessThanOrEqual(20_000);
      expect(s.artifact).not.toBeNull();
      expect(s.artifactRev).toBeGreaterThanOrEqual(first.artifactRev ?? 0);
      await expect(view.exportPdf()).rejects.toMatchObject({ reason: "too-large" });

      view.update({ ...opts, source: "Short again.", isStreaming: false });
      await until(view, (s) => s.status === "done" && s.heal.source === "Short again.");
      await shown(el, (await steady(() => view.getState())).artifact);
      expect(el.textContent).toContain("Short again.");
    } finally {
      view.destroy();
      el.remove();
      limited.dispose();
    }
  }, 120_000);

  it("stops previewing live past livePages, and compiles every page when finished", async () => {
    // 500 pages take seconds to lay out: budgets for a busy machine, so only the page limit acts.
    const limited = startEngine({ limits: { livePages: 20 }, watchdog: { streamingMs: 30_000, finalMs: 60_000 } });
    const entry = byName("pages-500");
    const el = host(600);
    const opts = appOptions(limited, entry, { target: "paged", source: "", isStreaming: true });
    const view = mountTypstream(el, opts);
    try {
      // Still streaming, the whole loop: 500 pages in one streaming compile.
      view.update({ ...opts, source: entry.source, isStreaming: true });
      const s = await until(view, (s) => !s.live);
      expect(s.status).toBe("stale");
      expect(s.failure?.reason).toBe("too-complex");
      expect(s.failure?.message).toContain("more than 20 pages");
      view.update({ ...opts, source: entry.source, isStreaming: false });
      const done = await until(view, (s) => s.final && finished(s), 120_000);
      expect(done.status).toBe("done");
      expect((done.artifact as PagedArtifact).pageCount).toBe(500);
    } finally {
      view.destroy();
      el.remove();
      limited.dispose();
    }
  }, 180_000);
});
