// The HTML renderer (PLAN §6.5, #16): keeps a DOM element in step with the
// HTML artifacts of a streaming document, touching only the blocks that
// changed.
//
// Each update splits the HTML into top-level blocks as strings (split.ts),
// keeps every block whose string is unchanged (its DOM nodes are never
// re-created), and parses, sanitizes and inserts only the rest. Source anchors
// become `data-typstream-src` attributes, so a block resolves to its source
// range without asking the engine (§10.2).

import { type TypstreamPlugin, trustedHTML } from "@typstream/core";
import {
  type AnimateOptions,
  AnimateTimeline,
  animateBlock,
  animateConfig,
  type Timings,
  visibleText,
} from "./animate";
import { directionOf } from "./dir";
import { createSanitizer, hideStyles, type Sanitizer } from "./sanitize";
import { type Split, splitHtml } from "./split";
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
}

/** Per-update options. @public */
export interface HtmlUpdateOptions {
  /** Fade in new words (while streaming). Default false. */
  animate?: boolean;
  /** Show a caret after the last text (while streaming). Default false. */
  caret?: boolean;
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
  /** Start times of words still fading in. */
  timings: Timings | null;
}

const SRC_ATTRIBUTE = "data-typstream-src";

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

// --- styles -------------------------------------------------------------------------

const injected = new WeakMap<Node, Set<string>>();

const injectCss = (root: HTMLElement, css: string): void => {
  const target = root.getRootNode() as Document | ShadowRoot;
  const done = injected.get(target) ?? new Set<string>();
  injected.set(target, done);
  if (done.has(css)) return;
  done.add(css);
  const doc = root.ownerDocument;
  // The sheet must come from the root's own window (an iframe's, say).
  const Sheet = (doc.defaultView as (Window & typeof globalThis) | null)?.CSSStyleSheet;
  if (Sheet && "adoptedStyleSheets" in target && "replaceSync" in Sheet.prototype) {
    const sheet = new Sheet();
    sheet.replaceSync(css);
    target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet];
    return;
  }
  const style = doc.createElement("style");
  style.textContent = css;
  // A shadow root is a document fragment (node type 11).
  (target.nodeType === 11 ? target : doc.head).append(style);
};

// --- caret ----------------------------------------------------------------------------

/** Elements the caret doesn't go into: it goes after them. */
const CARET_STOP = new Set(["math", "svg", "pre", "img", "hr", "br", "wbr"]);

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
    if (!last || last.nodeType !== 1 || CARET_STOP.has((last as Element).localName)) return el;
    el = last as Element;
  }
};

// --- wide blocks ----------------------------------------------------------------------

/**
 * On a box wider than the root, which the stylesheet makes scroll sideways (#95):
 * `1` on the scroll box the renderer put around it, empty on a box that scrolls itself.
 */
const WIDE = "data-typstream-wide";

/** Boxes the walk doesn't go into: they scroll whole. */
const WHOLE = new Set(["table", "math"]);

/** `el` is wider than `parent`'s content (a table, an equation, a block with a width). */
const wider = (el: Element, parent: Element): boolean => el.getBoundingClientRect().width > parent.clientWidth + 0.5;

/**
 * Collects in `found` the innermost boxes that make `el` overflow, if it does:
 * `el` is a box of its own (not inline, whose `clientWidth` is 0) in the flow,
 * not marked yet, and wider than `parent` or with content wider than itself (code). The
 * walk goes down to a table or an equation, or the box whose own lines
 * overflow. Scrolling only those leaves every other box as it was: a scroll
 * container is a formatting context, so margins inside it would stop
 * collapsing through it.
 */
