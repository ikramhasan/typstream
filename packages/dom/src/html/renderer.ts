// The HTML renderer (PLAN §6.5, #16): keeps a DOM element in step with the
// HTML artifacts of a streaming document, touching only the blocks that
// changed.
//
// Each update splits the HTML into top-level blocks as strings (split.ts),
// keeps every block whose string is unchanged (its DOM nodes are never
// re-created), and parses, sanitizes and inserts only the rest. Source anchors
// become `data-typstream-src` attributes, so a block resolves to its source
// range without asking the engine (§10.2).

import { type FileContent, ISLAND_MARKER, type TypstreamPlugin, trustedHTML } from "@typstream/core";
import { createIslands, type IslandRenderers, type Islands, MAX_ISLAND_DATA, type Marker } from "../islands";
import {
  type AnimateOptions,
  AnimateTimeline,
  animateBlock,
  animateConfig,
  type Timings,
  visibleText,
} from "./animate";
import { injectCss } from "./css";
import { directionOf } from "./dir";
import { createHtmlPages, parseGeometry } from "./pages";
import { collapseSpaces, rowRuns, wrapRuns } from "./runs";
import { createSanitizer, hideStyles, type Sanitizer } from "./sanitize";
import { type Split, type SplitBlock, splitHtml } from "./split";
import { htmlRendererCss } from "./styles";

/** Options for {@link createHtmlRenderer}. @public */
export interface HtmlRendererOptions {
  /** `auto` (default) follows the page's `color-scheme`; `light` and `dark` force one. */
  theme?: "auto" | "light" | "dark";
  /** Word fade-in settings, used by updates with `animate`. */
  animation?: AnimateOptions;
  /**
   * Prefix for the document's ids (and the links to them), so documents on one
   * page don't collide. Default: unique per renderer.
   */
  idPrefix?: string;
  /**
   * Plugins whose `sanitize` facet allows more tags and attributes, and whose
   * `stylesheets` are injected before `stylesheets` (html-compat's, for one),
   * in the order given (mountTypstream passes the engine's resolved list, dependencies first).
   */
  plugins?: readonly TypstreamPlugin[];
  /** `target` of links to http(s) URLs; `null` keeps them in the same tab. Default `_blank`. */
  linkTarget?: string | null;
  /**
   * More CSS to inject next to the renderer's own and the plugins'.
   * Injected once per document or shadow root, as constructable
   * stylesheets where supported (no `style-src 'unsafe-inline'` needed).
   */
  stylesheets?: readonly string[];
  /** Inject {@link htmlRendererCss}, the plugins' stylesheets and `stylesheets`. Default true; pass false to ship them yourself. */
  injectStyles?: boolean;
  /**
   * Island renderers by name (PLAN §8.4): each `typstream-island` marker whose
   * name a plugin in `plugins` declares is mounted over its fallback.
   * @beta
   */
  islands?: IslandRenderers;
  /** What islands get as `IslandProps.file`: the document's files. Default: none. @beta */
  file?: (path: string) => FileContent | null;
  /**
   * How the document's pages are shown, as the paged view's layouts: `fixed` (default), its pages at their own
   * size, scaled down to fit the element; `fit-width`, scaled to the element's width; `reflow`, pages as wide as
   * the element (open the document with the paged view's `REFLOW_PREAMBLE` and `reflowInputs`, which html-compat
   * reads). The document is laid out on sheets of its page size and margins and breaks across them where Typst
   * breaks its pages.
   */
  layout?: "fixed" | "fit-width" | "reflow";
  /**
   * Called when the number of pages changes. A document whose headers or footers show the page count
   * (`counter(page).final()`) reads it from the input `typstream-page-count` (html-compat): `mountTypstream` sets it
   * and compiles again.
   * @beta
   */
  onPages?: (count: number) => void;
}

/** Per-update options. @public */
export interface HtmlUpdateOptions {
  /** Fade in new words (while streaming). Default false. */
  animate?: boolean;
  /** Show a caret after the last text (while streaming). Default false. */
  caret?: boolean;
  /**
   * While streaming, heal's stable offset (`stableOffset`): islands whose block
   * starts at or after it are incomplete. Default: the document is complete.
   * @beta
   */
  stable?: number | null;
}

