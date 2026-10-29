// Messages between the engine pool (main thread) and its workers. Types only:
// worker.ts must stay runnable as plain TypeScript by Node, so it imports
// nothing at runtime except engine-wasm.

import type { Diagnostic, PageUpdate } from "@typstream/core";

/** What a job compiles to. `check` is a paged compile without export; `docx`, a DOCX export's document model. */
export type JobOp = "check" | "html" | "svg" | "pdf" | "docx";

/** A virtual file as a worker should hold it. `data` is omitted when the worker already has `version`. */
export interface JobFile {
  /** Absolute virtual path, e.g. `/img/a.png`. */
  path: string;
  version: number;
  data?: string | Uint8Array;
}

export interface Job {
  op: JobOp;
  /** `/main.typ`: the preamble (if any) followed by the document. */
  main: string;
  /** Every file the document can read. Files the worker holds that aren't listed are removed. */
  files: JobFile[];
  inputs: Record<string, string>;
  /**
   * `svg` only. The worker's changed-page baseline is valid only if its last
   * successful `svg` job had token `baseline`; otherwise it exports every page.
   * After success, its baseline is `token`.
   */
  baseline?: string | null;
  token?: string;
}

export interface JobResult {
  ok: boolean;
  /** engine-wasm diagnostics: core's shape, positions in `main`. */
  diagnostics: Diagnostic[];
  pageCount?: number;
  html?: string;
  pdf?: Uint8Array;
  /** `docx`: the document model as JSON, and the data of the fonts it names. */
  model?: string;
  fonts?: Uint8Array[];
  /** `svg`: exported pages (engine-wasm's frame hash and size included); all of them when `full`. */
  pages?: PageUpdate[];
  full?: boolean;
  compileMs: number;
  exportMs?: number;
}

export type WorkerRequest = { id: number; job: Job };

export type WorkerReply =
  | { id: number; ok: true; result: JobResult; memoryBytes: number }
  /** `crashed`: the wasm instance trapped (out of memory, a Typst panic) and must not be reused. */
  | { id: number; ok: false; message: string; crashed: boolean };

/** `workerData` of a pool worker. */
export interface WorkerInit {
  module: WebAssembly.Module;
  fonts: Uint8Array[];
}