const findWide = (el: Element, parent: Element, found: Element[]): void => {
  if (
    !el.clientWidth ||
    el.hasAttribute(WIDE) ||
    (el.scrollWidth <= el.clientWidth && !wider(el, parent)) ||
    // Out of flow (a placed box): a box around it wouldn't hold it.
    getComputedStyle(el).position === "absolute"
  )
    return;
  const before = found.length;
  if (!WHOLE.has(el.localName)) for (const child of el.children) findWide(child, el, found);
  if (found.length === before) found.push(el);
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

  let shell: string | null = null;
  /** The last update's split, which the next one resumes from. */
  let lastSplit: Split | null = null;
  /** Where blocks live: `root`, or the innermost wrapper of the shell. */
  let container: Element = root;
  let blocks: Block[] = [];
  let caret: Element | null = null;

  /** Puts `to` in `from`'s place, in the DOM and among the blocks' nodes (a top-level table and its scroll box). */
  const swap = (from: Element, to: Element): void => {
    from.replaceWith(to);
    for (const block of blocks) {
      const i = block.nodes.indexOf(from);
      if (i >= 0) block.nodes[i] = to;
    }
  };

  /**
   * Marks what is wider than the root, and unmarks what fits again, once laid
   * out: after updates, and when the root's size changes (its width, or fonts
   * that arrived). A marked box is focusable, so the keyboard can scroll it.
   * It has no name of its own: what it holds (a table, an equation, code)
   * is announced with it.
   */
  const fit = (): void => {
    // By the measure that marked them: a scroll box's content is no longer wider than it, a box's lines fit.
    const fits = [...root.querySelectorAll(`[${WIDE}]`)].filter((el) =>
      el.getAttribute(WIDE) ? !wider(el.firstElementChild as Element, el) : el.scrollWidth <= el.clientWidth,
    );
    const wide: Element[] = [];
    for (const child of container.children) findWide(child, container, wide);
    for (const el of fits) {
      if (el.getAttribute(WIDE)) swap(el, el.firstElementChild as Element);
      el.removeAttribute(WIDE);
      el.removeAttribute("tabindex");
    }
    for (const el of wide) {
      let box = el;
      // A box wider than its parent scrolls in a `div` as wide as the parent: browsers other than
      // Chromium don't scroll a `math` element, a table would have to be made a block (another
      // layout), and a box with a width of its own would only be cut narrower.
      if (wider(el, el.parentElement as Element)) {
        box = doc.createElement("div");
        box.setAttribute(WIDE, "1");
        swap(el, box);
        box.append(el);
      } else box.setAttribute(WIDE, "");
      box.setAttribute("tabindex", "0");
    }
  };
  // Before the next paint. An update and the resize it causes land in different frames: nothing to coalesce.
  const refit = () => view.requestAnimationFrame(fit);
  const resized = new view.ResizeObserver(refit);
  resized.observe(root);

  /** Parses and sanitizes markup into nodes owned by the page's document. */
  const parse = (html: string): Node[] => {
    // Under Trusted Types (#70) through typstream's policy: the template is inert, and sanitized next.
    template.innerHTML = trustedHTML(hideStyles(html));
    const content = template.content;
    sanitize(content);
    // Moving the cleaned nodes adopts them into the page's document.
    const fragment = doc.createDocumentFragment();
    fragment.append(...Array.from(content.childNodes));
    return Array.from(fragment.childNodes);
  };

  const setSrc = (block: Block, src: number | null): void => {
    if (block.src === src) return;
    block.src = src;
    // On the block's own element, not the scroll box the renderer may have put around it.
    let el = firstElement(block.nodes);
    if (el?.getAttribute(WIDE)) el = el.firstElementChild;
    if (!el) return;
    if (src === null) el.removeAttribute(SRC_ATTRIBUTE);
    else el.setAttribute(SRC_ATTRIBUTE, String(src));
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
    if (container !== root) root.replaceChildren();
    container = root;
    if (start.length === 0) return;
    const nodes = parse(start.join("") + end.join(""));
    root.replaceChildren(...nodes);
    // The innermost element along the chain of first elements.
    let el = firstElement(nodes);
    while (el?.firstElementChild) el = el.firstElementChild;
    container = el ?? root;
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
      const item = next[i] as { html: string; src: number | null };
      let block: Block | undefined;
      if (i < head) block = old[i];
      else if (i >= next.length - tail) block = old[old.length - (next.length - i)];
      else block = byKey.get(item.html)?.shift();
      if (!block) {
        block = { key: item.html, nodes: parse(item.html), src: null, timings: null };
        created.push(block);
      }
      setSrc(block, item.src);
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
      if (last.parentNode !== container || last.nextSibling !== after) {
        for (const node of nodes) container.insertBefore(node, after);
      }
      after = nodes[0] as Node;
    }
    blocks = result;

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
    refit();

    return { blocks: result.length, created: created.length, removed: removed.length, ms: view.performance.now() - t0 };
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
    caret?.remove();
    caret = null;
    for (const block of blocks) removeNodes(block);
    blocks = [];
    root.replaceChildren();
    container = root;
    shell = null;
    lastSplit = null;
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
      resized.disconnect();
      setLanguage(undefined);
      root.classList.remove("typstream");
      root.removeAttribute("data-typstream-theme");
      for (const property of ["--typstream-animation", "--typstream-duration", "--typstream-easing"]) {
        root.style.removeProperty(property);
      }
    },
  };
};