/** What an update did. @public */
export interface HtmlUpdateResult {
  /** Top-level blocks now shown. */
  blocks: number;
  /** Blocks parsed and inserted by this update. */
  created: number;
  /** Blocks removed by this update. */
  removed: number;
  /** Main-thread time of the update, ms. */
  ms: number;
}

/** A rendered HTML document. @public */
export interface HtmlRenderer {
  /** The element the document is rendered into. */
  readonly root: HTMLElement;
  /** Shows `html` (a Typst HTML export, untrusted), changing only what differs from the last update. */
  update(html: string, options?: HtmlUpdateOptions): HtmlUpdateResult;
  /**
   * The source range of the top-level block containing `node`: from its
   * anchor to the next one, `to` being `null` for the last. Offsets are in the
   * compiled document (the healed source, without the preamble; map them to
   * the raw stream with heal's `map.toInput`). `null` for nodes outside a
   * block, or blocks without an anchor (before the first one, footnotes).
   * @beta
   */
  sourceRange(node: Node): { from: number; to: number | null } | null;
  /**
   * The top-level block whose source range contains `offset`, if any.
   * @beta
   */
  blockAt(offset: number): Element | null;
  /** Removes the document. The renderer can be updated again. */
  clear(): void;
  /** Removes the document and everything the renderer added to `root`. */
  dispose(): void;
}

/** One rendered top-level block. */
interface Block {
  /** Its HTML: the identity compared across updates (split.ts copies it, so it doesn't pin the artifact). */
  key: string;
  nodes: Node[];
  src: number | null;
  /** Its element has {@link START_ATTRIBUTE}. */
  start: boolean;
  /** Start times of words still fading in. */
  timings: Timings | null;
}

const SRC_ATTRIBUTE = "data-typstream-src";
/** On a block right after its anchor: one the source starts after a blank line (html-compat's CSS reads it). */
const START_ATTRIBUTE = "data-typstream-start";

/**
 * The page html-compat writes on the source anchors, and its header and footer inside them: the last anchor's (a
 * document's pages are all alike). The first ones can come before the document's `#set page(..)`, or a template's.
 */
const PAGES = /<typstream-anchor data-src="\d+" data-page="([^"]*)">([\s\S]*?)<\/typstream-anchor>/y;

/** The last anchor's match of `PAGES` in `html`: found from the end, so a long document isn't scanned whole. */
const lastPage = (html: string): RegExpExecArray | null => {
  for (let at = html.lastIndexOf("<typstream-anchor "); at >= 0; at = html.lastIndexOf("<typstream-anchor ", at - 1)) {
    PAGES.lastIndex = at;
    const m = PAGES.exec(html);
    if (m && m.index === at) return m;
    if (at === 0) break;
  }
  return null;
};

/**
 * Typst writes the document's language on `<html>`, first in its output, and
 * nothing about direction: it derives that from the language (`Lang::dir` in
 * typst-library's lang.rs), as the renderer does for its root.
 */
const HTML_LANG = /^(?:<!DOCTYPE html>\s*)?<html[^>]*?\slang="([^"]+)"/i;

let renderers = 0;

const firstElement = (nodes: readonly Node[]): Element | null =>
  (nodes.find((n) => n.nodeType === 1) as Element | undefined) ?? null;

const lastElement = (nodes: readonly Node[]): Element | null => {
  for (let i = nodes.length - 1; i >= 0; i--) if ((nodes[i] as Node).nodeType === 1) return nodes[i] as Element;
  return null;
};

// --- caret ----------------------------------------------------------------------------

/** Elements the caret doesn't go into: it goes after them. */
const CARET_STOP = new Set(["math", "svg", "pre", "img", "hr", "br", "wbr", ISLAND_MARKER]);

