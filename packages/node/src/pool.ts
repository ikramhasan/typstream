// A pool of worker threads, each running engine-wasm (see worker.ts). Wasm can
// be interrupted where native code can't (#22), so the watchdog is simply
// `worker.terminate()`: a runaway compile costs one worker, never the process.
//
// Workers are caches, not state: the caller sends the full source and file
// list with every job, and the pool sends file bytes only to workers that
// don't have that version yet.

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import type { Job, JobFile, JobOp, JobResult, WorkerInit, WorkerReply } from "./jobs";

/** A file version: content plus a number that changes whenever the content does. */
export interface FileEntry {
  version: number;
  data: string | Uint8Array;
}

export interface PoolJob {
  op: JobOp;
  main: string;
  /** By absolute virtual path. */
  files: ReadonlyMap<string, FileEntry>;
  inputs: Record<string, string>;
  baseline?: string | null;
  token?: string;
}

export type Outcome =
  | { kind: "done"; result: JobResult; ms: number }
  /** The watchdog fired; the worker was terminated. */
  | { kind: "timeout"; ms: number }
  /** The engine trapped (e.g. a memory bomb hit wasm32's limit) or the worker died; it was replaced. */
  | { kind: "crashed"; message: string; ms: number }
  /** The engine rejected the job (e.g. an invalid file path). The worker is fine. */
  | { kind: "error"; message: string; ms: number };

export interface PoolOptions {
  fonts: () => Uint8Array[];
  maxWorkers: number;
  /** A worker whose wasm memory grows past this is replaced after its job (wasm memory never shrinks). */
  maxMemoryBytes: number;
}

interface Pending {
  id: number;
  job: Job;
  t0: number;
  timer: ReturnType<typeof setTimeout>;
  resolve(outcome: Outcome): void;
}

interface Slot {
  worker: Worker;
  /** Path → version the worker holds, as far as the pool knows. */
  files: Map<string, number>;
  pending: Pending | null;
  /** Key of the last job's `affinity`: its document, so Typst's caches stay warm for it. */
  affinity: unknown;
  retire: boolean;
}

interface Queued {
  job: PoolJob;
  timeoutMs: number;
  affinity: unknown;
  resolve(outcome: Outcome): void;
}

const requireHere = createRequire(import.meta.url);

/** dist/worker.js when built; worker.ts (run by Node's type stripping) in this package's tests. */
const workerUrl = (): URL => {
  const js = new URL("./worker.js", import.meta.url);
  return existsSync(js) ? js : new URL("./worker.ts", import.meta.url);
};

export class EnginePool {
  private readonly options: PoolOptions;
  private init: Promise<WorkerInit> | null = null;
  private readonly slots: Slot[] = [];
  private readonly queue: Queued[] = [];
  private nextId = 1;
  private closed = false;

  constructor(options: PoolOptions) {
    this.options = options;
  }

  /** Workers currently alive. */
  get size(): number {
    return this.slots.length;
  }

