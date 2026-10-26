// Compares the text of HTML output with the paged output's, as multisets of letters and
// digits. Characters, not words: PDF text runs split words at style changes (H#sub[2]O) and
// lines, and the order of runs isn't reading order. Both sides are NFKD-normalized without
// combining marks, so math italic 𝑥 is x and an accented ẋ (one char in PDF, x + U+0307 in
// MathML) is x.
import { parse } from "parse5";

interface Node {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: Node[];
  content?: Node;
}

const attr = (node: Node, name: string): string | undefined => node.attrs?.find((a) => a.name === name)?.value;

/**
 * The text a reader gets from the HTML: text nodes outside <head> and <svg>, accessible labels
 * (inline SVG from html.frame has glyphs, not text), and the numbers browsers draw for <ol>.
 */
export const htmlText = (html: string): string => {
  const out: string[] = [];
  const walk = (node: Node): void => {
    if (node.nodeName === "#text") out.push(node.value ?? "");
    if (node.nodeName === "head" || node.nodeName === "svg") return;
    const label = attr(node, "aria-label");
    if (label) out.push(` ${label} `);
    if (node.nodeName === "ol" && !attr(node, "class")?.includes("ts-enum")) {
      const items = (node.childNodes ?? []).filter((c) => c.nodeName === "li");
      const reversed = attr(node, "reversed") !== undefined;
      let n = Number(attr(node, "start") ?? (reversed ? items.length : 1));
      // A list Typst styles itself (outline, footnotes, bibliography) draws no numbers.
      const numbered = !attr(node, "style")?.includes("list-style-type: none");
      for (const item of items) {
        const value = attr(item, "value");
        if (value !== undefined) n = Number(value);
        if (numbered) out.push(` ${n} `);
        n += reversed ? -1 : 1;
      }
    }
    for (const child of node.childNodes ?? []) walk(child);
    out.push(" ");
  };
  walk(parse(html) as unknown as Node);
  return out.join("");
};

export const chars = (text: string): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const c of text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .match(/[\p{L}\p{N}]/gu) ?? []) {
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return counts;
};

/** Characters in `reference` that `text` has fewer of, as a sorted string ("" if none). */
export const missing = (reference: string, text: string): string => {
  const have = chars(text);
  let out = "";
  for (const [c, n] of chars(reference)) out += c.repeat(Math.max(0, n - (have.get(c) ?? 0)));
  return [...out].sort().join("");
};

/**
 * Block elements (<div>) nested in <p> or <span>, as "p > span > div" paths. Browsers don't
 * build that tree: the parser closes the <p> at the <div>, and everything after escapes it.
 * So this reads the tags as written (Typst closes every element), not a parsed tree.
 */
export const blocksInInline = (html: string): string[] => {
  const VOID = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "source",
    "track",
    "wbr",
  ]);
  const body = html.slice(html.indexOf("<body>") + 6, html.lastIndexOf("</body>")).replace(/<svg[\s\S]*?<\/svg>/g, "");
  const found: string[] = [];
  const open: string[] = [];
  for (const [tag, close, name] of body.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g)) {
    if (!name || VOID.has(name) || tag.endsWith("/>")) continue;
    if (close) {
      if (open.pop() !== name) throw new Error(`unbalanced </${name}> in HTML output`);
    } else {
      if (name === "div" && open.some((t) => t === "p" || t === "span")) found.push([...open, "div"].join(" > "));
      open.push(name);
    }
  }
  return found;
};
