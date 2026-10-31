// One plugin contract for the whole toolkit (PLAN §8.0). A plugin is a plain
// object with optional facets; each package reads only the facets it
// understands, so a plugin written for the renderer keeps working when the
// editor arrives, and new facets never break old plugins.

import type { Diagnostic } from "./diagnostic";
import type { TextEdit } from "./index";
import type { CompileMode, CompileTarget, FileContent } from "./protocol";

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
  /** End of that range (exclusive). */
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
  /**
   * Identifies the handler. A `settled` handler's edits are reported as lint
   * findings with this as their rule (patch reason `lint:<name>`).
   */
  name: string;
  /** Lower runs first; the default is 100. The built-in lint rules run before every handler. */
  priority?: number;
  /**
   * When it runs: `settled` on newly settled normalized text, like the lint
   * rules; `output` on the whole healed source, after tail repair.
   */
  phase: "settled" | "output";
  /** The handler's edits to `ctx.text` (see above), or `[]` when it has none. */
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
  /**
   * Text from this offset on is settled too: what is being typed is
   * `[settled, settledFrom)`, a range streaming into the middle of the document
   * (an edit). The end of the text otherwise. Fixes belong before it.
   */
  settledFrom: number;
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
 * the app allows otherwise, PLAN §9). A URL with `info` is a lazy font: the
 * engine registers it from `info` and downloads it only when a document
 * uses it (PLAN §6.4).
 * @beta
 */
export type FontSource = ({ kind: "url"; url: string } | { kind: "bytes"; data: Uint8Array }) & {
  family?: string;
  /** ISO 15924 codes the font is for, e.g. `["Beng"]`. Informational. */
  scripts?: string[];
  /**
   * The engine's metadata for the file's faces, which it selects fonts by.
   * For engine-wasm, Typst's `FontInfo` per face as JSON: what
   * `Engine.font_info(bytes)` from `@typstream/engine-wasm` returns for the
   * file (after `initSync`), computed once at build time.
   */
  info?: string;
};

/**
 * A library of fonts the engine loads by family name (PLAN §6.4): when a
 * compile names a family no loaded font has (Typst's "unknown font family"
 * warning), the engine looks it up in the catalogue's index, downloads its
 * files and compiles the document again. `@typstream/google-fonts` is one,
 * for the Google Fonts library.
 * @beta
 */
export interface FontCatalogue {
  /**
   * URL of the index, a {@link FontCatalogueIndex} as JSON. Fetched the first
   * time a document names a family the engine doesn't have.
   */
  index: string;
  /**
   * The most a family may download, in bytes; larger families (CJK fonts run
   * to 10–20 MB) aren't loaded. Default 5 MB.
   */
  maxBytes?: number;
}

/**
 * The index of a {@link FontCatalogue}, served as JSON.
 * @beta
 */
export interface FontCatalogueIndex {
  /** The format's version. */
  version: 1;
  /** The URL files' paths are relative to; itself relative to the index's URL. */
  base: string;
  /** By family name lowercased, which is how Typst compares family names. */
  families: Record<string, FontCatalogueFamily>;
}

/** A family of a {@link FontCatalogueIndex}. @beta */
export interface FontCatalogueFamily {
  /** The family's name, as its font files name it (`"Open Sans"`). */
  name: string;
  /** Its font files: one per style and weight, or a variable font per style. */
  files: FontCatalogueFile[];
}

/** A font file of a {@link FontCatalogueFamily} (TTF or OTF: Typst reads no WOFF). @beta */
export interface FontCatalogueFile {
  /** Relative to the index's `base`. */
  path: string;
  /** Its faces' style. */
  style: "normal" | "italic";
  /** Its weight (`400`), or the range of a variable font's weight axis (`[100, 900]`). */
  weight: number | [number, number];
  /** The file's size, which `maxBytes` is checked against. */
  bytes?: number;
}

/**
 * A family the engine loaded from a font catalogue: what the HTML target needs
 * to show it with the same files, as web fonts. Typst draws the paged target
 * itself.
 * @beta
 */
export interface LoadedFontFamily {
  /** The family as documents name it, lowercased (Typst's comparison). */
  family: string;
  /** The family's name, as its font files name it. */
  name: string;
  /** The files loaded, with absolute URLs. */
  files: (FontCatalogueFile & { url: string })[];
}

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
  /** The package's name, e.g. `cetz`. */
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
  /** Human-readable name, e.g. for a template picker: `"Worksheet"`. */
  title?: string;
  /** One line on what the template sets up, e.g. for a template picker. */
  description?: string;
  /** Typst evaluated before the document. */
  preamble: string;
  /** Default `sys.inputs` the template understands. */
  inputs?: Record<string, string>;
}

