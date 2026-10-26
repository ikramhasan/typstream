// Splits Typst's HTML export into top-level blocks without parsing it (PLAN
// §6.5, #16). Parsing and sanitizing a whole 20-page document on every update
// would take the main thread's whole budget, so the renderer compares blocks as
// strings and parses only the ones that changed.
//
// typst-html's serializer (encode.rs) is regular, which makes a depth count
// exact: attribute values are always double-quoted; `<` in text is always
// `&lt;`; void elements are the HTML void list; raw text appears only in
// `script`/`style` (never containing their closing tag) and `textarea`/`title`;
// and `/>` closes only `mspace`/`mprescripts` and elements in `html.frame` SVG.
// Input that breaks these rules can't split wrongly, only coarsely: it ends up
// as one block, which the sanitizer cleans like any other.

/** One top-level block of a document. */
export interface SplitBlock {
  /** Its HTML. Also its identity: a block whose HTML didn't change is kept. */
  html: string;
  /** Source offset from the anchor before it (PLAN §10.2), or `null`. */
  src: number | null;
}

export interface Split {
  /**
   * Start and end tags of the elements wrapping every block (a template's
   * `#show: body => html.div(body)`), outermost first, joined. Empty when
   * the blocks are the body's children.
   */
  shell: string;
  /** The wrappers' HTML, start tags then end tags, for building them. */
  shellStart: string[];
  shellEnd: string[];
  blocks: SplitBlock[];
  /** What the next split of the same document can reuse. */
  reuse: Reuse | null;
}

interface Reuse {
  /** The body's text before and after the blocks (wrappers, anchors before them), copied. */
  head: string;
  tail: string;
  /** Source offset in effect before the first block. */
  srcStart: number | null;
  /**
   * For each block, the text from the end of the one before it to its own end
   * (anchors included), copied. `null` for text, which can grow when more is appended.
   */
  segments: (string | null)[];
  /** Source offset in effect after each block. */
  srcAfter: (number | null)[];
}

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
const RAW = new Set(["script", "style", "textarea", "title"]);
/** Elements a template wraps the whole document in, descended into. */
const WRAPPERS = new Set(["div", "section", "article", "main"]);

const ANCHOR = /^<typstream-anchor data-src="(\d+)"><\/typstream-anchor>$/;
/** Typst writes footnotes after the last block; no anchor belongs to them. */
const ENDNOTES = '<section role="doc-endnotes"';

interface Item {
  start: number;
  end: number;
  /** Lowercased tag name for elements, `null` for text. */
  tag: string | null;
  /** End of the start tag (for elements). */
  open: number;
}

const isNameChar = (c: number): boolean =>
  c !== 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0c && c !== 0x0d && c !== 0x2f && c !== 0x3e && !Number.isNaN(c);

/** End (after `>`) of the tag starting at `at`, honoring quoted attribute values; -1 if unterminated. */
const tagEnd = (s: string, at: number, to: number): number => {
  let quote = 0;
  for (let i = at + 1; i < to; i++) {
    const c = s.charCodeAt(i);
    if (quote) {
      if (c === quote) quote = 0;
    } else if (c === 0x22 || c === 0x27) quote = c;
    else if (c === 0x3e) return i + 1;
  }
  return -1;
};

/** The top-level items of `s[from, to)`, or `null` if the markup isn't balanced. */
const scan = (s: string, from: number, to: number): Item[] | null => {
  const items: Item[] = [];
  let depth = 0;
  let start = from;
  let tag: string | null = null;
  let open = from;
  let i = from;
  while (i < to) {
    if (s.charCodeAt(i) !== 0x3c /* < */) {
      const next = s.indexOf("<", i);
      const end = next === -1 || next > to ? to : next;
      if (depth === 0 && s.slice(i, end).trim() !== "") items.push({ start: i, end, tag: null, open: i });
      i = end;
      continue;
    }
    const c = s.charCodeAt(i + 1);
    if (c === 0x21 /* ! */) {
      // A comment (Typst writes none) or a doctype.
      const end = s.startsWith("<!--", i) ? s.indexOf("-->", i + 4) + 3 : s.indexOf(">", i) + 1;
      if (end <= 0 || end > to) return null;
      i = end;
      continue;
    }
    if (c === 0x2f /* / */) {
      const end = s.indexOf(">", i) + 1;
      if (end <= 0 || end > to || depth === 0) return null;
      depth--;
      i = end;
      if (depth === 0) items.push({ start, end, tag, open });
      continue;
    }
    let n = i + 1;
    while (n < to && isNameChar(s.charCodeAt(n))) n++;
    if (n === i + 1) return null;
    // Typst writes tag names in lowercase (and SVG's camelCase ones are neither void nor raw).
    const name = s.slice(i + 1, n);
    const end = tagEnd(s, n - 1, to);
    if (end === -1) return null;
    if (depth === 0) {
      start = i;
      tag = name;
      open = end;
    }
    if (VOID.has(name) || s.charCodeAt(end - 2) === 0x2f /* / */) {
      i = end;
      if (depth === 0) items.push({ start, end, tag, open });
      continue;
    }
    if (RAW.has(name)) {
      // Raw text runs to the closing tag, which Typst refuses to write inside it
      // (encode.rs, `write_raw`). Typst writes tag names in lowercase.
      const close = s.indexOf(`</${name}`, end);
      if (close === -1 || close > to) return null;
      i = close;
      depth++;
      continue;
    }
    depth++;
    i = end;
  }
  return depth === 0 ? items : null;
};

