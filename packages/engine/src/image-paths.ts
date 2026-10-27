// Image paths in Typst source, found the same way by the client, which asks
// the app's `resolveImage` for their files (images.ts), and by the worker,
// which shows a placeholder for each one the document has no file for
// (fixers.ts). Only paths written as a string an `image` call starts with: a
// path in a variable is left to the compiler's error.

const ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t" };

/** A Typst string literal's value, or `null` for escapes Typst wouldn't take. */
export const stringValue = (literal: string): string | null => {
  let ok = true;
  const value = literal.slice(1, -1).replace(/\\(u\{([0-9a-fA-F]{1,6})\}|.)/g, (_, e: string, hex?: string) => {
    if (hex) return String.fromCodePoint(Math.min(Number.parseInt(hex, 16), 0x10ffff));
    if (e === "\\" || e === '"') return e;
    if (ESCAPES[e]) return ESCAPES[e] as string;
    ok = false;
    return "";
  });
  return ok ? value : null;
};

/**
 * A path as the document's files are keyed in the compiler, the way Typst
 * resolves it from the document (`cat.png`, `./cat.png` and `/cat.png` are all
 * `/cat.png`; a URL is a path too, `/https:/example.org/a.png`). `null` for
 * one no file can be written for: out of the project, a package's, the document.
 */
export const fileKey = (path: string): string | null => {
  if (path.startsWith("@")) return null;
  const parts = path.split("/").filter((s) => s !== "" && s !== ".");
  if (parts.length === 0 || parts.includes("..")) return null;
  const key = `/${parts.join("/")}`;
  return key === "/main.typ" ? null : key;
};

/** An image's source written as a string. */
export interface ImageSource {
  /** The string literal, quotes included. */
  from: number;
  to: number;
  path: string;
  key: string;
}

// A complete string as an image's source. One still being typed has no closing quote in the input yet.
const IMAGE_SOURCE = /\bimage\(\s*(?:source\s*:\s*)?("(?:[^"\\\n]|\\.)*")/g;

/** The image sources in `text` written as complete strings, in order. */
export const imageSources = (text: string): ImageSource[] => {
  if (!text.includes("image(")) return [];
  const sources: ImageSource[] = [];
  for (const m of text.matchAll(IMAGE_SOURCE)) {
    const literal = m[1] as string;
    const path = stringValue(literal);
    const key = path === null ? null : fileKey(path);
    const to = m.index + m[0].length;
    if (path !== null && key !== null) sources.push({ from: to - literal.length, to, path, key });
  }
  return sources;
};
