/// <reference lib="dom" />
// Families from font catalogues in the HTML target (PLAN §6.4), in each
// browser: google-fonts' plugin with an index of engine-wasm's script fonts,
// on a worker that has only the base fonts. The engine loads the family the
// document names; mountTypstream shows its text in a web font made from the
// same file, and HTML exports link it.

import type { FontCatalogueIndex, LoadedFontFamily } from "@typstream/core";
import { createEngine, type DocumentState, type Engine, fromWorker } from "@typstream/engine";
import { scriptFonts } from "@typstream/engine-wasm/fonts";
import { createGoogleFonts } from "@typstream/google-fonts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { server } from "vitest/browser";
import { registerLoadedFont } from "../../src/html/fonts";
import { createHtmlRenderer } from "../../src/html/renderer";
import { type MountedTypstream, mountTypstream } from "../../src/mount";

const browser = server.browser;

const bengali = scriptFonts.find((f) => f.file === "NotoSerifBengali-Regular.ttf");
if (!bengali) throw new Error("no Noto Serif Bengali in engine-wasm's script fonts");
const fontUrl = new URL(bengali.url, location.href);

const INDEX: FontCatalogueIndex = {
  version: 1,
  base: new URL(".", fontUrl).href,
  families: {
    "noto serif bengali": {
      name: "Noto Serif Bengali",
      files: [{ path: bengali.file, style: "normal", weight: 400, bytes: 200_000 }],
    },
  },
};

let engine: Engine;
let index: string;
beforeAll(async () => {
  index = URL.createObjectURL(new Blob([JSON.stringify(INDEX)], { type: "application/json" }));
  engine = createEngine({
    spawn: fromWorker(
      () => new Worker(new URL("../support/base-fonts-worker.ts", import.meta.url), { type: "module" }),
    ),
    spare: false,
  });
  await engine.ready;
}, 60_000);
afterAll(() => {
  engine.dispose();
  URL.revokeObjectURL(index);
});

/** An element's computed `font-family`, without the quotes some browsers (WebKit) leave out. */
const family = (el: Element | undefined): string => (el ? getComputedStyle(el).fontFamily.replace(/"/g, "") : "");

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

describe(`font catalogues in the HTML target, in ${browser}`, () => {
  it("show a family the document names in the font the engine loaded", async () => {
    const el = document.createElement("div");
    document.body.append(el);
    const view = mountTypstream(el, {
      engine,
      source: '#set text(font: "Noto Serif Bengali")\nআমি বাংলায় গান গাই।\n\nআর এখানে আরেকটি অনুচ্ছেদ।',
      plugins: [createGoogleFonts({ index })],
      lazy: false,
    });
    await until(view, (s) => s.status === "done");
    // The engine compiles again once the family has arrived: no warning about it then.
    await expect.poll(() => engine.fonts.map((f) => f.family), { timeout: 20_000 }).toEqual(["noto serif bengali"]);
    await expect.poll(() => view.getState()?.diagnostics.map((d) => d.message), { timeout: 20_000 }).toEqual([]);
    const spans = [...el.querySelectorAll('[data-typstream-font="noto serif bengali"]')];
    expect(spans).toHaveLength(2);
    await expect.poll(() => family(spans[0]), { timeout: 20_000 }).toBe("typstream Noto Serif Bengali");
    expect(document.fonts.check('16px "typstream Noto Serif Bengali"', "আমি")).toBe(true);

    const exported = await view.exportHtml();
    expect(exported).toContain(`src: url(${JSON.stringify(fontUrl.href)})`);
    expect(exported).toMatch(new RegExp(`font-src data: ${fontUrl.origin}`));
    view.destroy();
    el.remove();
  });

  it("show a family in a shadow root, and leave text in families nobody loaded in the page's font", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const root = document.createElement("div");
    shadow.append(root);
    const renderer = createHtmlRenderer(root, { plugins: [createGoogleFonts({ index })] });
    renderer.update(
      '<p><span data-typstream-font="noto serif bengali">আমি</span> <span data-typstream-font="lobster">Hi</span></p>',
    );
    const font: LoadedFontFamily = {
      family: "noto serif bengali",
      name: "Noto Serif Bengali",
      files: [{ path: bengali.file, style: "normal", weight: 400, url: fontUrl.href }],
    };
    await registerLoadedFont(font, root);
    const [loaded, other] = [...root.querySelectorAll("span")];
    expect(family(loaded)).toBe("typstream Noto Serif Bengali");
    expect(family(other)).toBe(family(root));
    renderer.dispose();
    host.remove();
  });
});