/** The start and end of the body's content (the whole string if it has no `<body>`). */
const bodyOf = (html: string): [number, number] => {
  const body = html.indexOf("<body");
  if (body === -1) return [0, html.length];
  const start = html.indexOf(">", body) + 1;
  const end = html.lastIndexOf("</body>");
  return [start, end < start ? html.length : end];
};

/** A string that doesn't share memory with the one it was sliced from (streamdown's `copyString`). */
const copy = (s: string): string => ` ${s}`.slice(1);

const WRAPPER_START = /^<(?:div|section|article|main)[\s>]/;

/**
 * Turns scanned items from `from` on into blocks, appending to `blocks` and
 * `reuse`. Block HTML is copied, so blocks kept across updates don't pin the
 * artifacts they came from.
 */
const collect = (
  html: string,
  items: readonly Item[],
  from: number,
  src: number | null,
  blocks: SplitBlock[],
  reuse: Reuse,
): void => {
  let prev = from;
  for (const item of items) {
    if (item.tag === "typstream-anchor") {
      const anchor = ANCHOR.exec(html.slice(item.start, item.end));
      if (anchor) {
        src = Number(anchor[1]);
        continue;
      }
    }
    const segment = copy(html.slice(prev, item.end));
    const own = segment.slice(item.start - prev);
    blocks.push({ html: own, src: own.startsWith(ENDNOTES) ? null : src });
    reuse.segments.push(item.tag === null ? null : segment);
    reuse.srcAfter.push(src);
    prev = item.end;
  }
};

const full = (html: string, from: number, to: number): Split => {
  const bodyFrom = from;
  const bodyTo = to;
  const shellStart: string[] = [];
  const shellEnd: string[] = [];
  let src: number | null = null;
  for (;;) {
    const items = scan(html, from, to);
    const shell = shellStart.join("") + shellEnd.join("");
    if (!items)
      return { shell, shellStart, shellEnd, blocks: [{ html: copy(html.slice(from, to)), src }], reuse: null };
    // A template that wraps the whole document: split inside the wrapper. The
    // anchor before the wrapper marks its first block, unless one inside does.
    let wrapper: Item | null = null;
    let elements = 0;
    let inside: number | null = src;
    for (const item of items) {
      const anchor = item.tag === "typstream-anchor" ? ANCHOR.exec(html.slice(item.start, item.end)) : null;
      if (anchor) inside = Number(anchor[1]);
      else {
        elements++;
        wrapper = item;
      }
    }
    if (elements === 1 && wrapper?.tag && WRAPPERS.has(wrapper.tag)) {
      const close = wrapper.end - (wrapper.tag.length + 3);
      shellStart.push(html.slice(wrapper.start, wrapper.open));
      shellEnd.unshift(html.slice(close, wrapper.end));
      from = wrapper.open;
      to = close;
      src = inside;
      continue;
    }
    const reuse: Reuse = {
      head: copy(html.slice(bodyFrom, from)),
      tail: copy(html.slice(to, bodyTo)),
      srcStart: src,
      segments: [],
      srcAfter: [],
    };
    const blocks: SplitBlock[] = [];
    collect(html, items, from, src, blocks, reuse);
    return { shell, shellStart, shellEnd, blocks, reuse };
  }
};

/**
 * Splits from where `previous` (the split of an earlier version of the same
 * document) stops matching: its leading blocks are verified with `startsWith`,
 * kept as they are, and only the rest is scanned. `null` when the wrappers
 * changed or the rest doesn't scan, for a full split instead.
 */
const resume = (html: string, from: number, to: number, previous: Split, reuse: Reuse): Split | null => {
  const { head, tail, segments } = reuse;
  const start = from + head.length;
  const end = to - tail.length;
  if (end < start || !html.startsWith(head, from) || !html.startsWith(tail, end)) return null;
  let pos = start;
  let kept = 0;
  while (kept < segments.length) {
    const segment = segments[kept];
    if (segment == null || !html.startsWith(segment, pos)) break;
    pos += segment.length;
    kept++;
  }
  const items = scan(html, pos, end);
  if (!items) return null;
  const next: Reuse = {
    head,
    tail,
    srcStart: reuse.srcStart,
    segments: segments.slice(0, kept),
    srcAfter: reuse.srcAfter.slice(0, kept),
  };
  const blocks = previous.blocks.slice(0, kept);
  collect(html, items, pos, kept > 0 ? (reuse.srcAfter[kept - 1] ?? null) : reuse.srcStart, blocks, next);
  // A lone wrapper would be descended into by a full split.
  if (blocks.length === 1 && WRAPPER_START.test((blocks[0] as SplitBlock).html)) return null;
  return { shell: previous.shell, shellStart: previous.shellStart, shellEnd: previous.shellEnd, blocks, reuse: next };
};

/**
 * Splits a Typst HTML document (or a fragment of one) into top-level blocks.
 * Pass the split of the document's previous version to scan only what changed.
 */
export const splitHtml = (html: string, previous?: Split | null): Split => {
  const [from, to] = bodyOf(html);
  const reused = previous?.reuse ? resume(html, from, to, previous, previous.reuse) : null;
  return reused ?? full(html, from, to);
};
