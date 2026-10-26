// typstream's runtime library: Typst functions the worker's fixes (PLAN §5.5)
// and fallbacks (§5.6) put into a document, so a placeholder stands where the
// document can't compile yet, or can't compile at all. It's mounted in every
// document's file system, and compiles the worker changed import it as
// `typstream` after the preamble. A document's own file at the same path
// replaces it, e.g. to restyle the placeholders.
//
// In HTML, placeholders carry a class (`typstream-pending-ref`,
// `typstream-pending-text`, `typstream-error-block`) and inline styles, so they
// look right with or without the renderer's CSS.

/**
 * Where the runtime library is mounted in every document's files.
 * @public
 */
export const RUNTIME_PATH = "/@typstream/runtime.typ";

/** The line in front of a fixed document (after its preamble) that brings the library into scope. */
export const RUNTIME_IMPORT = `#import "${RUNTIME_PATH}" as typstream\n`;

/** The library's source. */
export const RUNTIME = `// typstream runtime library: placeholders for what a streamed document
// doesn't have yet, or can't compile. Imported as \`typstream\` by compiles
// the worker changed only.

#let _muted(class, body) = context if target() == "html" {
  html.elem("span", attrs: (class: class, style: "opacity: 0.55"), body)
} else {
  text(fill: luma(45%), body)
}

/// A reference whose label doesn't exist yet: a citation before its
/// \`#bibliography\`, a label that hasn't streamed in, or a name still being
/// typed. Shows the key.
#let pending-ref(key) = _muted("typstream-pending-ref", key)

/// The unsettled end of a streamed document while it doesn't compile, as
/// plain text with its line breaks.
#let pending-text(source) = context if target() == "html" {
  html.elem("div", attrs: (class: "typstream-pending-text", style: "opacity: 0.55; white-space: pre-wrap"), source)
} else {
  block(text(fill: luma(45%), source))
}

/// A top-level block that doesn't compile, in its place: a note, the error,
/// and the block's source (folded away in HTML).
#let error-block(source, message) = context if target() == "html" {
  html.elem("div", attrs: (
    class: "typstream-error-block",
    role: "note",
    style: "border: 1px dashed; border-radius: 4px; padding: 0.5em 0.75em; margin: 0.75em 0",
  ), {
    html.elem("p", attrs: (style: "margin: 0; font-weight: bold"), [This part couldn't be displayed.])
    html.elem("p", attrs: (class: "typstream-error-message", style: "margin: 0.25em 0 0; opacity: 0.7"), message)
    if source != "" {
      html.elem("details", {
        html.elem("summary", attrs: (style: "opacity: 0.7"), [Source])
        html.elem("pre", attrs: (style: "white-space: pre-wrap; margin: 0.25em 0 0"), source)
      })
    }
  })
} else {
  block(width: 100%, breakable: true, inset: 8pt, radius: 3pt, stroke: (paint: luma(60%), thickness: 0.5pt, dash: "dashed"), {
    set text(fill: luma(30%))
    strong[This part couldn't be displayed.]
    linebreak()
    text(size: 0.85em, message)
    if source != "" { block(above: 0.8em, text(size: 0.8em, raw(source, block: true))) }
  })
}

/// Stands for what a document imported from a package it can't have (not
/// allowed, still loading, failed to load): a function that shows the
/// package's spec wherever it is called.
#let missing-package(spec) = (..args) => _muted("typstream-missing-package", [[#spec]])
`;

const ESCAPES: Record<string, string> = { "\n": "\\n", "\r": "\\r", "\t": "\\t", "\\": "\\\\", '"': '\\"' };

/** `s` as a Typst string literal, with line breaks and other control characters escaped. */
export const typstString = (s: string): string =>
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it escapes.
  `"${s.replace(/[\\"\u0000-\u001f\u007f]/g, (c) => ESCAPES[c] ?? `\\u{${c.charCodeAt(0).toString(16)}}`)}"`;
