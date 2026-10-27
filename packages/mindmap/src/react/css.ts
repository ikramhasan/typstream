// Stylesheets for the interactive map, adopted by the document or shadow root it renders in as
// constructable stylesheets: no `<style>` element, so a strict CSP (`style-src 'self'`) and
// Trusted Types need nothing more (as @typstream/dom's own styles).

const adopted = new WeakMap<Node, Set<string>>();

/** Adds `css` to the document or shadow root `node` is in, unless it is there already. */
export const adoptCss = (node: Node, css: string): void => {
  const root = node.getRootNode() as Document | ShadowRoot;
  const done = adopted.get(root) ?? new Set<string>();
  adopted.set(root, done);
  if (done.has(css)) return;
  done.add(css);
  // The sheet must come from the node's own window (an iframe's, say).
  const Sheet =
    (node.ownerDocument?.defaultView as (Window & typeof globalThis) | null)?.CSSStyleSheet ?? CSSStyleSheet;
  const sheet = new Sheet();
  sheet.replaceSync(css);
  root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
};
