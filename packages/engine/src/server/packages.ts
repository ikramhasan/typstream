// Typst packages (PLAN §6.4, #25). The World's `file()` is synchronous, so
// imports are resolved by a pre-pass before each compile: the preamble and the
// document are scanned for package specs (`"@preview/cetz:0.5.3"`), allowed
// ones are fetched, checked against their integrity hash, untarred and mounted
// in the document's files under `@ns/name:version/…` keys, which engine-wasm
// roots at the package. Mounted packages are scanned the same way for their own
// imports. Nothing outside the allowlist is ever fetched: Typst then reports the
// package as not found, and the server says why (`describe`).
//
// Models write the versions they saw in training (`cetz:0.2.2`), so a request
// for another version of an allowed package gets the nearest allowed one,
// mounted under the requested spec with its manifest's version rewritten, and
// a warning on the import.

import type { Diagnostic, FileContent, PackageSpec, Range } from "@typstream/core";
import { gunzip, untar } from "./tar";

/**
 * How the server loads Typst packages.
 * @beta
 */
export interface PackageOptions {
  /** Packages every document may import, whatever the client sends. Default none. */
  allowlist?: readonly PackageSpec[];
  /**
   * Also allow the packages the client lists (`initialize`'s and
   * `document/open`'s). Default true: in a browser worker the client is the
   * page. A server facing untrusted clients sets false, or any client could
   * make it fetch any URL.
   */
  trustClient?: boolean;
  /**
   * Where packages without a `url` come from: `${registry}/${namespace}/${name}-${version}.tar.gz`,
   * the layout of `https://packages.typst.org`. Default none: such packages fail to load.
   */
  registry?: string;
  /** Cache Storage cache that keeps tarballs across sessions, where there is one. `false` turns it off. Default `"typstream-packages"`. */
  cache?: string | false;
  /** Fetches a tarball. Default `fetch`. */
  fetch?: (url: string) => Promise<Response>;
}

/** A package request, `@namespace/name:x.y.z`. */
interface Request {
  namespace: string;
  name: string;
  version: [number, number, number];
}

/** A spec as Typst writes it. */
export const specString = (p: { namespace: string; name: string; version: string }): string =>
  `@${p.namespace}/${p.name}:${p.version}`;

// A package spec in a string literal: what `import` and `include` take. A spec
// still being typed (`"@preview/cet`, healed closed) doesn't match.
const SPEC = /"@([A-Za-z_][\w-]*)\/([A-Za-z_][\w-]*):(\d+)\.(\d+)\.(\d+)"/g;

/** The package specs a Typst text names, with the range of each (quotes included). */
export const scanSpecs = (text: string): { spec: string; range: Range }[] => {
  if (!text.includes('"@')) return [];
  return [...text.matchAll(SPEC)].map((m) => ({
    spec: m[0].slice(1, -1),
    range: { from: m.index, to: m.index + m[0].length },
  }));
};

const parse = (spec: string): Request | null => {
  const m = /^@([^/]+)\/([^:]+):(\d+)\.(\d+)\.(\d+)$/.exec(spec);
  if (!m) return null;
  const [, namespace = "", name = "", major, minor, patch] = m;
  return { namespace, name, version: [Number(major), Number(minor), Number(patch)] };
};

const versionOf = (p: PackageSpec): number[] => p.version.split(".").map(Number);