  /**
   * Runs a job on an idle worker (preferring the one that last ran a job with
   * the same `affinity`), spawning one if all are busy and the pool isn't full.
   */
  async run(job: PoolJob, options: { timeoutMs: number; affinity?: unknown }): Promise<Outcome> {
    if (this.closed) throw new Error("@typstream/node: the engine is closed");
    // Compile the 20 MB module once; workers receive it compiled.
    this.init ??= (async () => ({
      module: await WebAssembly.compile(readFileSync(requireHere.resolve("@typstream/engine-wasm/engine_bg.wasm"))),
      fonts: this.options.fonts(),
    }))();
    const init = await this.init;
    return new Promise<Outcome>((resolve) => {
      this.queue.push({ job, timeoutMs: options.timeoutMs, affinity: options.affinity, resolve });
      this.pump(init);
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const q of this.queue.splice(0)) q.resolve({ kind: "crashed", message: "the engine was closed", ms: 0 });
    await Promise.all(this.slots.splice(0).map((slot) => this.kill(slot, "the engine was closed")));
  }

  private pump(init: WorkerInit): void {
    while (this.queue.length > 0) {
      const idle = this.slots.filter((s) => s.pending === null);
      const next = this.queue[0] as Queued;
      let slot = idle.find((s) => s.affinity === next.affinity) ?? idle[0];
      if (!slot) {
        if (this.slots.length >= this.options.maxWorkers) return;
        slot = this.spawn(init);
      }
      this.queue.shift();
      this.start(slot, next);
    }
  }

  private spawn(init: WorkerInit): Slot {
    const worker = new Worker(workerUrl(), { workerData: init });
    const slot: Slot = { worker, files: new Map(), pending: null, affinity: undefined, retire: false };
    worker.on("message", (reply: WorkerReply) => this.onReply(slot, reply));
    worker.on("error", (error: Error) => this.fail(slot, `the engine worker failed: ${error.message}`));
    worker.on("exit", (code) => this.fail(slot, `the engine worker exited (code ${code})`));
    // Idle workers don't keep the process alive; a running job's watchdog timer does.
    // After the listeners: adding a 'message' listener refs the worker again.
    worker.unref();
    this.slots.push(slot);
    return slot;
  }

  private start(slot: Slot, { job, timeoutMs, affinity, resolve }: Queued): void {
    const files: JobFile[] = [];
    for (const [path, entry] of job.files) {
      const file: JobFile = { path, version: entry.version };
      if (slot.files.get(path) !== entry.version) file.data = entry.data;
      files.push(file);
    }
    const sent: Job = {
      op: job.op,
      main: job.main,
      files,
      inputs: job.inputs,
      ...(job.op === "svg" ? { baseline: job.baseline ?? null, token: job.token } : {}),
    };
    const id = this.nextId++;
    const t0 = performance.now();
    const timer = setTimeout(() => {
      if (slot.pending?.id !== id) return;
      slot.pending = null;
      resolve({ kind: "timeout", ms: performance.now() - t0 });
      void this.kill(slot);
    }, timeoutMs);
    slot.pending = { id, job: sent, t0, timer, resolve };
    slot.affinity = affinity;
    slot.worker.postMessage({ id, job: sent });
  }

  private onReply(slot: Slot, reply: WorkerReply): void {
    const pending = slot.pending;
    if (!pending || pending.id !== reply.id) return;
    clearTimeout(pending.timer);
    slot.pending = null;
    const ms = performance.now() - pending.t0;
    if (reply.ok) {
      slot.files = new Map(pending.job.files.map((f) => [f.path, f.version]));
      if (reply.memoryBytes > this.options.maxMemoryBytes) slot.retire = true;
      pending.resolve({ kind: "done", result: reply.result, ms });
    } else if (reply.crashed) {
      pending.resolve({ kind: "crashed", message: reply.message, ms });
      void this.kill(slot);
      return;
    } else {
      // The worker may have applied part of the file list; resend everything next time.
      slot.files = new Map();
      pending.resolve({ kind: "error", message: reply.message, ms });
    }
    if (slot.retire) void this.kill(slot);
    else this.pumpIfReady();
  }

  /** The worker died on its own (an uncaught error, or it exited). */
  private fail(slot: Slot, message: string): void {
    const pending = slot.pending;
    if (pending) {
      clearTimeout(pending.timer);
      slot.pending = null;
      pending.resolve({ kind: "crashed", message, ms: performance.now() - pending.t0 });
    }
    void this.kill(slot);
  }

  private async kill(slot: Slot, message = "the engine worker was stopped"): Promise<void> {
    const index = this.slots.indexOf(slot);
    if (index !== -1) this.slots.splice(index, 1);
    const pending = slot.pending;
    if (pending) {
      clearTimeout(pending.timer);
      slot.pending = null;
      pending.resolve({ kind: "crashed", message, ms: performance.now() - pending.t0 });
    }
    slot.worker.removeAllListeners();
    // Swallow late errors from the dying thread.
    slot.worker.on("error", () => {});
    this.pumpIfReady();
    await slot.worker.terminate();
  }

  private pumpIfReady(): void {
    if (this.closed || this.queue.length === 0 || !this.init) return;
    void this.init.then((init) => this.pump(init));
  }
}
