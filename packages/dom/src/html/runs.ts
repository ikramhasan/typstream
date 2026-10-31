// Passes over a block's parsed HTML that make its inline content lay out as Typst's: spaces Typst drops around
// spacing, fractional spacing in a line, and text in spans of its own (the pages' line boxes, the caret, fade-in).

/** Inline elements: a run of inline content goes on through them. */
const INLINE_TAGS = new Set([
  "span",
  "a",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "s",
  "sub",
  "sup",
  "code",
  "mark",
  "small",
  "q",
  "cite",
  "abbr",
  "kbd",
  "samp",
  "var",
  "del",
  "ins",
  "math",
  "svg",
  "img",
  "br",
  "wbr",
]);
const inline = (node: Node): boolean =>
  node.nodeType !== 1 ||
  (INLINE_TAGS.has((node as Element).localName) && !/\bts-(?:b|v)\b/.test((node as Element).className));

/** The nearest block-level element around `node`. */
const blockOf = (node: Node): Node | null => {
  let at = node.parentNode;
  while (at && at.nodeType === 1 && inline(at)) at = at.parentNode;
  return at;
};

/** The text beside `from` in its paragraph, `forward` or back, skipping empty text. */
const besideText = (from: Node, forward: boolean, doc: Document): Text | null => {
  const walker = doc.createTreeWalker(blockOf(from) ?? from, 4);
  walker.currentNode = from;
  // Back from an element: its own text (none for spacing) isn't before it.
  for (
    let t = forward ? walker.nextNode() : walker.previousNode();
    t;
    t = forward ? walker.nextNode() : walker.previousNode()
  ) {
    if ((t as Text).data === "") continue;
    return blockOf(t) === blockOf(from) ? (t as Text) : null;
  }
  return null;
};

/**
 * Typst drops the space after spacing (`h`) and, for fractional spacing, the one before it too (realize.rs,
 * collapse_spaces). html-compat's spacing is an element by then, so its HTML keeps them.
 */
export const collapseSpaces = (root: ParentNode, doc: Document): void => {
  for (const h of root.querySelectorAll(".ts-h, .ts-hfill")) {
    const after = besideText(h, true, doc);
    if (after && /^\s/.test(after.data)) after.data = after.data.replace(/^\s+/, "");
    if (!h.classList.contains("ts-hfill")) continue;
    const before = besideText(h, false, doc);
    if (before && /\s$/.test(before.data)) before.data = before.data.replace(/\s+$/, "");
  }
};

/**
 * Lays out each run of inline content that holds fractional spacing (html-compat's `.ts-hfill`, `h(1fr)`) as
 * Typst's line does (`Left #h(1fr) Right`, a question's points at the end of its line). With one spacing, the run
 * is a block of its own (`typstream-fill`) whose text breaks into lines as it would without it, the pages then
 * giving the spacing what its line leaves. With more, a row (`typstream-row`): its pieces between the spacing are
 * its items (`typstream-seg`), the spacing growing between them. Done here, as the HTML comes, so it holds
 * whatever wrote the run: a `context`, a set rule, a helper function.
 */
export const rowRuns = (root: ParentNode, doc: Document): void => {
  const spacers = Array.from(root.querySelectorAll(".ts-hfill"));
  const done = new Set<Node>();
  for (const spacer of spacers) {
    if (done.has(spacer) || spacer.parentElement?.classList.contains("typstream-row")) continue;
    // The run: the inline siblings around it, up to block-level content.
    let first: Node = spacer;
    while (first.previousSibling && inline(first.previousSibling)) first = first.previousSibling;
    let last: Node = spacer;
    while (last.nextSibling && inline(last.nextSibling)) last = last.nextSibling;
    const row = doc.createElement("span");
    row.className = "typstream-row";
    (first.parentNode as Node).insertBefore(row, first);
    // One spacing: the text wraps as Typst's lines do, the spacing as wide as its line leaves (the pages size it).
    const run: Node[] = [];
    for (let node: Node | null = first; node; node = node === last ? null : node.nextSibling) run.push(node);
    if (run.filter((n) => (n as Element).classList?.contains("ts-hfill")).length === 1) {
      row.className = "typstream-fill";
      done.add(spacer);
      row.append(...run);
      continue;
    }
    let seg = doc.createElement("span");
    seg.className = "typstream-seg";
    for (let node: Node | null = first, next: Node | null; node; node = next) {
      next = node === last ? null : node.nextSibling;
      if ((node as Element).classList?.contains("ts-hfill")) {
        done.add(node);
        row.append(seg, node);
        seg = doc.createElement("span");
        seg.className = "typstream-seg";
      } else seg.append(node);
    }
    row.append(seg);
  }
};

/**
 * Wraps text in spans (`typstream-t`): with the pages' CSS, only they have a line box (Typst's 1.3em, the engine's
 * fonts putting the baseline where Typst does) and every element around them has none, so a line is as tall as the text
 * on it, as in Typst, not at least as tall as a strut of its block's or a `<strong>`'s size. Whitespace alone is left
 * out, and math and drawings, which aren't text.
 */
export const wrapRuns = (root: ParentNode, doc: Document): void => {
  const walker = doc.createTreeWalker(root, 4);
  const runs: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = n.parentElement;
    if (!parent || !(n as Text).data.trim() || parent.closest("math, svg, script, style")) continue;
    runs.push(n as Text);
  }
  for (const text of runs) {
    const span = doc.createElement("span");
    span.className = "typstream-t";
    text.replaceWith(span);
    span.append(text);
  }
};
