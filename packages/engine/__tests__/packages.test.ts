// Typst packages (PLAN §6.4, #25): the server's import pre-pass, allowlist,
// integrity checks, version substitution and the package-stub fixer, against
// engine-wasm in process with the packages @typstream/universe vendors.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import {
  type ClientMessage,
  type CompileParams,
  type Diagnostic,
  type PackageSpec,
  type PagedArtifact,
  type ParamsOf,
  PROTOCOL_VERSION,
  type ServerMessage,
  type ServerNotification,
} from "@typstream/core";
import { UNIVERSE_PACKAGES } from "@typstream/universe";
import { describe, expect, it } from "vitest";
import { resolvePackage, scanSpecs } from "../src/server/packages";
import { createServer, type ServerOptions } from "../src/server/server";
import { untar } from "../src/server/tar";
import { nodeEngineWasm } from "./support/engine-wasm";

type Allowed = typeof UNIVERSE_PACKAGES;

/** Serves the vendored tarballs (file: URLs, which Node's fetch can't read) and records what was fetched. */
const vendored = () => {
  const fetched: string[] = [];
  const fetch = async (url: string) => {
    fetched.push(url.slice(url.lastIndexOf("/") + 1));
    return new Response(readFileSync(fileURLToPath(url)));
  };
  return { fetched, fetch };
};

const errorsOf = (ds: Diagnostic[]) => ds.filter((d) => d.severity === "error");

/** A server on the calling thread, driven by raw protocol messages. */
const serverWith = async (options: ServerOptions, packages?: PackageSpec[]) => {
  const notes: ServerNotification[] = [];
  const waiting = new Map<number, (m: ServerMessage) => void>();
  const server = createServer(
    nodeEngineWasm(),
    (m) => {
      if ("id" in m) waiting.get(m.id as number)?.(m);
      else notes.push(m as ServerNotification);
    },
    options,
  );
  let id = 0;
  const request = (method: string, params: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      const n = ++id;
      waiting.set(n, (m) =>
        "error" in m ? reject(new Error(m.error.message)) : resolve((m as { result: unknown }).result),
      );
      server.receive({ id: n, method, params } as ClientMessage);
    });
  await request("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    options: { packages },
  });
  let docs = 0;
  return {
    notes,
    request,
    async open(text: string, extra: Partial<ParamsOf<"document/open">> = {}) {
      const uri = `doc-${++docs}`;
      await request("document/open", { uri, rev: 1, text, ...extra });
      return uri;
    },
    /** Compiles and returns the diagnostics and artifact the compile published. */
    async compile(params: CompileParams) {
      notes.length = 0;
      const result = (await request("compile", params)) as { status: string };
      const mine = notes.filter((n) => "uri" in n.params && n.params.uri === params.uri);
      const diagnostics = mine.flatMap((n) => (n.method === "document/diagnostics" ? [n.params.diagnostics] : []));
      const artifacts = mine.flatMap((n) => (n.method === "document/artifact" ? [n.params.artifact] : []));
      return { status: result.status, diagnostics: diagnostics.at(-1) ?? [], artifact: artifacts.at(-1) ?? null };
    },
  };
};

const CETZ = `#import "@preview/cetz:0.5.3"
#cetz.canvas({
  import cetz.draw: *
  circle((0, 0), radius: 1)
  line((-1, 0), (1, 0), mark: (end: ">"))
  content((0, 1.4), [Unit circle])
})
`;

