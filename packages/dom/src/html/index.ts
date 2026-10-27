// The HTML renderer (#16): sanitized, block-diffed Typst HTML with source anchors and word fade-in.
export type { AnimateOptions } from "./animate";
export { registerLoadedFont, registerMathFont } from "./fonts";
export {
  createHtmlRenderer,
  type HtmlRenderer,
  type HtmlRendererOptions,
  type HtmlUpdateOptions,
  type HtmlUpdateResult,
} from "./renderer";
export { htmlRendererCss } from "./styles";
