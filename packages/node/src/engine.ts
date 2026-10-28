// The server engine: a lazily started pool of worker threads running
// engine-wasm, with a watchdog per compile (#22). `validate`, `render` and the
// protocol server all compile through `compile` below.

import { availableParallelism } from "node:os";
import type { Diagnostic, FileContent } from "@typstream/core";
import { fromMain } from "@typstream/engine/server";
import { type Assembled, assemble, fileEntries } from "./document";
import { type FontOptions, loadFonts } from "./fonts";
import type { JobOp, JobResult } from "./jobs";
import { EnginePool, type FileEntry } from "./pool";

/** How {@link createEngine} sizes its worker pool, budgets compiles, and which fonts it loads. @public */
export interface EngineOptions extends FontOptions {
  /** Most worker threads to run at once, each compiling one document at a time. Default `min(4, cores - 1)`, at least 1. */
  workers?: number;
  /**
   * Default watchdog budget per compile, in milliseconds. A compile that takes
   * longer is stopped by terminating its worker and reported as an error
   * diagnostic with code `timeout`. Default 10,000 (PLAN §6.3, final mode).
   */
  timeoutMs?: number;
  /** Replace a worker once its wasm memory exceeds this many bytes (it never shrinks). Default 1 GiB. */
  maxMemoryBytes?: number;
}

/**
 * Compiles Typst on worker threads. Create one per process and share it;
 * {@link validate}, {@link render} and {@link createProtocolServer} use a
 * default one when none is given. Idle workers don't keep the process alive.
 * @public
 */
export interface NodeEngine {
  /** Workers currently running. They start on demand. */
  readonly workers: number;
  /** Stops every worker. Pending compiles fail; the engine can't be used afterwards. */
  close(): Promise<void>;
}

interface EngineState {
  pool: EnginePool;
  timeoutMs: number;
}

const states = new WeakMap<NodeEngine, EngineState>();

/**
 * Creates an engine. Nothing starts until the first compile: then the wasm
 * module is compiled once and fonts are loaded, and workers start as needed.
 * @public
 */
export const createEngine = (options: EngineOptions = {}): NodeEngine => {
  const pool = new EnginePool({
    fonts: () => loadFonts(options),
    maxWorkers: Math.max(1, options.workers ?? Math.min(4, availableParallelism() - 1)),
    maxMemoryBytes: options.maxMemoryBytes ?? 2 ** 30,
  });
  const engine: NodeEngine = {
    get workers() {
      return pool.size;
    },
    close: () => pool.close(),
  };
  states.set(engine, { pool, timeoutMs: options.timeoutMs ?? 10_000 });
  return engine;
};

let shared: NodeEngine | undefined;

/** The engine used when none is passed: created on first use with default options. @public */
export const defaultEngine = (): NodeEngine => {
  shared ??= createEngine();
  return shared;
};

/** Options every compile takes. @public */
export interface DocumentOptions {
  /** Typst evaluated before the document (theme, imports). Diagnostics inside it carry `file: { path: "<preamble>" }`. */
  preamble?: string;
  /** Files the document reads (images, data, other `.typ` files), by path relative to the document. */
  files?: Record<string, FileContent>;
  /** `sys.inputs`. */
  inputs?: Record<string, string>;
  /** Default: {@link defaultEngine}. */
  engine?: NodeEngine;
  /** Watchdog budget for this compile; default the engine's `timeoutMs`. */
  timeoutMs?: number;
}

/** A diagnostic typstream reports itself (not Typst): watchdog, crash. */
const ownError = (code: string, message: string, hints: string[] = []): Diagnostic => ({
  severity: "error",
  span: null,
  message,
  hints,
  trace: [],
  source: "typstream",
  code,
});

export interface Compiled {
  ok: boolean;
  /** In the document's coordinates. */
  diagnostics: Diagnostic[];
  /** Absent when the watchdog stopped the compile or the engine crashed. */
  result?: JobResult;
  /** Wall-clock milliseconds, including waiting for a worker. */
  ms: number;
}

export interface CompileRequest {
  text: string;
  op: JobOp;
  preamble?: string;
  files?: ReadonlyMap<string, FileEntry>;
  inputs?: Record<string, string>;
  timeoutMs?: number;
  /** Jobs with the same affinity prefer the same worker (its caches are warm for them). */
  affinity?: unknown;
  baseline?: string | null;
  token?: string;
}

/** Compiles a document on the engine's pool; timeouts and crashes come back as diagnostics. */
export const compile = async (engine: NodeEngine, req: CompileRequest): Promise<Compiled> => {
  const state = states.get(engine);
  if (!state) throw new TypeError("@typstream/node: not an engine from createEngine()");
  const assembled: Assembled = assemble(req.text, req.preamble, req.op !== "html");
  const timeoutMs = req.timeoutMs ?? state.timeoutMs;
  const outcome = await state.pool.run(
    {
      op: req.op,
      main: assembled.main,
      files: req.files ?? new Map(),
      inputs: req.inputs ?? {},
      baseline: req.baseline,
      token: req.token,
    },
    { timeoutMs, affinity: req.affinity },
  );
  switch (outcome.kind) {
    case "done":
      return {
        ok: outcome.result.ok,
        diagnostics: outcome.result.diagnostics.map((d) => fromMain(d, assembled.offset, assembled.preambleAt)),
        result: outcome.result,
        ms: outcome.ms,
      };
    case "timeout":
      return {
        ok: false,
        diagnostics: [
          ownError("timeout", `compiling took longer than ${timeoutMs} ms and was stopped`, [
            "a loop or recursion that never ends, or a document far larger than usual, causes this",
          ]),
        ],
        ms: outcome.ms,
      };
    case "crashed":
      return {
        ok: false,
        diagnostics: [
          ownError("engine-crashed", `the compiler ran out of memory or crashed (${outcome.message})`, [
            "building a huge array, string or document causes this",
          ]),
        ],
        ms: outcome.ms,
      };
    case "error":
      throw new Error(`@typstream/node: the engine rejected the document: ${outcome.message}`);
  }
};

/** {@link compile} for one-shot callers (`validate`, `render`): files from {@link DocumentOptions}. */
export const compileOnce = (text: string, op: JobOp, options: DocumentOptions): Promise<Compiled> =>
  compile(options.engine ?? defaultEngine(), {
    text,
    op,
    preamble: options.preamble,
    files: fileEntries(options.files),
    inputs: options.inputs,
    timeoutMs: options.timeoutMs,
  });