/** One Typst function in the prompt catalogue, generated from the package's doc comments. @public */
export interface FunctionDoc {
  /** The function's name as documents call it, e.g. `question`. */
  name: string;
  /** E.g. `question(points: int, body: content) -> content`. */
  signature: string;
  /** What the function does and how to call it: its doc comment's prose. */
  description: string;
  /** Typst that calls the function, from the doc comment's `example` block. */
  example?: string;
}

/** A few-shot example for the system prompt. @public */
export interface PromptExample {
  /** A label for the example (edu uses its file name). Not part of the prompt. */
  title?: string;
  /** What the user asked for. */
  request?: string;
  /** The Typst the model should write. */
  output: string;
}

/**
 * The name of an island's marker in Typst output (PLAN §8.4). The HTML target
 * writes an element of this name around the island's fallback, with its `name`
 * and its data as JSON in `props`. The paged target labels a `metadata` with
 * it, at the top left of the island's block; its value is a dictionary of
 * `name`, `data`, `width` and `height` (the block's size in points) and
 * `source`, content the document wrote, which locates the island in it.
 * @beta
 */
export const ISLAND_MARKER = "typstream-island";

/**
 * An interactive component that renderers mount over a Typst marker (PLAN
 * §8.4). The marker wraps its own fallback, the Typst drawing, which is what
 * prints, exports and shows wherever nothing mounts. Framework-neutral: apps
 * register a renderer for the name (`@typstream/dom`'s `islands` option,
 * `@typstream/react`'s `islands` prop); a marker becomes an island only when a
 * loaded plugin declares its name and the app registered a renderer for it.
 * @beta
 */
export interface IslandSpec<Data = unknown> {
  /** What the island shows or lets the reader do, for people and tools reading the plugin. */
  description?: string;
  /**
   * Checks the marker's data, which the document wrote and is untrusted
   * (parsed JSON in the HTML target, a Typst value in the paged one), and
   * returns what the renderer gets as `data`. `undefined` keeps the fallback.
   * Without it, the data is passed on as it is.
   */
  parse?(data: unknown): Data | undefined;
}

/**
 * What an island's renderer gets: everything comes from the marker, except
 * `isIncomplete` and `file`, which come from the document.
 * @beta
 */
export interface IslandProps<Data = unknown> {
  /** The island's name, a key of a plugin's `islands`. */
  name: string;
  /** The marker's data, through the spec's `parse`. */
  data: Data;
  /**
   * The document is streaming and the island's source is still being written:
   * it starts at or after the stable offset, so text that can change it is
   * still arriving.
   */
  isIncomplete: boolean;
  /** The target the island is shown in. */
  target: CompileTarget;
  /**
   * The island's position among the document's islands of its name, from 0:
   * its identity, which a renderer keeps across updates.
   */
  index: number;
  /**
   * A file the document has, by the path its Typst names it with: its own
   * files and the images its `resolveImage` resolved (the bytes Typst drew).
   * `null` for anything else; islands fetch nothing a document names.
   */
  file(path: string): FileContent | null;
}

/**
 * An argument of a component the editor shows in the component's form (#36),
 * so nobody writes Typst to set it: `points` of an edu question.
 * @beta
 */
export interface EditorParamSpec {
  /** The named argument. */
  name: string;
  /** Its label in the form. */
  label: string;
  /**
   * What the form edits: a number, a text (a Typst string), a yes/no, one of
   * `options`, a colour, a length (`2em`, written as typed), or `content`
   * (a `[…]` block, edited as text in the form).
   */
  type: "number" | "text" | "boolean" | "choice" | "color" | "length" | "content";
  /** The choices of a `choice`: each value's Typst source and its label. */
  options?: { value: string; label: string }[];
  /** What the function uses when the argument isn't written (Typst source), shown in the form. */
  default?: string;
  /** Smallest number allowed. */
  min?: number;
  /** Largest number allowed. */
  max?: number;
  /** Step of a number input. */
  step?: number;
  /** One line of help under the field. */
  help?: string;
}

/**
 * A component a plugin's Typst defines, as the visual editor offers it (#36):
 * in its insert menu (with `template`), and when selected with a form for
 * `params`. Plain data, so content plugins (layer 3) declare it without the editor.
 * @beta
 */
export interface EditorComponentSpec {
  /** The Typst function: `question`, `mindmap`. */
  name: string;
  /** Its name in menus: `Question`. */
  label: string;
  /** One line in the insert menu. */
  description?: string;
  /** The insert menu's group: `Questions`. */
  group?: string;
  /** An icon name the editor's toolbar knows (lucide's: `circle-help`, `network`). */
  icon?: string;
  /**
   * The Typst the insert menu writes, with `{{cursor}}` where the caret goes
   * (`#question(points: 1)[{{cursor}}]`). Without a cursor the new component is selected.
   */
  template: string;
  /** Set inline, in a paragraph (a blank to fill in), rather than a block of its own. */
  inline?: boolean;
  /** Search words for the slash menu. */
  keywords?: string[];
  /** The named arguments its form edits, in order. */
  params?: EditorParamSpec[];
}

