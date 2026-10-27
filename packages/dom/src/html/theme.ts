// The theme, on its own so standalone exports (../export/) don't bundle the
// renderer's animation and MathML CSS: a template literal with substitutions
// isn't pure to bundlers, so styles.ts would come along whole.

/**
 * Theme variables and element colors, shared by the renderer and standalone exports.
 * The last rule is for right-to-left text, which Typst's HTML export doesn't mark,
 * even under `text(lang: "ar")` (#11): each paragraph takes its direction from its
 * first strong letter, as `dir="auto"` would, so Arabic aligns right. (The
 * renderer also sets `dir` on its root from the document's language, which
 * orders lists and tables.)
 *
 * What the document filled (an inline `background`: a box, a table cell, a code
 * block) has the light theme's colors inside: the author chose the fill for dark
 * text, as on paper. Placed pieces that html-compat marks as pointing outward
 * (`ts-place-out`: a shape's dimension labels below or beside it) sit on the page,
 * so they keep the theme (`light dark` follows the OS under `auto`).
 */
export const THEME_CSS = `/* Theme. "auto" follows the page's color-scheme; set color-scheme: light dark on it to follow the OS. */
:where(.typstream) {
  --typstream-foreground: light-dark(#1c1c1e, #e8e8ea);
  --typstream-muted: light-dark(#5c5c63, #a4a4ab);
  --typstream-link: light-dark(#1d4ed8, #8ab4ff);
  --typstream-highlight: light-dark(#fff2a8, #6b5b00);
  --typstream-caret-color: currentColor;
  color: var(--typstream-foreground);
  overflow-wrap: break-word;
}
:where(.typstream[data-typstream-theme="light"]) {
  color-scheme: light;
}
:where(.typstream[data-typstream-theme="dark"]) {
  color-scheme: dark;
}
:where(.typstream [style*=background]) {
  color-scheme: light;
}
:where(.typstream [style*=background] .ts-place-out) {
  color-scheme: light dark;
}
:where(.typstream[data-typstream-theme=light] [style*=background] .ts-place-out) {
  color-scheme: light;
}
:where(.typstream[data-typstream-theme=dark] [style*=background] .ts-place-out) {
  color-scheme: dark;
}
:where(.typstream [style*=background], .typstream [style*=background] .ts-place-out) {
  color: var(--typstream-foreground);
}
:where(.typstream) a {
  color: var(--typstream-link);
}
:where(.typstream) mark {
  background: var(--typstream-highlight);
  color: inherit;
}
:where(.typstream) figcaption {
  color: var(--typstream-muted);
}
:where(.typstream) img,
:where(.typstream) svg {
  max-width: 100%;
}
:where(.typstream) :is(p, li, dt, dd, h1, h2, h3, h4, h5, h6, th, td, figcaption, blockquote) {
  unicode-bidi: plaintext;
}
`;
