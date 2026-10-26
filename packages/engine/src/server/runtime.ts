// typstream's runtime library: Typst functions the worker's fixes put into a
// document (PLAN §5.5), so a placeholder stands where the document can't
// compile yet. It's mounted in every document's file system, and compiles that
// carry fixes import it as `typstream` after the preamble. A document's own
// file at the same path replaces it, e.g. to restyle the placeholders.
//
// In HTML, placeholders are spans with a class (`typstream-pending-ref`) and an
// inline style, so they look muted with or without the renderer's CSS.

/**
 * Where the runtime library is mounted in every document's files.
 * @public
 */
export const RUNTIME_PATH = "/@typstream/runtime.typ";

/** The line in front of a fixed document (after its preamble) that brings the library into scope. */
export const RUNTIME_IMPORT = `#import "${RUNTIME_PATH}" as typstream\n`;

/** The library's source. */
export const RUNTIME = `// typstream runtime library: placeholders for what a streamed document
// doesn't have yet. Imported as \`typstream\` by fixed compiles only.

#let _muted(class, body) = context if target() == "html" {
  html.elem("span", attrs: (class: class, style: "opacity: 0.55"), body)
} else {
  text(fill: luma(45%), body)
}

/// A reference whose label doesn't exist yet: a citation before its
/// \`#bibliography\`, a label that hasn't streamed in, or a name still being
/// typed. Shows the key.
#let pending-ref(key) = _muted("typstream-pending-ref", key)
`;

/** `s` as a Typst string literal. */
export const typstString = (s: string): string => `"${s.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