describe("Typst packages", { timeout: 60_000 }, () => {
  it("loads an allowed package with its dependencies and renders it, in both targets", async () => {
    const { fetched, fetch } = vendored();
    const s = await serverWith({ packages: { fetch, cache: false } }, [...UNIVERSE_PACKAGES]);
    const uri = await s.open(CETZ);
    const paged = await s.compile({ uri, rev: 1, target: "paged" });
    expect(paged.diagnostics).toEqual([]);
    const page = (paged.artifact as PagedArtifact).pages[0];
    expect(page?.svg).toContain("<path");
    expect(page?.text?.map((t) => t.text).join(" ")).toContain("Unit circle");
    const html = await s.compile({ uri, rev: 1, target: "html" });
    expect(errorsOf(html.diagnostics)).toEqual([]);
    expect(html.status).toBe("ok");
    // CeTZ imports oxifmt; each tarball is fetched once, for every compile and document after.
    await s.open(CETZ);
    expect(fetched.sort()).toEqual(["cetz-0.5.3.tar.gz", "oxifmt-1.0.0.tar.gz"]);
  });

  it("follows dependencies pinned at other versions (fletcher's cetz 0.3.4)", async () => {
    const { fetched, fetch } = vendored();
    const s = await serverWith({ packages: { fetch, cache: false } }, [...UNIVERSE_PACKAGES]);
    const uri = await s.open(
      '#import "@preview/fletcher:0.5.8": diagram, node, edge\n#diagram(node((0, 0), [Start]), edge("-|>"), node((1, 0), [End]))\n',
    );
    const c = await s.compile({ uri, rev: 1, target: "paged" });
    expect(c.diagnostics).toEqual([]);
    expect(fetched.sort()).toEqual(["cetz-0.3.4.tar.gz", "fletcher-0.5.8.tar.gz", "oxifmt-0.2.1.tar.gz"]);
  });

  it("never fetches a package outside the allowlist, and says why it's missing", async () => {
    const { fetched, fetch } = vendored();
    const s = await serverWith({ packages: { fetch, cache: false } });
    const text = '#import "@preview/cetz:0.5.3"\n#cetz.canvas({})\n';
    const uri = await s.open(text);
    const c = await s.compile({ uri, rev: 1, target: "html", mode: "final" });
    expect(fetched).toEqual([]);
    const [error] = errorsOf(c.diagnostics);
    expect(error?.message).toBe("package @preview/cetz:0.5.3 is not allowed");
    expect(error?.hints).toContain("no packages are allowed here");
    expect(text.slice(error?.span?.from, error?.span?.to)).toBe('"@preview/cetz:0.5.3"');
    expect(c.status).toBe("error");
  });

  it("stubs the names a disallowed import brings in", async () => {
    const { fetch } = vendored();
    const s = await serverWith({ packages: { fetch, cache: false } }, [...UNIVERSE_PACKAGES]);
    const uri = await s.open('#import "@preview/mitex:0.2.7": mi, mitex\nBefore #mi("x^2") after.\n');
    const c = await s.compile({ uri, rev: 1, target: "html", mode: "final" });
    // The placeholder renders; final mode still reports the import.
    expect(c.status).toBe("ok");
    const html = c.artifact?.target === "html" ? c.artifact.html : "";
    expect(html).toContain("typstream-missing-package");
    expect(html).toContain("[@preview/mitex:0.2.7]");
    expect(errorsOf(c.diagnostics).map((d) => d.message)).toEqual(["package @preview/mitex:0.2.7 is not allowed"]);
    expect(errorsOf(c.diagnostics)[0]?.hints.join()).toContain("@preview/cetz:0.5.3");
  });

  it("gives another version of an allowed package the nearest allowed one, with a warning", async () => {
    const { fetched, fetch } = vendored();
    const s = await serverWith({ packages: { fetch, cache: false } }, [...UNIVERSE_PACKAGES]);
    const text = CETZ.replace("0.5.3", "0.2.2");
    const uri = await s.open(text);
    const c = await s.compile({ uri, rev: 1, target: "paged" });
    expect(errorsOf(c.diagnostics)).toEqual([]);
    const [warning] = c.diagnostics;
    expect(warning).toMatchObject({
      severity: "warning",
      message: "package @preview/cetz:0.2.2 isn't available here; using @preview/cetz:0.5.3",
      source: "typstream",
    });
    expect(text.slice(warning?.span?.from, warning?.span?.to)).toBe('"@preview/cetz:0.2.2"');
    expect(fetched).toContain("cetz-0.5.3.tar.gz");
  });

  it("rejects a tarball that fails its integrity check", async () => {
    const { fetch } = vendored();
    const cetz = UNIVERSE_PACKAGES.find((p) => p.name === "cetz") as Allowed[number];
    const s = await serverWith({ packages: { fetch, cache: false } }, [
      { ...cetz, integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" },
    ]);
    const uri = await s.open(CETZ);
    const c = await s.compile({ uri, rev: 1, target: "html", mode: "final" });
    expect(errorsOf(c.diagnostics)[0]?.message).toBe(
      "package @preview/cetz:0.5.3 failed to load (integrity check failed)",
    );
  });

  it("checks the archive as fetched or the tar inside it, however it travelled", async () => {
    const cetz = UNIVERSE_PACKAGES.filter((p) => p.name === "cetz" || p.name === "oxifmt");
    const gz = (url: string) => readFileSync(fileURLToPath(url));
    const sha256 = (bytes: Uint8Array) => `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
    // A server that sent `Content-Encoding: gzip`: the client gets the tar.
    const decoded = await serverWith(
      { packages: { cache: false, fetch: async (url) => new Response(gunzipSync(gz(url))) } },
      [...cetz],
    );
    const uri = await decoded.open(CETZ);
    expect((await decoded.compile({ uri, rev: 1, target: "paged" })).diagnostics).toEqual([]);
    // Integrity of the .tar.gz, as packages.typst.org's index would give it.
    const asPublished = await serverWith(
      { packages: { cache: false, fetch: async (url) => new Response(gz(url)) } },
      cetz.map((p) => ({ ...p, integrity: sha256(gz(p.url)) })),
    );
    const uri2 = await asPublished.open(CETZ);
    expect((await asPublished.compile({ uri: uri2, rev: 1, target: "paged" })).diagnostics).toEqual([]);
  });

  it("ignores the client's packages when told not to trust it", async () => {
    const { fetched, fetch } = vendored();
    const s = await serverWith({ packages: { fetch, cache: false, trustClient: false } }, [...UNIVERSE_PACKAGES]);
    const uri = await s.open(CETZ, { packages: [...UNIVERSE_PACKAGES] });
    const c = await s.compile({ uri, rev: 1, target: "html", mode: "final" });
    expect(fetched).toEqual([]);
    expect(errorsOf(c.diagnostics)[0]?.message).toBe("package @preview/cetz:0.5.3 is not allowed");
  });

  it("takes a document's own packages (plugins' engine.packages)", async () => {
    const { fetch } = vendored();
    const s = await serverWith({ packages: { fetch, cache: false } });
    const uri = await s.open(CETZ, { packages: [...UNIVERSE_PACKAGES] });
    const c = await s.compile({ uri, rev: 1, target: "paged" });
    expect(c.diagnostics).toEqual([]);
  });

  it("mounts a local package from the document's files, with no allowlist", async () => {
    const s = await serverWith({ packages: { cache: false } });
    const uri = await s.open('#import "@typstream/demo:0.1.0": greet\n#greet("class")\n', {
      files: {
        "@typstream/demo:0.1.0/typst.toml": '[package]\nname = "demo"\nversion = "0.1.0"\nentrypoint = "lib.typ"\n',
        "@typstream/demo:0.1.0/lib.typ": '#import "words.typ": hello\n#let greet(who) = [#hello, #who!]\n',
        "@typstream/demo:0.1.0/words.typ": "#let hello = [Hello]\n",
      },
    });
    const c = await s.compile({ uri, rev: 1, target: "html" });
    expect(c.diagnostics).toEqual([]);
    expect(c.artifact?.target === "html" && c.artifact.html).toContain("Hello, class!");
  });

  it("compiles again when a package arrives after the compile stopped waiting", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { fetch } = vendored();
    const s = await serverWith(
      {
        packages: {
          cache: false,
          fetch: async (url) => {
            if (url.includes("cetz-0.5.3")) await gate;
            return fetch(url);
          },
        },
      },
      [...UNIVERSE_PACKAGES],
    );
    const uri = await s.open(CETZ);
    const first = await s.compile({ uri, rev: 1, target: "paged" });
    expect(errorsOf(first.diagnostics)[0]?.message).toBe("package @preview/cetz:0.5.3 is still loading");
    s.notes.length = 0;
    release();
    await expect.poll(() => s.notes.some((n) => n.method === "document/artifact"), { timeout: 20_000 }).toBe(true);
    const diagnostics = s.notes.find((n) => n.method === "document/diagnostics");
    expect(diagnostics?.params).toMatchObject({ uri, rev: 1, diagnostics: [] });
  });
});

describe("scanSpecs", () => {
  it("finds complete specs in string literals, with their ranges", () => {
    const text = '#import "@preview/cetz:0.5.3": canvas\n#include "@local/x:1.0.0"\n#import "@preview/cet"\n';
    expect(scanSpecs(text)).toEqual([
      { spec: "@preview/cetz:0.5.3", range: { from: 8, to: 29 } },
      { spec: "@local/x:1.0.0", range: { from: 47, to: 63 } },
    ]);
  });
});

describe("resolvePackage", () => {
  const allowed = ["0.5.3", "0.5.2", "0.3.4"].map((version) => ({ namespace: "preview", name: "cetz", version }));
  const version = (spec: string) => resolvePackage(spec, allowed)?.version;

  it("takes the exact version, else the newest with the same major.minor, else the newest", () => {
    expect(version("@preview/cetz:0.5.2")).toBe("0.5.2");
    expect(version("@preview/cetz:0.3.1")).toBe("0.3.4");
    expect(version("@preview/cetz:0.5.9")).toBe("0.5.3");
    expect(version("@preview/cetz:0.2.2")).toBe("0.5.3");
    expect(version("@preview/fletcher:0.5.8")).toBeUndefined();
    expect(version("@local/cetz:0.5.3")).toBeUndefined();
  });
});

describe("untar", () => {
  /** A ustar header block for a regular file. */
  const header = (name: string, size: number, type = "0", prefix = ""): Uint8Array => {
    const block = new Uint8Array(512);
    const put = (at: number, s: string) => block.set(new TextEncoder().encode(s), at);
    put(0, name);
    put(124, `${size.toString(8).padStart(11, "0")}\0`);
    put(156, type);
    put(257, "ustar\0");
    put(345, prefix);
    return block;
  };
  const data = (s: string) => {
    const bytes = new TextEncoder().encode(s);
    const out = new Uint8Array(Math.ceil(bytes.length / 512) * 512);
    out.set(bytes);
    return out;
  };
  const tar = (...parts: Uint8Array[]) => {
    const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0) + 1024);
    let at = 0;
    for (const p of parts) {
      all.set(p, at);
      at += p.length;
    }
    return all;
  };

  it("reads regular files, with ustar prefixes and pax long names, and skips directories", () => {
    const long = `src/${"x".repeat(120)}.typ`;
    // The record's length counts its own digits: 3 here.
    const pax = `${long.length + 10} path=${long}\n`;
    const files = untar(
      tar(
        header("./", 0, "5"),
        header("./typst.toml", 4),
        data("toml"),
        header("lib.typ", 2, "0", "src"),
        data("hi"),
        header("PaxHeader", pax.length, "x"),
        data(pax),
        header("ignored", 3),
        data("abc"),
      ),
    );
    expect([...files.keys()]).toEqual(["typst.toml", "src/lib.typ", long]);
    expect(new TextDecoder().decode(files.get(long))).toBe("abc");
  });

  it("reads a vendored tarball", () => {
    const cetz = UNIVERSE_PACKAGES.find((p) => p.name === "cetz") as Allowed[number];
    const files = untar(gunzipSync(readFileSync(fileURLToPath(cetz.url))));
    expect(files.has("typst.toml")).toBe(true);
    expect(files.has("src/lib.typ")).toBe(true);
    expect(files.get("cetz-core/cetz_core.wasm")?.length).toBeGreaterThan(100_000);
  });
});