/**
 * What a plugin gives the visual editor (#36, PLAN §10.3): its components
 * (insert menu, forms), and its calls that style text (marks, shown inline
 * and stepped over like `*`) or are set inline in a paragraph. Further facets
 * may be added; unknown ones are ignored.
 * @beta
 */
export interface EditorFacet {
  /** Components the editor can insert and edit. */
  components?: EditorComponentSpec[];
  /** Functions that style the text inside them, like `strong`: the editor steps over their code. */
  marks?: string[];
  /** Functions set inline in a paragraph even alone on a line (the editor's blocks don't split there). */
  inline?: string[];
  /** Further facets the editor may define. */
  [key: string]: unknown;
}

/**
 * A typstream plugin: a key plus any of the facets below. `@typstream/edu` is
 * one; so are a school's branded templates or a chemistry pack.
 *
 * Everything except `heal.handlers` and islands' `parse` is plain data. The engine facet is
 * especially restricted because it is sent to the worker, which can't receive
 * functions: worker-side code is referenced by module URL (`fixerModules`).
 * @public
 */
export interface TypstreamPlugin {
  /** Unique, namespaced for third parties: `"edu"`, `"acme/chemistry"`. */
  key: string;
  /** The plugin's version, e.g. its Typst package's. Informational: nothing in typstream reads it. */
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
    /**
     * Font libraries the engine loads families from by name, when a document
     * names one it doesn't have (PLAN §6.4). Unlike `fonts`, they work from a
     * document's plugins too: the fonts they load are then the worker's. @beta
     */
    fontCatalogues?: FontCatalogue[];
    /** Typst evaluated before every document, after earlier plugins' preambles. */
    preamble?: string;
  };

  /** Content. */
  templates?: TemplateSpec[];
  /** Prompt kit: what the model is told about this plugin's Typst API. */
  prompt?: { catalogue?: FunctionDoc[]; rules?: string[]; examples?: PromptExample[] };

  /** Rendering. Islands by name. @beta */
  islands?: Record<string, IslandSpec>;
  /**
   * Extra tags, attributes (by tag, `"*"` for every HTML element) and classes the
   * sanitizer lets through. Event handlers and loading attributes stay blocked,
   * `"*"` can't allow `href` or `src`, and SVG and MathML keep their own lists.
   * The HTML renderer drops every other class, so a document can't take on the
   * page's own (#69): list the ones this plugin's Typst writes, by name or as a
   * prefix (`"ts-*"`).
   */
  sanitize?: { allowTags?: string[]; allowAttrs?: Record<string, string[]>; allowClasses?: string[] };
  /**
   * CSS for the HTML this plugin's Typst writes, added to the HTML renderer and
   * to standalone HTML exports, after earlier plugins' and before the app's own.
   */
  stylesheets?: string[];

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

/**
 * The plugins to load, in the order their facets apply: each key once, and
 * every plugin after the plugins it depends on.
 *
 * - A key given more than once is loaded once, as its last definition, at the
 *   place of its first (a provider's plugin overridden by a component's).
 * - Otherwise plugins keep the order they were given in; a dependency given
 *   later moves up to just before the first plugin that needs it.
 * - A dependency that isn't among `plugins`, a cycle of dependencies, or a
 *   plugin without a key is an error: the facets of a half-loaded plugin set
 *   would compile documents differently, unnoticed.
 *
 * Facets this version of typstream doesn't know (e.g. a future `editor` facet)
 * are left alone: every package reads only the facets it understands.
 * @public
 */
export const resolvePlugins = <P extends TypstreamPlugin>(plugins: readonly P[]): P[] => {
  const byKey = new Map<string, P>();
  for (const plugin of plugins) {
    if (typeof plugin?.key !== "string" || !plugin.key) throw new Error("typstream plugin without a key");
    byKey.set(plugin.key, plugin);
  }
  const order: P[] = [];
  /** Keys of the plugins being placed, each a dependency of the one before: a cycle if one comes back. */
  const path: string[] = [];
  const place = (plugin: P): void => {
    if (order.includes(plugin)) return;
    const at = path.indexOf(plugin.key);
    if (at >= 0)
      throw new Error(
        `typstream plugins depend on each other in a cycle: ${[...path.slice(at), plugin.key].join(" → ")}`,
      );
    path.push(plugin.key);
    for (const key of plugin.dependencies ?? []) {
      const dependency = byKey.get(key);
      if (!dependency) throw new Error(`typstream plugin "${plugin.key}" depends on "${key}", which isn't loaded`);
      place(dependency);
    }
    path.pop();
    order.push(plugin);
  };
  for (const plugin of byKey.values()) place(plugin);
  return order;
};
