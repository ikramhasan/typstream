// Images a document names but has no file for: the paths the client finds,
// `fetchImages`, and a document whose `resolveImage` fills them in, on the real
// engine (placeholder first, then the image; diagnostics while it loads or
// after it failed).

import type { HtmlArtifact } from "@typstream/core";
import { describe, expect, it, vi } from "vitest";
import type { DocumentState, EngineDocument } from "../src/document";
import { type ImageResolver, imagePaths } from "../src/document-images";
import { createEngine } from "../src/engine";
import { fetchImages } from "../src/images";
import { inProcess } from "../src/server/serve";
import { nodeEngineWasm } from "./support/engine-wasm";

const utf8 = (s: string) => new TextEncoder().encode(s);
const svg = (fill: string) =>
  utf8(
    `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="${fill}"/></svg>`,
  );
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

describe("imagePaths", () => {
  it("finds complete strings an image call starts with, each once", () => {
    const text = [
      '#image("a.png") #figure(image(source: "b.svg", width: 2cm))',
      '#image(\n  "https://example.org/c.jpg?w=1&h=2") #image("a.png")',
      '#image("d\\"q\\u{e9}.png") #image("/e.png") #image("./f.png")',
    ].join("\n");
    expect(imagePaths(text)).toEqual([
      "a.png",
      "b.svg",
      "https://example.org/c.jpg?w=1&h=2",
      'd"qé.png',
      "/e.png",
      "./f.png",
    ]);
  });

  it("skips paths still being typed and ones no file can be written for", () => {
    expect(imagePaths('#image("https://exa')).toEqual([]);
    expect(imagePaths('#image(src) #read("x.png") #image("../up.png") #image("@preview/x:1.0.0/a.png")')).toEqual([]);
    expect(imagePaths('#image("main.typ") #image("") #image("bad\\q.png")')).toEqual([]);
  });
});

/** A `fetch` answering from a table of URLs, recording what it was asked. */
const fakeFetch = (routes: Record<string, () => Response>) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const route = routes[url];
    return route ? route() : new Response("not found", { status: 404 });
  });
  return { fetch: fn, calls };
};

const signal = () => ({ signal: new AbortController().signal });

