/// <reference lib="dom" />
// Both targets under Trusted Types (#70): with `require-trusted-types-for
// 'script'; trusted-types typstream`, the renderers' markup goes through the
// `typstream` policy, and nothing is refused. The policy is turned on for this
// file's page after the engine worker has started (the worker's URL is checked
// in examples/strict-csp, through engineWorker()), so the test can still load
// the worker from source.

import type { DocumentState, Engine } from "@typstream/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { server } from "vitest/browser";
import { type MountedTypstream, mountTypstream } from "../../src/mount";
import { startEngine } from "../support/html";

const browser = server.browser;

const SOURCE = `= Trusted
A paragraph with *markup*, $x^2$ and #link("https://typst.app")[a link].

#box(width: 1cm, height: 1cm, fill: red)`;

let engine: Engine;
const violations: string[] = [];
const PROBE = "<b>probe</b>";
beforeAll(async () => {
  engine = startEngine();
  await engine.ready;
  // The renderers' violations; the first test's probe reports one too.
  document.addEventListener("securitypolicyviolation", (e) => {
    if (!e.sample.includes(PROBE)) violations.push(`${e.effectiveDirective}: ${e.sample}`);
  });
  const meta = document.createElement("meta");
  meta.httpEquiv = "Content-Security-Policy";
  meta.content = "require-trusted-types-for 'script'; trusted-types typstream";
  document.head.append(meta);
}, 60_000);
afterAll(() => engine.dispose());

const until = (view: MountedTypstream, done: (s: DocumentState) => boolean, ms = 30_000) =>
  new Promise<DocumentState>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out; status ${view.getState()?.status}`)), ms);
    const check = () => {
      const s = view.getState();
      if (!s || !done(s)) return;
      clearTimeout(timer);
      stop();
      resolve(s);
    };
    const stop = view.subscribe(check);
    check();
  });

const mount = async (target: "html" | "paged") => {
  const el = document.createElement("div");
  document.body.append(el);
  const view = mountTypstream(el, { engine, source: SOURCE, target, lazy: false });
  await until(view, (s) => s.status === "done" && s.artifact?.target === target);
  return { el, view };
};

/** The page's text: the HTML, or the paged view's text layer once it is drawn. */
const textOf = async (el: HTMLElement): Promise<string> => {
  for (let i = 0; i < 100 && !el.textContent?.includes("markup"); i++) await new Promise((r) => setTimeout(r, 50));
  return el.textContent ?? "";
};

describe(`Trusted Types in ${browser}`, () => {
  it("refuses plain strings on this page", () => {
    expect(() => {
      document.createElement("div").innerHTML = PROBE;
    }).toThrow(TypeError);
  });

  it.each(["html", "paged"] as const)("renders the %s target through the typstream policy, twice", async (target) => {
    // Two mounts side by side, and one after the first is gone: the policy is created once and reused.
    const first = await mount(target);
    const second = await mount(target);
    for (const { el } of [first, second]) expect(await textOf(el)).toContain("A paragraph with markup");
    if (target === "html") {
      expect(first.el.querySelector("strong")?.textContent).toBe("markup");
      expect(first.el.querySelector("a")?.getAttribute("href")).toBe("https://typst.app");
    } else {
      const page = first.el.querySelector(".typstream-page > div")?.shadowRoot;
      expect(page?.querySelector("svg")).not.toBeNull();
      // Links are filtered in the template, before the page sees them.
      expect(page?.querySelector("a")?.getAttribute("target")).toBe("_blank");
    }
    first.view.destroy();
    second.view.destroy();
    const third = await mount(target);
    expect(await textOf(third.el)).toContain("A paragraph with markup");
    third.view.destroy();
    expect(violations).toEqual([]);
  });
});