/** Where the caret goes: the deepest last element of `block` that holds text. */
const caretParent = (block: Element): Element => {
  let el = block;
  for (;;) {
    // Tables: their last cell.
    if (el.localName === "table") {
      const rows = (el as HTMLTableElement).rows;
      const cells = rows[rows.length - 1]?.cells;
      const cell = cells?.[cells.length - 1];
      if (!cell) return el;
      el = cell;
      continue;
    }
    let last = el.lastChild;
    while (last && last.nodeType === 3 && (last as Text).data.trim() === "") last = last.previousSibling;
    // Not into a run of text (`typstream-t`): the caret goes after it, in what holds it.
    if (
      !last ||
      last.nodeType !== 1 ||
      CARET_STOP.has((last as Element).localName) ||
      (last as Element).classList.contains("typstream-t")
    )
      return el;
    el = last as Element;
  }
};

// --- renderer -------------------------------------------------------------------------

/**
 * Renders Typst HTML artifacts into `root`, keeping the DOM of unchanged
 * blocks across updates.
 *
 * @example
 * ```ts
 * const renderer = createHtmlRenderer(element, { plugins: [htmlCompat] });
 * doc.subscribe((s) => {
 *   if (s.artifact?.target === "html") renderer.update(s.artifact.html, { animate: !s.final, caret: !s.final });
 * });
 * ```
 * @public
 */
