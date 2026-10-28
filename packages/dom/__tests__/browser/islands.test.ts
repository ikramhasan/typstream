/// <reference lib="dom" />
// Render islands in the HTML renderer (PLAN §8.4, #28), in each browser, with a framework-free
// island renderer on markers shaped as Typst writes them (`typstream-island` around its fallback
// SVG): which markers mount, what props they get, one mounted island per identity while blocks
// are re-created, `isIncomplete` from the stable offset, and every way a marker keeps its fallback.
// @typstream/mindmap's browser tests mount a real island (React Flow) on the real engine.

import type { IslandProps, TypstreamPlugin } from "@typstream/core";
import { afterEach, describe, expect, it } from "vitest";
import { server } from "vitest/browser";
import { createHtmlRenderer, type HtmlRenderer, type HtmlRendererOptions } from "../../src/html/renderer";
import { type IslandRenderers, MAX_ISLAND_DATA, MAX_ISLANDS } from "../../src/islands";

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
    const rules = [...document.adoptedStyleSheets].flatMap((s) => [...s.cssRules]);
    const print = rules.find((r) => r instanceof CSSMediaRule && r.conditionText === "print") as CSSMediaRule;
    expect([...print.cssRules].map((r) => r.cssText).join("\n")).toMatch(/\.typstream-island\)?\s*\{\s*display: none;/);
  });
});
