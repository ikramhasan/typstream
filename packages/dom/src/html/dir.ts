// The direction of a language, as Typst derives it (`Lang::dir` in
// typst-library's lang.rs): typst-html writes the document's `lang` but no
// `dir`, so the renderer and the standalone export add it.

/** Languages Typst sets right to left. */
const RTL = /^(ar|dv|fa|he|ks|pa|ps|sd|ug|ur|yi)\b/i;

/** The direction Typst gives text in `lang` (`ar`, `zh-CN`). */
export const directionOf = (lang: string): "ltr" | "rtl" => (RTL.test(lang) ? "rtl" : "ltr");
