// typstream (PLAN §4.1): the convenience package, like `streamdown`. One
// import for the React component with the defaults an app wants: html-compat
// (layout survives HTML export), the engine's math font for MathML, and the
// Typst packages @typstream/universe vendors (diagrams, math, chemistry).
// Everything else is @typstream/react's, plus the engine and healer for apps
// that drive documents themselves.

import { baseFonts } from "@typstream/engine-wasm/fonts";
import { htmlCompat } from "@typstream/html-compat";
import { type TypstreamProps as BaseProps, Typstream as BaseTypstream } from "@typstream/react";
import { universe } from "@typstream/universe";

/** The engine's copy of New Computer Modern Math, the font html-compat's CSS asks for in `<math>`. */
const MATH_FONT = baseFonts.find((url) => url.pathname.includes("NewCMMath"));

/** Props of {@link Typstream}. @public */
export interface TypstreamProps extends BaseProps {
  /**
   * Add the `@typstream/html-compat` plugin (its preamble, the sanitizer
   * allowances and its stylesheet), so grids, alignment and shapes survive the
   * HTML target. Default true.
   */
  htmlCompat?: boolean;
  /**
   * Add the `@typstream/universe` plugin: documents may import the Typst
   * packages it vendors (CeTZ, fletcher, cetz-plot, physica, unify,
   * chemformula, alchemist), fetched from the app's own origin when a document
   * imports one. Default true.
   */
  packages?: boolean;
}

/**
 * `@typstream/react`'s `<Typstream>` with the html-compat and universe plugins
 * (before the `plugins` given) and the math font set up.
 *
 * @example
 * ```tsx
 * import { Typstream } from "typstream";
 *
 * <Typstream source={text} isStreaming={status === "streaming"} animated caret />
 * ```
 * @public
 */
export const Typstream = ({
  htmlCompat: compat = true,
  packages = true,
  plugins,
  mathFont,
  ...props
}: TypstreamProps) => (
  <BaseTypstream
    {...props}
    plugins={[...(compat ? [htmlCompat] : []), ...(packages ? [universe] : []), ...(plugins ?? [])]}
    mathFont={mathFont ?? MATH_FONT}
  />
);

export { createEngine, type EngineOptions, engineWorker } from "@typstream/engine";
export { createHealer, type Healer, type HealOptions, type HealResult, heal } from "@typstream/heal";
export { htmlCompat, htmlCompatCss } from "@typstream/html-compat";
export {
  type AppliedFix,
  type CompiledEvent,
  type CompileReport,
  type DocumentEvent,
  type DocumentState,
  type DocumentStatus,
  type Engine,
  type FallbackEvent,
  type FallbackLevel,
  type RenderedEvent,
  type TelemetryHooks,
  type TypstreamDefaults,
  type TypstreamHandle,
  type TypstreamInfo,
  TypstreamProvider,
  type TypstreamProviderProps,
  useTypstream,
  type WatchdogEvent,
} from "@typstream/react";
export { UNIVERSE_PACKAGES, type UniversePackage, universe } from "@typstream/universe";
