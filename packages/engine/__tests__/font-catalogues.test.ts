// Font catalogues (PLAN §6.4): a family a document names that the engine
// doesn't have is looked up in the document's catalogues, downloaded, and the
// document compiled again. The catalogue here is served over HTTP, its files
// engine-wasm's script fonts, which these tests' adapter doesn't register.
// Fonts belong to the wasm instance, which every adapter in this file shares,
// so each test that loads a family loads another one.

import { readFileSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type {
  ClientMessage,
  Diagnostic,
  FontCatalogue,
  FontCatalogueFamily,
  FontCatalogueIndex,
  ServerMessage,
  ServerNotificationMap,
  ServerNotificationMethod,
} from "@typstream/core";
import { scriptFonts } from "@typstream/engine-wasm/fonts";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createEngine, type EngineEvent } from "../src/engine";
import { pickFiles, unknownFamilies } from "../src/server/fonts";
import { inProcess } from "../src/server/serve";
import { createServer, type ServerOptions } from "../src/server/server";
import { nodeEngineWasm } from "./support/engine-wasm";

const warning = (message: string): Diagnostic => ({ severity: "warning", span: null, message, hints: [], trace: [] });

describe("unknownFamilies", () => {
  it("reads the families of Typst's warnings, each once", () => {
    const diagnostics = [
      warning("unknown font family: lora"),
      warning("unknown font family: open sans"),
      warning("unknown font family: lora"),
      { ...warning("unknown font family: caveat"), severity: "error" as const },
      warning("page set rule was ignored during HTML export"),
    ];
    expect(unknownFamilies(diagnostics)).toEqual(["lora", "open sans"]);
  });
});

describe("pickFiles", () => {
  const file = (path: string, style: "normal" | "italic", weight: number | [number, number], bytes: number) => ({
    path,
    style,
    weight,
    bytes,
  });

  it("takes a small family whole", () => {
    const family: FontCatalogueFamily = {
      name: "Small",
      files: [file("a", "normal", 300, 1e5), file("b", "normal", 400, 1e5), file("c", "italic", 400, 1e5)],
    };
    expect(pickFiles(family)).toEqual(family.files);
  });

  it("takes a large static family's regular and bold of each style", () => {
    const weights = [100, 300, 400, 500, 700, 900];
    const files = weights.flatMap((w) => [file(`n${w}`, "normal", w, 6e5), file(`i${w}`, "italic", w, 6e5)]);
    expect(pickFiles({ name: "Lato", files }).map((f) => f.path)).toEqual(["n400", "i400", "n700", "i700"]);
  });

  it("takes the nearest weights a static family has", () => {
    const files = [
      file("light", "normal", 300, 6e5),
      file("black", "normal", 900, 6e5),
      file("thin", "normal", 100, 6e5),
    ];
    expect(pickFiles({ name: "Odd", files }).map((f) => f.path)).toEqual(["light", "black"]);
  });

  it("takes a style's variable font alone", () => {
    const files = [
      file("var", "normal", [100, 900], 9e5),
      file("n400", "normal", 400, 6e5),
      file("ivar", "italic", [100, 900], 9e5),
    ];
    expect(pickFiles({ name: "Inter", files }).map((f) => f.path)).toEqual(["var", "ivar"]);
  });
});

const font = (family: string, weight: "Regular" | "Bold") => {
  const f = scriptFonts.find((s) => s.family === family && s.file.endsWith(`-${weight}.ttf`));
  if (!f) throw new Error(`no script font ${family} ${weight}`);
  return f;
};

const familyOf = (name: string, bytes?: number): FontCatalogueFamily => ({
  name,
  files: (["Regular", "Bold"] as const).map((w) => {
    const f = font(name, w);
    return {
      path: f.file,
      style: "normal" as const,
      weight: w === "Regular" ? 400 : 700,
      bytes: bytes ?? readFileSync(f.url).length,
    };
  }),
});

