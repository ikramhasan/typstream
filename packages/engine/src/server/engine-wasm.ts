// The default adapter: @typstream/engine-wasm, our wasm build of Typst 0.15.1
// (PLAN §6.1). One wasm `Engine` per document, so each keeps its own files and
// changed-page hashes; all of them share the wasm instance, and with it Typst's
// memoization cache. Fonts are fetched once and added to every document's
// engine (each copies them into wasm memory; sharing them is #11).

import type { FontSource } from "@typstream/core";
import initWasm, { Engine, type InitInput } from "@typstream/engine-wasm";
import type { AdapterDocument, EngineAdapter } from "./adapter";

/**
 * The Typst version engine-wasm compiles with.
 * @public
 */
export const TYPST_VERSION = "0.15.1";

/**
 * A font: a URL to fetch, or the bytes of a font file (TTF, OTF or TTC).
 * @public
 */
export type FontInput = string | URL | Uint8Array;

/**
 * How to load engine-wasm.
 * @public
 */
export interface EngineWasmOptions {
  /**
   * The compiler: a URL (fetched and compiled while it streams in), a fetch
   * `Response`, the bytes, or a compiled `WebAssembly.Module`. Default:
   * `engine_bg.wasm` next to engine-wasm's JS, which bundlers emit as an asset.
   */
  wasm?: InitInput | Promise<InitInput>;
  /** Fonts every document gets, in addition to those sent with `initialize`. */
  fonts?: readonly FontInput[];
}

const loadFont = async (font: FontInput): Promise<Uint8Array> => {
  if (font instanceof Uint8Array) return font;
  const response = await fetch(font);
  if (!response.ok) throw new Error(`font ${String(font)}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};

const fontInput = (font: FontSource): FontInput => (font.kind === "url" ? font.url : font.data);

/**
 * The engine-wasm {@link EngineAdapter}. Targets HTML and paged (changed-page
 * SVG); exports HTML. PDF is a separate build (#18).
 * @public
 */
export const engineWasm = (options: EngineWasmOptions = {}): EngineAdapter => {
  let fonts: Uint8Array[] = [];
  return {
    info: { name: "engine-wasm", typstVersion: TYPST_VERSION },
    targets: ["html", "paged"],
    exports: ["html"],

    async init(init) {
      const [, loaded] = await Promise.all([
        // The glue streams a URL or Response through `instantiateStreaming`.
        initWasm(options.wasm === undefined ? undefined : { module_or_path: options.wasm }),
        Promise.all([...(options.fonts ?? []), ...(init.fonts ?? []).map(fontInput)].map(loadFont)),
      ]);
      fonts = loaded;
    },

    open(): AdapterDocument {
      const engine = new Engine();
      for (const font of fonts) engine.add_font(font);
      return {
        setFiles(files) {
          for (const [path, content] of Object.entries(files)) {
            if (content === null) engine.remove_file(path);
            else if (typeof content === "string") engine.set_source(path, content);
            else engine.set_file(path, content);
          }
        },
        setInputs: (inputs) => engine.set_inputs(inputs),
        compileHtml() {
          const r = engine.compile_html();
          // `ms` covers compile, export and eviction; HTML export has no separate timing.
          return { html: r.ok ? (r.html ?? "") : null, diagnostics: r.diagnostics, compileMs: r.ms };
        },
        compilePaged({ fullPages }) {
          if (fullPages) engine.reset_pages();
          const r = engine.compile_svg_changed();
          return {
            output: r.ok ? { pageCount: r.pageCount ?? 0, changed: r.changed ?? [] } : null,
            diagnostics: r.diagnostics,
            compileMs: r.compileMs,
            exportMs: r.exportMs,
          };
        },
        close: () => engine.free(),
      };
    },

    memoryBytes: () => Engine.memory_bytes(),
  };
};