const newer = (a: PackageSpec, b: PackageSpec): boolean => {
  const [x, y] = [versionOf(a), versionOf(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

/**
 * The allowed package a request gets: the same version; else the newest with
 * the same major.minor; else the newest of that name. `undefined` when the name
 * isn't allowed at all.
 */
export const resolvePackage = (spec: string, allowed: readonly PackageSpec[]): PackageSpec | undefined => {
  const r = parse(spec);
  if (!r) return undefined;
  const named = allowed.filter((p) => p.namespace === r.namespace && p.name === r.name);
  const newest = (list: PackageSpec[]) =>
    list.reduce<PackageSpec | undefined>((a, p) => (!a || newer(p, a) ? p : a), undefined);
  const [major, minor] = r.version;
  return (
    named.find((p) => p.version === r.version.join(".")) ??
    newest(named.filter((p) => versionOf(p)[0] === major && versionOf(p)[1] === minor)) ??
    newest(named)
  );
};

/** A fetched package: its files as the World takes them, and the specs its sources import. */
interface Loaded {
  files: Map<string, FileContent>;
  imports: string[];
}

const DIGESTS: Record<string, string> = { sha256: "SHA-256", sha384: "SHA-384", sha512: "SHA-512" };

const base64 = (bytes: ArrayBuffer): string => {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
};

/** The tar in a fetched archive: gzipped as published, or already decompressed in transit. */
const tarOf = (bytes: Uint8Array): Promise<Uint8Array> | Uint8Array =>
  bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzip(bytes) : bytes;

const matches = async (bytes: Uint8Array, integrity: string): Promise<boolean> => {
  for (const entry of integrity.trim().split(/\s+/)) {
    const dash = entry.indexOf("-");
    const algorithm = DIGESTS[entry.slice(0, dash)];
    if (!algorithm) continue;
    const digest = await crypto.subtle.digest(algorithm, bytes as Uint8Array<ArrayBuffer>);
    if (base64(digest) === entry.slice(dash + 1).split("?")[0]) return true;
  }
  return false;
};

/**
 * Whether a fetched archive matches an SRI string (any of its hashes may
 * match): the bytes as fetched, or the uncompressed tar. Servers often send
 * `.gz` files with `Content-Encoding: gzip`, and the browser then hands over
 * the tar, so a hash of the tar holds however the archive travelled.
 */
export const checkIntegrity = async (bytes: Uint8Array, integrity: string): Promise<boolean> =>
  (await matches(bytes, integrity)) || (await matches(await tarOf(bytes), integrity));

/** How long a failed download is remembered before a compile tries it again, ms. */
export const RETRY_MS = 10_000;

const utf8 = new TextDecoder();

/** The parts of Cache Storage used here. Looked up at runtime, so the package needs no DOM types. */
interface TarballCache {
  match(url: string): Promise<Response | undefined>;
  put(url: string, response: Response): Promise<void>;
  delete(url: string): Promise<boolean>;
}

const cacheStorage = (globalThis as { caches?: { open(name: string): Promise<TarballCache> } }).caches;

/**
 * Downloads, checks and unpacks packages; shared by every document of a server,
 * so each package is fetched once.
 */
export class PackageStore {
  private client: readonly PackageSpec[] = [];
  private readonly loads = new Map<string, { promise: Promise<Loaded>; failedAt?: number }>();

  constructor(private readonly options: PackageOptions = {}) {}

  /** The client's engine-wide list (`initialize`). */
  setClientPackages(packages: readonly PackageSpec[] | undefined): void {
    this.client = packages ?? [];
  }

  /** What a document may import: the server's list, plus the client's when trusted. */
  allowlist(document: readonly PackageSpec[] | undefined): PackageSpec[] {
    const own = [...(this.options.allowlist ?? [])];
    return this.options.trustClient === false ? own : [...own, ...this.client, ...(document ?? [])];
  }

  /** Loads a package, once; a failure is retried after {@link RETRY_MS}. */
  load(p: PackageSpec): Promise<Loaded> {
    const key = `${specString(p)} ${p.url ?? ""} ${p.integrity ?? ""}`;
    const known = this.loads.get(key);
    if (known && (known.failedAt === undefined || performance.now() - known.failedAt < RETRY_MS)) return known.promise;
    const entry: { promise: Promise<Loaded>; failedAt?: number } = { promise: this.fetchPackage(p) };
    entry.promise.catch(() => {
      entry.failedAt = performance.now();
    });
    this.loads.set(key, entry);
    return entry.promise;
  }

  private url(p: PackageSpec): string {
    if (p.url) return p.url;
    const { registry } = this.options;
    if (!registry) throw new Error("it has no url and the server has no package registry");
    return `${registry.replace(/\/+$/, "")}/${p.namespace}/${p.name}-${p.version}.tar.gz`;
  }

  private async cached(): Promise<TarballCache | null> {
    const name = this.options.cache ?? "typstream-packages";
    if (name === false || !cacheStorage) return null;
    try {
      return await cacheStorage.open(name);
    } catch {
      // Cache Storage can be unavailable (opaque origins, some private modes).
      return null;
    }
  }

  private async fetchPackage(p: PackageSpec): Promise<Loaded> {
    const url = this.url(p);
    const cache = await this.cached();
    let bytes: Uint8Array | null = null;
    const hit = await cache?.match(url).catch(() => undefined);
    if (hit) {
      bytes = new Uint8Array(await hit.arrayBuffer());
      if (p.integrity && !(await checkIntegrity(bytes, p.integrity))) {
        await cache?.delete(url).catch(() => {});
        bytes = null;
      }
    }
    if (!bytes) {
      const response = await (this.options.fetch ?? fetch)(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      bytes = new Uint8Array(await response.arrayBuffer());
      if (p.integrity && !(await checkIntegrity(bytes, p.integrity))) throw new Error("integrity check failed");
      await cache?.put(url, new Response(bytes as Uint8Array<ArrayBuffer>)).catch(() => {});
    }
    const files = new Map<string, FileContent>();
    const imports = new Set<string>();
    for (const [path, data] of untar(await tarOf(bytes))) {
      if (path.endsWith(".typ")) {
        const text = utf8.decode(data);
        files.set(path, text);
        for (const { spec } of scanSpecs(text)) imports.add(spec);
      } else files.set(path, data);
    }
    if (!files.has("typst.toml")) throw new Error("the archive has no typst.toml");
    return { files, imports: [...imports] };
  }
}

/** What happened to one requested spec in one document. */
type Entry =
  | { status: "denied" }
  | { status: "loading"; using: PackageSpec; promise: Promise<Loaded> }
  | { status: "loaded"; using: PackageSpec; loaded: Loaded }
  | { status: "mounted"; using: PackageSpec }
  | { status: "failed"; using: PackageSpec; reason: string; at: number };

/** The `version` of a manifest's `[package]` table set to `version`, for a package mounted under another spec. */
const rewriteVersion = (manifest: string, version: string): string => {
  const table = manifest.search(/^\s*\[package\]\s*$/m);
  const at = table < 0 ? 0 : table;
  return manifest.slice(0, at) + manifest.slice(at).replace(/^(\s*version\s*=\s*)"[^"]*"/m, `$1"${version}"`);
};

/**
 * One document's packages: what it may import, what it asked for, what is
 * mounted in its compiler.
 */
export class DocumentPackages {
  private readonly entries = new Map<string, Entry>();
  private readonly allowed: PackageSpec[];

  constructor(
    private readonly store: PackageStore,
    packages: readonly PackageSpec[] | undefined,
    private readonly mount: (files: Record<string, FileContent>) => void,
  ) {
    this.allowed = store.allowlist(packages);
  }

  /** Starts loading what `spec` needs, unless it is known (or failed recently). */
  private request(spec: string): void {
    const known = this.entries.get(spec);
    if (known && !(known.status === "failed" && performance.now() - known.at >= RETRY_MS)) return;
    const using = resolvePackage(spec, this.allowed);
    if (!using) {
      this.entries.set(spec, { status: "denied" });
      return;
    }
    const promise = this.store.load(using);
    const entry: Entry = { status: "loading", using, promise };
    this.entries.set(spec, entry);
    promise.then(
      (loaded) => {
        if (this.entries.get(spec) === entry) this.entries.set(spec, { status: "loaded", using, loaded });
      },
      (e: unknown) => {
        const reason = e instanceof Error ? e.message : String(e);
        if (this.entries.get(spec) === entry)
          this.entries.set(spec, { status: "failed", using, reason, at: performance.now() });
      },
    );
  }

  /** Mounts what has loaded under its requested spec, and requests its own imports. Returns whether anything was. */
  private mountLoaded(): boolean {
    let any = false;
    for (const [spec, entry] of this.entries) {
      if (entry.status !== "loaded") continue;
      const files: Record<string, FileContent> = {};
      const version = spec.slice(spec.lastIndexOf(":") + 1);
      for (const [path, content] of entry.loaded.files) {
        files[`${spec}/${path}`] =
          path === "typst.toml" && version !== entry.using.version && typeof content !== "string"
            ? rewriteVersion(utf8.decode(content), version)
            : content;
      }
      try {
        this.mount(files);
        this.entries.set(spec, { status: "mounted", using: entry.using });
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        this.entries.set(spec, { status: "failed", using: entry.using, reason, at: performance.now() });
      }
      for (const imported of entry.loaded.imports) this.request(imported);
      any = true;
    }
    return any;
  }

  private pending(): Promise<unknown>[] {
    return [...this.entries.values()].flatMap((e) => (e.status === "loading" ? [e.promise.catch(() => {})] : []));
  }

  /**
   * Before a compile: requests the packages `source` names, waits for them (and
   * for their own imports) until `deadline` (`performance.now()`), and mounts
   * what arrived. Resolves to `{ loading }`, settled once the rest have
   * loaded, when some still are; else `null`. (Wrapped: an async function
   * returning the promise itself would wait for it.)
   */
  async prepare(source: string, deadline: number): Promise<{ loading: Promise<void> } | null> {
    for (const { spec } of scanSpecs(source)) this.request(spec);
    for (;;) {
      if (this.mountLoaded()) continue;
      const pending = this.pending();
      if (pending.length === 0) return null;
      const left = deadline - performance.now();
      if (left <= 0) return { loading: Promise.all(pending).then(() => {}) };
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.race(pending),
        new Promise((resolve) => {
          timer = setTimeout(resolve, left);
        }),
      ]);
      clearTimeout(timer);
    }
  }

  /**
   * Typst's "package not found" for a spec this document asked for, said
   * better: not allowed, still loading, or why it failed.
   */
  describe(d: Diagnostic): Diagnostic {
    const spec = /^package not found \(searched for (@[^)]+)\)$/.exec(d.message)?.[1];
    const entry = spec === undefined ? undefined : this.entries.get(spec);
    if (!entry || spec === undefined) return d;
    switch (entry.status) {
      case "denied": {
        const names = [...new Set(this.allowed.map(specString))];
        const hint = names.length ? `allowed packages: ${names.join(", ")}` : "no packages are allowed here";
        return { ...d, message: `package ${spec} is not allowed`, hints: [...d.hints, hint] };
      }
      case "loading":
      case "loaded":
        return { ...d, message: `package ${spec} is still loading` };
      case "failed":
        return { ...d, message: `package ${spec} failed to load (${entry.reason})` };
      default:
        return d;
    }
  }

  /** Warnings for the specs in `text` (the document, without its preamble) that get another version. */
  substitutions(text: string): Diagnostic[] {
    return scanSpecs(text).flatMap(({ spec, range }) => {
      const entry = this.entries.get(spec);
      if (!entry || entry.status === "denied" || specString(entry.using) === spec) return [];
      return [
        {
          severity: "warning",
          span: range,
          message: `package ${spec} isn't available here; using ${specString(entry.using)}`,
          hints: [],
          trace: [],
          source: "typstream",
        } satisfies Diagnostic,
      ];
    });
  }
}
