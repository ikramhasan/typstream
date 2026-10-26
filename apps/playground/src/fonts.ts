import { baseFonts } from "@typstream/engine-wasm/fonts";

/**
 * The engine's copy of New Computer Modern Math. html-compat's CSS sets it for
 * <math>; without it as a web font browsers can't stretch delimiters (PLAN.md §6.5).
 */
export const MATH_FONT: URL | undefined = baseFonts.find((url) => url.pathname.includes("NewCMMath"));
