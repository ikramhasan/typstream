// MathML needs a math font: without one, browsers can't stretch delimiters or
// pick math italics (PLAN §6.5). html-compat's CSS asks for Typst's own,
// New Computer Modern Math, which the engine ships with its base fonts.

/** The family html-compat's stylesheet uses for `math`. */
const MATH_FAMILY = "New Computer Modern Math";

/**
 * Registers New Computer Modern Math as a web font in `doc`, for MathML. Pass
 * the URL of the engine's copy (`@typstream/engine-wasm/fonts`) or your own.
 * Uses the FontFace API, so no `font-src` exception for inline CSS is needed.
 * @public
 */
export const registerMathFont = async (url: string | URL, doc: Document = document): Promise<void> => {
  const view = doc.defaultView as (Window & typeof globalThis) | null;
  if (!view) throw new Error("registerMathFont: the document has no window");
  for (const face of doc.fonts) if (face.family.replace(/"/g, "") === MATH_FAMILY) return;
  const face = new view.FontFace(MATH_FAMILY, `url(${JSON.stringify(String(url))})`);
  doc.fonts.add(face);
  await face.load();
};
