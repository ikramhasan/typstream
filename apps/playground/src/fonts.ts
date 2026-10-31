import type { TypstFont } from "@typstream/dom";
import { baseFonts, extraFonts, scriptFonts } from "@typstream/engine-wasm/fonts";

/**
 * The engine's copy of New Computer Modern Math. html-compat's CSS sets it for
 * <math>; without it as a web font browsers can't stretch delimiters (PLAN.md §6.5).
 */
export const MATH_FONT: URL | undefined = baseFonts.find((url) => url.pathname.includes("NewCMMath"));

/** The families of the base fonts, which come without metadata, by the start of their file's name. */
const BASE_FAMILIES: Record<string, string> = {
  LibertinusSerif: "Libertinus Serif",
  NewCMMath: "New Computer Modern Math",
  DejaVuSansMono: "DejaVu Sans Mono",
};

const variant = (file: string): Pick<TypstFont, "weight" | "style"> => ({
  weight: /Semibold/.test(file) ? 600 : /Bold/.test(file) ? 700 : 400,
  style: /Italic|Oblique/.test(file) ? "italic" : "normal",
});

/** The engine's fonts, for the HTML target to set its text in as the pages do (as `typstream` registers them). */
export const TYPST_FONTS: readonly TypstFont[] = [
  ...baseFonts.flatMap((url) => {
    const file = url.pathname.split("/").pop() ?? "";
    const family = Object.entries(BASE_FAMILIES).find(([name]) => file.startsWith(name))?.[1];
    return family ? [{ url, family, ...variant(file) }] : [];
  }),
  ...[...extraFonts, ...scriptFonts].map(({ url, file, family }) => ({ url, family, ...variant(file) })),
];
