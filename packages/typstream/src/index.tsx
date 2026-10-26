// typstream (PLAN §4.1): the convenience package, like `streamdown`. One
// import for the React component with the defaults an app wants: html-compat
// (layout survives HTML export) and the engine's math font for MathML.
// Everything else is @typstream/react's, plus the engine and healer for apps
// that drive documents themselves.

import { baseFonts } from "@typstream/engine-wasm/fonts";
import { htmlCompat, htmlCompatCss } from "@typstream/html-compat";
import { type TypstreamProps as BaseProps, Typstream as BaseTypstream } from "@typstream/react";

/** The engine's copy of New Computer Modern Math, the font html-compat's CSS asks for in `<math>`. */
const MATH_FONT = baseFonts.find((url) => url.pathname.includes("NewCMMath"));

/** Props of {@link Typstream}. @public */
export interface TypstreamProps extends BaseProps {
  /**
   * Add `@typstream/html-compat` (its preamble, the sanitizer allowances and
   * its stylesheet), so grids, alignment and shapes survive the HTML target.
   * Default true.
   */
  htmlCompat?: boolean;
}

const PLUGINS = [htmlCompat];
const STYLESHEETS = [htmlCompatCss];

/**
 * `@typstream/react`'s `<Typstream>` with html-compat and the math font set up.
 *
 * @example
 * ```tsx
 * import { Typstream } from "typstream";
 *
 * <Typstream source={text} isStreaming={status === "streaming"} animated caret />
 * ```
 * @public
 */
export const Typstream = ({ htmlCompat: compat = true, plugins, stylesheets, mathFont, ...props }: TypstreamProps) => (
  <BaseTypstream
    {...props}
    plugins={compat ? [...PLUGINS, ...(plugins ?? [])] : plugins}
    stylesheets={compat ? [...STYLESHEETS, ...(stylesheets ?? [])] : stylesheets}
    mathFont={mathFont ?? MATH_FONT}
  />
);

export { createEngine, type EngineOptions, engineWorker } from "@typstream/engine";
export { createHealer, type Healer, type HealOptions, type HealResult, heal } from "@typstream/heal";
export { htmlCompat, htmlCompatCss } from "@typstream/html-compat";
export {
  type DocumentState,
  type DocumentStatus,
  type Engine,
  type RenderedInfo,
  type TypstreamDefaults,
  type TypstreamHandle,
  type TypstreamInfo,
  TypstreamProvider,
  type TypstreamProviderProps,
  useTypstream,
} from "@typstream/react";
