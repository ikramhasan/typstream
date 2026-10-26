/// <reference lib="dom" />
// Typst packages in the real worker (#25): the vendored tarballs fetched from
// the page's origin (Vite serves @typstream/universe's `new URL` assets the way
// an app's bundler emits them), gunzipped with DecompressionStream, kept in
// Cache Storage, and used from there when the network can't serve them.

import type { PackageSpec, PagedArtifact } from "@typstream/core";
import { UNIVERSE_PACKAGES } from "@typstream/universe";
import { afterEach, describe, expect, it } from "vitest";
import { fromWorker } from "../../src/connection";
import type { DocumentState, EngineDocument } from "../../src/document";
import { createEngine, type Engine } from "../../src/engine";

const spawn = () => fromWorker(() => new Worker(new URL("../../src/worker.ts", import.meta.url), { type: "module" }));

const until = (doc: EngineDocument, done: (s: DocumentState) => boolean, ms = 60_000): Promise<DocumentState> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out: ${JSON.stringify(doc.getState().diagnostics)}`)), ms);
    const check = (s: DocumentState) => {
      if (!done(s)) return;
      clearTimeout(timer);
      stop();
      resolve(s);
    };
    const stop = doc.subscribe(check);
    check(doc.getState());
  });

const CETZ = `#import "@preview/cetz:0.5.3"
#cetz.canvas({
  import cetz.draw: *
  circle((0, 0), radius: 1)
  content((0, 1.4), [Unit circle])
})
`;

const engines: Engine[] = [];
afterEach(() => {
  for (const e of engines.splice(0)) e.dispose();
});

const render = async (packages: PackageSpec[], text: string) => {
  const engine = createEngine({ spawn: spawn(), spare: false, initialize: { packages } });
  engines.push(engine);
  const doc = engine.open({ target: "paged" });
  doc.set(text);
  doc.finish();
  return until(doc, (s) => s.status === "done" || s.status === "error");
};

describe("Typst packages in the worker", { timeout: 90_000 }, () => {
  it("renders an allowed package and keeps its tarball in Cache Storage", async () => {
    const state = await render([...UNIVERSE_PACKAGES], CETZ);
    expect(state.diagnostics).toEqual([]);
    const page = (state.artifact as PagedArtifact).pages[0];
    expect(page?.text?.map((t) => t.text).join(" ")).toContain("Unit circle");
    const cache = await caches.open("typstream-packages");
    const cetz = UNIVERSE_PACKAGES.find((p) => p.name === "cetz" && p.version === "0.5.3");
    expect(await cache.match(cetz?.url as string)).toBeDefined();
  });

  it("loads from Cache Storage what the network can't serve", async () => {
    // Tarballs cached under URLs the server doesn't have: only the cache can answer.
    const cache = await caches.open("typstream-packages");
    const offline = await Promise.all(
      UNIVERSE_PACKAGES.filter((p) => p.name === "cetz" || p.name === "oxifmt").map(async (p) => {
        const url = `${location.origin}/offline/${crypto.randomUUID()}/${p.name}-${p.version}.tar.gz`;
        await cache.put(url, await fetch(p.url));
        return { ...p, url };
      }),
    );
    const state = await render(offline, CETZ);
    expect(state.diagnostics).toEqual([]);
  });

  it("doesn't load a package that isn't allowed", async () => {
    const state = await render([], CETZ);
    expect(state.status).toBe("error");
    expect(state.diagnostics.find((d) => d.severity === "error")?.message).toBe(
      "package @preview/cetz:0.5.3 is not allowed",
    );
  });
});
