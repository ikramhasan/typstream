/// <reference lib="dom" />
// Render islands in the HTML renderer (PLAN §8.4, #28), in each browser, with a framework-free
// island renderer on markers shaped as Typst writes them (`typstream-island` around its fallback
// SVG): which markers mount, what props they get, one mounted island per identity while blocks
// are re-created, `isIncomplete` from the stable offset, and every way a marker keeps its fallback.
// Then the same in the paged view, on artifacts shaped as the engine sends them (`PagedArtifact.islands`):
// boxes over the pages, one mounted island as pages are redrawn and it moves, covered text hidden.
// @typstream/mindmap's browser tests mount a real island (React Flow) on the real engine, in both targets.

import type { IslandProps, PagedArtifact, PagedIsland, PageUpdate, TextRun, TypstreamPlugin } from "@typstream/core";
import { afterEach, describe, expect, it } from "vitest";
import { server } from "vitest/browser";
import { createHtmlRenderer, type HtmlRenderer, type HtmlRendererOptions } from "../../src/html/renderer";
import { type IslandRenderers, MAX_ISLAND_DATA, MAX_ISLANDS } from "../../src/islands";
import { createPagedView, type PagedView, type PagedViewOptions } from "../../src/paged/view";

const plugin: TypstreamPlugin = {
  key: "test/islands",
  islands: {
    counter: { parse: (d) => (typeof (d as { n?: unknown })?.n === "number" ? d : undefined) },
    plain: {},
  },
};

/** A marker as Typst writes it: attributes double-quoted, JSON's quotes as entities. */
const marker = (name: string, data: unknown, label = "drawing") =>
  `<typstream-island name="${name}" props="${JSON.stringify(data).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"><svg viewBox="0 0 100 50" width="100pt" height="50pt" style="overflow: visible; width: 10em; height: 5em"><text>${label}</text></svg></typstream-island>`;

const anchor = (src: number) => `<typstream-anchor data-src="${src}"></typstream-anchor>`;
const doc = (...blocks: string[]) => `<!DOCTYPE html><html lang="en"><body>${blocks.join("")}</body></html>`;

/** An island renderer that logs what happens to it. */
const recorder = () => {
  const log: string[] = [];
  const props: IslandProps[] = [];
  const hosts: HTMLElement[] = [];
  const render: IslandRenderers[string] = (host, p) => {
    hosts.push(host);
    props.push(p);
    log.push(`mount ${p.name} ${p.index}`);
    host.textContent = `island ${p.index}`;
    return {
      update: (next) => {
        props.push(next);
        log.push(`update ${next.name} ${next.index}`);
      },
      destroy: () => log.push(`destroy ${p.name} ${p.index}`),
    };
  };
  return { log, props, hosts, render };
};

/** The print rules of every stylesheet adopted so far, as text. */
const printCss = () =>
  [...document.adoptedStyleSheets]
    .flatMap((s) => [...s.cssRules])
    .filter((r): r is CSSMediaRule => r instanceof CSSMediaRule && r.conditionText === "print")
    .flatMap((r) => [...r.cssRules].map((c) => c.cssText))
    .join("\n");

let renderer: HtmlRenderer | null = null;
const mount = (options: HtmlRendererOptions) => {
  const root = document.createElement("div");
  document.body.append(root);
  renderer = createHtmlRenderer(root, { plugins: [plugin], ...options });
  return renderer;
};
afterEach(() => {
  renderer?.root.remove();
  renderer?.dispose();
  renderer = null;
});

