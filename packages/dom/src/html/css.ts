// Stylesheets for rendered documents: injected once per document or shadow
// root, as constructable stylesheets where supported, so no
// `style-src 'unsafe-inline'` is needed.

const injected = new WeakMap<Node, Set<string>>();

/** Adds `css` to the document or shadow root `root` is in, unless it is there already. */
export const injectCss = (root: Node, css: string): void => {
  const target = root.getRootNode() as Document | ShadowRoot;
  const done = injected.get(target) ?? new Set<string>();
  injected.set(target, done);
  if (done.has(css)) return;
  done.add(css);
  const doc = root.ownerDocument ?? (root as Document);
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