describe("fetchImages", () => {
  it("downloads images by URL from the hosts it allows, and leaves other paths alone", async () => {
    const { fetch, calls } = fakeFetch({
      "https://upload.wikimedia.org/a.png": () => new Response(PNG),
      "https://img.example.org/b.svg": () => new Response(svg("red")),
      "http://other.net/c.svg": () => new Response(svg("blue")),
    });
    const resolve = fetchImages({ hosts: ["upload.wikimedia.org", "*.example.org"], fetch });
    expect(await resolve("https://upload.wikimedia.org/a.png", signal())).toEqual(PNG);
    expect(await resolve("https://img.example.org/b.svg", signal())).toEqual(svg("red"));
    expect(() => resolve("http://other.net/c.svg", signal())).toThrow("other.net isn't an allowed image host");
    expect(() => resolve("https://example.org/b.svg", signal())).toThrow(/allowed/);
    expect(resolve("diagram.png", signal())).toBeNull();
    expect(resolve("data:image/png;base64,AAAA", signal())).toBeNull();
    // Without the page's cookies or referrer.
    expect(calls.map((c) => [c.url, c.init.credentials, c.init.referrerPolicy])).toEqual([
      ["https://upload.wikimedia.org/a.png", "omit", "no-referrer"],
      ["https://img.example.org/b.svg", "omit", "no-referrer"],
    ]);
    expect(await fetchImages({ hosts: ["*"], fetch })("http://other.net/c.svg", signal())).toEqual(svg("blue"));
  });

  it("accepts what Typst decodes, by content, and nothing else", async () => {
    const bodies: Record<string, Uint8Array> = {
      png: PNG,
      jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]),
      gif: utf8("GIF89a..."),
      webp: utf8("RIFF\0\0\0\0WEBPVP8 "),
      svg: utf8('<?xml version="1.0"?>\n<!-- drawn -->\n<!DOCTYPE svg>\n<svg xmlns="http://www.w3.org/2000/svg"/>'),
      html: utf8("<!DOCTYPE html><html><body>Not found</body></html>"),
      pdf: utf8("%PDF-1.7"),
    };
    const { fetch } = fakeFetch(
      Object.fromEntries(
        Object.entries(bodies).map(([k, v]) => [
          `https://x.org/${k}`,
          () => new Response(v as Uint8Array<ArrayBuffer>),
        ]),
      ),
    );
    const resolve = fetchImages({ hosts: ["x.org"], fetch });
    for (const ok of ["png", "jpeg", "gif", "webp", "svg"]) {
      expect(await resolve(`https://x.org/${ok}`, signal())).toEqual(bodies[ok]);
    }
    for (const bad of ["html", "pdf"]) {
      await expect(resolve(`https://x.org/${bad}`, signal())).rejects.toThrow(
        "not a PNG, JPEG, GIF, WebP or SVG image",
      );
    }
  });

  it("fails on HTTP errors and images over the size limit", async () => {
    const big = new Uint8Array(2000);
    big.set(PNG);
    const { fetch } = fakeFetch({
      "https://x.org/big": () => new Response(big),
      "https://x.org/stream": () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(big.subarray(0, 900));
              c.enqueue(big.subarray(900));
              c.close();
            },
          }),
        ),
      "https://x.org/declared": () => new Response(big, { headers: { "content-length": "2000" } }),
    });
    const resolve = fetchImages({ hosts: ["x.org"], fetch, maxBytes: 1000 });
    await expect(resolve("https://x.org/missing", signal())).rejects.toThrow("HTTP 404");
    for (const url of ["https://x.org/big", "https://x.org/stream", "https://x.org/declared"]) {
      await expect(resolve(url, signal())).rejects.toThrow(/larger than/);
    }
  });

  it("fetches through a proxy with the page's credentials", async () => {
    const { fetch, calls } = fakeFetch({ "/api/image?url=https%3A%2F%2Fx.org%2Fa.png": () => new Response(PNG) });
    const resolve = fetchImages({ hosts: ["x.org"], fetch, proxy: (u) => `/api/image?url=${encodeURIComponent(u)}` });
    expect(await resolve("https://x.org/a.png", signal())).toEqual(PNG);
    expect(calls[0]?.init.credentials).toBe("same-origin");
  });

  it("downloads an image once for every document, and tries a failed one again", async () => {
    let up = false;
    const { fetch } = fakeFetch({
      "https://x.org/a.png": () => new Response(PNG),
      "https://x.org/flaky.png": () => (up ? new Response(PNG) : new Response("", { status: 503 })),
    });
    const resolve = fetchImages({ hosts: ["x.org"], fetch });
    const [a, b] = await Promise.all([
      resolve("https://x.org/a.png", signal()),
      resolve("https://x.org/a.png", signal()),
    ]);
    expect(a).toBe(b);
    await expect(resolve("https://x.org/flaky.png", signal())).rejects.toThrow("HTTP 503");
    up = true;
    expect(await resolve("https://x.org/flaky.png", signal())).toEqual(PNG);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("stops waiting when the document is disposed, without failing the download for others", async () => {
    let release = () => {};
    const { fetch } = fakeFetch({
      "https://x.org/slow.png": () => new Response(PNG),
    });
    const slow = vi.fn(async (url: string, init: RequestInit) => {
      await new Promise<void>((r) => {
        release = r;
      });
      return fetch(url, init);
    });
    const resolve = fetchImages({ hosts: ["x.org"], fetch: slow });
    const controller = new AbortController();
    const first = resolve("https://x.org/slow.png", { signal: controller.signal });
    const second = resolve("https://x.org/slow.png", signal());
    controller.abort();
    await expect(first).rejects.toThrow();
    release();
    expect(await second).toEqual(PNG);
  });
});

const html = (s: DocumentState) => (s.artifact as HtmlArtifact | null)?.html ?? "";

/** The SVGs an HTML artifact shows, decoded from their data URLs. */
const images = (s: DocumentState) =>
  [...html(s).matchAll(/src="data:image\/svg\+xml;base64,([^"]+)"/g)].map((m) =>
    Buffer.from(m[1] as string, "base64").toString(),
  );

const until = (doc: EngineDocument, test: (s: DocumentState) => boolean) =>
  new Promise<DocumentState>((resolve) => {
    const check = (s: DocumentState) => {
      if (test(s)) {
        stop();
        resolve(s);
      }
    };
    const stop = doc.subscribe(check);
    check(doc.getState());
  });

const idle = (s: DocumentState) => s.status === "done" || s.status === "error" || s.status === "idle";

/** A resolver whose answers the test gives, path by path. */
const deferred = () => {
  const waiting = new Map<string, (bytes: Uint8Array | null | Error) => void>();
  const asked: string[] = [];
  const resolve: ImageResolver = (path) =>
    new Promise((ok, fail) => {
      asked.push(path);
      waiting.set(path, (v) => (v instanceof Error ? fail(v) : ok(v)));
    });
  const answer = (path: string, v: Uint8Array | null | Error) => waiting.get(path)?.(v);
  return { resolve, asked, answer };
};

