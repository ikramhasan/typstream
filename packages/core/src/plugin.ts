// One plugin contract for the whole toolkit (PLAN §8.0). A plugin is a plain
// object with optional facets; each package reads only the facets it
// understands, so a plugin written for the renderer keeps working when the
// editor arrives, and new facets never break old plugins.

import type { Diagnostic } from "./diagnostic";
import type { TextEdit } from "./index";
import type { CompileMode } from "./protocol";

/**
 * Typst's lexical modes, plus the inside of raw blocks and comments, which
 * handlers almost always need to leave alone.
 * @public
 */
export type SyntaxMode = "markup" | "math" | "code" | "raw" | "comment";

/** What a {@link HealHandler} sees. @public */
export interface HealHandlerContext {
  /** Normalized text (`settled`) or healed source (`output`). */
  text: string;
  /** Range the handler may change (`settled`: newly settled text; `output`: everything). */
  from: number;
  to: number;
  /** The document is complete (no tail repair runs). */
  final: boolean;
  /** Lexical mode at a position (`settled` only; `output` handlers get `markup`). */
  modeAt(pos: number): SyntaxMode;
}

/**
 * Extension point of `@typstream/heal` (PLAN §8.1): product-specific fixes,
 * run alongside the built-in lint rules (`settled`, on text whose parse can no
 * longer change) or on the final healed source (`output`). Returned edits are
 * against `ctx.text`, non-overlapping, inside `[ctx.from, ctx.to)`.
 * @public
 */
export interface HealHandler {
  name: string;
  /** Lower runs first. Built-in lint rules run at 50. */
  priority?: number;
  phase: "settled" | "output";
  run(ctx: HealHandlerContext): TextEdit[];
}

/** What a {@link DiagnosticFixer} sees. @public */
export interface FixContext {
  /**
   * The document text that was compiled, without its preamble: the client's
   * text in the first round, with earlier rounds' fixes after that.
   */
  text: string;
  /**
   * Text before this offset is settled: streaming more can't change it. Fixes
   * that drop or rewrite text still being typed belong after it. It is the end
   * of the text in final compiles, and when the client didn't say.
   */
  settled: number;
  /** The compile's mode: fixers can stay out of final compiles with {@link DiagnosticFixer.modes}. */
  mode: CompileMode;
  /** 0 for the client's text; 1 and 2 for recompiles after fixes. */
  round: number;
  /** Every error of the compile, the one being fixed included. */
  errors: readonly Diagnostic[];
}

/**
 * Layer 3 of healing (PLAN §5.5, §8.2): turns a compile error into edits that
 * should make it go away; the worker applies them and recompiles, at most twice
 * per revision. For each error, fixers are tried in priority order and the
 * first that returns edits fixes it. A round is applied only when every error
 * has a fix, since one left over fails the recompile anyway. Fixers run in the
 * worker, so plugins ship them as ES modules (`engine.fixerModules`) whose
 * default export is a fixer or an array of them.
 *
 * Fixed compiles import typstream's runtime library as `typstream`
 * (`/@typstream/runtime.typ`), so fixes can insert placeholders such as
 * `#typstream.pending-ref("key");`.
 * @public
 */
export interface DiagnosticFixer {
  /** Unique. Reported as the `source` of the errors it fixed while streaming. */
  name: string;
  /** Lower runs first. Default 50; the built-in `pending-ref` runs at 10 and the catch-all `tail-cut` at 100. */
  priority?: number;
  /** Compiles it runs in. Default: both. */
  modes?: readonly CompileMode[];
  /** Errors it is tried on: a test of the message, or of the whole diagnostic. Default: every error. */
  match?: RegExp | ((d: Diagnostic) => boolean);
  /**
   * Edits to `ctx.text` (non-overlapping, ascending) that should make `d` go
   * away, or `null` when it can't fix it. May be async, e.g. to fetch a font
   * or a package; the compile waits for it.
   */
  fix(d: Diagnostic, ctx: FixContext): TextEdit[] | null | Promise<TextEdit[] | null>;
}

/** `fix` applies a lint rule's change, `warn` only reports it. @public */
export type LintSetting = "fix" | "warn" | "off";

/**
 * A font for the engine. URLs are fetched by the worker (same origin unless
 * the app allows otherwise, PLAN §9); `family` and `scripts` let it register
 * the font before downloading it (lazy fonts, PLAN §6.4).
 * @beta
 */
export type FontSource = ({ kind: "url"; url: string } | { kind: "bytes"; data: Uint8Array }) & {
  family?: string;
  /** ISO 15924 codes the font covers, e.g. `["Beng"]`, to fetch it when the text needs it. */
  scripts?: string[];
};

