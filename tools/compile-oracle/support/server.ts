// The engine's protocol server (`@typstream/engine/server`) over the oracle's
// engine, so prefixes go through the real Layer 3 fix loop (#20) and Layer 4
// fallback (#21): the same runtime library, rounds and budgets as in the
// browser worker. Anchors are off; they don't change what compiles
// (packages/engine/__tests__/anchors.test.ts).
import {
  type CompileMode,
  type CompileResult,
  type Diagnostic,
  type FallbackParams,
  PROTOCOL_VERSION,
  type RequestMethod,
  type ServerMessage,
} from "@typstream/core";
import type { EngineAdapter } from "../../../packages/engine/src/server/adapter";
import { createServer, type EngineServer } from "../../../packages/engine/src/server/server";
import type { Engine } from "./engine";
import type { Target } from "./measure";

export interface ServerCompile {
  result: CompileResult;
  diagnostics: Diagnostic[];
  /** Compiles the server ran for an artifact: 1, plus one per fix round and per fallback attempt. */
  compiles: number;
  /** Compiles the fallback ran only to check a prefix. */
  checks: number;
}

/**
 * An adapter over one shared engine. The oracle has set the document's other
 * files on it already; closing a document leaves the engine alone.
 */
const adapter = (engine: Engine, counter: { compiles: number; checks: number }): EngineAdapter => ({
  info: { name: "compile-oracle", typstVersion: "0.15.1" },
  targets: ["html", "paged"],
  exports: [],
  init: async () => {},
  open: () => ({
    setFiles(files) {
      for (const [path, content] of Object.entries(files)) {
        if (content === null) engine.remove_file(path);
        else if (typeof content === "string") engine.set_source(path, content);
        else engine.set_file(path, content);
      }
    },
    setInputs: (inputs) => engine.set_inputs(inputs),
    compileHtml() {
      counter.compiles++;
      const r = engine.compile_html();
      return { html: r.ok ? (r.html ?? "") : null, diagnostics: r.diagnostics };
    },
    compilePaged({ fullPages }) {
      counter.compiles++;
      if (fullPages) engine.reset_pages();
      const r = engine.compile_svg_changed();
      return {
        output: r.ok ? { pageCount: r.pageCount ?? 0, changed: r.changed ?? [] } : null,
        diagnostics: r.diagnostics,
      };
    },
    check({ target }) {
      counter.checks++;
      return { diagnostics: (target === "html" ? engine.compile_html() : engine.check_paged()).diagnostics };
    },
    close: () => {},
  }),
});

/** A protocol client for one document, compiling streamed healed sources. */
export class OracleServer {
  private readonly server: EngineServer;
  private readonly counter = { compiles: 0, checks: 0 };
  private readonly waiting = new Map<number, (m: ServerMessage) => void>();
  private diagnostics: Diagnostic[] = [];
  private id = 0;
  private rev = 0;
  private text = "";

  private constructor(engine: Engine) {
    this.server = createServer(adapter(engine, this.counter), (m) => {
      if ("id" in m) this.waiting.get(m.id)?.(m);
      else if (m.method === "document/diagnostics") this.diagnostics = m.params.diagnostics;
    });
  }

  static async open(engine: Engine): Promise<OracleServer> {
    const s = new OracleServer(engine);
    await s.request("initialize", { protocolVersion: PROTOCOL_VERSION, capabilities: { pagedDiff: true } });
    await s.request("document/open", { uri: "doc", rev: 0, text: "" });
    return s;
  }

  private request(method: RequestMethod, params: unknown): Promise<unknown> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, (m) => {
        this.waiting.delete(id);
        if ("error" in m && m.error) reject(new Error(m.error.message));
        else resolve("result" in m ? m.result : undefined);
      });
      this.server.receive({ id, method, params } as never);
    });
  }

  /**
   * Compiles `text` as the client would: while streaming with heal's stable
   * offset as `settled`; in final mode all of it settled. `fallback` as the
   * client sends it (Layer 4); without it, Layer 3 only.
   */
  async compile(
    text: string,
    settled: number,
    target: Target,
    options: { mode?: CompileMode; fallback?: FallbackParams } = {},
  ): Promise<ServerCompile> {
    this.rev++;
    await this.request("document/edit", {
      uri: "doc",
      rev: this.rev,
      edits: [{ from: 0, to: this.text.length, insert: text }],
    });
    this.text = text;
    this.counter.compiles = 0;
    this.counter.checks = 0;
    const mode = options.mode ?? "streaming";
    const result = (await this.request("compile", {
      uri: "doc",
      rev: this.rev,
      target,
      mode,
      settled: mode === "streaming" ? settled : undefined,
      anchors: false,
      fallback: options.fallback,
    })) as CompileResult;
    return { result, diagnostics: this.diagnostics, compiles: this.counter.compiles, checks: this.counter.checks };
  }
}