describe(`islands in the HTML renderer in ${server.browser}`, () => {
  it("mounts declared islands over their fallback, with the marker's props", () => {
    const r = recorder();
    const file = (path: string) => (path === "a.png" ? new Uint8Array([1]) : null);
    const html = mount({ islands: { counter: r.render, plain: r.render }, file });
    html.update(doc("<p>a</p>", marker("counter", { n: 1 }), marker("unknown", {}), marker("plain", [1, "x"])));
    expect(r.log).toEqual(["mount counter 0", "mount plain 0"]);
    expect(r.props[0]).toMatchObject({
      name: "counter",
      data: { n: 1 },
      index: 0,
      isIncomplete: false,
      target: "html",
    });
    expect(r.props[1]?.data).toEqual([1, "x"]);
    expect(r.props[0]?.file("a.png")).toEqual(new Uint8Array([1]));
    expect(r.props[0]?.file("b.png")).toBeNull();
    const [counter, unknown, plain] = html.root.querySelectorAll("typstream-island");
    for (const el of [counter, unknown, plain]) {
      // The sanitizer keeps no attributes: the data went to the island.
      expect(el?.getAttributeNames().filter((a) => a !== "data-typstream-island")).toEqual([]);
    }
    expect(counter?.hasAttribute("data-typstream-island")).toBe(true);
    expect(counter?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    const host = counter?.querySelector(":scope > .typstream-island") as HTMLElement;
    expect(host).toBe(r.hosts[0]);
    expect(host.getBoundingClientRect().toJSON()).toEqual((counter as Element).getBoundingClientRect().toJSON());
    // No renderer for it: the fallback, as it is.
    expect(unknown?.hasAttribute("data-typstream-island")).toBe(false);
    expect(unknown?.querySelector("svg")?.hasAttribute("aria-hidden")).toBe(false);
    expect(plain?.querySelector(".typstream-island")).not.toBeNull();
  });

  it("keeps one island per marker while its block is re-created, and unmounts it when it goes", () => {
    const r = recorder();
    const html = mount({ islands: { counter: r.render } });
    html.update(doc(anchor(0), "<p>a</p>", anchor(10), marker("counter", { n: 1 }), marker("counter", { n: 2 })));
    const [first, second] = r.hosts;
    // The block streams on: new markers, the same data for the first, new data for the second.
    html.update(doc(anchor(0), "<p>a</p>", anchor(10), marker("counter", { n: 1 }, "x"), marker("counter", { n: 3 })));
    expect(r.log).toEqual(["mount counter 0", "mount counter 1", "update counter 1"]);
    const markers = html.root.querySelectorAll("typstream-island");
    expect(markers[0]?.querySelector(".typstream-island")).toBe(first);
    expect(markers[1]?.querySelector(".typstream-island")).toBe(second);
    expect(r.props.at(-1)?.data).toEqual({ n: 3 });
    // The second goes; the first stays.
    html.update(doc(anchor(0), "<p>a</p>", anchor(10), marker("counter", { n: 1 }, "x")));
    expect(r.log.slice(3)).toEqual(["destroy counter 1"]);
    expect(second?.isConnected).toBe(false);
    html.clear();
    expect(r.log.slice(4)).toEqual(["destroy counter 0"]);
  });

  it("marks islands whose block starts at or after the stable offset incomplete", () => {
    const r = recorder();
    const html = mount({ islands: { counter: r.render } });
    const source = doc(anchor(0), marker("counter", { n: 1 }), anchor(20), marker("counter", { n: 2 }));
    html.update(source, { stable: 20 });
    expect(r.props.map((p) => p.isIncomplete)).toEqual([false, true]);
    html.update(source, { stable: 30 });
    html.update(source, { stable: null });
    expect(r.props.slice(2).map((p) => [p.index, p.isIncomplete])).toEqual([[1, false]]);
  });

  it("keeps the fallback for bad data, a failing renderer, and markers past the limit", () => {
    const r = recorder();
    const failing: IslandRenderers[string] = () => {
      throw new Error("broken island");
    };
    const html = mount({ islands: { counter: r.render, plain: failing } });
    const long = { n: 1, pad: "x".repeat(MAX_ISLAND_DATA) };
    html.update(
      doc(
        marker("counter", { n: "not a number" }),
        marker("counter", long),
        '<typstream-island name="counter" props="{not json"><svg></svg></typstream-island>',
        marker("plain", {}),
      ),
    );
    expect(r.log).toEqual([]);
    expect(html.root.querySelectorAll(".typstream-island")).toHaveLength(0);
    expect(html.root.querySelectorAll("[data-typstream-island]")).toHaveLength(0);
    html.update(doc(...Array.from({ length: MAX_ISLANDS + 5 }, (_, i) => marker("counter", { n: i }))));
    expect(r.log).toHaveLength(MAX_ISLANDS);
  });

  it("hides islands in print, which shows the fallback", () => {
    mount({ islands: { counter: recorder().render } }).update(doc(marker("counter", { n: 1 })));
    expect(printCss()).toMatch(/\.typstream \.typstream-island\)?\s*\{\s*display: none;/);
  });
});

// --- the paged view ---

/** Points per page edge: pages are 200 × 300 pt, shown 400 px wide (fit-width), so 2 px per point. */
const W = 200;
const H = 300;

/** A page as SVG, its fallback drawing a grey box; `text`: its text layer's runs. */
const page = (index: number, hash = `p${index}`, text?: TextRun[]): PageUpdate => ({
  index,
  hash,
  width: W,
  height: H,
  svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}pt" height="${H}pt"><rect x="20" y="40" width="160" height="80" fill="#ccc"/></svg>`,
  ...(text ? { text } : {}),
});