/**
 * A Typst package the engine may load (`#import "@preview/cetz:0.5.3"`): an
 * entry of its allowlist (PLAN §6.4). The engine fetches it only when a
 * document imports it. A document asking for another version of an allowed
 * package gets the nearest allowed one, with a warning. Without `url`, the
 * server resolves it from its configured registry, if it has one.
 * `@typstream/universe` lists the packages typstream vendors.
 * @beta
 */
export interface PackageSpec {
  /** `preview` for Typst Universe packages. */
  namespace: string;
  name: string;
  /** `major.minor.patch`. */
  version: string;
  /** Where to fetch the `.tar.gz` from, as packages.typst.org serves it. */
  url?: string;
  /**
   * Subresource-integrity hash (`sha256-…`, `sha384-…` or `sha512-…`), checked
   * before use: of the `.tar.gz` as fetched, or of the `.tar` inside it. Prefer
   * the tar's: servers often send `.gz` files with `Content-Encoding: gzip`,
   * and browsers then hand over the tar.
   */
  integrity?: string;
}

/** A named document setup: page, fonts, header (PLAN §8.3). @public */
export interface TemplateSpec {
  /** Unique among templates, e.g. `"worksheet"`. */
  name: string;
  title?: string;
  description?: string;
  /** Typst evaluated before the document. */
  preamble: string;
  /** Default `sys.inputs` the template understands. */
  inputs?: Record<string, string>;
}

/** One Typst function in the prompt catalogue, generated from the package's doc comments. @public */
export interface FunctionDoc {
  name: string;
  /** E.g. `question(points: int, body: content) -> content`. */
  signature: string;
  description: string;
  example?: string;
}

/** A few-shot example for the system prompt. @public */
export interface PromptExample {
  title?: string;
  /** What the user asked for. */
  request?: string;
  /** The Typst the model should write. */
  output: string;
}

/**
 * Describes an interactive component the renderer swaps in for a Typst marker
 * (PLAN §8.4). Framework-neutral: bindings (`@typstream/react`) map island
 * names to components. Shape to be settled by the islands work (#28).
 * @beta
 */
export interface IslandSpec {
  description?: string;
  /** The island flows with text (`inline`) or stands as a block. Default `block`. */
  display?: "inline" | "block";
  [key: string]: unknown;
}

/**
 * Reserved for the visual editor (PLAN §10.3). Typed loosely on purpose: the
 * editor will narrow these, and plugins may fill them in early without
 * breaking when it does.
 * @beta
 */
export interface EditorFacet {
  nodes?: unknown[];
  commands?: unknown[];
  toolbar?: unknown[];
  shortcuts?: unknown[];
  slashItems?: unknown[];
  [key: string]: unknown;
}

/**
 * A typstream plugin: a key plus any of the facets below. `@typstream/edu` is
 * one; so are a school's branded templates or a chemistry pack.
 *
 * Everything except `heal.handlers` is plain data. The engine facet is
 * especially restricted because it is sent to the worker, which can't receive
 * functions: worker-side code is referenced by module URL (`fixerModules`).
 * @public
 */
export interface TypstreamPlugin {
  /** Unique, namespaced for third parties: `"edu"`, `"acme/chemistry"`. */
  key: string;
  version?: string;
  /** Keys of plugins that must be loaded too, before this one. */
  dependencies?: string[];

  /** Language (`@typstream/heal`). */
  heal?: {
    handlers?: HealHandler[];
    /** Overrides of built-in lint rules by id, e.g. `{ "currency-dollar": "fix" }`. */
    lint?: Record<string, LintSetting | boolean>;
  };

  /** Runtime (`@typstream/engine`, worker side). */
  engine?: {
    /** ES module URLs loaded inside the worker; each default-exports a {@link DiagnosticFixer} or an array of them (PLAN §8.2). */
    fixerModules?: string[];
    /** Files mounted for every document, e.g. a local Typst package's sources. */
    files?: Record<string, string | Uint8Array>;
    /** @beta */
    packages?: PackageSpec[];
    /** @beta */
    fonts?: FontSource[];
    /** Typst evaluated before every document, after earlier plugins' preambles. */
    preamble?: string;
  };

  /** Content. */
  templates?: TemplateSpec[];
  /** Prompt kit: what the model is told about this plugin's Typst API. */
  prompt?: { catalogue?: FunctionDoc[]; rules?: string[]; examples?: PromptExample[] };

  /** Rendering. Islands by name. @beta */
  islands?: Record<string, IslandSpec>;
  /** Extra tags and attributes (by tag, `"*"` for all) the sanitizer lets through. */
  sanitize?: { allowTags?: string[]; allowAttrs?: Record<string, string[]> };

  /** Editor (future). @beta */
  editor?: EditorFacet;
}

/**
 * Identity function that type-checks a plugin while keeping its literal type.
 *
 * @example
 * ```ts
 * export const chemistry = definePlugin({ key: "acme/chemistry", engine: { packages: [...] } });
 * ```
 * @public
 */
export const definePlugin = <P extends TypstreamPlugin>(plugin: P): P => plugin;