describe("a document's images", { timeout: 30_000 }, () => {
  it("shows a placeholder, then the image its resolver gives, asking once per complete path", async () => {
    const engine = createEngine({ spawn: inProcess(nodeEngineWasm), spare: false });
    const r = deferred();
    const doc = engine.open({ resolveImage: r.resolve });
    const text = 'Cells.\n\n#figure(image("https://example.org/cell.svg", width: 4cm), caption: [A cell])\n\nEnd.';
    for (const c of text) doc.push(c);
    // Every prefix of the URL was in the input, but only the complete one is asked for.
    expect(r.asked).toEqual(["https://example.org/cell.svg"]);
    let state = await until(doc, (s) => idle(s) && images(s).length > 0);
    expect(images(state)[0]).toContain(">cell.svg</text>");
    expect(html(state)).toMatch(/<figcaption>Figure.1: A cell<\/figcaption>/);
    r.answer("https://example.org/cell.svg", svg("#123456"));
    state = await until(doc, (s) => idle(s) && images(s).some((i) => i.includes("#123456")));
    expect(images(state)).toEqual([expect.stringContaining("#123456")]);
    doc.finish();
    state = await until(doc, (s) => s.status === "done");
    expect(state.diagnostics).toEqual([]);
    expect(r.asked).toHaveLength(1);
    engine.dispose();
  });

  it("says an image is loading, then why it failed; leaves Typst's error for one it doesn't have", async () => {
    const engine = createEngine({ spawn: inProcess(nodeEngineWasm), spare: false });
    const r = deferred();
    const text = '#image("https://x.org/a.png")\n#image("https://x.org/b.png")\n#image("c.png")';
    const doc = engine.open({ resolveImage: r.resolve, text });
    doc.finish();
    const at = (s: DocumentState) =>
      s.diagnostics.map((d) => [d.severity, d.message, d.span && text.slice(d.span.from, d.span.to)]);
    let state = await until(doc, (s) => s.status === "done" && s.diagnostics.length === 3);
    expect(at(state)).toEqual([
      ["info", 'image "https://x.org/a.png" is loading', '"https://x.org/a.png"'],
      ["info", 'image "https://x.org/b.png" is loading', '"https://x.org/b.png"'],
      ["info", 'image "c.png" is loading', '"c.png"'],
    ]);
    r.answer("https://x.org/a.png", new Error("HTTP 404"));
    r.answer("c.png", null);
    state = await until(doc, (s) => s.diagnostics.filter((d) => d.severity === "error").length === 2);
    expect(at(state)).toEqual([
      ["error", 'image "https://x.org/a.png" failed to load (HTTP 404)', '"https://x.org/a.png"'],
      ["info", 'image "https://x.org/b.png" is loading', '"https://x.org/b.png"'],
      ["error", "file not found (searched at /c.png)", '"c.png"'],
    ]);
    // Placeholders all along, and the document is done.
    expect(state.status).toBe("done");
    expect(images(state)).toHaveLength(3);
    engine.dispose();
  });

  it("asks only for images its files don't have, and stops asking when disposed", async () => {
    const engine = createEngine({ spawn: inProcess(nodeEngineWasm), spare: false });
    const seen: AbortSignal[] = [];
    const resolve = vi.fn<ImageResolver>((_path, { signal }) => {
      seen.push(signal);
      return new Promise(() => {});
    });
    const doc = engine.open({
      resolveImage: resolve,
      files: { "/local.svg": svg("green") },
      text: '#image("local.svg") #image("./local.svg") #image("remote.svg")',
    });
    expect(resolve.mock.calls.map(([path]) => path)).toEqual(["remote.svg"]);
    doc.dispose();
    expect(seen[0]?.aborted).toBe(true);
    engine.dispose();
  });

  it("fetches nothing without a resolver", async () => {
    const engine = createEngine({ spawn: inProcess(nodeEngineWasm), spare: false });
    const doc = engine.open({ text: '#image("https://x.org/a.png")' });
    doc.finish();
    const state = await until(doc, (s) => s.status === "done");
    expect(images(state)).toHaveLength(1);
    expect(state.diagnostics.map((d) => d.message)).toEqual(["file not found (searched at /https:/x.org/a.png)"]);
    engine.dispose();
  });
});