/** A marker as the engine sends it: a box 160 × 80 pt at (20, `y`) on page `on`. */
const island = (name: string, data: unknown, on = 0, y = 40, from: number | null = null): PagedIsland => ({
  name,
  data,
  page: on,
  x: 20,
  y,
  width: 160,
  height: 80,
  from,
});

const artifact = (pages: PageUpdate[], islands: PagedIsland[]): PagedArtifact => ({
  target: "paged",
  base: null,
  pageCount: pages.length,
  pages,
  islands,
});

let paged: PagedView | null = null;
const mountPagedView = (options: PagedViewOptions) => {
  const el = document.createElement("div");
  el.style.width = "400px";
  document.body.append(el);
  paged = createPagedView(el, { layout: "fit-width", plugins: [plugin], ...options });
  return paged;
};
afterEach(() => {
  paged?.element.parentElement?.remove();
  paged?.destroy();
  paged = null;
});

/** Where `el` is on its page, in points. */
const onPage = (el: Element) => {
  const box = el.getBoundingClientRect();
  const pageBox = (el.closest(".typstream-page") as Element).getBoundingClientRect();
  const k = pageBox.width / W;
  return [box.left - pageBox.left, box.top - pageBox.top, box.width, box.height].map((v) => Math.round(v / k));
};

const boxes = (view: PagedView) => [...view.element.querySelectorAll<HTMLElement>(".typstream-island-box")];