const INDEX: FontCatalogueIndex = {
  version: 1,
  base: "fonts/",
  families: {
    "noto serif bengali": familyOf("Noto Serif Bengali"),
    "noto serif devanagari": familyOf("Noto Serif Devanagari"),
    "noto naskh arabic": familyOf("Noto Naskh Arabic"),
    // Its files are Arabic's: it never loads.
    huge: { ...familyOf("Noto Naskh Arabic", 4e6), name: "Huge" },
    // Bengali's files under another name: no font is ever called that, so any test can load it.
    renamed: { ...familyOf("Noto Serif Bengali"), name: "Renamed" },
  },
};

let http: Server;
let origin = "";
const requests: string[] = [];

beforeAll(async () => {
  http = createHttpServer((req, res) => {
    requests.push(req.url ?? "");
    if (req.url === "/index.json")
      return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(INDEX));
    const file = scriptFonts.find((f) => req.url === `/fonts/${f.file}`);
    if (!file) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": "font/ttf" }).end(readFileSync(file.url));
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => http.close(() => resolve())));

beforeEach(() => {
  requests.length = 0;
});

const catalogue = (): FontCatalogue => ({ index: `${origin}/index.json` });

/** A server on engine-wasm, spoken to in raw messages. */
const start = (options: ServerOptions = {}, initialize: { fontCatalogues?: FontCatalogue[] } = {}) => {
  const out: ServerMessage[] = [];
  const server = createServer(nodeEngineWasm(), (m) => out.push(m), options);
  let id = 0;
  const send = (m: Omit<ClientMessage, "id"> & { method: string }) =>
    server.receive({ id: ++id, ...m } as ClientMessage);
  send({ method: "initialize", params: { protocolVersion: 1, capabilities: {}, options: initialize } });
  const notes = <M extends ServerNotificationMethod>(method: M): ServerNotificationMap[M][] =>
    out.flatMap((m) => ("method" in m && m.method === method ? [m.params as ServerNotificationMap[M]] : []));
  const responses = () => out.filter((m) => "id" in m) as { id: number; result?: unknown; error?: unknown }[];
  return { out, send, notes, responses };
};

/** Waits until `check` stops throwing. */
const settled = (check: () => void) =>
  expect
    .poll(
      () => {
        check();
        return true;
      },
      { timeout: 5000 },
    )
    .toBe(true);

const messages = (ds: Diagnostic[]) => ds.map((d) => d.message);

describe("server, when a document names a family a catalogue has", () => {
  it("loads it, says so, and compiles the document again with it", async () => {
    const s = start();
    const text = '#set page(width: 8cm, height: auto)\n#set text(font: "Noto Serif Bengali")\nআমি বাংলায় গান গাই।';
    s.send({ method: "document/open", params: { uri: "a", rev: 1, text, fontCatalogues: [catalogue()] } });
    s.send({ method: "compile", params: { uri: "a", rev: 1, target: "paged" } });
    await settled(() => expect(s.notes("document/diagnostics")).toHaveLength(2));
    const [first, second] = s.notes("document/diagnostics");
    expect(messages(first?.diagnostics ?? [])).toEqual(["unknown font family: noto serif bengali"]);
    expect(second?.diagnostics).toEqual([]);
    // The first render fell back to other fonts; the second has the family's.
    const pages = s
      .notes("document/artifact")
      .map((a) => (a.artifact.target === "paged" ? a.artifact.pages[0]?.svg : ""));
    expect(pages).toHaveLength(2);
    expect(pages[0]).not.toEqual(pages[1]);
    expect(requests.sort()).toEqual([
      "/fonts/NotoSerifBengali-Bold.ttf",
      "/fonts/NotoSerifBengali-Regular.ttf",
      "/index.json",
    ]);
    expect(s.notes("fonts/loaded")).toEqual([
      {
        family: "noto serif bengali",
        name: "Noto Serif Bengali",
        files: [
          expect.objectContaining({
            url: `${origin}/fonts/NotoSerifBengali-Regular.ttf`,
            style: "normal",
            weight: 400,
          }),
          expect.objectContaining({ url: `${origin}/fonts/NotoSerifBengali-Bold.ttf`, style: "normal", weight: 700 }),
        ],
      },
    ]);

    // Fonts are the worker's: another document has it from the start, and nothing downloads again.
    requests.length = 0;
    s.out.length = 0;
    s.send({ method: "document/open", params: { uri: "b", rev: 1, text } });
    s.send({ method: "compile", params: { uri: "b", rev: 1, target: "paged" } });
    await settled(() => expect(s.responses()).toHaveLength(2));
    expect(s.notes("document/diagnostics")).toEqual([{ uri: "b", rev: 1, target: "paged", diagnostics: [] }]);
    expect(s.notes("fonts/loaded")).toEqual([]);
    expect(requests).toEqual([]);
  });

  it("announces the capability", async () => {
    const s = start();
    await settled(() => expect(s.responses()).toHaveLength(1));
    expect(s.responses()[0]?.result).toMatchObject({ capabilities: { fontCatalogues: true } });
  });

  it("leaves a family no catalogue has to its fallback, looking it up once", async () => {
    const s = start({}, { fontCatalogues: [catalogue()] });
    const text = '#set text(font: "Comic Sans MS")\nHello.';
    s.send({ method: "document/open", params: { uri: "a", rev: 1, text } });
    s.send({ method: "compile", params: { uri: "a", rev: 1, target: "html" } });
    await settled(() => expect(s.notes("$/log")).toHaveLength(1));
    expect(s.notes("$/log")[0]).toEqual({
      level: "warn",
      message: 'compiling without it: no font catalogue has the family "comic sans ms"',
    });
    s.send({
      method: "document/edit",
      params: { uri: "a", rev: 2, edits: [{ from: text.length, to: text.length, insert: "!" }] },
    });
    s.send({ method: "compile", params: { uri: "a", rev: 2, target: "html" } });
    await settled(() => expect(s.responses()).toHaveLength(5));
    // One compile per request, nothing more logged or fetched than the index.
    expect(s.notes("document/diagnostics")).toHaveLength(2);
    expect(s.notes("$/log")).toHaveLength(1);
    expect(requests).toEqual(["/index.json"]);
  });

  it("looks a family up again after a catalogue's index failed to load", async () => {
    const s = start({
      fontCatalogues: {
        // The first request fails, as a network error would.
        fetch: (() => {
          let calls = 0;
          return (url: string) => (++calls === 1 ? Promise.reject(new Error("offline")) : fetch(url));
        })(),
      },
    });
    s.send({
      method: "document/open",
      params: { uri: "a", rev: 1, text: '#set text(font: "Huge")\nHi.', fontCatalogues: [catalogue()] },
    });
    s.send({ method: "compile", params: { uri: "a", rev: 1, target: "html" } });
    await settled(() => expect(s.notes("$/log")).toHaveLength(2));
    expect(s.notes("$/log").map((l) => l.message)).toEqual([
      `font catalogue ${origin}/index.json: offline`,
      `compiling without it: font catalogue ${origin}/index.json isn't available`,
    ]);
    // Not given up on: once the index may be fetched again, the family is looked up.
    vi.useFakeTimers({ now: Date.now() + 31_000, toFake: ["Date"] });
    try {
      s.send({ method: "compile", params: { uri: "a", rev: 1, target: "html" } });
      await settled(() => expect(s.notes("$/log")).toHaveLength(3));
    } finally {
      vi.useRealTimers();
    }
    expect(s.notes("$/log")[2]).toMatchObject({ message: expect.stringContaining('"Huge" is 8.0 MB') });
  });

  it("doesn't download a family larger than its catalogue allows", async () => {
    const s = start();
    s.send({
      method: "document/open",
      params: { uri: "a", rev: 1, text: '#set text(font: "Huge")\nHi.', fontCatalogues: [catalogue()] },
    });
    s.send({ method: "compile", params: { uri: "a", rev: 1, target: "html" } });
    await settled(() => expect(s.notes("$/log")).toHaveLength(1));
    expect(s.notes("$/log")[0]).toMatchObject({ message: expect.stringContaining('"Huge" is 8.0 MB') });
    expect(requests).toEqual(["/index.json"]);
  });

  it("ignores the client's catalogues when it isn't trusted, and uses its own", async () => {
    const untrusted = start({ fontCatalogues: { trustClient: false } }, { fontCatalogues: [catalogue()] });
    untrusted.send({
      method: "document/open",
      params: { uri: "a", rev: 1, text: '#set text(font: "Noto Naskh Arabic")\nمرحبا', fontCatalogues: [catalogue()] },
    });
    untrusted.send({ method: "compile", params: { uri: "a", rev: 1, target: "html" } });
    await settled(() => expect(untrusted.responses()).toHaveLength(3));
    expect(messages(untrusted.notes("document/diagnostics")[0]?.diagnostics ?? [])).toEqual([
      "unknown font family: noto naskh arabic",
    ]);
    expect(requests).toEqual([]);

    // The server's own catalogue is looked in (this family is too large to load).
    const own = start({ fontCatalogues: { trustClient: false, catalogues: [catalogue()] } });
    own.send({ method: "document/open", params: { uri: "a", rev: 1, text: '#set text(font: "Huge")\nHi.' } });
    own.send({ method: "compile", params: { uri: "a", rev: 1, target: "html" } });
    await settled(() => expect(own.notes("$/log")).toHaveLength(1));
    expect(own.notes("$/log")[0]).toMatchObject({ message: expect.stringContaining('"Huge" is 8.0 MB') });
  });

  it("takes an index at a relative URL, as bundlers emit one, with its base from where it came", async () => {
    const text = '#set text(font: "Renamed")\nHi.';
    const loads = async (fetchIndex: (url: string) => Promise<Response>) => {
      const s = start({ fontCatalogues: { fetch: fetchIndex } });
      s.send({
        method: "document/open",
        params: { uri: "a", rev: 1, text, fontCatalogues: [{ index: "/index.json" }] },
      });
      s.send({ method: "compile", params: { uri: "a", rev: 1, target: "html" } });
      await settled(() => expect(s.notes("fonts/loaded")).toHaveLength(1));
      expect(s.notes("$/log")).toEqual([]);
      return s.notes("fonts/loaded")[0]?.files.map((f) => f.url);
    };
    const files = [`${origin}/fonts/NotoSerifBengali-Regular.ttf`, `${origin}/fonts/NotoSerifBengali-Bold.ttf`];
    // A worker's `fetch` resolves it against the worker's location, and the response has the URL it fetched.
    expect(await loads((url) => fetch(new URL(url, origin)))).toEqual(files);
    // A response without a URL (a custom `fetch`'s): the index's URL against the worker's location.
    vi.stubGlobal("location", new URL(`${origin}/assets/worker.js`));
    try {
      expect(await loads(async (url) => new Response(await (await fetch(new URL(url, origin))).text()))).toEqual(files);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("exports with the family once it has arrived", async () => {
    const s = start();
    const text = '#set text(font: "Noto Serif Devanagari")\nनमस्ते';
    s.send({ method: "document/open", params: { uri: "a", rev: 1, text, fontCatalogues: [catalogue()] } });
    s.send({ method: "export/pdf", params: { uri: "a", rev: 1 } });
    await settled(() => expect(s.responses()).toHaveLength(3));
    const exported = s.responses()[2]?.result as { status: string; diagnostics: Diagnostic[] };
    expect(exported.status).toBe("ok");
    expect(exported.diagnostics).toEqual([]);
    expect(requests).toContain("/fonts/NotoSerifDevanagari-Regular.ttf");
  });
});

describe("the engine client", () => {
  it("loads plugins' catalogues for their documents, and lists the families its workers loaded", async () => {
    const engine = createEngine({ spawn: inProcess(() => nodeEngineWasm()), spare: false });
    const events: EngineEvent[] = [];
    engine.onEvent((e) => e.type === "font" && events.push(e));
    const plugin = { key: "fonts", engine: { fontCatalogues: [catalogue()] } };
    const doc = engine.open({ target: "html", plugins: [plugin] });
    doc.set('#set text(font: "Noto Naskh Arabic")\nمرحبا');
    doc.finish();
    await expect.poll(() => engine.fonts.map((f) => f.family), { timeout: 5000 }).toEqual(["noto naskh arabic"]);
    expect(events).toEqual([{ type: "font", font: engine.fonts[0] }]);
    await expect.poll(() => doc.getState().diagnostics).toEqual([]);
    engine.dispose();
  });
});