export const createHtmlRenderer = (root: HTMLElement, options: HtmlRendererOptions = {}): HtmlRenderer => {
  const id = renderers++;
  const doc = root.ownerDocument;
  const view = doc.defaultView as Window & typeof globalThis;
  // Markup is parsed in a document with no browsing context: nothing in it runs or loads.
  const inert = doc.implementation.createHTMLDocument("");
  const template = inert.createElement("template");
  const sanitize: Sanitizer = createSanitizer({
    idPrefix: options.idPrefix ?? `typstream-${id}-`,
    ...(options.plugins ? { plugins: options.plugins } : {}),
    ...(options.linkTarget !== undefined ? { linkTarget: options.linkTarget } : {}),
  });
  const config = animateConfig(options.animation);
  const timeline = new AnimateTimeline(config.maxBacklogMs);

  root.classList.add("typstream");
  if (options.theme && options.theme !== "auto") root.setAttribute("data-typstream-theme", options.theme);
  root.style.setProperty("--typstream-animation", `typstream-${config.animation}`);
  root.style.setProperty("--typstream-duration", `${config.duration}ms`);
  root.style.setProperty("--typstream-easing", config.easing);
  if (options.injectStyles !== false) {
    // injectCss adds each stylesheet once per root, so a plugin's and the app's copy of one don't repeat.
    const plugins = (options.plugins ?? []).flatMap((p) => p.stylesheets ?? []);
    for (const css of [htmlRendererCss, ...plugins, ...(options.stylesheets ?? [])]) injectCss(root, css);
  }

  const pages = createHtmlPages(root, options.layout ?? "fixed", options.onPages);
  /** Where the document goes: the flow over the pages. */
  const host = pages.flow;

  let shell: string | null = null;
  /** The page's header and footer, as html-compat wrote them. */
  let marginals = "";
  /** The last update's split, which the next one resumes from. */
  let lastSplit: Split | null = null;
  /** Where blocks live: the flow, or the innermost wrapper of the shell. */
  let container: Element = host;
  let blocks: Block[] = [];
  let caret: Element | null = null;
  const islands: Islands | null = options.islands
    ? createIslands({ renderers: options.islands, plugins: options.plugins, target: "html", file: options.file })
    : null;
  /** The island markers parsed, with what their attributes said (the sanitizer drops them). */
  const markers = new WeakMap<Element, { name: string; raw: string; data: unknown }>();

  /** Parses and sanitizes markup into nodes owned by the page's document. */
  const parse = (html: string): Node[] => {
    // Under Trusted Types (#70) through typstream's policy: the template is inert, and sanitized next.
    template.innerHTML = trustedHTML(hideStyles(html));
    const content = template.content;
    if (islands) {
      for (const el of content.querySelectorAll(ISLAND_MARKER)) {
        const name = el.getAttribute("name");
        const raw = el.getAttribute("props") ?? "";
        if (!name || raw.length > MAX_ISLAND_DATA) continue;
        try {
          markers.set(el, { name, raw, data: JSON.parse(raw) });
        } catch {
          // Not JSON: the fallback stays.
        }
      }
    }
    sanitize(content);
    collapseSpaces(content, inert);
    rowRuns(content, inert);
    wrapRuns(content, inert);
    // Moving the cleaned nodes adopts them into the page's document.
    const fragment = doc.createDocumentFragment();
    fragment.append(...Array.from(content.childNodes));
    return Array.from(fragment.childNodes);
  };

  const setSrc = (block: Block, src: number | null, start: boolean): void => {
    if (block.src === src && block.start === start) return;
    block.src = src;
    block.start = start;
    const el = firstElement(block.nodes);
    if (!el) return;
    if (src === null) el.removeAttribute(SRC_ATTRIBUTE);
    else el.setAttribute(SRC_ATTRIBUTE, String(src));
    el.toggleAttribute(START_ATTRIBUTE, start);
  };

  const removeNodes = (block: Block): void => {
    for (const node of block.nodes) (node as ChildNode).remove();
  };

  /** The document's language and direction, from Typst's `<html lang>`, on the root. */
  let language: string | undefined;
  const setLanguage = (lang: string | undefined): void => {
    if (lang === language) return;
    language = lang;
    if (lang) {
      root.lang = lang;
      root.dir = directionOf(lang);
    } else {
      root.removeAttribute("lang");
      root.removeAttribute("dir");
    }
  };

  /** Rebuilds the wrapper elements around the blocks. */
  const buildShell = (start: readonly string[], end: readonly string[]): void => {
    for (const block of blocks) removeNodes(block);
    blocks = [];
    if (container !== host) host.replaceChildren();
    container = host;
    if (start.length === 0) return;
    const nodes = parse(start.join("") + end.join(""));
    host.replaceChildren(...nodes);
    // The innermost element along the chain of first elements.
    let el = firstElement(nodes);
    while (el?.firstElementChild) el = el.firstElementChild;
    container = el ?? host;
  };

  const update = (html: string, opts: HtmlUpdateOptions = {}): HtmlUpdateResult => {
    const t0 = view.performance.now();
    caret?.remove();
    caret = null;

    const split = splitHtml(html, lastSplit);
    lastSplit = split;
    if (split.shell !== shell) {
      buildShell(split.shellStart, split.shellEnd);
      shell = split.shell;
    }
    setLanguage(HTML_LANG.exec(html)?.[1]);
    const page = lastPage(html);
    pages.setGeometry(parseGeometry(page?.[1]));
    if ((page?.[2] ?? "") !== marginals) {
      marginals = page?.[2] ?? "";
      pages.setMarginals(marginals ? parse(marginals) : []);
    }
    const next = split.blocks;
    const old = blocks;

    // Unchanged blocks at both ends (a stream changes the tail), then by key in between.
    let head = 0;
    while (
      head < old.length &&
      head < next.length &&
      (old[head] as Block).key === (next[head] as { html: string }).html
    )
      head++;
    let tail = 0;
    while (
      tail < old.length - head &&
      tail < next.length - head &&
      (old[old.length - 1 - tail] as Block).key === (next[next.length - 1 - tail] as { html: string }).html
    )
      tail++;
    const byKey = new Map<string, Block[]>();
    for (let i = head; i < old.length - tail; i++) {
      const block = old[i] as Block;
      const same = byKey.get(block.key);
      if (same) same.push(block);
      else byKey.set(block.key, [block]);
    }

    const result: Block[] = [];
    const created: Block[] = [];
    for (let i = 0; i < next.length; i++) {
      const item = next[i] as SplitBlock;
      let block: Block | undefined;
      if (i < head) block = old[i];
      else if (i >= next.length - tail) block = old[old.length - (next.length - i)];
      else block = byKey.get(item.html)?.shift();
      if (!block) {
        block = { key: item.html, nodes: parse(item.html), src: null, start: false, timings: null };
        created.push(block);
      }
      setSrc(block, item.src, item.start === true);
      result.push(block);
    }
    const reused = new Set(result);
    const removed = old.filter((b) => !reused.has(b));

    // New words fade in: a created block is compared with the removed block it replaces.
    if (opts.animate && created.length > 0) {
      const now = view.performance.now();
      timeline.begin(now);
      let r = 0;
      for (const block of created) {
        const replaced = removed[r++];
        const previous = replaced ? { text: visibleText(replaced.nodes), timings: replaced.timings } : null;
        block.timings = animateBlock(block.nodes, previous, timeline, config, now);
      }
      timeline.commit();
    }

    for (const block of removed) removeNodes(block);
    // Place blocks back to front, moving only those not already before the next one.
    let after: Node | null = null;
    for (let i = result.length - 1; i >= 0; i--) {
      const { nodes } = result[i] as Block;
      if (nodes.length === 0) continue;
      const last = nodes[nodes.length - 1] as Node;
      // Past the pages' breaks between blocks (pages.ts), which aren't blocks.
      let next = last.nextSibling;
      while (next && (next as Element).classList?.contains("typstream-break")) next = next.nextSibling;
      if (last.parentNode !== container || next !== after) {
        for (const node of nodes) container.insertBefore(node, after);
      }
      after = nodes[0] as Node;
    }
    blocks = result;
    if (islands) syncIslands(opts.stable ?? null);

    if (opts.caret) {
      // After the last block's text; footnotes come after the text, not at its end.
      let last: Element | null = null;
      for (let i = result.length - 1; i >= 0 && !last; i--) {
        const el = lastElement((result[i] as Block).nodes);
        if (el && !(el.localName === "section" && el.getAttribute("role") === "doc-endnotes")) last = el;
      }
      const parent = last ? caretParent(last) : container;
      caret = doc.createElement("span");
      caret.className = "typstream-caret";
      caret.setAttribute("aria-hidden", "true");
      parent.append(caret);
    }
    // Pages from the first block that changed (a stream changes the end); the caret's block changed too.
    const fresh = new Set(created);
    let changed = result.findIndex((block, i) => fresh.has(block) || block !== old[i]);
    if (changed < 0) changed = result.length - 1;
    const firstNode = result[changed]?.nodes[0] ?? null;
    pages.layout(caret && firstNode && caret.compareDocumentPosition(firstNode) & 4 ? caret : firstNode);

    return { blocks: result.length, created: created.length, removed: removed.length, ms: view.performance.now() - t0 };
  };

  /** Mounts the islands of the markers now shown, in document order. */
  const syncIslands = (stable: number | null): void => {
    const found: Marker[] = [];
    for (const el of container.querySelectorAll(ISLAND_MARKER)) {
      const marker = markers.get(el);
      if (marker) found.push({ ...marker, place: el as HTMLElement, from: topBlock(el)?.src ?? null });
    }
    islands?.sync(found, { stable });
  };

  const topBlock = (node: Node): Block | null => {
    let n: Node | null = node;
    while (n && n.parentNode !== container) n = n.parentNode;
    if (!n) return null;
    return blocks.find((b) => b.nodes.includes(n as Node)) ?? null;
  };

  /** The source range of the block at `index`. */
  const rangeOf = (index: number): { from: number; to: number | null } | null => {
    const src = (blocks[index] as Block).src;
    if (src === null) return null;
    for (let i = index + 1; i < blocks.length; i++) {
      const next = (blocks[i] as Block).src;
      if (next !== null && next !== src) return { from: src, to: next };
    }
    return { from: src, to: null };
  };

  const clear = (): void => {
    islands?.sync([], { stable: null });
    caret?.remove();
    caret = null;
    for (const block of blocks) removeNodes(block);
    blocks = [];
    host.replaceChildren();
    container = host;
    shell = null;
    lastSplit = null;
    pages.layout();
  };

  return {
    root,
    update,
    sourceRange(node) {
      const block = topBlock(node);
      return block ? rangeOf(blocks.indexOf(block)) : null;
    },
    blockAt(offset) {
      for (let i = 0; i < blocks.length; i++) {
        const range = rangeOf(i);
        if (range && offset >= range.from && (range.to === null || offset < range.to)) {
          return firstElement((blocks[i] as Block).nodes);
        }
      }
      return null;
    },
    clear,
    dispose() {
      clear();
      islands?.destroy();
      pages.dispose();
      setLanguage(undefined);
      root.classList.remove("typstream");
      root.removeAttribute("data-typstream-theme");
      for (const property of ["--typstream-animation", "--typstream-duration", "--typstream-easing"]) {
        root.style.removeProperty(property);
      }
    },
  };
};