describe(`islands in the paged view in ${server.browser}`, () => {
  it("mounts declared islands over their fallback, in a layer over the page, with the marker's props", () => {
    const r = recorder();
    const file = (path: string) => (path === "a.png" ? new Uint8Array([1]) : null);
    const view = mountPagedView({ islands: { counter: r.render, plain: r.render }, file });
    view.render(
      artifact(
        [page(0)],
        [island("counter", { n: 1 }), island("unknown", {}, 0, 140), island("plain", [1, "x"], 0, 200)],
      ),
    );
    view.flush();
    expect(r.log).toEqual(["mount counter 0", "mount plain 0"]);
    expect(r.props[0]).toMatchObject({
      name: "counter",
      data: { n: 1 },
      index: 0,
      isIncomplete: false,
      target: "paged",
    });
    expect(r.props[1]?.data).toEqual([1, "x"]);
    expect(r.props[0]?.file("a.png")).toEqual(new Uint8Array([1]));
    // On top of the page, after its drawing, text layer and links; nothing for a name without a renderer.
    const pageEl = view.element.querySelector(".typstream-page") as HTMLElement;
    expect(pageEl.lastElementChild?.className).toBe("typstream-islands");
    const [counter, plain] = boxes(view);
    expect(boxes(view)).toHaveLength(2);
    expect(counter?.hasAttribute("data-typstream-island")).toBe(true);
    expect(onPage(counter as HTMLElement)).toEqual([20, 40, 160, 80]);
    expect(onPage(plain as HTMLElement)).toEqual([20, 200, 160, 80]);
    // The host covers the box, on the paper's colour: the drawing under it doesn't show through.
    const host = counter?.querySelector(":scope > .typstream-island") as HTMLElement;
    expect(host).toBe(r.hosts[0]);
    expect(host.getBoundingClientRect().toJSON()).toEqual((counter as HTMLElement).getBoundingClientRect().toJSON());
    expect(getComputedStyle(host).getPropertyValue("--typstream-island-background").trim()).toBe("white");
    expect(getComputedStyle(host).pointerEvents).toBe("auto");
  });

  it("keeps one island while its page is redrawn and it moves, to another page too, and unmounts it when it goes", () => {
    const r = recorder();
    const view = mountPagedView({ islands: { counter: r.render } });
    view.render(artifact([page(0)], [island("counter", { n: 1 })]));
    const [host] = r.hosts;
    // Text above it grew: the page is drawn again and the island is lower; then it moves to a new page.
    view.render(artifact([page(0, "a")], [island("counter", { n: 1 }, 0, 60)]));
    view.flush();
    expect(onPage(boxes(view)[0] as HTMLElement)).toEqual([20, 60, 160, 80]);
    view.render(artifact([page(0, "b"), page(1)], [island("counter", { n: 2 }, 1, 10)]));
    view.flush();
    expect(r.log).toEqual(["mount counter 0", "update counter 0"]);
    expect(r.props.at(-1)?.data).toEqual({ n: 2 });
    const pages = view.element.querySelectorAll(".typstream-page");
    expect(pages[0]?.querySelector(".typstream-island")).toBeNull();
    expect(pages[1]?.querySelector(".typstream-island")).toBe(host);
    expect(onPage(boxes(view)[0] as HTMLElement)).toEqual([20, 10, 160, 80]);
    // An engine without introspection sends no list: nothing to mount.
    view.render({ target: "paged", base: null, pageCount: 2, pages: [] });
    expect(r.log.slice(2)).toEqual(["destroy counter 0"]);
    expect(host?.isConnected).toBe(false);
    expect(boxes(view)).toHaveLength(0);
  });

  it("marks islands whose source starts at or after the stable offset incomplete", () => {
    const r = recorder();
    const view = mountPagedView({ islands: { counter: r.render } });
    const islands = [island("counter", { n: 1 }, 0, 40, 0), island("counter", { n: 2 }, 0, 140, 25)];
    view.render(artifact([page(0)], islands), { stable: 20 });
    expect(r.props.map((p) => p.isIncomplete)).toEqual([false, true]);
    view.render(artifact([page(0)], islands), { stable: 30 });
    view.render(artifact([page(0)], islands));
    expect(r.props.slice(2).map((p) => [p.index, p.isIncomplete])).toEqual([[1, false]]);
  });

  it("hides the text an island covers from assistive technology while it is mounted", () => {
    const run = (text: string, y: number): TextRun => ({ text, x: 30, y, size: 10, width: 40 });
    const text = [run("Above", 20), run("Under", 80), run("Below", 150)];
    const view = mountPagedView({ islands: { counter: recorder().render } });
    const hidden = () =>
      [...view.element.querySelectorAll(".typstream-text-layer span")]
        .filter((s) => s.getAttribute("aria-hidden") === "true")
        .map((s) => s.textContent);
    view.render(artifact([page(0, "a", text)], [island("counter", { n: 1 })]));
    view.flush();
    expect(hidden()).toEqual(["Under"]);
    // The page is unchanged, the island gone: its text is read again.
    view.render(artifact([page(0, "a", text)], []));
    view.flush();
    expect(hidden()).toEqual([]);
    // Bad data keeps the fallback, and its text.
    view.render(artifact([page(0, "a", text)], [island("counter", { n: "x" })]));
    view.flush();
    expect(hidden()).toEqual([]);
  });

  it("keeps the fallback for bad data, a failing renderer, and markers past the limit", () => {
    const r = recorder();
    const failing: IslandRenderers[string] = () => {
      throw new Error("broken island");
    };
    const view = mountPagedView({ islands: { counter: r.render, plain: failing } });
    const long = { n: 1, pad: "x".repeat(MAX_ISLAND_DATA) };
    view.render(
      artifact([page(0)], [island("counter", { n: "not a number" }), island("counter", long), island("plain", {})]),
    );
    expect(r.log).toEqual([]);
    expect(view.element.querySelectorAll(".typstream-island")).toHaveLength(0);
    expect(view.element.querySelectorAll("[data-typstream-island]")).toHaveLength(0);
    // An island on a page the view doesn't have is left out.
    view.render(artifact([page(0)], [island("counter", { n: 1 }, 3)]));
    expect(r.log).toEqual([]);
    view.render(
      artifact(
        [page(0)],
        Array.from({ length: MAX_ISLANDS + 5 }, (_, i) => island("counter", { n: i })),
      ),
    );
    expect(r.log).toHaveLength(MAX_ISLANDS);
    // Markers that keep their fallback get no box.
    expect(boxes(view)).toHaveLength(MAX_ISLANDS);
  });

  it("hides islands in print, which shows the page as drawn", () => {
    mountPagedView({ islands: { counter: recorder().render } }).render(
      artifact([page(0)], [island("counter", { n: 1 })]),
    );
    expect(printCss()).toMatch(/\.typstream-islands\s*\{\s*display: none;/);
  });
});
